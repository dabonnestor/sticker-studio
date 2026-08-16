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
  util,
  type Abortable,
  type CanvasOptions,
  type ControlRenderingStyleOverride,
  type FabricObject,
  type InteractiveFabricObject,
  type Object as BaseFabricObject,
  type TMat2D,
  type TPointerEvent,
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
import { DEFAULT_BORDER_COLOR, getShapeKind } from "@/fabric/shapes"
import { SNAP_TOLERANCE_PX, SmartGuides } from "@/fabric/smart-guides"
import { wireTextInteractions } from "@/fabric/text-interactions"
import { isTextObject } from "@/fabric/text"

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

/** Rotation-handle size — larger than the 13px corner handles so the icon reads. */
export const ROTATE_HANDLE_SIZE = 20

/** Handle accent color — matches the app's border color (DEFAULT_BORDER_COLOR). */
const ROTATE_ICON_COLOR = "#18181b"

/**
 * Corner-handle cursor per corner (build spec §5): the stage freezes the
 * aspect ratio at the gesture start, so every corner drag moves along the
 * corner's own diagonal. Fabric's quadrant-based corner cursor instead
 * reports the pointer's direction from the object's center — a narrow or
 * wide box (an auto-fitted text!) reads its corners as `n`/`s`/`e`/`w`,
 * so text corners never match the diagonal a squarish shape shows. A fixed
 * per-corner diagonal says "corner resize" for shapes and text alike.
 */
const CORNER_CURSORS: ReadonlyArray<readonly [string, string]> = [
  ["tl", "nwse-resize"],
  ["tr", "nesw-resize"],
  ["bl", "nesw-resize"],
  ["br", "nwse-resize"],
]

/**
 * The fixed diagonal cursor for an object's corner controls (CORNER_CURSORS).
 * Idempotent — safe to re-apply when a selection forms or changes.
 */
function applyCornerCursors(obj: FabricObject): void {
  for (const [key, cursor] of CORNER_CURSORS) {
    const control = obj.controls[key]
    if (control) control.cursorStyleHandler = () => cursor
  }
}

/**
 * The custom rotation handle (build spec §7): the white circular badge with
 * the rotate arrow (renderRotateHandle), sized above the 13px corner handles
 * so the icon reads. Idempotent — safe to re-apply when a selection forms or
 * changes.
 */
function applyRotateHandle(obj: FabricObject): void {
  const rotate = obj.controls.mtr
  if (!rotate) return
  rotate.sizeX = ROTATE_HANDLE_SIZE
  rotate.sizeY = ROTATE_HANDLE_SIZE
  rotate.render = renderRotateHandle
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
 * paint and the tests share one mapping.
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

/** The Document's rect in the workspace, as the overlay mapping needs it. */
export interface OverlayRect {
  left: number
  top: number
}

/**
 * Point-in-cut-geometry test for a shape's clipPath (build spec §7 Q2): a
 * sticker's clipped-out areas count as empty canvas — a marquee can start
 * inside the bounding box wherever the shape has no pixels, and a press
 * there deselects instead of selecting. The clipPath sits at the shape's
 * original edge in the shape's local plane (the inset border model, §4), so
 * the point — already mapped into that plane — tests against the clip's
 * geometry exactly: circle and oval by radius, rectangle by extent, triangle
 * by the base-apex wedge. (Fabric's `containsPoint` is a bounding-box test —
 * the clip's bbox corners are transparent for circle/oval/triangle, and the
 * border ring sits outside the interior bbox.) Any other clip shape falls
 * back to its own bounding-box test, the safe approximation.
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

  /**
   * Build 9's smart-guides wrapper — created by the stage factory, disposed
   * with the canvas (the canvas-rebuild lifecycle disposes and re-creates).
   */
  smartGuides?: SmartGuides

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
    options: Partial<CanvasOptions>,
  ) {
    super(element, options)
    this.marqueeOverlay = marqueeOverlay
  }

  /** True while a marquee drag is in progress. */
  isMarqueeActive(): boolean {
    return this._groupSelector !== null
  }

  /**
   * Per-object press hit test (build spec §7 Q2): a shape's pixels are its
   * cut area — the fill and the border ring both render inside the clipPath.
   * The base test is the interior bounding box, which over-hits (the clip's
   * bbox corners are transparent for circle/oval/triangle — a press there
   * must read as empty canvas, so a marquee can start inside the bounding
   * box wherever the shape has no pixels) and under-hits (the border ring
   * sits outside the interior bbox when the border is on — a press on
   * visible pixels must hit the shape). Shapes with a clipPath therefore
   * test the point against the cut geometry directly, in the shape's local
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
      !!this._activeObject
    this.marqueePaintedThisFrame = false
    this.controlsPaintedThisFrame = false
    this.guidesPaintedThisFrame = false
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

    const box = getMarqueeBox(this._groupSelector!, this.viewportTransform)

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
   * `cursorStyleHandler` — the fixed CORNER_CURSORS diagonals, the
   * rotation crosshair, the text wrap arrows — and the selection box's
   * interior (the visible border's box) shows the object's hoverCursor,
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
      // A bare object stands in for the real event: the corner overrides
      // (CORNER_CURSORS) ignore eventData entirely, and Fabric's stock
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
 * selection-controls mirrors paint on (§7 extension).
 */
