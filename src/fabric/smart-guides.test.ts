import {
  ActiveSelection,
  Group,
  type Object as FabricObject,
} from "fabric"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createStubContext } from "@/fabric/canvas-stub"
import { setLocked } from "@/fabric/document-props"
import { createShape } from "@/fabric/shapes"
import { createStageCanvas, type StageCanvas } from "@/fabric/stage-canvas"
import {
  SNAP_GUIDE_DASH,
  SNAP_GUIDE_NEAR_COLOR,
  SNAP_GUIDE_SOLID_COLOR,
  SmartGuides,
} from "@/fabric/smart-guides"
import { createText } from "@/fabric/text"

/**
 * Smart guides (build spec §17, ADR 0004): dragging a shape or text object
 * near another object's edge or center shows a 1 px periwinkle alignment
 * guide across the full workspace, and the object snaps to the alignment
 * within a flat 6 screen px tolerance. Driven with synthetic events, the
 * same way the interaction wiring is tested elsewhere: `object:moving` fires
 * the extension's handler, whose line caches (`verticalLines` /
 * `horizontalLines`) and position changes are the observable behavior.
 *
 * Placements keep the non-asserted axis clear of the fabricated Document
 * rects' coordinates (the edges 0/600 and the center 300/300) — the
 * Document's edges and center are targets like any other object, so an
 * object whose span sits within 6 px of them would y-snap (or x-snap)
 * alongside the asserted alignment.
 */

/** One drag tick at the object's current position. */
function dragTick(
  canvas: StageCanvas,
  obj: FabricObject,
  e: { altKey?: boolean } = {},
) {
  canvas.fire("object:moving", {
    e,
    target: obj,
    transform: { action: "drag" },
  } as never)
}

/** Position the object and fire one moving tick. */
function moveTo(canvas: StageCanvas, obj: FabricObject, left: number, top: number) {
  obj.set({ left, top })
  obj.setCoords()
  dragTick(canvas, obj)
}

/**
 * A two-tick drag from `from` to `to`: the first tick snapshots the moved
 * object's drag-start references (the tautological skip's baseline); the
 * second tick's position decides which axes the drag has moved.
 */
function dragGesture(
  canvas: StageCanvas,
  obj: FabricObject,
  from: { left: number; top: number },
  to: { left: number; top: number },
) {
  moveTo(canvas, obj, from.left, from.top)
  moveTo(canvas, obj, to.left, to.top)
}

/** End a gesture the way Fabric's mouseup does (resets the drag snapshot). */
function endGesture(canvas: StageCanvas) {
  canvas.fire("mouse:up", {} as never)
}

/** The x-coordinate of each recorded vertical line. */
function verticalCoords(guides: SmartGuides): number[] {
  return [...guides.verticalLines].map((entry) => {
    return (JSON.parse(entry) as { target: { x: number } }).target.x
  })
}

/** The y-coordinate of each recorded horizontal line. */
function horizontalCoords(guides: SmartGuides): number[] {
  return [...guides.horizontalLines].map((entry) => {
    return (JSON.parse(entry) as { target: { y: number } }).target.y
  })
}

/** A 192×192 square with stroke off, positioned by center. */
function squareAt(left: number, top: number): FabricObject {
  const shape = createShape("square")
  shape.set({ left, top })
  shape.setCoords()
  return shape
}

