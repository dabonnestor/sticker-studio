import {
  ActiveSelection,
  Canvas,
  Circle,
  Control,
  Ellipse,
  Group,
  Path,
  Point,
  Rect,
  Triangle,
  controlsUtils,
  util,
  type Abortable,
  type CanvasOptions,
  type ControlRenderingStyleOverride,
  type FabricObject,
  type InteractiveFabricObject,
  type Object as BaseFabricObject,
  type TCanvasSizeOptions,
  type TCornerPoint,
  type TMat2D,
  type TPointerEvent,
  type Transform,
  type TSize,
} from "fabric"

/**
 * The base's `findTarget` result type, declared here because the package
 * index does not re-export it — structurally identical, so an override can
 * name it (the fields match `SelectableCanvas`'s `FullTargetsInfoWithContainer`).
 */
interface FullTargetsInfoWithContainer {
  target?: StageFabricObject
  subTargets: StageFabricObject[]
  container?: StageFabricObject
  currentTarget?: StageFabricObject
  currentContainer?: StageFabricObject
  currentSubTargets: StageFabricObject[]
}

import {
  setLocked as setLockedProps,
  stampDocumentProps,
} from "@/fabric/document-props"
import { getTextMeasurer } from "@/fabric/fonts"
import { History } from "@/fabric/history"
import { HoverBorder } from "@/fabric/hover-border"
import { DEFAULT_BORDER_COLOR, getShapeKind, restampBorderClip } from "@/fabric/shapes"
import { SNAP_TOLERANCE_PX, SmartGuides } from "@/fabric/smart-guides"
import { wireTextInteractions } from "@/fabric/text-interactions"
import { bakeTextScale, isTextObject } from "@/fabric/text"
import {
  clampZoomPercent,
  computeFitZoom,
  displayRotationDeg,
  rotatedBounds,
  rotatedViewportTransform,
} from "@/fabric/zoom"

/**
 * Initial Document size — 600×600 px at the 96 DPI display basis. The canvas
 * dimensions are the Document size (build spec §5); the stage toolbar edits
 * them after mount, and exports will size to them.
 */
export const DOCUMENT_WIDTH = 600
export const DOCUMENT_HEIGHT = 600

/** Default Document background — white (§3); edited in the stage toolbar. */
export const DOCUMENT_BACKGROUND_COLOR = "#ffffff"

/**
 * Default Document border — off (width 0) and the shape border color: §3's
 * canvas starts borderless; the border is a document property the toolbar
 * turns on (ADR 0002, envelope `border`).
 */
export const DOCUMENT_BORDER_WIDTH = 0
export const DOCUMENT_BORDER_COLOR = DEFAULT_BORDER_COLOR

/**
 * Default Document rotation — 0° (§10, ADR 0002): the document, unrotated
 * at creation. The envelope carries it; export renders rotated (Build 8
 * §11). The stage displays cardinal rotations (0/90/180/270 — see
 * `displayRotationDeg`) through a rotated viewport transform; a non-cardinal
 * rotation imported from a Design file displays unrotated here and still
 * exports correctly.
 */
export const DOCUMENT_ROTATION = 0

/** Rotation-handle size — larger than the 13px corner handles so the icon reads. */
export const ROTATE_HANDLE_SIZE = 20

/**
 * Rotation snap step (build spec §5): a rotation gesture lands on the
 * nearest multiple of 15° — the design-tool standard (Figma, Canva, Slides)
 * — so the object clicks through detents at every 15° mark.
 */
export const ROTATION_SNAP_DEGREES = 15

/** Handle accent color — matches the app's border color (DEFAULT_BORDER_COLOR). */
const ROTATE_ICON_COLOR = "#18181b"

/**
 * Resize-handle cursors (build spec §5, rotation-aware): the stage freezes
 * the aspect ratio at the gesture start, so every corner drag moves along
 * the corner's own diagonal — and that diagonal rotates with the object, so
 * the cursor must too. The fixed diagonals the app used pointed 45° off the
 * real drag on a 45°-rotated box. Each cursor therefore carries the corner's
 * base diagonal (tl/br at 45°, tr/bl at 135° — where the fixed cursors
 * pointed at 0°), rotated by the object's angle, then snapped to the nearest
 * of the native axis/diagonal keywords — CSS has no rotated cursor keywords,
 * so between the 45° steps the arrow lands on the closest standard one: the
 * four corner orientations (`ew`/`ns`, `nwse`/`nesw`), and the eight compass
 * arrows for the side handles (square/rectangle's free-axis handles, text's
 * wrap handles), which carry the width/height axis the same way. A flip
 * mirrors the box: a flipped corner sits on the mirrored side, so its drag
 * line is the mirrored diagonal — one flip mirrors the arrow, both flips
 * cancel. Fabric's stock quadrant handler instead reports the pointer's
 * direction from the object's center — a narrow or wide box (an auto-fitted
 * text!) reads its corners as `n`/`s`/`e`/`w`, so text corners never match
 * the diagonal a squarish shape shows.
 */
const CORNER_BASE_DIRECTION: Readonly<Record<string, number>> = {
  tl: 45,
  br: 45,
  tr: 135,
  bl: 135,
}

/** The base direction of a side handle — where the axis points outward from
 * the center at 0° (y-down screen degrees: right 0, down 90, left 180, up
 * 270). */
const SIDE_BASE_DIRECTION: Readonly<Record<string, number>> = {
  ml: 180,
  mr: 0,
  mt: 270,
  mb: 90,
}

/** The handle a side handle's drag moves the edge along the line to. */
const SIDE_OPPOSITE: Readonly<Record<string, string>> = {
  ml: "mr",
  mr: "ml",
  mt: "mb",
  mb: "mt",
}

/** Native double-headed resize cursors, by arrow direction (y-down screen
 * degrees): the axis and diagonal keywords at the 45° steps. */
const NATIVE_DOUBLE_HEADED: Readonly<Record<number, string>> = {
  0: "ew-resize",
  45: "nwse-resize",
  90: "ns-resize",
  135: "nesw-resize",
}

/** Native single-headed resize cursors, by arrow direction (y-down screen
 * degrees): the eight compass keywords at the 45° steps. */
const NATIVE_SINGLE_HEADED: Readonly<Record<number, string>> = {
  0: "e-resize",
  45: "se-resize",
  90: "s-resize",
  135: "sw-resize",
  180: "w-resize",
  225: "nw-resize",
  270: "n-resize",
  315: "ne-resize",
}

function normalizeDegrees(degrees: number): number {
  return ((degrees % 360) + 360) % 360
}

/**
 * The cursor for a double-headed arrow at the given direction (y-down
 * screen degrees): the direction snapped to the nearest 45° step, answered
 * with the native axis/diagonal keyword. Double-headed — 180° is the same
 * arrow — so the direction normalizes to [0, 180).
 */
function doubleHeadedCursor(degrees: number): string {
  const d = normalizeDegrees(degrees) % 180
  return NATIVE_DOUBLE_HEADED[Math.round(d / 45) * 45]
}

/** The cursor for a single-headed arrow at the given direction — the same
 * snap-to-nearest rule as doubleHeadedCursor, over the full 360° compass. */
function singleHeadedCursor(degrees: number): string {
  const d = normalizeDegrees(degrees)
  return NATIVE_SINGLE_HEADED[Math.round(d / 45) * 45]
}

/**
 * The direction of a corner's diagonal: the corner's base direction rotated
 * with the object. A flip mirrors the diagonal — a flipped corner sits on
 * the mirrored side of the box, so its drag line is the mirror of the
 * unflipped one (one flip mirrors the arrow; both flips cancel).
 */
function cornerDirection(fabricObject: FabricObject, base: number): number {
  return fabricObject.flipX !== fabricObject.flipY
    ? -base - fabricObject.angle
    : base + fabricObject.angle
}

/**
 * The direction of a side handle's axis: the line from the opposite handle
 * to this one, read off the two handle positions themselves (oCoords) — so
 * flips come out right for free (the mirrored control sits on the mirrored
 * edge). Missing positions (never rendered) fall back to the base direction
 * rotated by the object's angle.
 */
function sideDirection(fabricObject: FabricObject, corner: string): number {
  const opposite = SIDE_OPPOSITE[corner]
  const from = fabricObject.oCoords[opposite]
  const to = fabricObject.oCoords[corner]
  return from && to
    ? Math.atan2(to.y - from.y, to.x - from.x) * (180 / Math.PI)
    : SIDE_BASE_DIRECTION[corner] + fabricObject.angle
}

/**
 * Wire the rotation-aware resize cursors onto every handle — the corners
 * (diagonal arrows) and the sides (axis arrows). The handler signature's
 * `coord` is the corner's position, not its name — the key is not passed
 * through — so each control gets a closure over its own key that answers
 * from the object's live angle and flips at hover time. Idempotent — safe
 * to re-apply when a selection forms or changes.
 */
