import { Textbox, type Object as FabricObject } from "fabric"

import { stampDocumentProps } from "@/fabric/document-props"

/**
 * Text model (build spec §6). Text is a Document object — the Fabric Textbox
 * — not a shape: it has no shape of its own and no cut line (no clipPath).
 * Styling is per-textbox (no per-run rich text); the toolbar edits the nine
 * properties directly on the object.
 *
 * Auto-fit (§6): the box hugs its content at creation, live while typing
 * (auto width — the box grows with the text, never a fixed-width wrap
 * restriction), and re-fits at the end of each text session while it has
 * never been manually resized. Fabric v7 has no auto-width mode — an unset
 * width collapses to `dynamicMinWidth` (~2 px), so the box always carries an
 * explicit width measured with `ctx.measureText` on the longest line. The
 * measurer is injected (browser context at runtime, a stub in tests) so the
 * model stays pure.
 */

/** Default text content — also what an emptied session restores to (§6). */
export const TEXT_DEFAULT_STRING = "Text"

/** Default family and size for a new box (§6). */
export const TEXT_DEFAULT_FAMILY = "Inter"
export const TEXT_DEFAULT_FONT_SIZE = 24

/** Default line height (§6). */
export const TEXT_DEFAULT_LINE_HEIGHT = 1.2

/** Default text fill — near-black, like the border color. */
export const TEXT_FILL = "#18181b"

/** The face a measurement runs against — the object's own style. */
export interface TextMeasureStyle {
  fontSize: number
  fontFamily: string
  fontWeight: number | string
  fontStyle: string
}

/**
 * Measures the width of a single line in the given face. Injected so the
 * model runs anywhere (browser canvas context, test stub). Weight and style
 * are part of the face — measuring the 400 normal face for a 800-italic text
 * under-fits the box (§6 auto-fit).
 */
export type TextMeasurer = (text: string, style: TextMeasureStyle) => number

/** A text-property commit against one Textbox (§6) — all ten properties. */
export interface TextPropsPatch {
  fontFamily?: string
  /** Text color — the object's fill (§6). */
  fillColor?: string
  /** Size in px. */
  fontSize?: number
  /** Weight — real faces only; static 400-only families have only 400. */
  fontWeight?: number
  fontStyle?: "normal" | "italic"
  underline?: boolean
  textAlign?: "left" | "center" | "right"
  /** Line height, 1.2 default (§6). */
  lineHeight?: number
  /** Letter spacing in Fabric units — thousandths of em (§6). */
  charSpacing?: number
  /**
   * Two-way uppercase flag (§6): while set, the stored string is uppercased
   * and the mixed-case original is kept as `uppercaseSource`; toggling off
   * restores it.
   */
  uppercase?: boolean
}

/** Text objects are Textboxes; nothing else (groups, shapes) is text. */
export function isTextObject(obj: FabricObject | null | undefined): obj is Textbox {
  return obj instanceof Textbox
}

/** What the toolbar offers for a family (§6) — the faces it really bundles. */
export interface FontFamilySpec {
  family: string
  /** Real weights (Bebas Neue, Anton and Pacifico are static 400-only). */
  weights: readonly number[]
  /** A real italic face exists — no faux italic for families without one. */
  italic: boolean
}

/**
 * The ten bundled families (build spec §12), in picker order. The asset files
 * and @font-face rules live in `fonts.ts`; this table is the model's view —
 * the real faces the toolbar may offer and `applyTextProps` may snap to.
 * Literal-typed (`as const`) so `fonts.ts` can key its asset table to the
 * exact family names.
 */
export const FONT_FAMILIES = [
  { family: "Inter", weights: [400, 500, 600, 700, 800], italic: true },
  { family: "Work Sans", weights: [400, 500, 600, 700, 800], italic: true },
  { family: "Barlow", weights: [400, 600, 700, 900], italic: true },
  { family: "Lora", weights: [400, 500, 600, 700], italic: true },
  { family: "Playfair Display", weights: [400, 500, 600, 700, 800, 900], italic: true },
  { family: "Bebas Neue", weights: [400], italic: false },
  { family: "Anton", weights: [400], italic: false },
  { family: "Pacifico", weights: [400], italic: false },
  { family: "Dancing Script", weights: [400, 500, 600, 700], italic: false },
  { family: "JetBrains Mono", weights: [400, 500, 600, 700, 800], italic: true },
] as const satisfies readonly FontFamilySpec[]