describe("smart-guides snapping", () => {
  let canvas: ReturnType<typeof createStageCanvas>

  beforeEach(() => {
    canvas = createStageCanvas(
      document.createElement("canvas"),
      document.createElement("canvas"),
    )
  })

  afterEach(async () => {
    await canvas.dispose()
  })

  it("snaps within the 6 px tolerance and records the alignment line", () => {
    const moved = squareAt(210, 250)
    const target = squareAt(400, 400) // left edge x=304
    canvas.add(moved, target)
    // Right edge at 306 — 2 px from the target's left edge.
    moveTo(canvas, moved, 210, 250)
    expect(moved.left).toBe(208) // snapped — right edge lands on 304
    expect(moved.top).toBe(250) // y untouched — the axis did not snap
    expect(verticalCoords(canvas.smartGuides!)).toContain(304)
    expect(canvas.smartGuides!.snappedX).toBe(true)
    expect(canvas.smartGuides!.snappedY).toBe(false)
  })

  it("flat boundary: snaps at exactly 6 px, nothing at 6.1 px", () => {
    const moved = squareAt(214, 250)
    const target = squareAt(400, 400)
    canvas.add(moved, target)
    // Right edge at 310 — exactly 6 px from the target's edge.
    moveTo(canvas, moved, 214, 250)
    expect(moved.left).toBe(208)
    endGesture(canvas)
    // 6.1 px — beyond the flat threshold: no snap, no lines, no stickiness.
    moveTo(canvas, moved, 214.1, 250)
    expect(moved.left).toBe(214.1)
    expect(canvas.smartGuides!.verticalLines.size).toBe(0)
    expect(canvas.smartGuides!.horizontalLines.size).toBe(0)
  })

  it("a corner approach engages both axes — crosshair, both snapped", () => {
    const moved = squareAt(210, 406)
    const target = squareAt(400, 400) // edges x=304, y=304
    canvas.add(moved, target)
    // Right edge 306 (2 from 304) and bottom edge 502 (6 from 304).
    moveTo(canvas, moved, 210, 406)
    expect(moved.left).toBe(208)
    expect(moved.top).toBe(400)
    expect(verticalCoords(canvas.smartGuides!)).toContain(304)
    expect(horizontalCoords(canvas.smartGuides!)).toContain(304)
    expect(canvas.smartGuides!.snappedX).toBe(true)
    expect(canvas.smartGuides!.snappedY).toBe(true)
  })

  it("equidistant ties: every line shows, the snapped one first", () => {
    const moved = squareAt(204, 250) // edges x=108 and x=300
    const a = squareAt(208, 600) // right edge x=112
    const b = squareAt(400, 600) // left edge x=304
    canvas.add(moved, a, b)
    // Left edge 108 is 4 px from a's right edge (112); right edge 300 is
    // 4 px from b's left edge (304) — an equidistant tie on x. The first
    // min-distance point (the tl) wins: the left edge snaps to 112.
    moveTo(canvas, moved, 204, 250)
    expect(moved.left).toBe(208) // 108 + 96 + 4 — left edge landed on 112
    const coords = verticalCoords(canvas.smartGuides!)
    expect(coords).toContain(112)
    expect(coords).toContain(304)
    // The setXY-triggering line — the first cache entry — is the 112 one.
    expect(coords[0]).toBe(112)
  })

  it("move-only v1: scaling and resizing produce no guides and no snapping", () => {
    const moved = squareAt(210, 250)
    const target = squareAt(400, 400)
    canvas.add(moved, target)
    for (const event of ["object:scaling", "object:resizing"] as const) {
      canvas.fire(event, {
        e: { altKey: false },
        target: moved,
        transform: { action: "scale", corner: "br" },
      } as never)
    }
    expect(moved.left).toBe(210)
    expect(moved.top).toBe(250)
    expect(canvas.smartGuides!.verticalLines.size).toBe(0)
    expect(canvas.smartGuides!.horizontalLines.size).toBe(0)
  })

  it("Alt/Option suppresses the snap while the guides stay — release re-snaps", () => {
    const moved = squareAt(210, 250)
    const target = squareAt(400, 400)
    canvas.add(moved, target)
    dragTick(canvas, moved, { altKey: true })
    expect(moved.left).toBe(210) // no snap — reverted to the pre-snap position
    expect(verticalCoords(canvas.smartGuides!)).toContain(304) // guide stays
    expect(canvas.smartGuides!.snappedX).toBe(false) // nothing snapped
    // Releasing Alt within tolerance — the next tick snaps normally.
    dragTick(canvas, moved, { altKey: false })
    expect(moved.left).toBe(208)
    expect(canvas.smartGuides!.snappedX).toBe(true)
  })

  it("a duplicate drag keeps snapping — Alt held at press does not suppress", () => {
    const moved = squareAt(210, 250)
    const target = squareAt(400, 400)
    canvas.add(moved, target)
    // The duplicate gesture (Alt held at press, duplicate.ts): the tick
    // reads altKey, but the suppression is a mid-drag plain-move affordance
    // — the duplicate snaps like any move.
    canvas.altDragDuplicating = true
    moveTo(canvas, moved, 210, 250)
    dragTick(canvas, moved, { altKey: true })
    expect(moved.left).toBe(208) // still snapped — right edge on 304
    // The guide line for the engaged alignment is recorded.
    expect(verticalCoords(canvas.smartGuides!)).toContain(304)
    canvas.altDragDuplicating = false
  })

  it("the drag snapshot resets on mouse:up", () => {
    const moved = squareAt(210, 250)
    const target = squareAt(400, 400)
    canvas.add(moved, target)
    moveTo(canvas, moved, 210, 250)
    expect(canvas.smartGuides!.dragStartRefs).not.toBeNull()
    endGesture(canvas)
    expect(canvas.smartGuides!.dragStartRefs).toBeNull()
    expect(canvas.smartGuides!.snappedX).toBe(false)
    expect(canvas.smartGuides!.snappedY).toBe(false)
  })
})