function applyResizeCursors(obj: FabricObject): void {
  for (const [key, base] of Object.entries(CORNER_BASE_DIRECTION)) {
    const control = obj.controls[key]
    if (control) {
      control.cursorStyleHandler = (_e, _c, fabricObject: FabricObject) =>
        doubleHeadedCursor(cornerDirection(fabricObject, base))
    }
  }
  for (const key of Object.keys(SIDE_BASE_DIRECTION)) {
    const control = obj.controls[key]
    if (control) {
      control.cursorStyleHandler = (_e, _c, fabricObject: FabricObject) =>
        singleHeadedCursor(sideDirection(fabricObject, key))
    }
  }
}

/**
 * The rotation action handler (build spec §5): rounds the angle to the
 * nearest ROTATION_SNAP_DEGREES multiple in both directions. Fabric's stock
 * `rotationWithSnapping` snap is floor-biased — the object sits on the
 * multiple below the pointer, so a hair of counter-clockwise motion from a
 * snap point throws it a full step ahead of the pointer. Nearest-multiple
 * rounding keeps the object on the step closest to the pointer, the detent
 * feeling the design tools give. The stock structure is kept — the
 * fixed-anchor wrapper pins the rotation pivot, and the event wrapper fires
 * `object:rotating` only when the angle actually changed.
 */
function rotateObjectWithSnap(
  _eventData: TPointerEvent,
  { target, ex, ey, theta, originX, originY }: Transform,
  x: number,
  y: number,
): boolean {
  const pivotPoint = target.getPositionByOrigin(originX, originY)
  if (target.lockRotation) return false
  const lastAngle = Math.atan2(ey - pivotPoint.y, ex - pivotPoint.x)
  const curAngle = Math.atan2(y - pivotPoint.y, x - pivotPoint.x)
  const angle = util.radiansToDegrees(curAngle - lastAngle + theta)
  const snapped =
    Math.round(angle / ROTATION_SNAP_DEGREES) * ROTATION_SNAP_DEGREES
  // Normalize to [0, 360) — the stock handler's equivalent; the double mod
  // keeps negative angles (a counter-clockwise gesture) positive.
  const normalized = ((snapped % 360) + 360) % 360
  const hasRotated = target.angle !== normalized
  target.angle = normalized
  return hasRotated
}

/** The stage rotation action handler — the snap handler with the stock wrappers. */
export const rotationWithSnap = controlsUtils.wrapWithFireEvent(
  "rotating",
  controlsUtils.wrapWithFixedAnchor(rotateObjectWithSnap),
)

/**
 * The custom rotation handle (build spec §7): the white circular badge with
 * the rotate arrow (renderRotateHandle), sized above the 13px corner handles
 * so the icon reads. Also wires the snap action handler (rotationWithSnap) —
 * the same cursor style and wrappers as the stock rotationWithSnapping, but
 * with nearest-multiple rounding (§5). Idempotent — safe to re-apply when a
 * selection forms or changes.
 */
function applyRotateHandle(obj: FabricObject): void {
  const rotate = obj.controls.mtr
  if (!rotate) return
  rotate.sizeX = ROTATE_HANDLE_SIZE
  rotate.sizeY = ROTATE_HANDLE_SIZE
  rotate.render = renderRotateHandle
  rotate.actionHandler = rotationWithSnap
}

/**
 * Point-in-quadrilateral test — the selection box is a rotated rectangle,
 * so an axis-aligned rect test would misfire on angled objects. The four
 * bounding-box corners (`oCoords` tl/tr/br/bl) keep their cyclic order
 * under rotation; the point is inside the convex quad when every edge's
 * cross product carries the same sign (inclusive, so a point exactly on
 * the border counts). The same polygon test Fabric's `shouldActivate` runs
 * for its own handle hit areas.
 */
function isPointInQuad(
  point: Point,
  tl: { x: number; y: number },
  tr: { x: number; y: number },
  br: { x: number; y: number },
  bl: { x: number; y: number },
): boolean {
  const cross = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)
  const signs = [cross(tl, tr), cross(tr, br), cross(br, bl), cross(bl, tl)]
  return signs.every((s) => s >= 0) || signs.every((s) => s <= 0)
}

/**
 * The rotation-handle icon: lucide's `rotate-cw` (24×24 viewBox, ISC) — a
 * designer-tuned circular arrow. Rendered as a stroked Fabric Path so the
 * geometry is exact at any size.
 */
const ROTATE_ICON_PATH =
  "M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" + "M21 3v5h-5"

/** Lazily-built drawing template — stateless, safe to share across handles. */
let rotateIcon: Path | null = null
function getRotateIcon(): Path {
  if (!rotateIcon) {
    rotateIcon = new Path(ROTATE_ICON_PATH, {
      fill: "transparent",
      stroke: ROTATE_ICON_COLOR,
      strokeWidth: 2,
      strokeLineCap: "round",
      strokeLineJoin: "round",
    })
  }
  return rotateIcon
}

/**
 * Custom rotation-handle renderer (build spec §7): a white circular badge
 * with a dark outline — so it reads on any canvas — and the rotate icon
 * centered inside it. The arrow rotates with the object.
 */
export function renderRotateHandle(
  this: Control,
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  styleOverride: ControlRenderingStyleOverride | undefined,
  fabricObject: InteractiveFabricObject,
) {
  const { xSize } = this.commonRenderProps(ctx, left, top, fabricObject, styleOverride)
  const radius = xSize / 2
  // Badge.
  ctx.beginPath()
  ctx.arc(0, 0, radius, 0, 2 * Math.PI)
  ctx.fillStyle = "#ffffff"
  ctx.fill()
  ctx.strokeStyle = ROTATE_ICON_COLOR
  ctx.lineWidth = 1
  ctx.stroke()
  // Icon, scaled from its 24×24 box to sit inside the badge.
  const icon = getRotateIcon()
  const scale = (radius * 1.44) / 24
  ctx.save()
  ctx.scale(scale, scale)
  icon._render(ctx)
  ctx.restore()
}

/** The marquee rectangle, normalized to a top-left box, in viewport space. */
export interface MarqueeBox {
  left: number
  top: number
  width: number
  height: number
}

/**
 * The marquee rectangle in viewport space (§7 extension): the drag's start
 * and current extent — `_groupSelector`'s scene-plane values — mapped
 * through the viewport transform, normalized to a box. Pure, so the overlay
 * paint and the tests share one mapping. Only valid for an unrotated
 * viewport — under a rotated viewport the marquee is a quad (getMarqueeQuad).
 */
export function getMarqueeBox(
  selector: { x: number; y: number; deltaX: number; deltaY: number },
  viewportTransform: TMat2D,
): MarqueeBox {
  const start = new Point(selector.x, selector.y).transform(viewportTransform)
  const extent = new Point(
    selector.x + selector.deltaX,
    selector.y + selector.deltaY,
  ).transform(viewportTransform)
  return {
    left: Math.min(start.x, extent.x),
    top: Math.min(start.y, extent.y),
    width: Math.abs(extent.x - start.x),
    height: Math.abs(extent.y - start.y),
  }
}

/**
 * The marquee rectangle's four corners in viewport space, in order (§7
 * extension, build spec §10): the scene rect's corners mapped through the
 * viewport transform. Under a rotated viewport the two-corner box mapping
 * (`getMarqueeBox`) collapses to the axis-aligned bounding box of the
 * transformed corners — the wrong shape — so the rotated overlay paints the
 * quad instead. The selection itself is scene-plane math and is unaffected.
 * Pure, so the overlay paint and the tests share one mapping.
 */
export function getMarqueeQuad(
  selector: { x: number; y: number; deltaX: number; deltaY: number },
  viewportTransform: TMat2D,
): Point[] {
  return [
    new Point(selector.x, selector.y).transform(viewportTransform),
    new Point(selector.x + selector.deltaX, selector.y).transform(viewportTransform),
    new Point(selector.x + selector.deltaX, selector.y + selector.deltaY).transform(
      viewportTransform,
    ),
    new Point(selector.x, selector.y + selector.deltaY).transform(viewportTransform),
  ]
}

/** The Document's rect in the workspace, as the overlay mapping needs it. */
export interface OverlayRect {
  left: number
  top: number
}

/**
 * Point-in-cut-geometry test for a shape's clipPath (build spec §7 Q2): a
 * sticker's clipped-out areas count as empty canvas — a marquee can start
 * inside the bounding box wherever the shape has no pixels, and a press
 * there deselects instead of selecting. The clipPath is the design extent in
 * the shape's local plane (it extends half the border beyond the cut edge,
 * §4), so the point — already mapped into that plane — tests against the
 * clip's geometry exactly: circle and oval by radius, rectangle by extent,
 * triangle by the base-apex wedge. (Fabric's `containsPoint` is a
 * bounding-box test — the clip's bbox corners are transparent for
 * circle/oval/triangle.) Any other clip shape falls back to its own
 * bounding-box test, the safe approximation.
 */
