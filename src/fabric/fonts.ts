import { type Canvas, Group, Textbox, cache, config, type Object as FabricObject } from "fabric"

import { refitParentGroup } from "@/fabric/groups"
import {
  FONT_FAMILIES,
  fitToContent,
  getFontFamilySpec,
  isTextObject,
  snapToRealFace,
  type FontFamilySpec,
  type TextMeasureStyle,
  type TextPropsPatch,
} from "@/fabric/text"

// The bundled font families (build spec §12, map #71). All are SIL OFL 1.1
// and ship unmodified from Fontsource (woff2, latin subset — the pre-map
// baseline was ten families / 22 files / ~732 KB as measured in #58; map
// #71's family tickets #65–#69 expand the roster per category). Variable
// families bundle one file per style covering their whole weight axis;
// static families bundle one file per real weight.
//
// The Fontsource variable packages register their faces under the
// "… Variable" family name; we write our own @font-face rules under the plain
// family name instead, so the name in the family picker, in Fabric's
// `fontFamily`, and in `config.fontPaths` (SVG export) are all the same
// string.
//
// Loading is on demand — the map #71 policy, settled in #59 (this comment is
// its canonical in-code form). The contract, in one breath: every @font-face
// registers at startup; every face fetch is caused by an explicit use or by
// an item rendered on screen; every measurement that persists or exports is
// computed against the real face — or heals on its own next load.
//
// - **Registration is up-front, loading is not.** `registerFonts()` injects
//   the rules and fills `config.fontPaths`; a cold boot on an empty design
//   fetches no font file.
// - **Loads are per face** — the exact (family, weight, style) a surface
//   needs, never a whole family: a variable package collapses to one file
//   per style, a static family fetches only the used weight/italic files.
// - **Awaited paths are bounded** ({@link FONT_LOAD_TIMEOUT_MS}): Add Text,
//   a toolbar commit, and Export await their faces, and past the bound
//   proceed with the fallback face and warn — a hung server never holds a
//   click. Restore, import, and hover previews request their faces rather
//   than awaiting them.
// - **The arrival fix-up** ({@link healFontsOnArrival}) repairs late faces:
//   a canvas never repaints when a font lands, and Fabric caches per-face
//   char widths — so when faces arrive, the objects using those families are
//   re-measured, auto-fit boxes re-fit, char caches cleared, and the stage
//   repainted. It never records history and never re-persists the draft: a
//   face correction, not a document edit.
// - **Failures never revert and never cascade**: a failed or timed-out face
//   is evicted so the next explicit touch retries it, and one 404 never
//   skips the fix-up for the families that did arrive.

// Fontsource file URLs, acquired with `new URL(…, import.meta.url)` over
// static literals — deliberately not `?url` imports: in dev a `?url` import
// is a JS stub module the browser fetches at boot, which reads as a request
// for every bundled font on a cold empty design (#63's DevTools acceptance);
// `new URL` stays an inert string until a face is actually used. Vite
// resolves each literal at build time, so the URL is fetchable in both
// environments — the injected @font-face rules and `config.fontPaths` need
// one, and the build emits the bytes as hashed assets.

