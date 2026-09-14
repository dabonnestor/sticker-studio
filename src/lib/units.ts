/**
 * Display units (build spec §5) — a label swap over stored px. Pixels are the
 * stored unit; inches and millimetres are view-layer derivations only.
 */
export type Unit = "in" | "mm" | "px"

/**
 * The units the app offers, in the order its controls list them. One home for
 * the list: the toolbar's unit switcher and New's Custom fields both read it,
 * so a unit added here appears in both rather than in whichever was edited.
 */
export const UNITS: { value: Unit; label: string }[] = [
  { value: "in", label: "in" },
  { value: "mm", label: "mm" },
  { value: "px", label: "px" },
]

/** 1 in = 96 px at the display basis (§5). */
export const PX_PER_INCH = 96

/** 1 in = 25.4 mm — the inch basis every mm derivation runs through. */
export const MM_PER_INCH = 25.4

/** Convert a value in the given unit to px. Exact math — no rounding here. */
export function unitToPx(value: number, unit: Unit): number {
  switch (unit) {
    case "in":
      return value * PX_PER_INCH
    case "mm":
      return (value / MM_PER_INCH) * PX_PER_INCH
    case "px":
      return value
  }
}

/** Convert stored px to the given unit. */
export function pxToUnit(px: number, unit: Unit): number {
  switch (unit) {
    case "in":
      return px / PX_PER_INCH
    case "mm":
      return (px / PX_PER_INCH) * MM_PER_INCH
    case "px":
      return px
  }
}

/** Convert a toolbar value to integer px at commit (§5). */
export function commitPx(value: number, unit: Unit): number {
  return Math.round(unitToPx(value, unit))
}

/**
 * Format stored px for display in the given unit (display-only rounding):
 * integers in px, decimals in in/mm with trailing zeros trimmed.
 */
export function formatPx(px: number, unit: Unit): string {
  if (unit === "px") return String(Math.round(px))
  const decimals = unit === "in" ? 2 : 1
  return pxToUnit(px, unit)
    .toFixed(decimals)
    .replace(/\.?0+$/, "")
}