export function isPointInCutGeometry(clip: BaseFabricObject, local: Point): boolean {
  if (clip instanceof Circle) {
    return local.x * local.x + local.y * local.y <= clip.radius * clip.radius
  }
  if (clip instanceof Ellipse) {
    return (local.x / clip.rx) * (local.x / clip.rx) + (local.y / clip.ry) * (local.y / clip.ry) <= 1
  }
  if (clip instanceof Rect) {
    return (
      Math.abs(local.x) <= clip.width / 2 && Math.abs(local.y) <= clip.height / 2
    )
  }
  if (clip instanceof Triangle) {
    // The wedge — apex at local (0, −h/2), base at y = +h/2 — tested with
    // the same polygon-inclusive cross-product sign rule as isPointInQuad.
    const apex = { x: 0, y: -clip.height / 2 }
    const baseL = { x: -clip.width / 2, y: clip.height / 2 }
    const baseR = { x: clip.width / 2, y: clip.height / 2 }
    const cross = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      (b.x - a.x) * (local.y - a.y) - (b.y - a.y) * (local.x - a.x)
    const signs = [cross(apex, baseL), cross(baseL, baseR), cross(baseR, apex)]
    return signs.every((s) => s >= 0) || signs.every((s) => s <= 0)
  }
  return clip.containsPoint(local)
}

/**
 * The full-props object type the interactive canvas APIs use — Fabric's
 * `FabricObject` export carries the full property surface while the
 * deprecated `Object` export resolves to the base generic; the interactive
 * surface (findTarget, _checkTarget) works with the full type.
 */
type StageFabricObject = FabricObject

/**
 * The Document's position inside the workspace overlay, in CSS px — the
 * translate that glues scene-space paint to the Document at any zoom or
 * scroll. The marquee mirror's mapping (the canvas origin offset by how far
 * the Document sits inside the overlay), shared with the controls mirror
 * and the tests. Pure, so the overlay paints and the tests use one mapping.
 */
export function getOverlayOffset(
  viewportRect: OverlayRect,
  overlayRect: OverlayRect,
): { x: number; y: number } {
  return {
    x: viewportRect.left - overlayRect.left,
    y: viewportRect.top - overlayRect.top,
  }
}

/**
 * Wrap a 2D context so every absolute `setTransform` lands offset by the
 * Document's position inside the overlay. Fabric's handle renderer resets
 * the transform to the retina basis before painting each handle at its
 * viewport coordinates (`InteractiveObject.drawControls`), which would drop
 * the translate the overlay needs — folding the offset into every reset
 * keeps handles glued to the scene at any zoom or scroll. Relative calls
 * (`translate`/`rotate`) pass through untouched: the selection box composes
 * them on the injected base, exactly as it does on the upper canvas.
 *
 * Every method is returned bound to the real context and every property
 * write forwards with the real context as receiver — native 2D-context
 * methods and style accessors brand-check their receiver and throw
 * "Illegal invocation" when invoked with the Proxy as `this`, so the paint
 * would break without the forwarding.
 */
function offsetContext(
  ctx: CanvasRenderingContext2D,
  offset: { x: number; y: number },
): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1
  return new Proxy(ctx, {
    get(target, property) {
      if (property === "setTransform") {
        return (a: number, b: number, c: number, d: number, e: number, f: number) =>
          target.setTransform(a, b, c, d, e + offset.x * dpr, f + offset.y * dpr)
      }
      const value = Reflect.get(target, property, target)
      return typeof value === "function" ? value.bind(target) : value
    },
    set(target, property, value) {
      return Reflect.set(target, property, value, target)
    },
  })
}

/**
 * The stage canvas, with the marquee and the selection controls mirrored
 * onto a workspace overlay (§7 extension). Fabric paints the marquee on the
 * upper canvas and the selection box/controls on the lower canvas, whose
 * bitmaps are exactly the Document's size — either would be invisible past
 * the Document edge. The overlay spans the whole workspace, so the marquee
 * renders — and can select objects — beyond the Document, and a selected
 * object's controls stay visible and draggable when they hang off it.
 * Hit-testing stays Fabric's own (`collectObjects` and the control hit-test
 * are unbounded DOM math); only the paint is mirrored. Fabric calls
 * `drawControls` exactly once per render (`controlsAboveOverlay` and
 * `skipControlsDrawing` stay unset) — the mirror hooks that call.
 */
export class StageCanvas extends Canvas {
  private readonly marqueeOverlay: HTMLCanvasElement

  /**
   * The scrollable workspace wrapper (build spec §9) — the Stage's scroll
   * container. Its client size is the workspace, its scroll position is the
   * pan: the Document element is laid out in the scrolled content at
   * `document × zoom` CSS px, so the browser scrolls it and the viewport
   * transform carries the zoom only. Null in tests, where the zoom layout
   * degrades to the element sizing without scroll anchoring.
   */
  private readonly workspaceEl: HTMLElement | null

  /**
   * The current zoom as a percentage (build spec §9) — 100% renders one
   * document pixel as one CSS pixel at any DPR. View state: never serialized,
   * never an undoable step, and the `onZoomChanged` callback keeps the
   * chrome's readout in sync — the same pattern as the History's `onChange`.
   */
  private zoomPercentValue = 100

  /** Fired after every zoom change (§9) — the React mirror's subscription. */
  onZoomChanged?: () => void

  /**
   * Fired after the rotation changes (§10) — the React mirror's subscription:
   * the same pattern as `onZoomChanged`. Document state (undoable, serialized
   * via the envelope), unlike zoom's view state.
   */
  onRotationChanged?: () => void

  /**
   * The group currently entered (§7 Q5), or null. While entered, presses
   * target the group's children (the findTarget override resolves them —
   * children aren't in the canvas collection) and children are fixed in
   * place (applyEnteredChildState); clicking empty canvas or pressing
   * Escape exits. View state — never serialized, never an undoable step;
   * a document restore (loadFromJSON) exits first.
   */
  enteredGroup: Group | null = null

  /**
   * The children fixed while entered — captured at enter time, so the exit
   * restores exactly the objects that were fixed, even if the group itself
   * was dissolved by then (an ungroup of the entered group extracts the
   * children before the exit runs).
   */
  private enteredChildren: FabricObject[] = []

  /** True while the marquee painted on the overlay in the current frame. */
  private marqueePaintedThisFrame = false

  /** True while the selection controls painted on the overlay this frame. */
  private controlsPaintedThisFrame = false

  /** True while the smart guides painted on the overlay this frame. */
  private guidesPaintedThisFrame = false

  /** True while the hover border painted on the overlay this frame. */
  private hoverPaintedThisFrame = false

  /**
   * Build 9's smart-guides wrapper — created by the stage factory, disposed
   * with the canvas (the canvas-rebuild lifecycle disposes and re-creates).
   */
  smartGuides?: SmartGuides

  /**
   * The hover-border wrapper — the object under the pointer paints its
   * selection-style border on the overlay. Created by the stage factory,
   * disposed with the canvas (the canvas-rebuild lifecycle disposes and
   * re-creates).
   */
  hoverBorder?: HoverBorder

  /**
   * Build 4's undo/redo stack — created by the stage factory (the only
   * construction path), disposed with the canvas (the canvas-rebuild
   * lifecycle disposes and re-creates, so each rebuild starts a fresh
   * history). `declare`: set after the constructor — the factory creates it
   * last, so the seed snapshot carries the final border defaults.
   */
  declare history: History

  constructor(
    element: HTMLCanvasElement,
    marqueeOverlay: HTMLCanvasElement,
    workspaceEl: HTMLElement | null,
    options: Partial<CanvasOptions>,
  ) {
    super(element, options)
    this.marqueeOverlay = marqueeOverlay
    this.workspaceEl = workspaceEl
  }

  /** True while a marquee drag is in progress. */
  isMarqueeActive(): boolean {
    return this._groupSelector !== null
  }

  /** The current zoom as a percentage (§9) — the viewport transform's scale. */
  getZoomPercent(): number {
    return this.zoomPercentValue
  }

  /**
   * The document rotation in degrees (§10) — the literal `canvas.rotation`
   * (envelope-owned), which the design-tool rotate control steps in 90°
   * increments and a Design file import may set to any angle.
   */
  getRotation(): number {
    return this.rotation
  }

  /**
   * Set the document rotation (build spec §10) — the rotate-canvas control's
   * stage side. Document state, exactly like size: the envelope carries it,
   * history snapshots it, and export renders it; the stage here re-lays-out
   * the viewport so the Document displays rotated about its center. The
   * layout reads `displayRotationDeg` — a non-cardinal rotation displays
   * unrotated on stage (a `recenter()` keeps the workspace view sensible, in
   * that case a no-op statement reset). No-op when the value is unchanged.
   * Fires `onRotationChanged` for the React mirror; the caller commits the
   * history step (the rotate control composes with the undo stack like any
   * property commit).
   */
  setRotation(degrees: number): void {
    if (this.rotation === degrees) return
    this.rotation = degrees
    this.applyZoomLayout()
    this.recenter()
    this.requestRenderAll()
    this.onRotationChanged?.()
  }