/** `@fontsource-variable/inter` — variable: one file per style. */
const interNormal = new URL(
  "../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  import.meta.url,
).href
const interItalic = new URL(
  "../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-italic.woff2",
  import.meta.url,
).href
/** `@fontsource-variable/work-sans` — variable: one file per style. */
const workSansNormal = new URL(
  "../../node_modules/@fontsource-variable/work-sans/files/work-sans-latin-wght-normal.woff2",
  import.meta.url,
).href
const workSansItalic = new URL(
  "../../node_modules/@fontsource-variable/work-sans/files/work-sans-latin-wght-italic.woff2",
  import.meta.url,
).href
/** `@fontsource/barlow` — static: one file per weight and style. */
const barlow400 = new URL(
  "../../node_modules/@fontsource/barlow/files/barlow-latin-400-normal.woff2",
  import.meta.url,
).href
const barlow600 = new URL(
  "../../node_modules/@fontsource/barlow/files/barlow-latin-600-normal.woff2",
  import.meta.url,
).href
const barlow700 = new URL(
  "../../node_modules/@fontsource/barlow/files/barlow-latin-700-normal.woff2",
  import.meta.url,
).href
const barlow900 = new URL(
  "../../node_modules/@fontsource/barlow/files/barlow-latin-900-normal.woff2",
  import.meta.url,
).href
const barlow400Italic = new URL(
  "../../node_modules/@fontsource/barlow/files/barlow-latin-400-italic.woff2",
  import.meta.url,
).href
const barlow600Italic = new URL(
  "../../node_modules/@fontsource/barlow/files/barlow-latin-600-italic.woff2",
  import.meta.url,
).href
const barlow700Italic = new URL(
  "../../node_modules/@fontsource/barlow/files/barlow-latin-700-italic.woff2",
  import.meta.url,
).href
const barlow900Italic = new URL(
  "../../node_modules/@fontsource/barlow/files/barlow-latin-900-italic.woff2",
  import.meta.url,
).href
/** `@fontsource-variable/figtree` — variable: one file per style. */
const figtreeNormal = new URL(
  "../../node_modules/@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2",
  import.meta.url,
).href
const figtreeItalic = new URL(
  "../../node_modules/@fontsource-variable/figtree/files/figtree-latin-wght-italic.woff2",
  import.meta.url,
).href
/** `@fontsource-variable/space-grotesk` — variable, normal style only. */
const spaceGroteskNormal = new URL(
  "../../node_modules/@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2",
  import.meta.url,
).href
/** `@fontsource-variable/karla` — variable: one file per style. */
const karlaNormal = new URL(
  "../../node_modules/@fontsource-variable/karla/files/karla-latin-wght-normal.woff2",
  import.meta.url,
).href
const karlaItalic = new URL(
  "../../node_modules/@fontsource-variable/karla/files/karla-latin-wght-italic.woff2",
  import.meta.url,
).href
/** `@fontsource-variable/lora` — variable: one file per style. */
const loraNormal = new URL(
  "../../node_modules/@fontsource-variable/lora/files/lora-latin-wght-normal.woff2",
  import.meta.url,
).href
const loraItalic = new URL(
  "../../node_modules/@fontsource-variable/lora/files/lora-latin-wght-italic.woff2",
  import.meta.url,
).href
/** `@fontsource-variable/playfair-display` — variable: one file per style. */
const playfairNormal = new URL(
  "../../node_modules/@fontsource-variable/playfair-display/files/playfair-display-latin-wght-normal.woff2",
  import.meta.url,
).href
const playfairItalic = new URL(
  "../../node_modules/@fontsource-variable/playfair-display/files/playfair-display-latin-wght-italic.woff2",
  import.meta.url,
).href
/** `@fontsource-variable/eb-garamond` — variable: one file per style. */
const ebGaramondNormal = new URL(
  "../../node_modules/@fontsource-variable/eb-garamond/files/eb-garamond-latin-wght-normal.woff2",
  import.meta.url,
).href
const ebGaramondItalic = new URL(
  "../../node_modules/@fontsource-variable/eb-garamond/files/eb-garamond-latin-wght-italic.woff2",
  import.meta.url,
).href
/** `@fontsource-variable/libre-baskerville` — variable: one file per style. */
const libreBaskervilleNormal = new URL(
  "../../node_modules/@fontsource-variable/libre-baskerville/files/libre-baskerville-latin-wght-normal.woff2",
  import.meta.url,
).href
const libreBaskervilleItalic = new URL(
  "../../node_modules/@fontsource-variable/libre-baskerville/files/libre-baskerville-latin-wght-italic.woff2",
  import.meta.url,
).href
/** `@fontsource-variable/bodoni-moda` — variable: one file per style. */
const bodoniModaNormal = new URL(
  "../../node_modules/@fontsource-variable/bodoni-moda/files/bodoni-moda-latin-wght-normal.woff2",
  import.meta.url,
).href
const bodoniModaItalic = new URL(
  "../../node_modules/@fontsource-variable/bodoni-moda/files/bodoni-moda-latin-wght-italic.woff2",
  import.meta.url,
).href
/** `@fontsource-variable/fraunces` — variable: one file per style. */
const frauncesNormal = new URL(
  "../../node_modules/@fontsource-variable/fraunces/files/fraunces-latin-wght-normal.woff2",
  import.meta.url,
).href
const frauncesItalic = new URL(
  "../../node_modules/@fontsource-variable/fraunces/files/fraunces-latin-wght-italic.woff2",
  import.meta.url,
).href
/** `@fontsource/bebas-neue` — static, single face. */
const bebasNormal = new URL(
  "../../node_modules/@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff2",
  import.meta.url,
).href
/** `@fontsource/anton` — static, single face. */
const antonNormal = new URL(
  "../../node_modules/@fontsource/anton/files/anton-latin-400-normal.woff2",
  import.meta.url,
).href
/** `@fontsource/archivo-black` — static, single face. */
const archivoBlackNormal = new URL(
  "../../node_modules/@fontsource/archivo-black/files/archivo-black-latin-400-normal.woff2",
  import.meta.url,
).href
/** `@fontsource/alfa-slab-one` — static, single face. */
const alfaSlabOneNormal = new URL(
  "../../node_modules/@fontsource/alfa-slab-one/files/alfa-slab-one-latin-400-normal.woff2",
  import.meta.url,
).href
/** `@fontsource/bungee` — static, single face. */
const bungeeNormal = new URL(
  "../../node_modules/@fontsource/bungee/files/bungee-latin-400-normal.woff2",
  import.meta.url,
).href
/** `@fontsource/lobster` — static, single face. */
const lobsterNormal = new URL(
  "../../node_modules/@fontsource/lobster/files/lobster-latin-400-normal.woff2",
  import.meta.url,
).href
/** `@fontsource/pacifico` — static, single face. */
const pacificoNormal = new URL(
  "../../node_modules/@fontsource/pacifico/files/pacifico-latin-400-normal.woff2",
  import.meta.url,
).href
/** `@fontsource-variable/dancing-script` — variable, normal style only. */
const dancingNormal = new URL(
  "../../node_modules/@fontsource-variable/dancing-script/files/dancing-script-latin-wght-normal.woff2",
  import.meta.url,
).href
/** `@fontsource-variable/caveat` — variable, normal style only. */
const caveatNormal = new URL(
  "../../node_modules/@fontsource-variable/caveat/files/caveat-latin-wght-normal.woff2",
  import.meta.url,
).href
/** `@fontsource/great-vibes` — static, single face. */
const greatVibesNormal = new URL(
  "../../node_modules/@fontsource/great-vibes/files/great-vibes-latin-400-normal.woff2",
  import.meta.url,
).href
/** `@fontsource/patrick-hand` — static, single face. */
const patrickHandNormal = new URL(
  "../../node_modules/@fontsource/patrick-hand/files/patrick-hand-latin-400-normal.woff2",
  import.meta.url,
).href
/** `@fontsource/amatic-sc` — static: one file per real weight (400, 700). */
const amaticSc400 = new URL(
  "../../node_modules/@fontsource/amatic-sc/files/amatic-sc-latin-400-normal.woff2",
  import.meta.url,
).href
const amaticSc700 = new URL(
  "../../node_modules/@fontsource/amatic-sc/files/amatic-sc-latin-700-normal.woff2",
  import.meta.url,
).href
/** `@fontsource-variable/jetbrains-mono` — variable: one file per style. */
const jetbrainsNormal = new URL(
  "../../node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2",
  import.meta.url,
).href
const jetbrainsItalic = new URL(
  "../../node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-italic.woff2",
  import.meta.url,
).href
/** `@fontsource/space-mono` — static: one file per weight and style. */
const spaceMono400 = new URL(
  "../../node_modules/@fontsource/space-mono/files/space-mono-latin-400-normal.woff2",
  import.meta.url,
).href
const spaceMono400Italic = new URL(
  "../../node_modules/@fontsource/space-mono/files/space-mono-latin-400-italic.woff2",
  import.meta.url,
).href
const spaceMono700 = new URL(
  "../../node_modules/@fontsource/space-mono/files/space-mono-latin-700-normal.woff2",
  import.meta.url,
).href
const spaceMono700Italic = new URL(
  "../../node_modules/@fontsource/space-mono/files/space-mono-latin-700-italic.woff2",
  import.meta.url,
).href
/** `@fontsource/ibm-plex-mono` — static: one file per weight and style. */
const ibmPlex400 = new URL(
  "../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2",
  import.meta.url,
).href
const ibmPlex400Italic = new URL(
  "../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-italic.woff2",
  import.meta.url,
).href
const ibmPlex500 = new URL(
  "../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2",
  import.meta.url,
).href
const ibmPlex500Italic = new URL(
  "../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-italic.woff2",
  import.meta.url,
).href
const ibmPlex600 = new URL(
  "../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2",
  import.meta.url,
).href
const ibmPlex600Italic = new URL(
  "../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-italic.woff2",
  import.meta.url,
).href
const ibmPlex700 = new URL(
  "../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-700-normal.woff2",
  import.meta.url,
).href
const ibmPlex700Italic = new URL(
  "../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-700-italic.woff2",
  import.meta.url,
).href
/** `@fontsource-variable/azeret-mono` — variable: one file per style. */
const azeretNormal = new URL(
  "../../node_modules/@fontsource-variable/azeret-mono/files/azeret-mono-latin-wght-normal.woff2",
  import.meta.url,
).href
const azeretItalic = new URL(
  "../../node_modules/@fontsource-variable/azeret-mono/files/azeret-mono-latin-wght-italic.woff2",
  import.meta.url,
).href
/** `@fontsource/dm-mono` — static: one file per weight and style. */
const dmMono300 = new URL(
  "../../node_modules/@fontsource/dm-mono/files/dm-mono-latin-300-normal.woff2",
  import.meta.url,
).href
const dmMono300Italic = new URL(
  "../../node_modules/@fontsource/dm-mono/files/dm-mono-latin-300-italic.woff2",
  import.meta.url,
).href
const dmMono400 = new URL(
  "../../node_modules/@fontsource/dm-mono/files/dm-mono-latin-400-normal.woff2",
  import.meta.url,
).href
const dmMono400Italic = new URL(
  "../../node_modules/@fontsource/dm-mono/files/dm-mono-latin-400-italic.woff2",
  import.meta.url,
).href
const dmMono500 = new URL(
  "../../node_modules/@fontsource/dm-mono/files/dm-mono-latin-500-normal.woff2",
  import.meta.url,
).href
const dmMono500Italic = new URL(
  "../../node_modules/@fontsource/dm-mono/files/dm-mono-latin-500-italic.woff2",
  import.meta.url,
).href
/** `@fontsource-variable/source-code-pro` — variable: one file per style. */
const sourceCodeNormal = new URL(
  "../../node_modules/@fontsource-variable/source-code-pro/files/source-code-pro-latin-wght-normal.woff2",
  import.meta.url,
).href
const sourceCodeItalic = new URL(
  "../../node_modules/@fontsource-variable/source-code-pro/files/source-code-pro-latin-wght-italic.woff2",
  import.meta.url,
).href

