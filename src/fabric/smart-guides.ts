/**
 * Smart guides (build spec §17, ADR 0004): interactive alignment guides with
 * magnetic snapping while dragging an object on the stage — a visual and
 * positional aid for laying out a Document. Move-only v1: guides and snapping
 * engage during drags, never while scaling or resizing.
 *
 * The engine is Fabric's `aligning_guidelines` extension (v7.4.0
 * exact-pinned): it computes per-axis min-distance lines from the moved
 * object's five reference points (corners + center) against every target's
 * corner+center points, snaps via `setXY` inside `object:moving`, and caches
 * the lines as JSON strings in `verticalLines` / `horizontalLines`. This
 * module subclasses it with four behavior overrides — `getObjectsByTarget`,
 * `scalingOrResizing`, `afterRender`, `moving` — plus the lifecycle's
 * `dispose`; the subclass is the only place the extension's class API is
 * touched, so a v7-major API move stays contained (ADR 0004).
 *
 * The extension is imported from its source module, not the `fabric/extensions`
 * barrel: the barrel re-exports the westures gesture integration, whose
 * `westures` package is not installed. The import path is pinned by the
 * exact-pinned v7.4.0.
 */

import {
  ActiveSelection,
  Point,
  Rect,
  type BasicTransformEvent,
  type Canvas,
  type FabricObject,
} from "fabric"
import { AligningGuidelines } from "../../node_modules/fabric/extensions/aligning_guidelines/index.ts"
import type { AligningLineConfig } from "../../node_modules/fabric/extensions/aligning_guidelines/typedefs.ts"

import type { StageCanvas } from "@/fabric/stage-canvas"
import { displayRotationDeg } from "@/fabric/zoom"

/**
 * Snap tolerance — a flat 6 screen px (ADR 0004). Snap engages at ≤6 and
 * releases the instant it exceeds 6, no hysteresis; the extension divides the
 * margin by the canvas zoom, so the tolerance stays screen-correct at any
 * zoom. The named constant keeps hysteresis a one-knob change if jitter
 * reports justify it.
 */
export const SNAP_TOLERANCE_PX = 6

/** Solid snapped-guide color (ADR 0004) — periwinkle `rgb(100,100,255)`. */
export const SNAP_GUIDE_SOLID_COLOR = "rgb(100, 100, 255)"

/** Dashed near-guide color (ADR 0004) — periwinkle `rgb(178,204,255)`. */
export const SNAP_GUIDE_NEAR_COLOR = "rgb(178, 204, 255)"

/** Near-guide dash pattern — 4 px on, 4 px off. */
export const SNAP_GUIDE_DASH = [4, 4]

/**
 * The tautological skip's tolerance (ADR 0004): an axis the drag has not
 * moved (accumulated |position − drag-start| within this tolerance) and the
 * coordinate-coincidence bound for targets on such an axis.
 */
const TAUTOLOGY_TOLERANCE_PX = 1

/** The `object:moving` event shape the extension's handlers consume. */
type MoveEvent = BasicTransformEvent & { target: FabricObject }

/**
 * The moved object's five reference coordinates — `getCoords()`'s corners
 * plus the center — cloned, since the extension mutates the shared corner
 * points in place while collecting lines (a per-tick snap would corrupt an
 * aliased snapshot).
 */
type ReferencePoints = [Point, Point, Point, Point, Point]

function referencePoints(obj: FabricObject): ReferencePoints {
  const [tl, tr, br, bl] = obj.getCoords().map((point) => point.clone())
  return [tl, tr, br, bl, obj.getCenterPoint().clone()]
}

/**
 * Remove the moved object (and, for a multi-drag, every ActiveSelection
 * member) from the target set — the moved objects' own members are never
 * targets (ADR 0004). Groups are removed as whole boxes: with the
 * whole-box-target change below, a Group member entered the set as one box,
 * so the box is removed, not its children.
 */
function removeMovedFromTargets(objects: Set<FabricObject>, target: FabricObject): void {
  const members = target instanceof ActiveSelection ? target.getObjects() : [target]
  for (const member of members) {
    if (member instanceof ActiveSelection) {
      removeMovedFromTargets(objects, member)
    } else {
      objects.delete(member)
    }
  }
}