  /**
   * The visible scene region for off-screen culling (skipOffscreen is on by
   * default) — the Document rect, unchanged by zoom. The base computes this
   * as `canvas.width/height` (the Document size) divided by the zoom, which
   * is right when the element is the viewport; under the stage's zoom model
   * the element grows to `document × zoom` while `canvas.width` stays the
   * Document size, so at zoom>100 the base would report a shrinking box of
   * the scene and cull every object outside it — a centered shape vanished
   * at ≈300% once it left the shrinking box. Here the element IS the whole
   * Document at any zoom, so the on-screen region is the Document itself.
   */
  override calcViewportBoundaries(): TCornerPoint {
    return (this.vptCoords = {
      tl: new Point(0, 0),
      tr: new Point(this.width, 0),
      bl: new Point(0, this.height),
      br: new Point(this.width, this.height),
    })
  }

  /**
   * Set the zoom (build spec §9). With `aboutCenter`, the scene point at the
   * workspace center stays put — the anchor the Ctrl+= / Ctrl+− steps, the
   * presets, and the slider zoom about: the scroll re-anchors after the
   * layout change. Notifies `onZoomChanged` (view state — the chrome's
   * readout mirrors it; nothing is serialized, nothing enters the undo
   * stack).
   */
  setZoomPercent(percent: number, aboutCenter = false): void {
    const anchor = aboutCenter ? this.getViewportCenterScenePoint() : null
    this.zoomPercentValue = clampZoomPercent(percent)
    this.applyZoomLayout()
    if (anchor && this.workspaceEl) {
      const workspace = this.getWorkspaceSize()
      const scroll = this.scrollForScenePoint(
        anchor,
        workspace.width / 2,
        workspace.height / 2,
      )
      this.workspaceEl.scrollLeft = scroll.x
      this.workspaceEl.scrollTop = scroll.y
    }
    this.onZoomChanged?.()
  }

  /**
   * Set the zoom about the scene point under the client point (build spec §9
   * extension — the wheel zoom): the anchor the touchpad pinch and Ctrl+wheel
   * zoom about — the scene point under the pointer stays put as the layout
   * changes. The workspace's own rect maps the client point in, so the caller
   * passes page coordinates unchanged. Same view-state contract as
   * `setZoomPercent`; without a workspace (tests) there is no pointer to map,
   * so the plain set is the fallback.
   */
  setZoomPercentAboutClientPoint(
    percent: number,
    clientX: number,
    clientY: number,
  ): void {
    const workspaceEl = this.workspaceEl
    if (!workspaceEl) {
      this.setZoomPercent(percent)
      return
    }
    const rect = workspaceEl.getBoundingClientRect()
    const workspaceX = clientX - rect.left
    const workspaceY = clientY - rect.top
    const anchor = this.scenePointAt(workspaceX, workspaceY)
    this.zoomPercentValue = clampZoomPercent(percent)
    this.applyZoomLayout()
    const scroll = this.scrollForScenePoint(anchor, workspaceX, workspaceY)
    workspaceEl.scrollLeft = scroll.x
    workspaceEl.scrollTop = scroll.y
    this.onZoomChanged?.()
  }

  /**
   * Fit (§9): always-fit — the whole Document (rotated bounds) scales up or
   * down into the workspace minus the fixed margin — the default zoom on
   * load, and Ctrl+0. Re-centers after the zoom lands.
   */
  fitToWorkspace(): void {
    const workspace = this.getWorkspaceSize()
    const percent = computeFitZoom(
      this.width,
      this.height,
      workspace.width,
      workspace.height,
      this.displayRotation(),
    )
    this.setZoomPercent(percent)
    this.recenter()
  }

  /**
   * Re-center at the current zoom (§9) — the workspace-resize behavior: the
   * Document returns to the workspace center and the scroll clamps into the
   * range (scrollbars appear when the zoomed Document no longer fits). The
   * zoom itself never changes — resize never re-fits.
   */
  recenter(): void {
    if (!this.workspaceEl) return
    const content = this.getContentSize()
    const workspace = this.getWorkspaceSize()
    this.workspaceEl.scrollLeft = this.clampScroll(
      (content.width - workspace.width) / 2,
      content.width - workspace.width,
    )
    this.workspaceEl.scrollTop = this.clampScroll(
      (content.height - workspace.height) / 2,
      content.height - workspace.height,
    )
  }

  /** Clamp a scroll position to its range — never negative, never past the end. */
  private clampScroll(value: number, range: number): number {
    return Math.min(Math.max(0, value), Math.max(0, range))
  }

  /**
   * The scene point at the workspace center — the anchor the zoom controls
   * keep fixed (§9): the viewport center in scene coordinates. Without a
   * workspace (tests), falls back to the base's viewport center.
   */
  getViewportCenterScenePoint(): Point {
    if (!this.workspaceEl) return this.getVpCenter()
    const workspace = this.getWorkspaceSize()
    return this.scenePointAt(workspace.width / 2, workspace.height / 2)
  }

  /**
   * The scene point at a workspace position — the general form of the
   * center-anchor above: the anchor the point-anchored zoom keeps fixed (§9
   * extension) is whatever scene point sits under the pointer.
   */
  private scenePointAt(workspaceX: number, workspaceY: number): Point {
    // The workspace position, plus the scroll, minus the element's centering
    // offset, is an element point; the viewport transform's inverse maps it
    // to scene space. Under a rotated viewport the transform carries the
    // rotation, so the mapping stays exact at any displayed orientation. At
    // 0° (transform `[z, 0, 0, z, 0, 0]`) this reduces to the divide-by-z
    // form.
    const offset = this.getElementOffset()
    const scroll = this.getScroll()
    return new Point(
      workspaceX + scroll.x - offset.x,
      workspaceY + scroll.y - offset.y,
    ).transform(util.invertTransform(this.viewportTransform))
  }

  /**
   * Center an object at the viewport center (§6 — new text lands there): the
   * base's viewport center is the transform's own center, which the
   * workspace-scrolled layout does not show at the workspace center.
   */
  override viewportCenterObject(object: FabricObject): FabricObject {
    const center = this.getViewportCenterScenePoint()
    object.setPositionByOrigin(center, "center", "center")
    return object
  }

  /** The workspace's size — the scroll container's client size, 0 without one. */
  private getWorkspaceSize(): { width: number; height: number } {
    return this.workspaceEl
      ? {
          width: this.workspaceEl.clientWidth,
          height: this.workspaceEl.clientHeight,
        }
      : { width: 0, height: 0 }
  }

  /**
   * The rotation the stage displays the Document at (build spec §10): the
   * cardinal snap of `canvas.rotation`. The layout, fit, and the scroll↔scene
   * mapping all read this; a non-cardinal rotation displays unrotated.
   */
  private displayRotation(): number {
    return displayRotationDeg(this.rotation)
  }

  /**
   * The zoomed Document size, rounded to integer CSS px — the element's size.
   * At a cardinal rotation the element is the Document's rotated bounding box
   * (`rotatedBounds` × zoom); at 0° that is exactly `document × zoom`.
   */
  private getZoomedSize(): { width: number; height: number } {
    const z = this.zoomPercentValue / 100
    const bounds = rotatedBounds(this.width, this.height, this.displayRotation())
    return {
      width: Math.round(bounds.width * z),
      height: Math.round(bounds.height * z),
    }
  }

  /**
   * The scrollable content's size: the workspace, floored against the zoomed
   * Document — the stage's flex layout centers the element in it, so the
   * scrollbars appear exactly when the zoomed Document no longer fits (§9),
   * and the fit margin is the flex centering's remainder at rest.
   */
  private getContentSize(): { width: number; height: number } {
    const workspace = this.getWorkspaceSize()
    const zoomed = this.getZoomedSize()
    return {
      width: Math.max(workspace.width, zoomed.width),
      height: Math.max(workspace.height, zoomed.height),
    }
  }

  /**
   * The Document's top-left inside the content box, before scrolling — the
   * stage layout flex-centers the element, so the offset is the centering
   * remainder; the scroll subtracts from it.
   */
  private getElementOffset(): { x: number; y: number } {
    const content = this.getContentSize()
    const zoomed = this.getZoomedSize()
    return {
      x: (content.width - zoomed.width) / 2,
      y: (content.height - zoomed.height) / 2,
    }
  }

  private getScroll(): { x: number; y: number } {
    return this.workspaceEl
      ? { x: this.workspaceEl.scrollLeft, y: this.workspaceEl.scrollTop }
      : { x: 0, y: 0 }
  }