/** The metadata (family, weights, italic) comes from the text model's table. */
type FontSpec = FontFamilySpec & {
  /** Bundled woff2 URL for the normal face (SVG export registry). */
  url: string
  /** @font-face declarations — one per real face. */
  faces: string
}

/** Every bundled family name — the asset table must cover exactly these. */
type FontFamilyName = (typeof FONT_FAMILIES)[number]["family"]

/** A @font-face rule for one real face (family, style, weight, file). */
function face(
  family: string,
  style: "normal" | "italic",
  weight: string,
  url: string,
): string {
  return [
    "@font-face {",
    `  font-family: "${family}";`,
    `  font-style: ${style};`,
    `  font-weight: ${weight};`,
    "  font-display: swap;",
    `  src: url(${url}) format("woff2");`,
    "}",
  ].join("\n")
}

/** Variable families: one file per style, the whole weight axis as the range. */
function variableFace(
  family: string,
  weightCss: string,
  files: { normal: string; italic?: string },
): string[] {
  return [
    face(family, "normal", weightCss, files.normal),
    ...(files.italic ? [face(family, "italic", weightCss, files.italic)] : []),
  ]
}

/**
 * The bundled assets and faces, keyed by family — `satisfies` ties the table
 * to the model's FONT_FAMILIES, so adding a family without assets (or
 * misspelling a key) is a compile error instead of a silent mispair.
 */