describe("snap targets", () => {
  let canvas: ReturnType<typeof createStageCanvas>

  beforeEach(() => {
    canvas = createStageCanvas(
      document.createElement("canvas"),
      document.createElement("canvas"),
    )
  })

  afterEach(async () => {
    await canvas.dispose()
  })

  it("locked objects guide", () => {
    const moved = squareAt(210, 250)
    const target = squareAt(400, 400)
    setLocked(target, true)
    canvas.add(moved, target)
    moveTo(canvas, moved, 210, 250)
    expect(moved.left).toBe(208)
    expect(verticalCoords(canvas.smartGuides!)).toContain(304)
  })

  it("text objects guide", () => {
    const moved = squareAt(210, 250)
    const text = createText((s) => s.length * 10) // 40 px wide
    text.set({ left: 88, top: 400 }) // right edge x=108 — 6 px from the moved
    canvas.add(moved, text)
    moveTo(canvas, moved, 210, 250)
    expect(moved.left).toBeLessThan(210) // snapped toward the text
    expect(canvas.smartGuides!.verticalLines.size).toBeGreaterThan(0)
  })

  it("a Group target guides as one whole box — never its children", () => {
    const a = squareAt(100, 100)
    const b = squareAt(400, 400)
    const group = new Group([a, b], { canvas })
    canvas.add(group)
    // The group's union box spans x∈[4, 496]; the seam between the children
    // (a's right edge x=196) is no target. The moved's left edge on the seam
    // must not align — whole-box, not per-child.
    const moved = squareAt(292, 250)
    canvas.add(moved)
    moveTo(canvas, moved, 292, 250)
    expect(moved.left).toBe(292) // nothing to snap to — the seam is not a target
    expect(canvas.smartGuides!.verticalLines.size).toBe(0)
  })

  it("a Group's box edge aligns like any other target", () => {
    const a = squareAt(100, 100)
    const b = squareAt(400, 400)
    const group = new Group([a, b], { canvas })
    canvas.add(group)
    // Top 300 keeps the moved's y-references off the group's center-y (250)
    // — a y-coincidence on the non-moved axis would drop the group entirely.
    const moved = squareAt(106, 300)
    canvas.add(moved)
    // Left edge 10 is 6 px from the box's left edge (x=4).
    dragGesture(canvas, moved, { left: 106, top: 300 }, { left: 100, top: 300 })
    expect(moved.left).toBe(100) // snapped to the box edge
    expect(verticalCoords(canvas.smartGuides!)).toContain(4)
  })

  it("the Document's four edges and its center guide", () => {
    const moved = squareAt(300, 250)
    canvas.add(moved)
    // Left edge approaching x=0 — the Document's left edge.
    dragGesture(canvas, moved, { left: 100, top: 250 }, { left: 96, top: 250 })
    expect(verticalCoords(canvas.smartGuides!)).toContain(0)
    // Center-x approaching the Document center x=300.
    dragGesture(canvas, moved, { left: 304, top: 250 }, { left: 300, top: 250 })
    expect(verticalCoords(canvas.smartGuides!)).toContain(300)
    // Bottom edge approaching y=600 — the Document's bottom edge.
    dragGesture(canvas, moved, { left: 300, top: 500 }, { left: 300, top: 504 })
    expect(horizontalCoords(canvas.smartGuides!)).toContain(600)
  })

  it("off-screen objects never guide", () => {
    const moved = squareAt(-694, 250) // left edge -790 — 6 px from the edge below
    const offScreen = squareAt(-700, 250) // spans [-796, -604] — off the canvas
    canvas.add(moved, offScreen)
    moveTo(canvas, moved, -694, 250)
    expect(canvas.smartGuides!.verticalLines.size).toBe(0)
    expect(moved.left).toBe(-694)
  })

  it("invisible objects never guide", () => {
    const moved = squareAt(106, 250)
    const invisible = squareAt(100, 400) // left edge x=4 — 6 px from the moved
    invisible.visible = false
    canvas.add(moved, invisible)
    moveTo(canvas, moved, 106, 250)
    expect(moved.left).toBe(106)
    expect(canvas.smartGuides!.verticalLines.size).toBe(0)
  })

  it("a multi-drag aligns as the union box and its members never guide", () => {
    const a = squareAt(100, 100)
    const b = squareAt(400, 400)
    const c = squareAt(446, 400) // left edge x=350 — on-screen
    canvas.add(a, b, c)
    const selection = new ActiveSelection([a, b], { canvas })
    canvas.setActiveObject(selection)
    selection.setCoords()
    // The union box is 492 wide (x∈[4, 496]); moved to (110, 300) its right
    // edge 356 is 6 px from c's left edge (350).
    moveTo(canvas, selection, 110, 300)
    expect(selection.left).toBe(104) // snapped — right edge lands on 350
    expect(verticalCoords(canvas.smartGuides!)).toContain(350)
    // The members are never targets: neither a nor b appears in the set.
    const targets = canvas.smartGuides!.getObjectsByTarget(selection)
    expect(targets.has(a)).toBe(false)
    expect(targets.has(b)).toBe(false)
    expect(targets.has(c)).toBe(true)
  })
})