/** The spec for a family, or undefined for families outside the bundle. */
export function getFontFamilySpec(family: string): FontFamilySpec | undefined {
  return FONT_FAMILIES.find((spec) => spec.family === family)
}

/**
 * The family's bold weight for the Bold toggle — the weight nearest 700
 * among its 500+ faces (CSS bold), or undefined when the family ships no
 * bold face (the static 400-only families — no faux bold, like no faux
 * italic). All ten multi-weight families land on 700.
 */
export function getBoldWeight(family: string): number | undefined {
  const bolds = getFontFamilySpec(family)?.weights.filter((w) => w >= 500) ?? []
  if (bolds.length === 0) return undefined
  return bolds.reduce((best, w) => (Math.abs(w - 700) < Math.abs(best - 700) ? w : best))
}

/**
 * Create a Text object: "Text" in Inter 24 px, near-black, the document
 * identity stamped (id, locked=false, ADR 0002), auto-fit on. When a measurer
 * is given (the app passes one after the fonts are ready), the width is
 * auto-fitted to the content at creation — the unset-width collapse Fabric v7
 * would otherwise render as a ~2 px box (§6, spike #4).
 */
export function createText(measure?: TextMeasurer): Textbox {
  const obj = new Textbox(TEXT_DEFAULT_STRING, {
    fontFamily: TEXT_DEFAULT_FAMILY,
    fontSize: TEXT_DEFAULT_FONT_SIZE,
    fill: TEXT_FILL,
    lineHeight: TEXT_DEFAULT_LINE_HEIGHT,
  })
  obj.uppercase = false
  obj.autoFit = true
  stampDocumentProps(obj)
  if (measure) fitToContent(obj, measure)
  return obj
}

/**
 * The auto-fit width for a text: the longest line's measured width — in the
 * object's own face, letter spacing folded in per character gap — plus a
 * hair of breathing room, rounded up. Fabric v7 has no auto-width — the box
 * width is set explicitly, from the longest line across all lines (§6, spike:
 * measured + 2 was verified against 7.4.0).
 */
export function fitTextWidth(
  text: string,
  style: TextMeasureStyle,
  charSpacing: number,
  measure: TextMeasurer,
): number {
  // Fabric's charSpacing is additional space per character gap, in
  // thousandths of em — the wrapped line is measured width + gaps × spacing.
  const spacing = (charSpacing / 1000) * style.fontSize
  const longest = text.split("\n").reduce((max, line) => {
    const gaps = Math.max(0, line.length - 1)
    return Math.max(max, measure(line, style) + gaps * spacing)
  }, 0)
  return Math.ceil(longest + 2)
}

/**
 * Fit the box width to its content — the auto-fit operation, used at
 * creation, live while typing, and at the end of every text session while
 * `autoFit` is set. Height re-measures from the new width's wrapping
 * (Fabric's `set` re-inits dimensions for text layout properties).
 *
 * The top edge is pinned across the re-measure: objects anchor at their
 * center (Fabric's default), so a changed height would pivot the box around
 * the center and walk the text down — the same reason Fabric's own
 * `updateFromTextArea` preserves the top-anchored position on input.
 */
export function fitToContent(obj: Textbox, measure: TextMeasurer): void {
  const top = obj.getPositionByOrigin(obj.originX, "top")
  obj.set(
    "width",
    fitTextWidth(
      obj.text,
      {
        fontSize: obj.fontSize,
        fontFamily: obj.fontFamily,
        fontWeight: obj.fontWeight,
        fontStyle: obj.fontStyle,
      },
      obj.charSpacing,
      measure,
    ),
  )
  obj.setPositionByOrigin(top, obj.originX, "top")
  obj.setCoords()
}

/**
 * Force the uppercase flag on the stored string (spec §6) — the flag's own
 * commit path (applyTextProps) and the session commit share it. The mixed-case
 * text is saved as `uppercaseSource` first, so turning the flag off later can
 * restore it (the two-way toggle).
 */
export function forceUppercase(obj: Textbox): void {
  if (obj.uppercase && obj.text !== obj.text.toUpperCase()) {
    obj.uppercaseSource = obj.text
    obj.set("text", obj.text.toUpperCase())
  }
}