const FONT_ASSETS = {
  Inter: {
    url: interNormal,
    faces: variableFace("Inter", "100 900", {
      normal: interNormal,
      italic: interItalic,
    }).join("\n"),
  },
  "Work Sans": {
    url: workSansNormal,
    faces: variableFace("Work Sans", "100 900", {
      normal: workSansNormal,
      italic: workSansItalic,
    }).join("\n"),
  },
  Barlow: {
    url: barlow400,
    faces: [
      face("Barlow", "normal", "400", barlow400),
      face("Barlow", "italic", "400", barlow400Italic),
      face("Barlow", "normal", "600", barlow600),
      face("Barlow", "italic", "600", barlow600Italic),
      face("Barlow", "normal", "700", barlow700),
      face("Barlow", "italic", "700", barlow700Italic),
      face("Barlow", "normal", "900", barlow900),
      face("Barlow", "italic", "900", barlow900Italic),
    ].join("\n"),
  },
  Figtree: {
    url: figtreeNormal,
    faces: variableFace("Figtree", "300 900", {
      normal: figtreeNormal,
      italic: figtreeItalic,
    }).join("\n"),
  },
  "Space Grotesk": {
    url: spaceGroteskNormal,
    faces: variableFace("Space Grotesk", "300 700", {
      normal: spaceGroteskNormal,
    }).join("\n"),
  },
  Karla: {
    url: karlaNormal,
    faces: variableFace("Karla", "200 800", {
      normal: karlaNormal,
      italic: karlaItalic,
    }).join("\n"),
  },
  Lora: {
    url: loraNormal,
    faces: variableFace("Lora", "400 700", {
      normal: loraNormal,
      italic: loraItalic,
    }).join("\n"),
  },
  "Playfair Display": {
    url: playfairNormal,
    faces: variableFace("Playfair Display", "400 900", {
      normal: playfairNormal,
      italic: playfairItalic,
    }).join("\n"),
  },
  "EB Garamond": {
    url: ebGaramondNormal,
    faces: variableFace("EB Garamond", "400 800", {
      normal: ebGaramondNormal,
      italic: ebGaramondItalic,
    }).join("\n"),
  },
  "Libre Baskerville": {
    url: libreBaskervilleNormal,
    faces: variableFace("Libre Baskerville", "400 700", {
      normal: libreBaskervilleNormal,
      italic: libreBaskervilleItalic,
    }).join("\n"),
  },
  "Bodoni Moda": {
    url: bodoniModaNormal,
    faces: variableFace("Bodoni Moda", "400 900", {
      normal: bodoniModaNormal,
      italic: bodoniModaItalic,
    }).join("\n"),
  },
  Fraunces: {
    url: frauncesNormal,
    faces: variableFace("Fraunces", "100 900", {
      normal: frauncesNormal,
      italic: frauncesItalic,
    }).join("\n"),
  },
  "Bebas Neue": {
    url: bebasNormal,
    faces: face("Bebas Neue", "normal", "400", bebasNormal),
  },
  Anton: {
    url: antonNormal,
    faces: face("Anton", "normal", "400", antonNormal),
  },
  "Archivo Black": {
    url: archivoBlackNormal,
    faces: face("Archivo Black", "normal", "400", archivoBlackNormal),
  },
  "Alfa Slab One": {
    url: alfaSlabOneNormal,
    faces: face("Alfa Slab One", "normal", "400", alfaSlabOneNormal),
  },
  Bungee: {
    url: bungeeNormal,
    faces: face("Bungee", "normal", "400", bungeeNormal),
  },
  Lobster: {
    url: lobsterNormal,
    faces: face("Lobster", "normal", "400", lobsterNormal),
  },
  Pacifico: {
    url: pacificoNormal,
    faces: face("Pacifico", "normal", "400", pacificoNormal),
  },
  "Dancing Script": {
    url: dancingNormal,
    faces: variableFace("Dancing Script", "400 700", {
      normal: dancingNormal,
    }).join("\n"),
  },
  Caveat: {
    url: caveatNormal,
    faces: variableFace("Caveat", "400 700", {
      normal: caveatNormal,
    }).join("\n"),
  },
  "Great Vibes": {
    url: greatVibesNormal,
    faces: face("Great Vibes", "normal", "400", greatVibesNormal),
  },
  "Patrick Hand": {
    url: patrickHandNormal,
    faces: face("Patrick Hand", "normal", "400", patrickHandNormal),
  },
  "Amatic SC": {
    url: amaticSc400,
    faces: [
      face("Amatic SC", "normal", "400", amaticSc400),
      face("Amatic SC", "normal", "700", amaticSc700),
    ].join("\n"),
  },
  "JetBrains Mono": {
    url: jetbrainsNormal,
    faces: variableFace("JetBrains Mono", "100 800", {
      normal: jetbrainsNormal,
      italic: jetbrainsItalic,
    }).join("\n"),
  },
  "Space Mono": {
    url: spaceMono400,
    faces: [
      face("Space Mono", "normal", "400", spaceMono400),
      face("Space Mono", "italic", "400", spaceMono400Italic),
      face("Space Mono", "normal", "700", spaceMono700),
      face("Space Mono", "italic", "700", spaceMono700Italic),
    ].join("\n"),
  },
  "IBM Plex Mono": {
    url: ibmPlex400,
    faces: [
      face("IBM Plex Mono", "normal", "400", ibmPlex400),
      face("IBM Plex Mono", "italic", "400", ibmPlex400Italic),
      face("IBM Plex Mono", "normal", "500", ibmPlex500),
      face("IBM Plex Mono", "italic", "500", ibmPlex500Italic),
      face("IBM Plex Mono", "normal", "600", ibmPlex600),
      face("IBM Plex Mono", "italic", "600", ibmPlex600Italic),
      face("IBM Plex Mono", "normal", "700", ibmPlex700),
      face("IBM Plex Mono", "italic", "700", ibmPlex700Italic),
    ].join("\n"),
  },
  "Azeret Mono": {
    url: azeretNormal,
    faces: variableFace("Azeret Mono", "100 900", {
      normal: azeretNormal,
      italic: azeretItalic,
    }).join("\n"),
  },
  "DM Mono": {
    url: dmMono400,
    faces: [
      face("DM Mono", "normal", "300", dmMono300),
      face("DM Mono", "italic", "300", dmMono300Italic),
      face("DM Mono", "normal", "400", dmMono400),
      face("DM Mono", "italic", "400", dmMono400Italic),
      face("DM Mono", "normal", "500", dmMono500),
      face("DM Mono", "italic", "500", dmMono500Italic),
    ].join("\n"),
  },
  "Source Code Pro": {
    url: sourceCodeNormal,
    faces: variableFace("Source Code Pro", "200 900", {
      normal: sourceCodeNormal,
      italic: sourceCodeItalic,
    }).join("\n"),
  },
} satisfies Record<FontFamilyName, { url: string; faces: string }>