describe("tautological skip", () => {
  let canvas: ReturnType<typeof createStageCanvas>

  beforeEach(() => {
    canvas = createStageCanvas(
      document.createElement("canvas"),
      document.createElement("canvas"),
    )
  })

  afterEach(async () => {
    await canvas.dispose()
  })

  /** A full-width 600×100 object centered on x=300 — the full-span case. */
  function fullWidthObject(): FabricObject {
    const shape = createShape("square")
    shape.set({ width: 600, height: 100, left: 300, top: 200 })
    shape.setCoords()
    canvas.add(shape)
    return shape
  }

  it("a full-width object dragged vertically shows no guides at its own edges or center", () => {
    const moved = fullWidthObject()
    // Vertical drag: x never moves, so the Document edges/center — permanent
    // coincidences with the object's own edges/center — are skipped.
    dragGesture(canvas, moved, { left: 300, top: 200 }, { left: 300, top: 220 })
    expect(verticalCoords(canvas.smartGuides!)).toEqual([])
  })

  it("the same full-width object dragged horizontally aligns to the Document edges normally", () => {
    const moved = fullWidthObject()
    dragGesture(canvas, moved, { left: 300, top: 200 }, { left: 306, top: 200 })
    // Edges at x=6 and x=606 — 6 px from the Document edges 0 and 600 — and
    // the center 306, 6 px from the Document center 300.
    expect(verticalCoords(canvas.smartGuides!)).toEqual(
      expect.arrayContaining([0, 300, 600]),
    )
  })

  it("a nearly-covered target's edge alignment still shows", () => {
    const moved = fullWidthObject()
    // A small target inside the moved object's span, its left edge 4 px from
    // the moved object's center-x — distinct from the object's own reference
    // coordinates, so the narrow skip keeps it.
    const target = squareAt(400, 300) // left edge x=304
    canvas.add(target)
    dragGesture(canvas, moved, { left: 300, top: 200 }, { left: 300, top: 220 })
    // The raw cache holds one entry per equidistant target point (both left
    // corners of the small target); the painted line dedupes to one.
    expect(new Set(verticalCoords(canvas.smartGuides!))).toEqual(new Set([304]))
  })

  it("measures drag-start references, not per-tick positions", () => {
    const moved = fullWidthObject()
    // The first tick snapshots at (300, 200); the second tick's position is
    // what the skip measures against. The x-coordinates never left the
    // drag-start refs, so the skip stays active for the whole vertical drag.
    dragGesture(canvas, moved, { left: 300, top: 200 }, { left: 300, top: 240 })
    expect(verticalCoords(canvas.smartGuides!)).toEqual([])
    // A horizontal drag moves x away from the drag-start refs — the skip
    // releases and the Document edges guide again.
    dragGesture(canvas, moved, { left: 300, top: 200 }, { left: 306, top: 200 })
    expect(verticalCoords(canvas.smartGuides!)).toContain(0)
  })
})

