/**
 * Zoom & viewport (build spec §9–§10): the zoom and document-rotation math —
 * pure functions, shared by the StageCanvas adapter and its tests.
 *
 * The model: the viewport transform carries the zoom, and at a cardinal
 * document rotation the rotation too (the element is the Document's rotated
 * bounding box at `rotatedBounds × zoom`, laid out centered in the scrolled
 * content as at 0°). The scroll position IS the pan at every orientation.
 * Zoom is view state — never serialized, never an undoable step; document
 * rotation is document state (the envelope, history, and export own it).
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
 * Normalize an angle to [0, 360) — the document rotation's canonical range.
 * The Design file and history store the literal value, so an import can carry
 * any angle; the stage display and the step math normalize before using it.
 */
export function normalizeDegrees(angleDeg: number): number {
  return ((angleDeg % 360) + 360) % 360
}

/**
 * The angle the stage displays the Document at (build spec §10): the document
 * rotation snapped to the nearest multiple of 90°, or 0° when it isn't one.
 * The stage's rotated viewport and scroll math support only the four cardinal
 * orientations — a non-cardinal rotation imported from a Design file (e.g.
 * 45°) still exports correctly, but displays unrotated.
 */
export function displayRotationDeg(rotation: number): number {
  const normalized = normalizeDegrees(rotation)
  // Snap to the nearest multiple of 90 within tolerance (trig-float-safe).
  const snapped = Math.round(normalized / 90) * 90
  return Math.abs(normalized - snapped) < 1e-9 && snapped < 360 ? snapped : 0
}

/**
 * Step the document rotation by ±90° (the rotate-canvas control), wrapping
 * through the four cardinals: 270 stepping forward wraps to 0, 0 backward
 * wraps to 270. The display range — export honors any angle the envelope
 * carries, but the stage and the readout live on the cardinals.
 */
export function stepDocumentRotation(
  currentDeg: number,
  direction: 1 | -1,
): number {
  return normalizeDegrees(Math.round(currentDeg) + direction * 90)
}

/**
 * The bounding box of a rectangle rotated by `angleDeg` degrees, axis-aligned
 * to the workspace — the space a rotated Document needs to fit (build spec
 * §10's display and §11's export both use it). At a cardinal rotation it is
 * the swapped box (H×W for 90°/270°).
 */
export function rotatedBounds(
  width: number,
  height: number,
  angleDeg: number,
): { width: number; height: number } {
  const rad = (angleDeg * Math.PI) / 180
  // The same near-integer snapping the viewport transform uses — otherwise a
  // 90° cardinal's `Math.cos(π/2)` residue (~6e-17) would grow into the box
  // dimensions and stretch the translate the transform derives from them.
  const cos = Math.abs(snapTrigValue(Math.cos(rad)))
  const sin = Math.abs(snapTrigValue(Math.sin(rad)))
  return {
    width: width * cos + height * sin,
    height: width * sin + height * cos,
  }
}

/**
 * Snap a trig value to the exact integer it represents. The stage displays
 * only cardinal rotations (a multiple of 90°), where `Math.cos(π/2)`'s float
 * residue (~6e-17) would smear the exact matrices below — snapping near-
 * integer values keeps 0/90/180/270 byte-exact while leaving arbitrary angles
 * (unsupported by the stage viewport) untouched.
 */
function snapTrigValue(value: number): number {
  const rounded = Math.round(value)
  return Math.abs(value - rounded) < 1e-9 ? rounded : value
}

/**
 * The stage viewport transform that displays a Document of `width × height`
 * scaled by `zoomRatio` and rotated `rotationDeg` about its center. The
 * element is the Document's axis-aligned rotated bounds (`rotatedBounds` ×
 * zoom); the Document rotates inside it. The transform maps scene → element,
 * translating the Doc center to the element center: the translate is
 * rotation-dependent (it is zero only at 0°), while the scroll position IS
 * the pan exactly as at 0° — the scrollbars just map their axes through this
 * matrix. Composes with Fabric's `TMat2D` convention (`x' = a·x + c·y + e`).
 * The cardinals reduce exactly:
 *   90°:  [0, z, −z, 0, H·z, 0]   180°: [−z, 0, 0, −z, W·z, H·z]
 *   270°: [0, −z, z, 0, 0, W·z]   0°:   [z, 0, 0, z, 0, 0]
 * The caller passes the displayed orientation — the stage's `displayRotation`.
 */
/** Normalize a value that is zero (including a flipped −0) to the literal 0. */
const zero = (n: number): number => (n === 0 ? 0 : n)

export function rotatedViewportTransform(
  width: number,
  height: number,
  zoomRatio: number,
  rotationDeg: number,
): [number, number, number, number, number, number] {
  const rad = (rotationDeg * Math.PI) / 180
  const cos = snapTrigValue(Math.cos(rad))
  const sin = snapTrigValue(Math.sin(rad))
  const bounds = rotatedBounds(width, height, rotationDeg)
  const e = (bounds.width * zoomRatio) / 2 - (cos * width - sin * height) * (zoomRatio / 2)
  const f = (bounds.height * zoomRatio) / 2 - (sin * width + cos * height) * (zoomRatio / 2)
  // Unary minus on a snapped zero yields −0, and the zero terms above could
  // too at non-0° — normalizing keeps the exact cardinal matrices above.
  return [
    zero(zoomRatio * cos),
    zero(zoomRatio * sin),
    zero(-zoomRatio * sin),
    zero(zoomRatio * cos),
    zero(e),
    zero(f),
  ]
}

/**
 * The Fit zoom (build spec §9): always-fit — the whole Document (rotated
 * bounds) scales up or down into the workspace minus the fixed FIT_MARGIN_PX
 * margin, clamped to the 10–800% range. The smaller of the two axes' scales
 * wins, so the whole Document fits on both. A workspace smaller than the
 * margins clamps to the minimum. The rotation is the displayed orientation —
 * the stage passes `displayRotationDeg(this.rotation)`, so Fit matches what
 * the rotated viewport shows.
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