/**
 * A fabricated Document rect — a 0-thickness rect at one of the Document's
 * four edges, or a 0×0 rect at its center. Detached: constructed once per
 * Document size, never added to the canvas, so there are no render,
 * serialization, or selection side effects (ADR 0004). `originX`/`originY`
 * pin the rect's corner to the nominal coordinate — Fabric 7's default
 * center origin would center it on the edge — and the 0 stroke keeps the
 * corners on the integer coordinate (the default 1 px stroke would halve
 * them off it). `setCoords()` primes the lazy `aCoords` so the extension's
 * detached `getCoords()` works.
 */
function fabricateDocumentRect(
  left: number,
  top: number,
  width: number,
  height: number,
): Rect {
  const rect = new Rect({
    left,
    top,
    width,
    height,
    originX: "left",
    originY: "top",
    strokeWidth: 0,
  })
  rect.setCoords()
  return rect
}

/**
 * Parse one cached line entry — `{origin, target}` JSON whose line
 * coordinate is `target.x` (vertical) / `target.y` (horizontal), in scene
 * coordinates (ADR 0004).
 */
function parseGuideLines(lines: Set<string>): Array<{ x: number; y: number }> {
  const parsed: Array<{ x: number; y: number }> = []
  for (const entry of lines) {
    const line = JSON.parse(entry) as { target: { x: number; y: number } }
    parsed.push(line.target)
  }
  return parsed
}

/**
 * Paint one axis's guide lines on the overlay context: 1 px full-workspace-
 * extent periwinkle lines at the alignment coordinates. Per axis, the first
 * cache entry — the `setXY`-triggering one, in insertion order — is solid
 * when the axis snapped and the rest dashed; a suppressed axis (Alt/Option)
 * paints all its lines dashed — nothing snapped (ADR 0004). The dash phase
 * restarts per line, so coincident lines read identically. Only for an
 * unrotated viewport, where a scene guide IS an axis-aligned overlay line.
 */
function paintGuideAxis(
  ctx: CanvasRenderingContext2D,
  coords: number[],
  snapped: boolean,
  width: number,
  height: number,
  axis: "vertical" | "horizontal",
): void {
  if (!coords.length) return
  ctx.lineWidth = 1
  const lineAt = (coord: number) => {
    ctx.beginPath()
    if (axis === "vertical") {
      ctx.moveTo(coord, 0)
      ctx.lineTo(coord, height)
    } else {
      ctx.moveTo(0, coord)
      ctx.lineTo(width, coord)
    }
    ctx.stroke()
  }
  if (snapped) {
    ctx.strokeStyle = SNAP_GUIDE_SOLID_COLOR
    ctx.setLineDash([])
    lineAt(coords[0])
    if (coords.length > 1) {
      ctx.strokeStyle = SNAP_GUIDE_NEAR_COLOR
      ctx.setLineDash(SNAP_GUIDE_DASH)
      for (const coord of coords.slice(1)) lineAt(coord)
    }
  } else {
    ctx.strokeStyle = SNAP_GUIDE_NEAR_COLOR
    ctx.setLineDash(SNAP_GUIDE_DASH)
    for (const coord of coords) lineAt(coord)
  }
}

/** How far a guide's segment extends past the Document in scene px — far
 * enough that, rotated and scaled, the segment still crosses the whole
 * workspace, so the overlay trims it into the full-extent guide. */
const GUIDE_SEGMENT_MARGIN = 100000

/**
 * Paint one axis's guide lines under a rotated viewport (§10): each scene
 * guide is a doc-aligned line (constant scene x or y), so its overlay image
 * is the line through any two of its scene points mapped through the full
 * viewport transform — a rotated line when the view is. The segment's two
 * endpoints sit far beyond the Document (GUIDE_SEGMENT_MARGIN) on the guide's
 * axis, so after the transform the segment spans the entire workspace in every
 * orientation. Same solid-first/dashed-rest styling as `paintGuideAxis`.
 */