  /** The scroll that puts the given scene point at the given workspace
   * position — the zoom re-anchor (§9 and its wheel-zoom extension), clamped
   * to the scroll range. The center-anchor zooms pass the workspace center;
   * the wheel zoom passes the pointer's position. The scene point maps to the
   * element via the viewport transform (the rotation included), then to a
   * scroll position by removing the element's centering offset; at 0° this
   * reduces to the `scene × z` form. */
  private scrollForScenePoint(
    scene: Point,
    workspaceX: number,
    workspaceY: number,
  ): { x: number; y: number } {
    const workspace = this.getWorkspaceSize()
    const content = this.getContentSize()
    const offset = this.getElementOffset()
    const elementPoint = scene.transform(this.viewportTransform)
    return {
      x: this.clampScroll(
        elementPoint.x + offset.x - workspaceX,
        content.width - workspace.width,
      ),
      y: this.clampScroll(
        elementPoint.y + offset.y - workspaceY,
        content.height - workspace.height,
      ),
    }
  }

  /**
   * Apply the zoom to the stage: the Document's element — CSS size and
   * bitmaps (the DOMManager re-scales the contexts for the DPR after the
   * resize, exactly as a document resize does) — grows to `document × zoom`
   * (its rotated bounding box at a cardinal display rotation), and the
   * viewport transform scales and rotates the render into it. canvas.width
   * and canvas.height — the Document size — never change, so the envelope,
   * the toolbar, and the history keep reading the Document. The transform's
   * translate carries the rotation's centering (zero at 0°); the scroll
   * position IS the pan — the scrollbars map their axes through the
   * transform, so panning stays native at every orientation.
   */
  private applyZoomLayout(): void {
    const z = this.zoomPercentValue / 100
    const size = this.getZoomedSize()
    this.elements.setDimensions(size, this.getRetinaScaling())
    this.elements.setCSSDimensions(size)
    this.setViewportTransform(
      rotatedViewportTransform(this.width, this.height, z, this.displayRotation()),
    )
  }

  /**
   * Per-object press hit test (build spec §7 Q2): a shape's pixels are its
   * design extent — the fill and the full border (which renders centered on
   * the cut, §4) both sit inside the clipPath. The base test is the
   * interior bounding box, which over-hits: the clip's bbox corners are
   * transparent for circle/oval/triangle — a press there must read as empty
   * canvas, so a marquee can start inside the bounding box wherever the
   * shape has no pixels. Shapes with a clipPath therefore test the point
   * against the clip geometry directly (the clip extends half the border
   * past the cut, so the border ring is covered too), in the shape's local
   * plane; everything else keeps Fabric's test. Group children go through
   * the same path with their absolute transform (`calcTransformMatrix`
   * de-nests through the group), so the cut test works inside groups too.
   */
  override _checkTarget(obj: StageFabricObject, pointer: Point): boolean {
    if (obj.clipPath) {
      if (!obj.visible || !obj.evented) return false
      const local = pointer.transform(util.invertTransform(obj.calcTransformMatrix()))
      // The clipPath property is declared on the base generic; the cut
      // geometry test only reads shape props, so the cast is safe.
      return isPointInCutGeometry(obj.clipPath as FabricObject, local)
    }
    // The exported `Canvas` type resolves `FabricObject` to the base generic
    // while the base method's own signature carries the full-props class —
    // the same class, seen through two instantiation paths. The runtime call
    // is unchanged; the cast bridges the declaration mismatch.
    return super._checkTarget(obj as never, pointer)
  }

  /**
   * The child of an entered group under a scene pointer, topmost first —
   * the group's internal order is the Document's, fixed at group time — via
   * the same clip-aware hit test as the top level. Undefined when the
   * pointer is over the group's empty interior or its clipped-out areas.
   * `getObjects` types children with the base generic (the interface shape,
   * without the interactive surface); the hit test needs the full props —
   * the same cast Fabric's own target search performs.
   */
  private findChildAt(group: Group, pointer: Point): StageFabricObject | undefined {
    const children = group.getObjects() as StageFabricObject[]
    for (let i = children.length - 1; i >= 0; i--) {
      if (this._checkTarget(children[i], pointer)) return children[i]
    }
    return undefined
  }

  /**
   * Empty-interior resolution while a group is entered (§7 Q5): with
   * `enteredGroup` set, the base search already resolves children natively
   * (the group's subTargetCheck/interactive flags, set at entry) — those
   * pass through untouched. What the base cannot express: a press in the
   * group's empty interior — the bounding box, no child — still resolves
   * the group itself. That must read exactly like empty canvas: deselect on
   * click, marquee on drag, and the entered state exits on mouse:down — so
   * the child test runs for it, and a miss resolves to no target. A press
   * on any other top-level object resolves normally — selecting it exits
   * the entered state on mouse:down too.
   */
  override findTarget(e: TPointerEvent): FullTargetsInfoWithContainer {
    const info = super.findTarget(e)
    const group = this.enteredGroup
    if (!group) return info
    const target = info.target
    if (target !== group && target !== null) return info
    const child = this.findChildAt(group, this.getScenePoint(e))
    if (child) {
      return {
        ...info,
        target: child,
        currentTarget: child,
        subTargets: [child],
        currentSubTargets: [child],
      }
    }
    return {
      ...info,
      target: undefined,
      currentTarget: undefined,
      subTargets: [],
      currentSubTargets: [],
    }
  }

  /**
   * Enter a group (§7 Q5): children become individually selectable for
   * property inspection and Text editing, but are fixed — no handles, no
   * free dragging, no individual resize (the same inert surface as the
   * locked state, minus the `editable` block: a text child's session stays
   * open). The selection clears — the next press picks a child. Locked
   * groups can't be entered.
   */
  enterGroup(group: Group): void {
    if (group.locked || this.enteredGroup === group) return
    this.enteredGroup = group
    // The interactive surface of the entered group: Fabric's target search
    // resolves children natively (subTargetCheck), and the text session's
    // second single-click is gated on `group.interactive` — the early-verify
    // item (§7 Q5). Both are view state, restored on exit.
    group.set("subTargetCheck", true)
    group.set("interactive", true)
    this.enteredChildren = group.getObjects()
    for (const child of this.enteredChildren) this.applyEnteredChildState(child, true)
    this.discardActiveObject()
    this.requestRenderAll()
  }

  /**
   * Exit the entered group (§7 Q5): children return to their normal surface
   * and the selection clears — the exit paths (empty press, Escape) are
   * deselects. Also the document-restore reset (loadFromJSON): the entered
   * group and its children may not exist after a restore, and the fixed
   * child state must not leak onto the restored objects. The re-fix walks
   * the children captured at enter time, not the group's live list — an
   * ungroup of the entered group extracts them first, and the exit must
   * still restore their surface.
   */
  exitEnteredGroup(): void {
    const children = this.enteredChildren
    const group = this.enteredGroup
    this.enteredGroup = null
    this.enteredChildren = []
    if (group) {
      group.set("subTargetCheck", false)
      group.set("interactive", false)
    }
    for (const child of children) this.applyEnteredChildState(child, false)
    this.discardActiveObject()
    this.requestRenderAll()
  }

  /** True while the object is a child of the currently entered group. */
  isEnteredChild(obj: BaseFabricObject): boolean {
    return obj.group === this.enteredGroup
  }

  /**
   * The inert surface of a group child while its group is entered (§7 Q5):
   * no handles and locked transforms — a child is fixed in place. The
   * locked state folds in: a locked child stays inert after the group
   * exits, and a child unlocked inside its group lands on exactly this
   * entered-fixed surface (see setLocked).
   */
  private applyEnteredChildState(obj: BaseFabricObject, entered: boolean): void {
    const inert = obj.locked || entered
    obj.set("hasControls", !inert)
    obj.set("lockMovementX", inert)
    obj.set("lockMovementY", inert)
    obj.set("lockScalingX", inert)
    obj.set("lockScalingY", inert)
    obj.set("lockRotation", inert)
  }

  /**
   * Set an object's locked state — wraps the document-props `setLocked` so
   * a child unlocked inside its entered group stays fixed: the unlock would
   * otherwise hand it handles and free transforms inside the group (§7 Q5).
   */
  setLocked(obj: BaseFabricObject, locked: boolean): void {
    setLockedProps(obj, locked)
    if (this.isEnteredChild(obj)) this.applyEnteredChildState(obj, true)
  }

  /**
   * A document restore (undo/redo, and the design-file import of a later
   * build) replaces the whole document — the entered group and its children
   * may no longer exist, and the fixed child state must not leak onto the
   * restored objects. Exit the entered state before the restore runs.
   */
  override loadFromJSON(
    json: string | Record<string, unknown>,
    reviver?: util.EnlivenObjectOptions["reviver"],
    options?: Abortable,
  ): Promise<this> {
    this.exitEnteredGroup()
    return super.loadFromJSON(json, reviver, options).then((canvas) => {
      // The entered flags are view state (ADR 0003 — never serialized), but
      // Fabric serializes `subTargetCheck`/`interactive` on groups: a
      // snapshot taken mid-entry (a property edit on a child is a commit
      // boundary) would otherwise restore children individually targetable
      // without entering. Reset every restored group to the plain surface.
      for (const obj of this.getObjects()) {
        if (obj instanceof Group) {
          obj.set("subTargetCheck", false)
          obj.set("interactive", false)
        }
      }
      return canvas
    })
  }