/**
 * Apply a text-property patch to the object (§6). Commits go through
 * `set()` — Fabric re-measures text layout and marks the object dirty.
 * Auto-fit survives family/size changes: while the box has never been
 * manually resized it still hugs its content, so the width re-fits.
 *
 * The top edge is pinned across the whole commit: a family/size/line-height
 * set re-wraps the box against the current width, and a changed line count
 * changes the height — without a pin, the center-anchored object pivots
 * around its center and the text visibly walks vertically by Δh/2. The edge
 * is captured before any set and restored after the re-fit (the same
 * capture-restore Fabric's own `updateFromTextArea` uses while typing).
 */
export function applyTextProps(
  obj: Textbox,
  patch: TextPropsPatch,
  measure?: TextMeasurer,
): void {
  const top = obj.getPositionByOrigin(obj.originX, "top")
  if (patch.fontFamily !== undefined) {
    obj.set("fontFamily", patch.fontFamily)
    // Real faces only (§6): a weight or italic the new family doesn't bundle
    // would render as a browser-synthesized faux face. Snap down — a static
    // 400-only family takes 400 / normal.
    const spec = getFontFamilySpec(patch.fontFamily)
    if (spec) {
      const weight = Number(obj.fontWeight) || 400
      if (!spec.weights.includes(weight)) obj.set("fontWeight", 400)
      if (obj.fontStyle === "italic" && !spec.italic) {
        obj.set("fontStyle", "normal")
      }
    }
  }
  if (patch.fontSize !== undefined) obj.set("fontSize", patch.fontSize)
  if (patch.fillColor !== undefined) obj.set("fill", patch.fillColor)
  if (patch.fontWeight !== undefined) obj.set("fontWeight", patch.fontWeight)
  if (patch.fontStyle !== undefined) obj.set("fontStyle", patch.fontStyle)
  if (patch.underline !== undefined) obj.set("underline", patch.underline)
  if (patch.textAlign !== undefined) obj.set("textAlign", patch.textAlign)
  if (patch.lineHeight !== undefined) obj.set("lineHeight", patch.lineHeight)
  if (patch.charSpacing !== undefined) obj.set("charSpacing", patch.charSpacing)
  if (patch.uppercase !== undefined) {
    obj.uppercase = patch.uppercase
    if (patch.uppercase) {
      // Turning the flag on saves the current (mixed-case) text as the
      // restore source and forces the case; turning it off restores the
      // saved text (§6 — two-way toggle).
      forceUppercase(obj)
    } else if (typeof obj.uppercaseSource === "string") {
      obj.set("text", obj.uppercaseSource)
      obj.uppercaseSource = undefined
    }
  }
  if (
    measure &&
    obj.autoFit &&
    (patch.fontFamily !== undefined || patch.fontSize !== undefined)
  ) {
    fitToContent(obj, measure)
  }
  obj.setPositionByOrigin(top, obj.originX, "top")
  obj.setCoords()
}

/**
 * Bake a scale gesture into the font size (§6): a corner drag scales the
 * Textbox like a shape, leaving the box carrying a scale transform with
 * `fontSize` — the toolbar's readout — stale at its pre-drag value. The
 * gesture end folds the scale into the size — the effective size is
 * fontSize × scale — and resets the transform, so the size field stays the
 * source of truth. The wrap width scales with it (the box wraps the same
 * lines it wrapped scaled), and the height re-measures from the new width
 * and size (Fabric's `set` re-inits dimensions for layout properties). The
 * top edge is pinned across the re-measure, like `applyTextProps`. No-op at
 * scale 1 — moves, rotations, and plain session commits pass through.
 *
 * The factor is the geometric mean of the two axes (absolute — a flip
 * mirrors one): uniform corner gestures keep them equal, while a text folded
 * out of a scaled group can carry a matrix whose per-axis decomposition
 * differs, and the mean is the size that preserves the glyph area.
 */
export function bakeTextScale(obj: Textbox): void {
  if (obj.scaleX === 1 && obj.scaleY === 1) return
  const s = Math.sqrt(Math.abs(obj.scaleX * obj.scaleY))
  const top = obj.getPositionByOrigin(obj.originX, "top")
  obj.set({
    fontSize: Math.round(obj.fontSize * s),
    width: obj.width * s,
    scaleX: 1,
    scaleY: 1,
  })
  obj.setPositionByOrigin(top, obj.originX, "top")
  obj.setCoords()
}