/**
 * The bundled families — metadata from the model, assets keyed above.
 * `FontFamilyName` is derived from FONT_FAMILIES, and the `satisfies` on
 * FONT_ASSETS ties the asset keys to exactly those names.
 */
const FONT_SPECS: readonly FontSpec[] = FONT_FAMILIES.map((family) => ({
  ...family,
  ...FONT_ASSETS[family.family],
}))

let fontsRegistered = false

/**
 * Register the @font-face rules and point Fabric's SVG-export font registry
 * (`config.fontPaths`) at the bundled files. Runs once at app startup —
 * rule text only: nothing here fetches a face (§1 of the policy below), and
 * the faces load on demand through {@link loadFontFaces}.
 */
export function registerFonts(): void {
  if (fontsRegistered) return
  fontsRegistered = true

  const style = document.createElement("style")
  style.dataset.fonts = "sticker-studio"
  style.textContent = FONT_SPECS.map((s) => s.faces).join("\n")
  document.head.appendChild(style)

  // SVG export: Fabric does not collect font faces from the DOM — it renders
  // an @font-face per family listed here (spec §12; the export build embeds
  // the bytes for a self-contained file).
  config.fontPaths = Object.fromEntries(FONT_SPECS.map((s) => [s.family, s.url]))
}

/**
 * One text face — the exact (family, weight, style) a surface needs. Loading
 * is per face, never per family (§2 of the policy): a variable package
 * collapses to one file per style, and a static family fetches only the used
 * weight/italic files. Weights and styles are real faces only — the same
 * pairs `snapToRealFace` resolves to.
 */