describe("guide painting", () => {
  let canvas: ReturnType<typeof createStageCanvas>
  let overlayElement: HTMLCanvasElement
  let overlayCtx: CanvasRenderingContext2D

  /** The mirror harness: distinct stubbed contexts for canvas and overlay. */
  function mount() {
    const element = document.createElement("canvas")
    overlayElement = document.createElement("canvas")
    const lowerCtx = createStubContext()
    overlayCtx = createStubContext()
    vi.spyOn(element, "getContext").mockReturnValue(lowerCtx)
    vi.spyOn(overlayElement, "getContext").mockReturnValue(overlayCtx)
    canvas = createStageCanvas(element, overlayElement)
  }

  beforeEach(() => {
    mount()
  })

  afterEach(async () => {
    await canvas.dispose()
  })

  it("paints a full-extent periwinkle guide on the overlay at the alignment", () => {
    const moved = squareAt(210, 250)
    const target = squareAt(400, 400)
    canvas.add(moved, target)
    moveTo(canvas, moved, 210, 250) // line at x=304
    const style = vi.spyOn(overlayCtx, "strokeStyle", "set")
    canvas.renderAll()
    // The snapped axis's first line is solid; the extent spans the full
    // overlay height (0 in jsdom's 0×0 overlay).
    expect(overlayCtx.moveTo).toHaveBeenCalledWith(304, 0)
    expect(overlayCtx.lineTo).toHaveBeenCalledWith(304, 0)
    expect(style).toHaveBeenCalledWith(SNAP_GUIDE_SOLID_COLOR)
    expect(overlayCtx.setLineDash).toHaveBeenCalledWith([])
  })

  it("glues the guides to the Document's position in the overlay", () => {
    const moved = squareAt(210, 250)
    const target = squareAt(400, 400)
    canvas.add(moved, target)
    moveTo(canvas, moved, 210, 250) // line at x=304
    // Document at (200,100) inside a workspace overlay starting at (100,40).
    vi.spyOn(canvas.upperCanvasEl, "getBoundingClientRect").mockReturnValue({
      left: 200,
      top: 100,
    } as DOMRect)
    vi.spyOn(overlayElement, "getBoundingClientRect").mockReturnValue({
      left: 100,
      top: 40,
    } as DOMRect)
    canvas.renderAll()
    // The line's scene coordinate maps through the viewport (identity) and
    // the Document's offset inside the overlay: 304 + 100 = 404 (the same
    // pixels the marquee mirror's translate produces).
    expect(overlayCtx.moveTo).toHaveBeenCalledWith(404, 0)
  })

  it("rotates the guides with a rotated viewport — a doc-vertical guide paints screen-horizontal", () => {
    canvas.setDimensions({ width: 600, height: 400 })
    canvas.setRotation(90)
    const moved = squareAt(210, 250)
    const target = squareAt(400, 400)
    canvas.add(moved, target)
    moveTo(canvas, moved, 210, 250) // scene vertical guide at x=304
    canvas.renderAll()
    // The 90° viewport maps the scene line x=304 through the FULL transform
    // (x' = −y + 400, y' = x): the segment spans the workspace as a screen-
    // horizontal line at y=304 — the segment margin keeps both endpoints far
    // beyond the overlay, which trims it into the full-width guide.
    expect(overlayCtx.moveTo).toHaveBeenCalledWith(100400, 304)
    expect(overlayCtx.lineTo).toHaveBeenCalledWith(-100000, 304)
  })

  it("keeps the tolerance at 6 screen px at non-100% zoom", () => {
    canvas.setZoom(2)
    // Both objects stay inside the zoomed viewport (visible scene [0,300]²) —
    // at zoom 2 the 600-px canvas shows only the top-left quadrant.
    const target = squareAt(100, 100) // left edge x=4 — on-screen
    const moved = squareAt(-89, 250) // right edge x=7 — 3 scene px from 4
    canvas.add(moved, target)
    // The extension divides the margin by zoom: 3 scene px = 6 screen px at
    // zoom 2 — exactly on the flat threshold.
    moveTo(canvas, moved, -89, 250)
    expect(moved.left).toBe(-92) // right edge snapped to 4
    endGesture(canvas)
    // Right edge at 7.05 — 3.05 scene px = 6.1 screen px — beyond the
    // threshold, so nothing snaps at zoom 2.
    moveTo(canvas, moved, -88.95, 250)
    expect(moved.left).toBe(-88.95)
    expect(canvas.smartGuides!.verticalLines.size).toBe(0)
    // And the guides stay glued to the scene: the line at scene x=4 paints
    // at viewport x=8 under zoom 2. (An edge exactly on the target's would
    // be tautologically dropped, so the moved sits 2 scene px off.)
    endGesture(canvas)
    moveTo(canvas, moved, -90, 250) // right edge 6 — 2 scene px from 4
    canvas.renderAll()
    expect(overlayCtx.moveTo).toHaveBeenCalledWith(8, 0)
  })

  it("equidistant companions render dashed behind the solid snapped line", () => {
    const moved = squareAt(204, 250)
    const a = squareAt(208, 600)
    const b = squareAt(400, 600)
    canvas.add(moved, a, b)
    moveTo(canvas, moved, 204, 250) // tie: lines at x=112 (snapped) and x=304
    const style = vi.spyOn(overlayCtx, "strokeStyle", "set")
    canvas.renderAll()
    const styles = style.mock.calls.map((call) => call[0])
    expect(styles).toEqual([SNAP_GUIDE_SOLID_COLOR, SNAP_GUIDE_NEAR_COLOR])
    expect(overlayCtx.setLineDash).toHaveBeenNthCalledWith(1, [])
    expect(overlayCtx.setLineDash).toHaveBeenNthCalledWith(2, SNAP_GUIDE_DASH)
    expect(overlayCtx.moveTo).toHaveBeenCalledWith(112, 0)
    expect(overlayCtx.moveTo).toHaveBeenCalledWith(304, 0)
  })

  it("an Alt-suppressed axis paints all its lines dashed — nothing snapped", () => {
    const moved = squareAt(210, 250)
    const target = squareAt(400, 400)
    canvas.add(moved, target)
    dragTick(canvas, moved, { altKey: true })
    const style = vi.spyOn(overlayCtx, "strokeStyle", "set")
    canvas.renderAll()
    expect(style).toHaveBeenCalledWith(SNAP_GUIDE_NEAR_COLOR)
    expect(style).not.toHaveBeenCalledWith(SNAP_GUIDE_SOLID_COLOR)
    expect(overlayCtx.setLineDash).toHaveBeenCalledWith(SNAP_GUIDE_DASH)
  })

  it("the selection chrome survives the guides' paint in the same frame", () => {
    // A locked active object's chrome is borders only — no handle or badge
    // strokes polluting the guide-stroke signal.
    const moved = squareAt(210, 250)
    const target = squareAt(400, 400)
    setLocked(moved, true)
    canvas.add(moved, target)
    canvas.setActiveObject(moved)
    moveTo(canvas, moved, 210, 250)
    canvas.renderAll()
    // drawControls cleared the overlay, painted the border, and the painter
    // skip-cleared (controls painted this frame) — one clear, before the
    // chrome, with the guides stroked after it.
    expect(overlayCtx.clearRect).toHaveBeenCalledTimes(1)
    const clearTimes = vi.mocked(overlayCtx.clearRect).mock.invocationCallOrder
    const strokeRectTimes = vi.mocked(overlayCtx.strokeRect).mock.invocationCallOrder
    const guideStrokeTimes = vi.mocked(overlayCtx.stroke).mock.invocationCallOrder
    expect(Math.max(...clearTimes)).toBeLessThan(Math.min(...strokeRectTimes))
    expect(Math.max(...strokeRectTimes)).toBeLessThan(
      Math.min(...guideStrokeTimes),
    )
  })

  it("stale guides are wiped by the chrome's per-frame clear on mouse:up", () => {
    const moved = squareAt(210, 250)
    const target = squareAt(400, 400)
    canvas.add(moved, target)
    moveTo(canvas, moved, 210, 250)
    canvas.renderAll()
    const strokesAfterDrag = vi.mocked(overlayCtx.stroke).mock.calls.length
    expect(strokesAfterDrag).toBeGreaterThan(0)
    // mouse:up clears the line caches; the commit render paints nothing and
    // the sweep erases the stale guides (no selection keeps the overlay).
    endGesture(canvas)
    canvas.renderAll()
    expect(vi.mocked(overlayCtx.stroke).mock.calls.length).toBe(strokesAfterDrag)
    expect(overlayCtx.clearRect).toHaveBeenCalledTimes(2) // chrome clear + sweep
  })

  it("a render during an active marquee does not clear the marquee's paint", () => {
    const moved = squareAt(210, 250)
    const target = squareAt(400, 400)
    canvas.add(moved, target)
    canvas.selectionColor = "rgba(0, 0, 0, 0.3)"
    canvas.selectionBorderColor = "#000"
    canvas.selectionLineWidth = 1
    const raw = canvas as unknown as {
      _groupSelector: {
        x: number
        y: number
        deltaX: number
        deltaY: number
      } | null
      _drawSelection(ctx: CanvasRenderingContext2D): void
    }
    raw._groupSelector = { x: 100, y: 100, deltaX: 150, deltaY: 120 }
    raw._drawSelection(canvas.getContext())
    expect(overlayCtx.fillRect).toHaveBeenCalled() // the marquee fill
    // A queued render while the marquee is live — the guides painter skip-
    // clears and finalize keeps the marquee's paint.
    canvas.renderAll()
    const lastClear = Math.max(
      ...vi.mocked(overlayCtx.clearRect).mock.invocationCallOrder,
    )
    const lastFill = Math.max(
      ...vi.mocked(overlayCtx.fillRect).mock.invocationCallOrder,
    )
    expect(lastClear).toBeLessThan(lastFill)
  })
})

