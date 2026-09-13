/**
 * The Document's outline — the shape of its Cut line (CONTEXT "Cut line",
 * map #48).
 *
 * The outline is a property of the Document, envelope-owned (ADR 0002)
 * alongside size, rotation, and border — not an object in the z-order. It is
 * two fields, and the sticker a Document *reads as* is derived from them
 * (`getStickerShape`), never stored: the preset a design was created from and
 * the preset it reads as now are the same question, and a design that has
 * since been resized answers it freshly.
 *
 * The outline's rendering is derived too. The canvas `clipPath` that clips
 * the stage and every Export is built by code from this state and the
 * Document size rather than serialized (map #48): the clip is a pure function
 * of the two, the geometry is the app's own, and a stored copy of it would
 * only be a second place for the shape to be wrong.
 */

/**
 * The shape of the Document's Cut line.
 *
 * `rect` and `oval` each carry an aspect lock and so read as two stickers
 * apiece (Square/Rectangle, Circle/Oval); `rounded-rect` has a fixed corner
 * radius preset and never locks, so its lock bit — carried in the envelope
 * and honoured on resize — does not name a different sticker.
 */
export type OutlineKind = "rect" | "rounded-rect" | "oval"

/** The outline shapes the app knows — the import-validation whitelist. */
export const OUTLINE_KINDS: ReadonlySet<string> = new Set<OutlineKind>([
  "rect",
  "rounded-rect",
  "oval",
])

/** The Document's outline state — the two envelope-owned fields (ADR 0002). */
export interface DocumentOutline {
  /** The Cut line's shape. */
  outline: OutlineKind
  /** Whether resizing the Document holds its aspect ratio at 1:1. */
  aspectLocked: boolean
}

/** A width and height in px at the 96 DPI display basis. */
export interface DocumentSize {
  width: number
  height: number
}

/**
 * The rounded-rect corner radius, as a fraction of the outline's short side
 * (map #48): Rounded corner's radius is a fixed preset, not a user control —
 * a proportion rather than a px value, so the corner keeps its look at
 * whatever size the sheet is later resized to.
 */
export const ROUNDED_CORNER_RADIUS_RATIO = 0.12

/** The corner radius of a rounded-rect outline at this Document size. */
export function cornerRadius(size: DocumentSize): number {
  return Math.min(size.width, size.height) * ROUNDED_CORNER_RADIUS_RATIO
}

/**
 * The size a locked Document actually takes (map #48): the axis the user
 * typed wins and the other mirrors it, so on a Square or Circle editing
 * width moves height to match and vice versa. The mirror — never a disabled
 * field, which on a locked sticker reads as broken rather than as a rule.
 *
 * Both Square and Circle lock 1:1, so this is one rule, not two.
 *
 * The typed axis is the one that differs from `current`, the Document's own
 * size: a field commits alone, so the two never move at once. A commit that
 * moves neither — a re-typed value — passes through untouched, leaving the
 * no-op for the History's dedup rather than for a rule here.
 */
export function mirrorLockedSize(
  current: DocumentSize,
  next: DocumentSize,
): DocumentSize {
  if (next.width !== current.width) {
    return { width: next.width, height: next.width }
  }
  if (next.height !== current.height) {
    return { width: next.height, height: next.height }
  }
  return next
}

/**
 * The sticker a Document's outline state reads as — derived for display and
 * for filtering the Designs panel (map #48), never stored.
 *
 * Custom is deliberately absent. It is rect + free, the very state Rectangle
 * is: the difference between them is only which dropdown entry created the
 * sheet, and how a design was made is not a fact about it. So a custom-sized
 * rectangle correctly reads as Rectangle, and shows Rectangle Predesigns.
 */
export type StickerShape =
  | "square"
  | "rectangle"
  | "rounded-corner"
  | "oval"
  | "circle"

/** What New offers: the five shapes above, plus Custom's free W×H. */
export type StickerPreset = StickerShape | "custom"

/** What a preset creates at New: its outline state and its Default size. */
interface PresetSpec extends DocumentOutline {
  /** The Default size; null for Custom, whose size is the user's to type. */
  size: DocumentSize | null
}

/**
 * The six presets New offers, and the Default size each creates at (CONTEXT
 * "Default size", at the 96 DPI display basis).
 *
 * The size is load-bearing, not decoration (map #48): a preset is a shape
 * *at a size*, because changing only the outline inscribes it in whatever
 * Document is already there — Oval on a square Document degenerates to a
 * circle, Rectangle to a square, and both buttons look broken.
 */
export const STICKER_PRESETS: Record<StickerPreset, PresetSpec> = {
  square: {
    outline: "rect",
    aspectLocked: true,
    size: { width: 192, height: 192 },
  },
  rectangle: {
    outline: "rect",
    aspectLocked: false,
    size: { width: 288, height: 192 },
  },
  "rounded-corner": {
    outline: "rounded-rect",
    aspectLocked: false,
    size: { width: 192, height: 192 },
  },
  oval: {
    outline: "oval",
    aspectLocked: false,
    size: { width: 288, height: 192 },
  },
  circle: {
    outline: "oval",
    aspectLocked: true,
    size: { width: 192, height: 192 },
  },
  custom: { outline: "rect", aspectLocked: false, size: null },
}

/**
 * The sticker an outline state reads as (map #48's derivation): rect locks
 * 1:1 as Square and freely as Rectangle; oval locks as Circle and freely as
 * Oval; rounded-rect is Rounded corner either way, its lock bit unreachable
 * at New and ignored here.
 */
export function getStickerShape(state: DocumentOutline): StickerShape {
  switch (state.outline) {
    case "rounded-rect":
      return "rounded-corner"
    case "oval":
      return state.aspectLocked ? "circle" : "oval"
    case "rect":
      return state.aspectLocked ? "square" : "rectangle"
  }
}

/**
 * The Default size a fresh sheet of this outline state is created at, or null
 * when the state alone does not fix one.
 *
 * Square, Rounded corner, Circle and Oval each have exactly one size at New,
 * so a sheet of one of those shapes at another size has been resized and is
 * no longer factory-fresh. rect + free is the state of *both* Rectangle
 * (288×192) and Custom — whatever the user typed — so its size is a choice
 * rather than the preset's, and no size can make it read as unfresh. That
 * matters to the blank-guard (auto-persist): a Custom sheet that has just
 * replaced a design must not write itself over the draft it replaced.
 */
export function presetDefaultSize(state: DocumentOutline): DocumentSize | null {
  if (state.outline === "rect" && !state.aspectLocked) return null
  return STICKER_PRESETS[getStickerShape(state)].size
}

/**
 * The preset a fresh session boots as (map #48) — a Square sticker, rather
 * than the fixed 600×600 sheet the app used to start on.
 */
export const BOOT_PRESET: StickerPreset = "square"

const BOOT_SPEC = STICKER_PRESETS[BOOT_PRESET]

/** The outline state a fresh session boots with. */
export const BOOT_OUTLINE: DocumentOutline = {
  outline: BOOT_SPEC.outline,
  aspectLocked: BOOT_SPEC.aspectLocked,
}

/**
 * The boot Document size in px — Square's Default size. Custom is the only
 * preset without one, so the assertion holds for every other preset by
 * construction of the table above.
 */
export const BOOT_SIZE: DocumentSize = BOOT_SPEC.size!