export interface FontFaceSpec {
  family: string
  weight: number
  style: "normal" | "italic"
}

/**
 * How long an awaited path waits (§9) — Add Text, a family/weight/style
 * click, and Export race this bound; on timeout they proceed with the
 * fallback face and warn. Offline fetches reject fast; the bound only
 * catches a hung server, so a click never hangs on the network.
 */
export const FONT_LOAD_TIMEOUT_MS = 10_000

/** The dedupe key of a face — the (family, weight, style) triple. */
function faceKey(spec: FontFaceSpec): string {
  return `${spec.family}|${spec.weight}|${spec.style}`
}

/**
 * The in-flight/fulfilled load memo — dedupes every request for one face, so
 * a hover skim fires each fetch once. Deliberately no negative cache (§9): a
 * failed probe is evicted below, so the next explicit touch retries it. A
 * probe that settles after its caller timed out stays memoized — a retry
 * joins it and, if the face arrived in the meantime, succeeds instantly.
 */
const faceLoads = new Map<string, Promise<boolean>>()

/**
 * Probe the DOM for one face — `document.fonts.load` fetches the exact
 * descriptor if it isn't available yet. An empty match (a family the bundle
 * doesn't ship, or a face beyond a family's real set) and an errored
 * download both read as failure; only a non-empty, all-loaded set is
 * success.
 */
async function probeFace(spec: FontFaceSpec): Promise<boolean> {
  const descriptor = `${spec.style === "italic" ? "italic " : ""}${spec.weight} 24px "${spec.family}"`
  const faces = await document.fonts.load(descriptor)
  return faces.length > 0 && faces.every((face) => face.status === "loaded")
}

/** The memoized probe for a face — started once, joined by every caller. */
function loadFace(spec: FontFaceSpec): Promise<boolean> {
  const key = faceKey(spec)
  const existing = faceLoads.get(key)
  if (existing) return existing
  const probe = probeFace(spec).catch(() => false)
  faceLoads.set(key, probe)
  // Evict a failure — the no-negative-cache rule above: the next explicit
  // touch starts a fresh probe.
  void probe.then((arrived) => {
    if (!arrived) faceLoads.delete(key)
  })
  return probe
}

/** Race a probe against the awaited-path bound — a timeout reads as failure. */
function boundedProbe(probe: Promise<boolean>, boundMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), boundMs)
    void probe.then(
      (arrived) => {
        clearTimeout(timer)
        resolve(arrived)
      },
      () => {
        clearTimeout(timer)
        resolve(false)
      },
    )
  })
}

/**
 * Request the given faces and heal the canvas as each family's batch lands —
 * the one entry point every path shares: Add Text, toolbar commits,
 * restore/import, hover previews, and export's readiness check.
 *
 * Returns the families that failed or timed out, in first-use order (deduped
 * triples; [] when everything arrived), and never rejects — a failed face is
 * a warning, never an exception (§9). `canvas` is null where there is nothing
 * live to heal (export's offscreen path); otherwise each family's arrival
 * runs {@link healFontsOnArrival} scoped to that family, so the fix-up lands
 * per family as it settles and one 404 never skips the families that did
 * arrive (§4). A batch that settles past `boundMs` still heals when it
 * lands — its caller proceeded with a fallback face, and a late arrival must
 * not leave fallback-computed widths standing.
 */