describe("dispose / rebuild", () => {
  it("canvas dispose releases the extension and wrapper listeners", async () => {
    const element = document.createElement("canvas")
    const overlayElement = document.createElement("canvas")
    const canvas = createStageCanvas(element, overlayElement)
    const guides = canvas.smartGuides!
    const moved = squareAt(210, 250)
    const target = squareAt(400, 400)
    canvas.add(moved, target)
    moveTo(canvas, moved, 210, 250)
    const sizeBefore = guides.verticalLines.size
    expect(sizeBefore).toBeGreaterThan(0)
    await canvas.dispose()
    // Nothing listens anymore: a moving tick records no new lines, and no
    // drag snapshot starts.
    const refsBefore = guides.dragStartRefs
    moveTo(canvas, moved, 210, 250)
    expect(guides.verticalLines.size).toBe(sizeBefore)
    expect(guides.dragStartRefs).toBe(refsBefore)
  })

  it("a rebuilt canvas carries a fresh smart-guides wrapper", async () => {
    const element = document.createElement("canvas")
    const overlayElement = document.createElement("canvas")
    const first = createStageCanvas(element, overlayElement)
    await first.dispose()
    const second = createStageCanvas(element, overlayElement)
    try {
      expect(second.smartGuides).toBeDefined()
      expect(second.smartGuides!.dragStartRefs).toBeNull()
      expect(second.smartGuides!.verticalLines.size).toBe(0)
    } finally {
      await second.dispose()
    }
  })
})