export function createStageCanvas(
  element: HTMLCanvasElement,
  marqueeOverlay: HTMLCanvasElement,
): StageCanvas {
  const canvas = new StageCanvas(element, marqueeOverlay, {
    width: DOCUMENT_WIDTH,
    height: DOCUMENT_HEIGHT,
    backgroundColor: DOCUMENT_BACKGROUND_COLOR,
  })

  // Document border (envelope-owned, ADR 0002) — off at creation. The canvas
  // is the document: the border lives here, mirrored by the stage toolbar.
  canvas.borderWidth = DOCUMENT_BORDER_WIDTH
  canvas.borderColor = DOCUMENT_BORDER_COLOR

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
      // non-uniformly; scaling is free from the corners, §7 Q8).
      obj.setControlsVisibility({ ml: false, mt: false, mr: false, mb: false })
    }
    // Corner handles show the fixed diagonal cursor (CORNER_CURSORS) instead
    // of Fabric's quadrant-based one — shapes and text share it, so the
    // affordance never varies with the object's aspect.
    applyCornerCursors(obj)
  })

  // The multi-select wrapper never fires `object:added` — Fabric builds the
  // ActiveSelection without an add — so it would keep the stock chrome: the
  // quadrant corner cursor, the plain square rotation handle (no badge), and
  // the side handles that would stretch the set non-uniformly. Apply the same
  // chrome the members got at add time — the fixed diagonal corner cursors,
  // the rotation badge, and corners-only visibility, so the set scales
  // uniformly from corners like a single object — whenever a selection forms
  // or changes; re-applying is a no-op for already-chromed selections.
  const applySelectionChrome = () => {
    const active = canvas.getActiveObject()
    if (!(active instanceof ActiveSelection)) return
    applyCornerCursors(active)
    applyRotateHandle(active)
    active.setControlsVisibility({ ml: false, mt: false, mr: false, mb: false })
  }
  canvas.on("selection:created", applySelectionChrome)
  canvas.on("selection:updated", applySelectionChrome)

  // The document border (envelope-owned, ADR 0002) renders as an inset stroke
  // on the document edge — same inset model as shape borders (§4): the stroke
  // sits inside the edge, so exports (which render only the document area)
  // show the full border. `after:render` paints in the background's base
  // space, so the stroke hugs the document edge at any zoom.
  canvas.on("after:render", () => {
    const borderWidth = canvas.borderWidth
    if (!borderWidth) return
    const ctx = canvas.getContext()
    ctx.save()
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
  // (§5 shapes, §6 text: the scale fold is gone — text scales like a shape,
  // scale stays on the object). Square/rectangle also expose the side
  // handles: a drag on one (mt/mb scale the height, ml/mr the width) scales
  // that axis freely, outside the ratio lock — so a square can grow into a
  // taller or wider rectangle. The first `object:scaling` tick records the
  // ratio; later ticks keep it; the end of the gesture (any transform
  // commit) clears it for the next one. Scaling also hands a text's width to
  // the user — a re-fit at session exit would measure in local units and
  // fight the scale.
  const gestureRatios = new WeakMap<FabricObject, number>()
  canvas.on("object:scaling", (event) => {
    const obj = event.target
    const kind = getShapeKind(obj)
    if (!kind && !isTextObject(obj)) return
    if (isTextObject(obj)) obj.set("autoFit", false)
    const corner = event.transform?.corner
    const axisHandle = corner === "mt" || corner === "mb" || corner === "ml" || corner === "mr"
    if (axisHandle && (kind === "square" || kind === "rectangle")) {
      gestureRatios.delete(obj) // a stale corner-drag ratio must not pin the axis
      return
    }
    const ratio = gestureRatios.get(obj)
    if (ratio === undefined) {
      gestureRatios.set(obj, obj.scaleX / obj.scaleY)
      return
    }
    obj.set("scaleY", obj.scaleX / ratio)
  })
  canvas.on("object:modified", (event) => {
    if (event.target) gestureRatios.delete(event.target)
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