export async function loadFontFaces(
  canvas: Canvas | null,
  faces: readonly FontFaceSpec[],
  boundMs: number = FONT_LOAD_TIMEOUT_MS,
): Promise<string[]> {
  const seen = new Set<string>()
  const groups = new Map<string, FontFaceSpec[]>()
  for (const spec of faces) {
    const key = faceKey(spec)
    if (seen.has(key)) continue
    seen.add(key)
    const group = groups.get(spec.family)
    if (group) group.push(spec)
    else groups.set(spec.family, [spec])
  }

  const results = await Promise.all(
    [...groups].map(async ([family, familyFaces]) => {
      const probes = familyFaces.map((spec) => loadFace(spec))
      if (canvas) {
        // The arrival fix-up is attached to the raw probes: it fires when
        // the faces land — even past the bound — once per family per call.
        let healed = false
        for (const probe of probes) {
          void probe.then((arrived) => {
            if (arrived && !healed) {
              healed = true
              healFontsOnArrival(canvas, [family])
            }
          })
        }
      }
      // `allSettled` per family: one failed face never skips the fix-up for
      // the faces that arrived (§4 isolation). A family counts as arrived
      // when at least one of its faces landed.
      const settled = await Promise.allSettled(
        probes.map((probe) => boundedProbe(probe, boundMs)),
      )
      return {
        family,
        arrived: settled.some(
          (result) => result.status === "fulfilled" && result.value,
        ),
      }
    }),
  )

  return results.filter((result) => !result.arrived).map((result) => result.family)
}

/**
 * A text measurer bound to a live canvas 2D context — the browser-side
 * `measureText` the text model's auto-fit takes as its measure function.
 * The full face is set per call — weight and style included, so measuring
 * honors the object's real face (auto-fit §6). Stateless, so one shared
 * instance serves the stage, the add-text path, and the toolbar commits.
 */
function makeTextMeasurer(): (text: string, style: TextMeasureStyle) => number {
  const ctx = document.createElement("canvas").getContext("2d")
  if (!ctx) throw new Error("Canvas 2D context unavailable")
  return (text, style) => {
    const weight = style.fontWeight === "normal" ? 400 : style.fontWeight
    const italic = style.fontStyle === "italic" ? "italic " : ""
    ctx.font = `${italic}${weight} ${style.fontSize}px ${style.fontFamily}`
    return ctx.measureText(text).width
  }
}

/**
 * The arrival fix-up (§4) — repair the canvas after late faces land.
 *
 * A canvas never repaints when a webfont arrives (`font-display: swap`
 * reflows DOM text, not canvas pixels) and Fabric caches per-face char
 * widths — a Textbox measured against the fallback face keeps its wrong
 * wrapping, height, and (for `autoFit`) width until a fix-up runs. For every
 * text object using an arrived family — top level and group children — clear
 * Fabric's char cache for the family, re-measure, re-fit `autoFit` widths (a
 * box fitted from fallback metrics must hug the real face), mark the object
 * (and its parent group — a group caches its own bitmap on top of the
 * children's) dirty, and repaint.
 *
 * Scoped: only the arrived families' texts are touched. Non-recording and
 * non-persisting — never a history step, never a draft write: a face
 * correction, not a document edit. A live text session is skipped — its own
 * re-fit settles at session exit, and re-measuring mid-edit would fight the
 * caret. Self-healing by design: a stored fallback-computed width (a draft
 * written before the face arrived) is corrected by the next load's fix-up.
 */
export function healFontsOnArrival(canvas: Canvas, families: readonly string[]): void {
  const arrived = new Set(families)
  if (arrived.size === 0) return

  // Fabric's char cache holds widths measured with whatever face was loaded
  // at measure time — a fallback-face entry under the real family's key
  // would poison the re-measure below. Clear per arrived family, so other
  // families' caches survive.
  for (const family of arrived) cache.clearFontCache(family)

  const measure = getTextMeasurer()
  const healText = (text: Textbox): void => {
    if (text.isEditing) return
    if (text.autoFit) {
      fitToContent(text, measure)
    } else {
      // A user-owned width is face-independent, but the wrapping inside it
      // re-measures — height and line count follow the real face.
      text.initDimensions()
      text.setCoords()
    }
    // A group's bounds were computed against the fallback-measured child —
    // re-fit the parent so the corrected child isn't clipped by the group's
    // cached bounds. A no-op at the top level.
    refitParentGroup(text)
    text.dirty = true
  }

  canvas.forEachObject((obj) => {
    if (isTextObject(obj) && arrived.has(obj.fontFamily)) healText(obj)
    if (obj instanceof Group) {
      for (const child of obj.getObjects()) {
        if (isTextObject(child) && arrived.has(child.fontFamily)) {
          healText(child)
          // The group caches its own bitmap on top of the children's — mark
          // it too, or its cache rows re-blit the stale child caches.
          obj.dirty = true
        }
      }
    }
  })
  canvas.requestRenderAll()
}

/**
 * Normalize a stored (family, weight, style) into a real face — the same
 * snap a family commit applies (via `snapToRealFace`), so a stale stored
 * pair (an old draft's weight beyond the family's set, a faux italic) loads
 * the face that really renders instead of probing for one that never existed
 * and warning falsely. Unknown families pass through — the probe finds no
 * face, which is exactly the failure the caller warns about.
 */
