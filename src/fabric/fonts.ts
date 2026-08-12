import { config } from "fabric"

import { FONT_FAMILIES, type FontFamilySpec, type TextMeasureStyle } from "@/fabric/text"

// The ten bundled font families (build spec §12, research issue #3). All are
// SIL OFL 1.1 and ship unmodified from Fontsource (woff2, latin subset — the
// ~400–470 KB bundle the research budgeted). Variable families bundle one file
// per style covering their whole weight axis; Barlow, Bebas Neue, Anton and
// Pacifico are static — one file per weight.
//
// The Fontsource variable packages register their faces under the
// "… Variable" family name; we write our own @font-face rules under the plain
// family name instead, so the name in the family picker, in Fabric's
// `fontFamily`, and in `config.fontPaths` (SVG export) are all the same
// string.

/** Fontsource file URLs — `?url` resolves to the bundled asset URL. */
import interNormal from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url"
import interItalic from "@fontsource-variable/inter/files/inter-latin-wght-italic.woff2?url"
import workSansNormal from "@fontsource-variable/work-sans/files/work-sans-latin-wght-normal.woff2?url"
import workSansItalic from "@fontsource-variable/work-sans/files/work-sans-latin-wght-italic.woff2?url"
import barlow400 from "@fontsource/barlow/files/barlow-latin-400-normal.woff2?url"
import barlow600 from "@fontsource/barlow/files/barlow-latin-600-normal.woff2?url"
import barlow700 from "@fontsource/barlow/files/barlow-latin-700-normal.woff2?url"
import barlow900 from "@fontsource/barlow/files/barlow-latin-900-normal.woff2?url"
import barlow400Italic from "@fontsource/barlow/files/barlow-latin-400-italic.woff2?url"
import barlow600Italic from "@fontsource/barlow/files/barlow-latin-600-italic.woff2?url"
import barlow700Italic from "@fontsource/barlow/files/barlow-latin-700-italic.woff2?url"
import barlow900Italic from "@fontsource/barlow/files/barlow-latin-900-italic.woff2?url"
import loraNormal from "@fontsource-variable/lora/files/lora-latin-wght-normal.woff2?url"
import loraItalic from "@fontsource-variable/lora/files/lora-latin-wght-italic.woff2?url"
import playfairNormal from "@fontsource-variable/playfair-display/files/playfair-display-latin-wght-normal.woff2?url"
import playfairItalic from "@fontsource-variable/playfair-display/files/playfair-display-latin-wght-italic.woff2?url"
import bebasNormal from "@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff2?url"
import antonNormal from "@fontsource/anton/files/anton-latin-400-normal.woff2?url"
import pacificoNormal from "@fontsource/pacifico/files/pacifico-latin-400-normal.woff2?url"
import dancingNormal from "@fontsource-variable/dancing-script/files/dancing-script-latin-wght-normal.woff2?url"
import jetbrainsNormal from "@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2?url"
import jetbrainsItalic from "@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-italic.woff2?url"

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
  "Bebas Neue": {
    url: bebasNormal,
    faces: face("Bebas Neue", "normal", "400", bebasNormal),
  },
  Anton: {
    url: antonNormal,
    faces: face("Anton", "normal", "400", antonNormal),
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
  "JetBrains Mono": {
    url: jetbrainsNormal,
    faces: variableFace("JetBrains Mono", "100 800", {
      normal: jetbrainsNormal,
      italic: jetbrainsItalic,
    }).join("\n"),
  },
} satisfies Record<FontFamilyName, { url: string; faces: string }>

/**
 * The ten bundled families — metadata from the model, assets keyed above.
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
 * (`config.fontPaths`) at the bundled files. Runs once at app startup — the
 * browser downloads each face on first use; `preloadFonts` then forces the
 * download so measuring and rasterizing see real metrics.
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

let fontsLoaded: Promise<void> | null = null

/**
 * Preload every bundled face — each offered weight, normal and italic — and
 * resolve when all of them are ready. The text auto-fit measures glyphs with
 * `ctx.measureText`; a not-yet-loaded face silently falls back to the default
 * font and the fit would be wrong, so creating text awaits this. Memoized;
 * idempotent.
 */
export function preloadFonts(): Promise<void> {
  if (!fontsLoaded) {
    fontsLoaded = Promise.all(
      FONT_SPECS.flatMap((s) =>
        s.weights.flatMap((weight) => [
          document.fonts.load(`${weight} 24px ${s.family}`),
          ...(s.italic
            ? [document.fonts.load(`italic ${weight} 24px ${s.family}`)]
            : []),
        ]),
      ),
    ).then(() => document.fonts.ready.then(() => undefined))
  }
  return fontsLoaded
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

let sharedTextMeasurer: ReturnType<typeof makeTextMeasurer> | null = null

/** The app-wide text measurer — created once, shared by every caller. */
export function getTextMeasurer(): ReturnType<typeof makeTextMeasurer> {
  sharedTextMeasurer ??= makeTextMeasurer()
  return sharedTextMeasurer
}