function paintGuideSegment(
  ctx: CanvasRenderingContext2D,
  coords: number[],
  snapped: boolean,
  toViewport: (sceneX: number, sceneY: number) => Point,
  sceneWidth: number,
  sceneHeight: number,
  axis: "vertical" | "horizontal",
): void {
  if (!coords.length) return
  ctx.lineWidth = 1
  const lineAt = (coord: number) => {
    ctx.beginPath()
    const near =
      axis === "vertical"
        ? toViewport(coord, -GUIDE_SEGMENT_MARGIN)
        : toViewport(-GUIDE_SEGMENT_MARGIN, coord)
    const far =
      axis === "vertical"
        ? toViewport(coord, sceneHeight + GUIDE_SEGMENT_MARGIN)
        : toViewport(sceneWidth + GUIDE_SEGMENT_MARGIN, coord)
    ctx.moveTo(near.x, near.y)
    ctx.lineTo(far.x, far.y)
    ctx.stroke()
  }
  if (snapped) {
    ctx.strokeStyle = SNAP_GUIDE_SOLID_COLOR
    ctx.setLineDash([])
    lineAt(coords[0])
    if (coords.length > 1) {
      ctx.strokeStyle = SNAP_GUIDE_NEAR_COLOR
      ctx.setLineDash(SNAP_GUIDE_DASH)
      for (const coord of coords.slice(1)) lineAt(coord)
    }
  } else {
    ctx.strokeStyle = SNAP_GUIDE_NEAR_COLOR
    ctx.setLineDash(SNAP_GUIDE_DASH)
    for (const coord of coords) lineAt(coord)
  }
}

/**
 * The AligningGuidelines subclass (ADR 0004). Four behavior overrides:
 *
 * - `getObjectsByTarget` — the only custom target logic: Groups align as one
 *   whole box (the default unpacks them to children); five detached rects
 *   fabricate the Document's four edges and its center; the default's
 *   exclusions stay (off-screen, invisible, the moved objects' members); and
 *   the tautological skip drops targets that would sit permanently at the
 *   moved object's own reference point on an axis the drag does not move.
 * - `scalingOrResizing` / `afterRender` — no-ops (move-only v1; the repo
 *   paints the guides on the workspace overlay, not the extension's
 *   `contextTop`). `beforeRender` keeps the default — it clears the now
 *   unused top context.
 * - `moving` — Alt/Option suppression via revert-after-snap, the per-axis
 *   snapped flags the overlay painter reads, and the drag's first-tick
 *   reference snapshot the tautological skip measures. The suppression is
 *   skipped while an Alt-drag duplication is in progress
 *   (`stage.altDragDuplicating`) — the duplicate snaps like any other drag.
 *
 * `dispose()` releases the wrapper's own listeners — the overlay painter
 * (`after:render`) and the drag-snapshot resets (`mouse:down` / `mouse:up`) —
 * alongside the extension's six, pinned for the canvas-rebuild lifecycle.
 */
export class SmartGuides extends AligningGuidelines {
  /**
   * The drag's first-tick reference snapshot — the tautological skip's
   * drag-start baseline, reset on `mouse:down`/`mouse:up` (ADR 0004).
   */
  dragStartRefs: ReferencePoints | null = null

  /** True when the last moving tick snapped the horizontal (x) axis. */
  snappedX = false

  /** True when the last moving tick snapped the vertical (y) axis. */
  snappedY = false

  /** The fabricated Document rects, cached per Document size. */
  private documentRects: Rect[] | null = null
  private documentRectsSize: { width: number; height: number } | null = null

  private readonly paintGuidesHandler: () => void
  private readonly resetDragHandler: () => void

  constructor(canvas: StageCanvas, options: Partial<AligningLineConfig> = {}) {
    super(canvas, options)
    this.paintGuidesHandler = this.paintGuides.bind(this)
    this.resetDragHandler = this.resetDrag.bind(this)
    canvas.on("after:render", this.paintGuidesHandler)
    canvas.on("mouse:down", this.resetDragHandler)
    canvas.on("mouse:up", this.resetDragHandler)
  }

  override dispose(): void {
    super.dispose()
    this.canvas.off("after:render", this.paintGuidesHandler)
    this.canvas.off("mouse:down", this.resetDragHandler)
    this.canvas.off("mouse:up", this.resetDragHandler)
  }

  /** Move-only v1 (ADR 0004): no snapping or guides while scaling or resizing. */
  override scalingOrResizing(): void {}

  /**
   * The extension's `contextTop` paint is replaced: the repo paints the
   * guides on the workspace overlay (`paintGuides`).
   */
  override afterRender(): void {}