  /**
   * A document resize re-applies the zoomed presentation (build spec §9): the
   * base sizes the element to the new Document size, and the element must
   * come back to `document × zoom` — the toolbar's size edit and the history
   * restore both route here. The zoom itself never changes. The base's
   * `setDimensions` is replicated through its protected impl because the
   * override signature (the union of the base's overloads) cannot be
   * forwarded back into them.
   */
  override setDimensions(
    dimensions: Partial<TSize>,
    options?: TCanvasSizeOptions,
  ): void {
    this._setDimensionsImpl(
      { width: dimensions.width ?? this.width, height: dimensions.height ?? this.height },
      options,
    )
    if (!options || !options.cssOnly) this.requestRenderAll()
    this.applyZoomLayout()
  }

  /**
   * Clear the full bitmap — the zoomed element is larger than the Document
   * size (canvas.width), and the base clears only the Document-sized rect in
   * the element's top-left, leaving the previous frame's pixels beyond it
   * (ghosts when zooming out). The element's bitmap dimensions are the
   * zoomed stage's true size.
   */
  override clearContext(ctx: CanvasRenderingContext2D): void {
    const element = this.getElement()
    ctx.clearRect(0, 0, element.width, element.height)
  }

  /**
   * Paint the Document background across the whole element (build spec §11).
   * The stage's zoom model (ADR-adjacent, §9) enlarges the element to
   * `document × zoom` — canvas.width stays the Document size, and the
   * viewport transform carries the zoom. Fabric's own background renderer
   * draws a `0..width / 0..height` rect and *then* applies the viewport
   * transform, but a Canvas 2D path is rasterized under the matrix active at
   * path construction, so the zoom never reaches the fill: at zoom>100% the
   * background covers only `document × DPR` and the enlarged element's outer
   * ring shows the raw (transparent) bitmap. Because the element is the
   * Document at any zoom, the background fills the element's full bitmap.
   * Gradients, patterns, and `backgroundImage` fall through to the base (the
   * Document background is a plain color today, §11).
   */
  override _renderBackground(ctx: CanvasRenderingContext2D): void {
    if (typeof this.backgroundColor !== "string" || this.backgroundImage) {
      super._renderBackground(ctx)
      return
    }
    const element = this.getElement()
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = this.backgroundColor
    ctx.fillRect(0, 0, element.width, element.height)
    ctx.restore()
  }

  /**
   * True while the selection controls painted on the overlay this frame —
   * the smart-guides painter's skip-clear probe: the controls mirror's own
   * per-frame clear already wipes stale paint, so a clear at this point
   * would only ever wipe the chrome painted moments earlier.
   */
  didPaintControlsThisFrame(): boolean {
    return this.controlsPaintedThisFrame
  }

  /** Marks this frame as painting smart guides — the sweep keeps the overlay. */
  markGuidesPainted(): void {
    this.guidesPaintedThisFrame = true
  }

  /** Marks this frame as painting the hover border — the sweep keeps the overlay. */
  markHoverPainted(): void {
    this.hoverPaintedThisFrame = true
  }