function storedFace(family: string, weight: unknown, style: unknown): FontFaceSpec {
  const real = snapToRealFace(
    getFontFamilySpec(family),
    Number(weight) || 400,
    style === "italic" ? "italic" : "normal",
  )
  return { family, ...real }
}

/**
 * The faces actually used in a serialized document — walked through the
 * top-level `objects`, recursing into groups (single-level, §7, but the walk
 * costs nothing and future-proofs), reading each text object's
 * family/weight/style. These are the faces restore and import request,
 * export awaits, and the SVG embeds. Deduped by triple, first-use order.
 * (Lifted from the export pipeline by #63 — every engine caller needs it.)
 */
export function collectUsedFontFaces(payload: {
  objects?: Array<Record<string, unknown>>
}): FontFaceSpec[] {
  const seen = new Map<string, FontFaceSpec>()
  const walk = (objects: Array<Record<string, unknown>> | undefined): void => {
    for (const obj of objects ?? []) {
      if (typeof obj.fontFamily === "string" && obj.fontFamily) {
        const spec = storedFace(obj.fontFamily, obj.fontWeight, obj.fontStyle)
        seen.set(faceKey(spec), spec)
      }
      const children = obj.objects as Array<Record<string, unknown>> | undefined
      if (Array.isArray(children)) walk(children)
    }
  }
  walk(payload.objects)
  return [...seen.values()]
}

/**
 * The faces a live canvas's text objects use — {@link collectUsedFontFaces}'
 * companion for the restore path: the draft is loaded onto the canvas first
 * (that *is* the fallback render), then the canvas itself is walked, so what
 * gets requested is exactly what's on the sheet — groups included. Deduped
 * by triple, first-use order.
 */
export function collectCanvasFontFaces(canvas: Canvas): FontFaceSpec[] {
  const seen = new Map<string, FontFaceSpec>()
  const add = (obj: FabricObject): void => {
    if (!isTextObject(obj) || !obj.fontFamily) return
    const spec = storedFace(obj.fontFamily, obj.fontWeight, obj.fontStyle)
    seen.set(faceKey(spec), spec)
  }
  canvas.forEachObject((obj) => {
    add(obj)
    if (obj instanceof Group) obj.getObjects().forEach(add)
  })
  return [...seen.values()]
}

/**
 * The exact face a text-property patch leaves the object on — computed from
 * the current object state plus the patch, without mutating (§5): the click
 * path awaits this face before `applyTextProps` runs, so the re-fit measures
 * the real face. The snap is the rule `applyTextProps` runs on a family
 * change (`snapToRealFace`), so the awaited face and the committed face are
 * one answer.
 */
export function resolveTextFace(obj: Textbox, patch: TextPropsPatch): FontFaceSpec {
  const family = patch.fontFamily ?? obj.fontFamily
  const weight = patch.fontWeight ?? (Number(obj.fontWeight) || 400)
  const style = patch.fontStyle ?? (obj.fontStyle === "italic" ? "italic" : "normal")
  return { family, ...snapToRealFace(getFontFamilySpec(family), weight, style) }
}

/**
 * The commit / Add Text warning (§9), verbatim:
 * `Anton couldn't be loaded — using a fallback font`.
 */
export function fontCommitWarning(family: string): string {
  return `${family} couldn't be loaded — using a fallback font`
}

/**
 * The restore / import warning (§9), summed over the families that never
 * arrived: `Couldn't load 2 fonts — using fallbacks (Anton, Pacifico)`, or
 * the singular `Couldn't load Anton — using a fallback`.
 */
export function fontFallbackNotice(families: readonly string[]): string {
  if (families.length === 1) return `Couldn't load ${families[0]} — using a fallback`
  return `Couldn't load ${families.length} fonts — using fallbacks (${families.join(", ")})`
}

/**
 * The export warning (§9, the existing shape kept): `Some fonts couldn't be
 * loaded — exported with fallback rendering (Anton)`.
 */
export function fontExportWarning(families: readonly string[]): string {
  return `Some fonts couldn't be loaded — exported with fallback rendering (${families.join(", ")})`
}

/**
 * Clear the load memo — a test hook, so suites start from a cold engine (the
 * `resetAutoPersistTestState` precedent). Never called by app code.
 */
export function resetFontLoadTestState(): void {
  faceLoads.clear()
}

let sharedTextMeasurer: ReturnType<typeof makeTextMeasurer> | null = null

/** The app-wide text measurer — created once, shared by every caller. */
export function getTextMeasurer(): ReturnType<typeof makeTextMeasurer> {
  sharedTextMeasurer ??= makeTextMeasurer()
  return sharedTextMeasurer
}