  override getObjectsByTarget(target: FabricObject): Set<FabricObject> {
    const objects = new Set<FabricObject>()
    const canvas = target.canvas
    if (!canvas) return objects

    // Every other on-screen, visible object — Groups align as one whole box
    // (the default unpacks them to children, ADR 0004).
    canvas.forEachObject((o) => {
      if (!o.isOnScreen()) return
      if (!o.visible) return
      objects.add(o)
    })

    // The moved object and, for a multi-drag, its members are never targets.
    removeMovedFromTargets(objects, target)

    // The Document's four edges and its center align like any other target.
    for (const rect of this.getDocumentRects(canvas)) objects.add(rect)

    this.applyTautologicalSkip(objects, target)
    return objects
  }

  /**
   * The fabricated Document rects — constructed once per Document size
   * (rebuilt only when the stage toolbar resizes the Document, since the
   * rects' geometry is read every tick), never added to the canvas.
   */
  private getDocumentRects(canvas: Canvas): Rect[] {
    const width = canvas.width
    const height = canvas.height
    if (
      this.documentRects &&
      this.documentRectsSize &&
      this.documentRectsSize.width === width &&
      this.documentRectsSize.height === height
    ) {
      return this.documentRects
    }
    const rects = [
      fabricateDocumentRect(0, 0, 0, height), // left edge (x = 0)
      fabricateDocumentRect(width, 0, 0, height), // right edge (x = W)
      fabricateDocumentRect(0, 0, width, 0), // top edge (y = 0)
      fabricateDocumentRect(0, height, width, 0), // bottom edge (y = H)
      fabricateDocumentRect(width / 2, height / 2, 0, 0), // center
    ]
    this.documentRects = rects
    this.documentRectsSize = { width, height }
    return rects
  }

  /**
   * The tautological skip (ADR 0004): on an axis the drag does not move
   * (accumulated movement from the drag-start reference within the sub-pixel
   * tolerance), a target whose alignment coordinate coincides with the moved
   * object's own drag-start reference coordinate on that axis is dropped.
   * Without the skip, a full-width object's edges and center — permanently
   * coincident with the Document's — would show solid guides at its own
   * edges (and a line through its own body) for the whole drag. The skip is
   * narrow: an alignment to a nearly-covered target whose coordinate is
   * distinct from the object's own still shows.
   */
  private applyTautologicalSkip(objects: Set<FabricObject>, target: FabricObject): void {
    const refs = this.dragStartRefs
    if (!refs) return
    const center = target.getCenterPoint()
    const notMovedX = Math.abs(center.x - refs[4].x) <= TAUTOLOGY_TOLERANCE_PX
    const notMovedY = Math.abs(center.y - refs[4].y) <= TAUTOLOGY_TOLERANCE_PX
    if (!notMovedX && !notMovedY) return
    const refXs = refs.map((point) => point.x)
    const refYs = refs.map((point) => point.y)
    for (const candidate of [...objects]) {
      const points = candidate.getCoords()
      points.push(candidate.getCenterPoint())
      const coincides = (axis: "x" | "y", refs: number[]) =>
        points.some((point) =>
          refs.some((ref) => Math.abs(ref - point[axis]) <= TAUTOLOGY_TOLERANCE_PX),
        )
      if (
        (notMovedX && coincides("x", refXs)) ||
        (notMovedY && coincides("y", refYs))
      ) {
        objects.delete(candidate)
      }
    }
  }