  /** Erase the workspace overlay — all mirrored paint lives only on it. */
  clearOverlay(): void {
    const ctx = this.marqueeOverlay.getContext("2d")
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.marqueeOverlay.width, this.marqueeOverlay.height)
  }

  /**
   * End-of-frame overlay sweep, called from every `after:render` (both
   * `renderCanvas` and `renderTop` fire it): erase the overlay when neither
   * the marquee nor the selection controls painted during this frame, no
   * marquee is in progress, and no selection is active — a stale rect from
   * a finished drag would otherwise linger on the workspace. An active
   * selection keeps the previous frame's paint: `renderTop`-only frames
   * (a zero-delta pointer jitter between down and up) paint nothing, and
   * the selection is unchanged, so its chrome still holds. Resets the
   * per-frame paint flags regardless, so each frame's decision starts
   * clean.
   */
  finalizeOverlayFrame(): void {
    const keep =
      this.isMarqueeActive() ||
      this.marqueePaintedThisFrame ||
      this.controlsPaintedThisFrame ||
      this.guidesPaintedThisFrame ||
      this.hoverPaintedThisFrame ||
      !!this._activeObject
    this.marqueePaintedThisFrame = false
    this.controlsPaintedThisFrame = false
    this.guidesPaintedThisFrame = false
    this.hoverPaintedThisFrame = false
    if (!keep) this.clearOverlay()
  }

  /**
   * Prepare the overlay context for one frame's paint: size the bitmap to
   * the overlay's CSS size at the device pixel ratio and reset to the dpr
   * transform, clearing unless the caller asks to keep an earlier paint of
   * this same frame (a live marquee must not be wiped by the controls
   * mirror). Returns the context and the Document's offset inside the
   * overlay — the caller applies the offset the way its paint needs (the
   * marquee translates; the controls mirror folds it into the context shim,
   * since Fabric's handle renderer resets the transform absolutely).
   * Returns null when no 2D context is available. Deliberately not guarded
   * on zero size: the tests paint at jsdom's 0×0.
   */
  prepareOverlay(
    skipClear: boolean,
  ): {
    ctx: CanvasRenderingContext2D
    offset: { x: number; y: number }
    width: number
    height: number
  } | null {
    const overlay = this.marqueeOverlay
    const ctx = overlay.getContext("2d")
    if (!ctx) return null
    const dpr = window.devicePixelRatio || 1
    const width = overlay.offsetWidth
    const height = overlay.offsetHeight
    const bitmapWidth = Math.round(width * dpr)
    const bitmapHeight = Math.round(height * dpr)
    // Independent dimension compares — resizing only when the width changes
    // goes stale on a height-only resize.
    if (overlay.width !== bitmapWidth || overlay.height !== bitmapHeight) {
      overlay.width = bitmapWidth
      overlay.height = bitmapHeight
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    if (!skipClear) ctx.clearRect(0, 0, width, height)
    return {
      ctx,
      offset: getOverlayOffset(
        this.upperCanvasEl.getBoundingClientRect(),
        overlay.getBoundingClientRect(),
      ),
      width,
      height,
    }
  }

  /**
   * Dispose the Build 9 smart-guides wrapper and Build 4's undo/redo stack
   * (their extension listeners) before the canvas's own async dispose — the
   * canvas-rebuild lifecycle in the stage component disposes and re-creates,
   * so a rebuild must not leak the old listeners or caches.
   */
  override dispose(): Promise<boolean> {
    this.smartGuides?.dispose()
    this.hoverBorder?.dispose()
    this.history.dispose()
    return super.dispose()
  }

  /**
   * Mirror Fabric's marquee paint onto the overlay instead of the upper
   * canvas: the same fill and centered dashed stroke (build spec §7's look),
   * in overlay-local viewport coordinates — the canvas origin offset by how
   * far the Document sits inside the overlay, so the paint stays glued to
   * the scene at any zoom or scroll.
   */
  override _drawSelection(_ctx: CanvasRenderingContext2D): void {
    const prepared = this.prepareOverlay(false)
    if (!prepared) return
    const { ctx, offset } = prepared
    // The marquee paints in viewport coordinates — the canvas origin offset
    // by how far the Document sits inside the overlay glues it to the scene.
    ctx.translate(offset.x, offset.y)
    this.marqueePaintedThisFrame = true

    const selector = this._groupSelector!
    if (this.displayRotation() !== 0) {
      // A rotated viewport turns the marquee into a quad — the two-corner
      // box mapping (getMarqueeBox) would paint the axis-aligned bounding
      // box of the transformed corners, the wrong shape. Paint the quad.
      this.paintMarqueePath(ctx, getMarqueeQuad(selector, this.viewportTransform))
      return
    }

    const box = getMarqueeBox(selector, this.viewportTransform)

    if (this.selectionColor) {
      ctx.fillStyle = this.selectionColor
      ctx.fillRect(box.left, box.top, box.width, box.height)
    }
    if (!this.selectionLineWidth || !this.selectionBorderColor) return
    const strokeOffset = this.selectionLineWidth / 2
    ctx.lineWidth = this.selectionLineWidth
    ctx.strokeStyle = this.selectionBorderColor
    if (this.selectionDashArray.length) ctx.setLineDash(this.selectionDashArray)
    ctx.strokeRect(
      box.left + strokeOffset,
      box.top + strokeOffset,
      box.width - this.selectionLineWidth,
      box.height - this.selectionLineWidth,
    )
  }

  /**
   * Paint the marquee as a filled, dashed-stroked path through four corners —
   * the rotated-viewport form of the box paint above (build spec §7's look,
   * §10 rotation). The stroke insets half its width toward the quad's
   * centroid, so it reads centered on the drag rect's edge like the box
   * path's inset.
   */
  private paintMarqueePath(ctx: CanvasRenderingContext2D, corners: Point[]): void {
    if (this.selectionColor) {
      ctx.fillStyle = this.selectionColor
      ctx.beginPath()
      ctx.moveTo(corners[0].x, corners[0].y)
      for (let i = 1; i < corners.length; i++) {
        ctx.lineTo(corners[i].x, corners[i].y)
      }
      ctx.closePath()
      ctx.fill()
    }
    if (!this.selectionLineWidth || !this.selectionBorderColor) return
    const cx = corners.reduce((sum, c) => sum + c.x, 0) / corners.length
    const cy = corners.reduce((sum, c) => sum + c.y, 0) / corners.length
    ctx.lineWidth = this.selectionLineWidth
    ctx.strokeStyle = this.selectionBorderColor
    if (this.selectionDashArray.length) ctx.setLineDash(this.selectionDashArray)
    ctx.beginPath()
    const inset = this.selectionLineWidth / 2
    corners.forEach((corner, i) => {
      const dx = corner.x - cx
      const dy = corner.y - cy
      const dist = Math.hypot(dx, dy) || 1
      const x = corner.x - (dx / dist) * inset
      const y = corner.y - (dy / dist) * inset
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.closePath()
    ctx.stroke()
  }

  /**
   * Mirror the selection controls onto the workspace overlay instead of the
   * lower canvas (§7 extension — the lower bitmap is the Document's size, so
   * a selection box, corner handle, or rotation handle past the Document
   * edge was invisible there). The paint is Fabric's own `_renderControls`,
   * which applies the viewport and object transforms against a base context,
   * so locked objects (borders only), the custom rotation handle, and
   * ActiveSelection member boxes all mirror as-is. The skip-clear guard keeps
   * a live marquee: its paint lives on the same overlay, and `renderTop`'s
   * `after:render` already reset this frame's marquee flag by the time a
   * queued render runs. Hit-testing never changed — `findControl` is
   * unbounded client-coordinate math — so the mirrored handles stay
   * draggable past the Document edge through the existing workspace press
   * routing. The workspace's hover cursor over them is the canvas's own
   * answer — `getWorkspaceCursor` — since Fabric's cursor updates stop at
   * the upper-canvas edge, which the pointer past the Document is not over.
   */
  override drawControls(_ctx: CanvasRenderingContext2D): void {
    const activeObject = this._activeObject
    if (!activeObject) return
    const prepared = this.prepareOverlay(this.isMarqueeActive())
    if (!prepared) return
    const { ctx, offset } = prepared
    this.controlsPaintedThisFrame = true
    // The offset rides twice: a base translate, and the shim's injection
    // into absolute `setTransform` resets. The selection box composes its
    // position with relative calls on the base — it needs the translate.
    // The handle renderer resets the transform absolutely — it wipes that
    // translate, so the injection restores it.
    ctx.translate(offset.x, offset.y)
    activeObject._renderControls(offsetContext(ctx, offset))
  }

  /**
   * The cursor the workspace should show for the pointer at a client
   * position (build spec §5, §7 extension). Fabric's own cursor updates
   * (`_setCursorFromEvent`) stop at the upper-canvas edge — the pointer
   * past the Document is not over it — so the mirrored chrome hanging off
   * the Document would read `auto`. Hit-testing is Fabric's own
   * `findControl` (unbounded DOM math, the same path the in-document
   * cursor takes): a mirrored control answers with its own
   * `cursorStyleHandler` — the rotation-aware corner diagonals and side
   * axes, the rotation crosshair — and the selection box's interior (the
   * visible border's box) shows the object's hoverCursor,
   * the "move" affordance the object itself gives in-document. Returns ""
   * when nothing mirrored is under the pointer, so the workspace keeps
   * its default cursor. The viewport point is the client point relative
   * to the upper canvas's rect — the same CSS-space mapping the mirror
   * paints with.
   */
  getWorkspaceCursor(clientX: number, clientY: number): string {
    const active = this._activeObject
    if (!active || this.isMarqueeActive()) return ""
    const rect = this.upperCanvasEl.getBoundingClientRect()
    const viewportPoint = new Point(clientX - rect.left, clientY - rect.top)
    const corner = active.findControl(viewportPoint)
    if (corner) {
      // A bare object stands in for the real event: the rotation-aware
      // corner/side overrides ignore eventData entirely, and Fabric's stock
      // scale/skew handlers only read the modifier keys off it
      // (`canvas.uniScaleKey` / `altActionKey`) to pick uniform scaling and
      // the skew affordance. Absent reads are the no-modifier state a plain
      // hover has — a real event would read the same, since the cursor must
      // not depend on keys that aren't pressed. `undefined` would crash
      // them: the handlers dereference `eventData[key]` at the first
      // modifier check.
      return corner.control.cursorStyleHandler(
        {} as never,
        corner.control,
        active,
        corner.coord,
      )
    }
    const { tl, tr, br, bl } = active.oCoords
    if (tl && tr && br && bl && isPointInQuad(viewportPoint, tl, tr, br, bl)) {
      return active.hoverCursor || this.hoverCursor
    }
    return ""
  }
}

/**
 * Create the stage Canvas on a fresh canvas element. The white Document
 * background is a document property (serialized, honored at export, build
 * spec §11) — set it here so the stage shows the Document, not CSS paint.
 * The overlay is the workspace-spanning transparent canvas the marquee and
 * selection-controls mirrors paint on (§7 extension). The workspace element
 * is the Stage's scroll container — the zoom layout reads its client size
 * and scroll position (§9); null in tests.
 */
export function createStageCanvas(
  element: HTMLCanvasElement,
  marqueeOverlay: HTMLCanvasElement,
  workspaceEl: HTMLElement | null = null,
): StageCanvas {
  const canvas = new StageCanvas(element, marqueeOverlay, workspaceEl, {
    width: DOCUMENT_WIDTH,
    height: DOCUMENT_HEIGHT,
    backgroundColor: DOCUMENT_BACKGROUND_COLOR,
  })

  // Document border (envelope-owned, ADR 0002) — off at creation. The canvas
  // is the document: the border lives here, mirrored by the stage toolbar.
  canvas.borderWidth = DOCUMENT_BORDER_WIDTH
  canvas.borderColor = DOCUMENT_BORDER_COLOR

  // Document rotation (envelope-owned, ADR 0002) — 0° at creation. The
  // envelope carries it and export renders it; the stage displays cardinal
  // rotations through the viewport transform (a non-cardinal value displays
  // unrotated).
  canvas.rotation = DOCUMENT_ROTATION

  // Document identity (ADR 0002): stamp the id/locked defaults at the
  // document boundary so every creation path — sidebar, console-added
  // objects, imports — carries a stable id. Objects restored from a Design
  // file already have their ids and are left untouched. The rotation handle
  // is replaced with the icon version on every add path; shapes hide the
  // side handles — square/rectangle keep all four (ml/mr scale the width,
  // mt/mb the height, freely, §5), while circle/oval/triangle stay
  // corner-handles-only (uniform scaling) — and text hides the top/bottom
  // handles — a Y-only drag would distort the glyphs, and the uniform-scaling
  // lock pins it dead anyway. Text keeps the ml/mr wrap handles (§6).
  canvas.on("object:added", (event) => {
    const obj = event.target
    if (!obj) return
    if (!obj.id) stampDocumentProps(obj)
    applyRotateHandle(obj)
    const kind = getShapeKind(obj)
    if (kind) {
      // The border renders at a fixed px (strokeUniform) with the cache
      // re-rendered live while scaling (`noScaleCache` off) — a stale
      // gesture-start cache would stretch the baked stroke and the border
      // would grow until the gesture commits. `noScaleCache` is not
      // serialized, so the add boundary re-stamps it: a JSON restore
      // (undo/redo) would otherwise revive shapes with the stock default.
      obj.set("noScaleCache", false)
      // Square and rectangle keep every side handle — a drag on one scales
      // that axis freely (the scaling handler below skips the ratio lock for
      // them); the other shapes stay corner-handles-only.
      if (kind !== "square" && kind !== "rectangle") {
        obj.setControlsVisibility({ ml: false, mt: false, mr: false, mb: false })
      }
    } else if (isTextObject(obj)) {
      obj.setControlsVisibility({ mt: false, mb: false })
    } else if (obj instanceof Group) {
      // A group scales as one unit — corner handles only, like a
      // multi-selection (a side-handle drag would stretch the children
      // non-uniformly; scaling is free from the corners, §7 Q8). The cache
      // policy re-stamps here too: children's fixed-px borders hold while
      // the group itself scales.
      obj.setControlsVisibility({ ml: false, mt: false, mr: false, mb: false })
      obj.set("noScaleCache", false)
    }
    // Corner handles show the diagonal cursor (CORNER_BASE_DIRECTION)
    // instead of Fabric's quadrant-based one — shapes and text share it, so
    // the affordance never varies with the object's aspect — rotated with
    // the object, and the side handles show the rotated axis arrows.
    applyResizeCursors(obj)
  })

  // The multi-select wrapper never fires `object:added` — Fabric builds the
  // ActiveSelection without an add — so it would keep the stock chrome: the
  // quadrant corner cursor, the plain square rotation handle (no badge), and
  // the side handles that would stretch the set non-uniformly. Apply the same
  // chrome the members got at add time — the rotation-aware corner cursors,
  // the rotation badge, and corners-only visibility, so the set scales
  // uniformly from corners like a single object — whenever a selection forms
  // or changes; re-applying is a no-op for already-chromed selections.
  const applySelectionChrome = () => {
    const active = canvas.getActiveObject()
    if (!(active instanceof ActiveSelection)) return
    applyResizeCursors(active)
    applyRotateHandle(active)
    active.setControlsVisibility({ ml: false, mt: false, mr: false, mb: false })
    // The wrapper is never serialized — Fabric builds it fresh per
    // selection — so the live-scale cache policy stamps here, the same
    // re-stamp the add boundary gives shapes and groups.
    active.set("noScaleCache", false)
  }
  canvas.on("selection:created", applySelectionChrome)
  canvas.on("selection:updated", applySelectionChrome)

  // A text can still carry a stale scale transform at selection time: a
  // multi-selection's members get the selection's transform folded into them
  // when it dissolves (§7), and the fold happens after the gesture's own
  // commit — so the size readout would lag whatever scale the set was
  // dragged to. Baking the folded scale the moment the text becomes active
  // keeps the toolbar's size field the source of truth on every path.
  const bakeActiveTextScale = () => {
    const active = canvas.getActiveObject()
    if (isTextObject(active)) bakeTextScale(active, getTextMeasurer())
  }
  canvas.on("selection:created", bakeActiveTextScale)
  canvas.on("selection:updated", bakeActiveTextScale)

  // The document border (envelope-owned, ADR 0002) renders as an inset stroke
  // on the document edge — unlike the shape border, it is inset (§4): the
  // stroke sits inside the edge, so exports (which render only the document
  // area) show the full border. `after:render` paints in scene space under
  // the viewport transform (§9), so the stroke hugs the document edge at any
  // zoom — the border is document state and scales with the Document.
  canvas.on("after:render", () => {
    const borderWidth = canvas.borderWidth
    if (!borderWidth) return
    const ctx = canvas.getContext()
    ctx.save()
    ctx.transform(...canvas.viewportTransform)
    ctx.strokeStyle = canvas.borderColor
    ctx.lineWidth = borderWidth
    ctx.strokeRect(
      borderWidth / 2,
      borderWidth / 2,
      canvas.width - borderWidth,
      canvas.height - borderWidth,
    )
    ctx.restore()
  })

  // Build 9: smart guides (ADR 0004) — the AligningGuidelines subclass
  // wires its own listeners (the six extension handlers plus the overlay
  // painter and the drag-snapshot resets); dispose() releases them, pinned
  // for the canvas-rebuild lifecycle. Constructed before the sweep below so
  // its after:render painter runs first — the sweep's keep-rule reads the
  // guides-painted flag it sets.
  canvas.smartGuides = new SmartGuides(canvas, { margin: SNAP_TOLERANCE_PX })

  // Hover border: the object under the pointer paints its selection-style
  // border on the overlay (mouse:over/mouse:out track the target — each
  // change requests a render, since plain hover moves render nothing —
  // object:removed clears a ghost, and the after:render painter draws the
  // border). Constructed before the sweep below so its painter runs first —
  // the sweep's keep-rule reads the hover-painted flag it sets.
  canvas.hoverBorder = new HoverBorder(canvas)

  // Both mirrors live on the workspace overlay, not on Fabric's canvases
  // (whose bitmaps are the Document's size), so Fabric never clears it. The
  // end-of-render sweep erases it when neither the marquee, the selection
  // controls, nor the smart guides painted this frame — a rect from a
  // finished drag would otherwise linger on the workspace.
  canvas.on("after:render", () => {
    canvas.finalizeOverlayFrame()
  })

  // A deselect must wipe the mirrored chrome at once, not wait for the
  // commit render: that render (renderAll → renderCanvas) early-returns
  // from `drawControls` with no active object, and `finalizeOverlayFrame`
  // keeps the overlay while the marquee is armed — the same pointerdown
  // starts it — so a click on empty space whose mouse:up renders nothing
  // (a no-move click: `isClick` stays true, no renderTop) would leave the
  // previous frame's handles on the workspace forever. `selection:cleared`
  // fires synchronously inside the discard, before any render, so the wipe
  // always precedes whatever paints next — a new selection's controls, or
  // nothing.
  canvas.on("selection:cleared", () => {
    canvas.clearOverlay()
  })

  // Shapes and text scale uniformly from a corner — the aspect ratio is
  // frozen at the gesture start, so a corner drag never distorts the object
  // (§5 shapes, §6 text: text scales like a shape, scale stays on the object
  // and folds into the size at the gesture end — a corner scale is a size
  // change, so auto-fit survives it; only the wrap-width drag hands the
  // width over). Square/rectangle also expose the side handles: a drag on
  // one (mt/mb scale the height, ml/mr the width) scales that axis freely,
  // outside the ratio lock — so a square can grow into a taller or wider
  // rectangle. The first `object:scaling` tick records the ratio; later
  // ticks keep it; the end of the gesture (any transform commit) clears it
  // for the next one.
  const gestureRatios = new WeakMap<FabricObject, number>()
  canvas.on("object:scaling", (event) => {
    const obj = event.target
    const kind = getShapeKind(obj)
    if (!kind && !isTextObject(obj)) return
    const corner = event.transform?.corner
    const axisHandle = corner === "mt" || corner === "mb" || corner === "ml" || corner === "mr"
    if (axisHandle && (kind === "square" || kind === "rectangle")) {
      gestureRatios.delete(obj) // a stale corner-drag ratio must not pin the axis
    } else {
      const ratio = gestureRatios.get(obj)
      if (ratio === undefined) {
        gestureRatios.set(obj, obj.scaleX / obj.scaleY)
      } else {
        obj.set("scaleY", obj.scaleX / ratio)
      }
    }
    // The fixed-px border's clip extension divides by the scale — re-stamp
    // after the scale settles (the ratio correction above), so the clip
    // lands on the stroke's outer edge this very frame.
    if (kind) restampBorderClip(obj)
  })
  canvas.on("object:modified", (event) => {
    if (event.target) gestureRatios.delete(event.target)
    // A text corner drag leaves the box carrying the gesture's scale — bake
    // it into the font size (the toolbar's readout) at the commit boundary,
    // re-hugging the content while the box still auto-fits. Registered
    // before the History (constructed last), so its snapshot sees the baked
    // state and undo/redo restore the size, not the transform. Plain moves,
    // rotations, and session exits pass through (scale 1).
    if (isTextObject(event.target)) bakeTextScale(event.target, getTextMeasurer())
  })

  // Text (§6): text scales uniformly with the shapes above, and the text
  // session lifecycle (commit on exit, Escape reverts, auto-fit re-fits,
  // uppercase) wires here.
  wireTextInteractions(canvas, getTextMeasurer())

  // Build 4: undo/redo (ADR 0001) — the snapshot stack. Created last so the
  // seed snapshot (the initial empty Document) carries the final border and
  // background defaults; it listens for gesture-end boundaries itself, and
  // the StageProvider commits its structural commands (add, delete, arrange,
  // lock, property commits) through it.
  canvas.history = new History(canvas)

  // Group entry (§7 Q5): double-click an unlocked group enters it — children
  // become individually selectable and fixed. The double-click's target is
  // the group (children aren't in the canvas collection, and the two clicks
  // already selected the group). Text inside a group is untouched: the
  // double-click lands on the text object, not the group, so the second
  // single-click still opens the text session — the early-verify item.
  canvas.on("mouse:dblclick", (event) => {
    const target = event.target
    if (target instanceof Group && !target.locked) canvas.enterGroup(target)
  })

  // Exit the entered group (§7 Q5): a press on empty canvas — including the
  // group's own empty interior and any clipped-out area, which the target-
  // finding overrides resolve to no target — or on any object outside the
  // group. The press's own behavior (deselect, select the object) proceeds
  // untouched; the exit is just the context change.
  canvas.on("mouse:down", (event) => {
    if (!canvas.enteredGroup) return
    const target = event.target
    if (target === undefined || !canvas.isEnteredChild(target)) {
      canvas.exitEnteredGroup()
    }
  })

  return canvas
}
