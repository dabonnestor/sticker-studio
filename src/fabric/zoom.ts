/**
 * Zoom & viewport (build spec §9, issue #16): the zoom math — pure functions,
 * shared by the StageCanvas adapter and its tests.
 *
 * The model: the viewport transform carries the zoom only
 * (`[z, 0, 0, z, 0, 0]` — translate zero); the workspace wrapper scrolls, and
 * the Document (its canvas element) is laid out in the scrolled content at
 * `document × zoom` CSS px, centered. Scrollbars appear when the zoomed
 * Document exceeds the workspace; the scroll position IS the pan. Zoom is
 * view state — never serialized, never an undoable step.
 */

/** Zoom range (build spec §9) — 10% to 800%, inclusive. */
export const ZOOM_MIN_PERCENT = 10
export const ZOOM_MAX_PERCENT = 800

/** Zoom step — Ctrl+= / Ctrl+− and the −/+ buttons move ±10%. */
export const ZOOM_STEP_PERCENT = 10

/**
 * Wheel zoom sensitivity (build spec §9 extension — the wheel zoom): the
 * exponent per CSS px of deltaY. A mouse-wheel notch is ≈100 px, so one notch
 * zooms e^0.1 ≈ +10.5% — close to the ±10% keyboard step — and a pinch
 * gesture's summed deltas ride the same curve.
 */
export const WHEEL_ZOOM_SENSITIVITY = 0.001

/**
 * The zoom factor a wheel deltaY applies (build spec §9 extension — Ctrl+wheel
 * and the touchpad pinch): exponential, so zooming in then out returns exactly
 * to the start (the factors multiply to 1), and the feel is proportional at
 * every zoom level. A negative delta (wheel up, pinch out) zooms in.
 */
export function wheelZoomFactor(deltaY: number): number {
  return Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY)
}

/**
 * Fit margin (build spec §9) — the whole Document fits inside the workspace
 * minus a fixed 48 px margin on every side: the fit zoom scales the Document
 * so its centered box leaves exactly this margin at rest.
 */
export const FIT_MARGIN_PX = 48

/** Zoom presets (build spec §9) — Fit is a separate control. */
export const ZOOM_PRESETS = [100, 150, 200] as const

/** Clamp a zoom percentage to the range (build spec §9). */
export function clampZoomPercent(percent: number): number {
  return Math.min(ZOOM_MAX_PERCENT, Math.max(ZOOM_MIN_PERCENT, percent))
}

/** Step the zoom by ±ZOOM_STEP_PERCENT, clamped to the range (§9). */
export function stepZoomPercent(current: number, direction: 1 | -1): number {
  return clampZoomPercent(current + direction * ZOOM_STEP_PERCENT)
}

/**
 * The bounding box of a rectangle rotated by `angleDeg` degrees, axis-aligned
 * to the workspace — the space a rotated Document needs to fit. The document
 * rotation joins the envelope in the design-file build (§10); rotation is 0
 * today, and the fit math is rotation-ready.
 */
export function rotatedBounds(
  width: number,
  height: number,
  angleDeg: number,
): { width: number; height: number } {
  const rad = (angleDeg * Math.PI) / 180
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))
  return {
    width: width * cos + height * sin,
    height: width * sin + height * cos,
  }
}

/**
 * The Fit zoom (build spec §9): always-fit — the whole Document (rotated
 * bounds) scales up or down into the workspace minus the fixed FIT_MARGIN_PX
 * margin, clamped to the 10–800% range. The smaller of the two axes' scales
 * wins, so the whole Document fits on both. A workspace smaller than the
 * margins clamps to the minimum.
 */
export function computeFitZoom(
  documentWidth: number,
  documentHeight: number,
  workspaceWidth: number,
  workspaceHeight: number,
  rotationDeg = 0,
): number {
  const bounds = rotatedBounds(documentWidth, documentHeight, rotationDeg)
  const scaleX = (workspaceWidth - 2 * FIT_MARGIN_PX) / bounds.width
  const scaleY = (workspaceHeight - 2 * FIT_MARGIN_PX) / bounds.height
  return clampZoomPercent(Math.min(scaleX, scaleY) * 100)
}