  override moving(e: MoveEvent): void {
    const target = e.target
    // The drag's first tick snapshots the moved object's five reference
    // coordinates — the tautological skip measures against these drag-start
    // references, not per-tick positions (the extension records pre-snap
    // points, so per-tick equality would leak the perpetual full-span guides
    // back in under pointer jitter). Reset on `mouse:up`.
    if (!this.dragStartRefs) this.dragStartRefs = referencePoints(target)
    const origin = {
      left: target.left,
      top: target.top,
      originX: target.originX,
      originY: target.originY,
    }
    super.moving(e)
    // Alt/Option mid-drag suppresses the snap while the guides stay at the
    // would-be alignment: revert to the pre-snap position and refresh the
    // coords Fabric's snap wrote. The origin restores with it — the
    // extension's `setXY` routes through `setPositionByOrigin`, which
    // repositions the object against the passed origin (ADR 0004 pins the
    // origin reset regardless, keeping the restore order-insensitive to
    // future engine changes). A duplicate drag skips the suppression: Alt
    // held at press duplicates, and the duplicate snaps like any other drag
    // (ADR 0004 §duplicate — the suppression is a mid-drag plain-move
    // affordance, not an attribute of the duplicate gesture).
    if (
      e.e &&
      (e.e as MouseEvent).altKey &&
      !(this.canvas as StageCanvas).altDragDuplicating
    ) {
      target.set({
        left: origin.left,
        top: origin.top,
        originX: origin.originX,
        originY: origin.originY,
      })
      target.setCoords()
    }
    // Per-axis snapped flags from the pre-snap snapshot — recorded after the
    // Alt revert, so a suppressed axis reads false. The issue's parenthetical
    // pins pre-revert timing, but the painting rule it also pins ("a
    // suppressed axis paints all its lines dashed — nothing snapped") and
    // the acceptance ("guides stay, all dashed") require the post-revert
    // reading — the painting rule wins, it is the testable contract.
    this.snappedX = target.left !== origin.left
    this.snappedY = target.top !== origin.top
  }

  /**
   * The overlay painter — a repo `after:render` handler. Reads the
   * extension's line caches and paints full-extent periwinkle guides on the
   * workspace overlay through the stage's public paint seam (clear-then-paint
   * per frame, skip-clear while a marquee is live or the selection controls
   * painted this frame — the chrome mirror's own per-frame clear already
   * wipes stale guide paint, so a clear here would only ever hurt it).
   */
  private paintGuides(): void {
    // The line coordinate is `target.x` (vertical) / `target.y` (horizontal);
    // coincident coordinates render one line, and the first occurrence — the
    // `setXY`-triggering entry — stays first, so the snapped line reads solid
    // (ADR 0004).
    const vertical = [
      ...new Set(parseGuideLines(this.verticalLines).map((point) => point.x)),
    ]
    const horizontal = [
      ...new Set(parseGuideLines(this.horizontalLines).map((point) => point.y)),
    ]
    if (!vertical.length && !horizontal.length) return
    const canvas = this.canvas as StageCanvas
    const prepared = canvas.prepareOverlay(
      canvas.isMarqueeActive() || canvas.didPaintControlsThisFrame(),
    )
    if (!prepared) return
    const { ctx, offset, width, height } = prepared
    canvas.markGuidesPainted()
    const v = canvas.viewportTransform
    if (displayRotationDeg(canvas.getRotation()) === 0) {
      // Unrotated viewport: each scene guide IS an axis-aligned overlay line,
      // so each scene coordinate maps through the viewport transform, then
      // the Document's offset inside the overlay glues the line to the scene
      // — the same mapping the marquee mirror's `getMarqueeBox` uses.
      const toViewportX = (sceneX: number) => sceneX * v[0] + v[4] + offset.x
      const toViewportY = (sceneY: number) => sceneY * v[3] + v[5] + offset.y
      paintGuideAxis(
        ctx,
        vertical.map(toViewportX),
        this.snappedX,
        width,
        height,
        "vertical",
      )
      paintGuideAxis(
        ctx,
        horizontal.map(toViewportY),
        this.snappedY,
        width,
        height,
        "horizontal",
      )
      return
    }
    // Rotated viewport: the guides are doc-aligned scene lines, so map two
    // far scene endpoints through the FULL transform (the cross terms!) and
    // stroke the segment — the guide rotates with the Document and still
    // spans the whole workspace after the overlay trims it.
    const offsetPoint = new Point(offset.x, offset.y)
    const toViewport = (sceneX: number, sceneY: number) =>
      new Point(sceneX, sceneY).transform(v).add(offsetPoint)
    paintGuideSegment(
      ctx,
      vertical,
      this.snappedX,
      toViewport,
      canvas.width,
      canvas.height,
      "vertical",
    )
    paintGuideSegment(
      ctx,
      horizontal,
      this.snappedY,
      toViewport,
      canvas.width,
      canvas.height,
      "horizontal",
    )
  }

  /** Clear the drag snapshot and the snapped flags between gestures. */
  private resetDrag(): void {
    this.dragStartRefs = null
    this.snappedX = false
    this.snappedY = false
  }
}
