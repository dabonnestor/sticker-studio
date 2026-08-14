import {
  ActiveSelection,
  Point,
  type Object as FabricObject,
  type TMat2D,
} from "fabric"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createStubContext } from "@/fabric/canvas-stub"
import { setLocked } from "@/fabric/document-props"
import { createShape } from "@/fabric/shapes"
import {
  createStageCanvas,
  getMarqueeBox,
  getOverlayOffset,
} from "@/fabric/stage-canvas"
import { createText } from "@/fabric/text"

/**
 * Marquee viewport mapping (§7 extension). The marquee mirror paints on the
 * workspace overlay in viewport space: the drag's scene-plane start and
 * extent (`_groupSelector`) mapped through the viewport transform, then
 * normalized to a top-left box — the same mapping Fabric's own
 * `_drawSelection` uses, shared with the tests.
 */
describe("getMarqueeBox", () => {
  const IDENTITY: TMat2D = [1, 0, 0, 1, 0, 0]

  it("maps a positive drag to the normalized box", () => {
    const box = getMarqueeBox(
      { x: 100, y: 100, deltaX: 200, deltaY: 150 },
      IDENTITY,
    )
    expect(box).toEqual({ left: 100, top: 100, width: 200, height: 150 })
  })

  it("normalizes a drag up-left (negative deltas)", () => {
    const box = getMarqueeBox(
      { x: 300, y: 250, deltaX: -200, deltaY: -150 },
      IDENTITY,
    )
    expect(box).toEqual({ left: 100, top: 100, width: 200, height: 150 })
  })

  it("transforms through the viewport (zoom 2, translate 50,30)", () => {
    const box = getMarqueeBox(
      { x: 100, y: 100, deltaX: 200, deltaY: 150 },
      [2, 0, 0, 2, 50, 30],
    )
    // start (100,100) → (250,230); extent (300,250) → (650,530)
    expect(box).toEqual({ left: 250, top: 230, width: 400, height: 300 })
  })

  it("returns a zero box for a plain press (no drag)", () => {
    const box = getMarqueeBox({ x: 150, y: 80, deltaX: 0, deltaY: 0 }, IDENTITY)
    expect(box).toEqual({ left: 150, top: 80, width: 0, height: 0 })
  })

  it("can start beyond the Document edge (negative scene coords)", () => {
    const box = getMarqueeBox(
      { x: -120, y: 40, deltaX: 240, deltaY: 160 },
      IDENTITY,
    )
    expect(box).toEqual({ left: -120, top: 40, width: 240, height: 160 })
  })
})

/**
 * Uniform scaling (build spec §5 shapes, §6 text) — the stage's
 * `object:scaling` handler freezes the aspect ratio at the gesture start, so
 * a corner drag never distorts the object. Driven with synthetic events, the
 * same way the interaction wiring is tested elsewhere.
 */
describe("uniform scaling", () => {
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

  /** A synthetic scaling tick — only `target` matters to the handler. */
  function scale(obj: FabricObject) {
    canvas.fire("object:scaling", { target: obj } as never)
  }

  it("freezes a shape's aspect ratio at the gesture start", () => {
    const shape = createShape("square")
    canvas.add(shape)
    shape.set({ scaleX: 2, scaleY: 1 }) // gesture tick 1 — the start ratio
    scale(shape)
    shape.set({ scaleX: 3 }) // later ticks derive scaleY from the frozen ratio
    scale(shape)
    expect(shape.scaleX / shape.scaleY).toBeCloseTo(2, 10)
    expect(shape.scaleY).toBeCloseTo(1.5, 10)
  })

  it("scales text uniformly like a shape and hands the width to the user", () => {
    const text = createText()
    canvas.add(text)
    text.set({ scaleX: 1.5, scaleY: 0.5 }) // gesture start — the ratio
    scale(text)
    text.set({ scaleX: 3 }) // later tick — scaleY derives, auto-fit stops
    scale(text)
    expect(text.scaleX / text.scaleY).toBeCloseTo(3, 10)
    expect(text.scaleY).toBeCloseTo(1, 10)
    expect(text.autoFit).toBe(false)
  })

  it("a committed transform clears the frozen ratio for the next gesture", () => {
    const shape = createShape("square")
    canvas.add(shape)
    shape.set({ scaleX: 2, scaleY: 1 })
    scale(shape)
    canvas.fire("object:modified", { target: shape } as never)
    // A fresh gesture re-records from the committed state.
    shape.set({ scaleX: 4, scaleY: 2 })
    scale(shape)
    shape.set({ scaleX: 6 })
    scale(shape)
    expect(shape.scaleY).toBeCloseTo(3, 10)
  })

  it("shapes expose corner handles only — every side handle is hidden", () => {
    const shape = createShape("square")
    canvas.add(shape)
    // Fabric 7.4 keeps per-control visibility in `_controlsVisibility`
    // (undefined = visible by default).
    for (const handle of ["ml", "mt", "mr", "mb"] as const) {
      expect(shape._controlsVisibility[handle]).toBe(false)
    }
    expect(shape._controlsVisibility.tr).toBeUndefined() // corners scale
  })

  it("text hides the top/bottom handles — corners scale, the wrap handles stay", () => {
    const text = createText()
    canvas.add(text)
    // A Y-only top/bottom drag would distort the glyphs and the uniform lock
    // pins it dead — so mt/mb are hidden, like a shape's side handles.
    expect(text._controlsVisibility.mt).toBe(false)
    expect(text._controlsVisibility.mb).toBe(false)
    expect(text._controlsVisibility.tr).toBeUndefined() // corners scale uniformly
    expect(text._controlsVisibility.ml).toBeUndefined() // wrap width (§6)
    expect(text._controlsVisibility.mr).toBeUndefined()
  })
})

/**
 * Corner-handle cursors (build spec §5): the aspect-ratio lock makes every
 * corner drag a diagonal gesture, so the corners show a fixed diagonal
 * cursor instead of Fabric's quadrant-based one — which reports `n`/`s`/`e`/
 * `w` at the corners of narrow or wide boxes (auto-fitted text!), so text
 * corners never matched the diagonal a squarish shape shows.
 */
describe("corner handle cursors", () => {
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

  /**
   * The cursor the canvas would show over the given control: the same path
   * `_setCursorFromEvent` takes — findControl at the control's own point,
   * then the control's cursorStyleHandler.
   */
  function cursorAt(obj: FabricObject, key: string) {
    obj.setCoords()
    const corner = obj.findControl(
      new Point(obj.oCoords[key].x, obj.oCoords[key].y),
    )
    if (!corner) throw new Error(`no control at ${key}`)
    return corner.control.cursorStyleHandler?.(
      undefined as never,
      corner.control,
      obj,
      corner.coord,
    )
  }

  it("shape corners show the fixed diagonal cursors", () => {
    const shape = createShape("square")
    canvas.add(shape)
    canvas.setActiveObject(shape)
    expect(cursorAt(shape, "tl")).toBe("nwse-resize")
    expect(cursorAt(shape, "br")).toBe("nwse-resize")
    expect(cursorAt(shape, "tr")).toBe("nesw-resize")
    expect(cursorAt(shape, "bl")).toBe("nesw-resize")
  })

  it("text corners match shapes — even on a wide auto-fitted box", () => {
    const text = createText()
    text.set({ width: 300, height: 28.8 })
    canvas.add(text)
    canvas.setActiveObject(text)
    // Fabric's quadrant cursor would report `w-resize` here — the corner of
    // a 300×29 box sits ~straight left of the center. The fixed diagonal
    // keeps the same affordance shapes show.
    expect(cursorAt(text, "tl")).toBe("nwse-resize")
    expect(cursorAt(text, "br")).toBe("nwse-resize")
    expect(cursorAt(text, "tr")).toBe("nesw-resize")
    expect(cursorAt(text, "bl")).toBe("nesw-resize")
  })
})

/**
 * Overlay offset mapping (§7 extension). The marquee and the selection
 * controls mirror paint on the workspace overlay; the Document's position
 * inside the overlay — the canvas rect minus the overlay rect — is the
 * translate that glues the paint to the scene at any zoom or scroll. Pure,
 * so the overlay paints and the tests share one mapping.
 */
describe("getOverlayOffset", () => {
  it("maps identical origins to a zero offset", () => {
    expect(getOverlayOffset({ left: 0, top: 0 }, { left: 0, top: 0 })).toEqual({
      x: 0,
      y: 0,
    })
  })

  it("maps a Document right/down of the overlay origin positively", () => {
    expect(
      getOverlayOffset({ left: 200, top: 100 }, { left: 100, top: 40 }),
    ).toEqual({ x: 100, y: 60 })
  })

  it("maps an overlay larger than the Document rect negatively", () => {
    expect(
      getOverlayOffset({ left: 100, top: 40 }, { left: 200, top: 100 }),
    ).toEqual({ x: -100, y: -60 })
  })

  it("uses only the rects' left/top", () => {
    // DOMRects carry width/height too — a structurally wider rect works.
    const documentRect = { left: 120, top: 80, width: 600, height: 600 }
    const overlayRect = { left: 60, top: 20, width: 1200, height: 800 }
    expect(getOverlayOffset(documentRect, overlayRect)).toEqual({ x: 60, y: 60 })
  })
})

/**
 * Selection controls mirror (§7 extension): a selected object's selection
 * box, corner handles, and rotation handle paint on the workspace overlay
 * instead of the lower canvas — whose bitmap is the Document's size, so
 * anything past the Document edge was invisible there. The paint is
 * Fabric's own `_renderControls` (unmodified), so locked objects mirror
 * borders only and the handles stay draggable past the edge. Driven with
 * per-instance 2D-context stubs, so the paint routing is observable — the
 * shared stub in vitest.setup.ts cannot tell the surfaces apart.
 */
describe("selection controls mirror", () => {
  let canvas: ReturnType<typeof createStageCanvas>
  let lowerCtx: CanvasRenderingContext2D
  let overlayCtx: CanvasRenderingContext2D
  let overlayElement: HTMLCanvasElement

  /**
   * A stage canvas whose lower and overlay canvases carry distinct stubbed
   * contexts. The lower canvas's own context is swapped before creation, so
   * the render paints into it are observable; the overlay's context records
   * the mirrored paint.
   */
  function mountMirrorHarness() {
    const element = document.createElement("canvas")
    overlayElement = document.createElement("canvas")
    lowerCtx = createStubContext()
    overlayCtx = createStubContext()
    vi.spyOn(element, "getContext").mockReturnValue(lowerCtx)
    vi.spyOn(overlayElement, "getContext").mockReturnValue(overlayCtx)
    canvas = createStageCanvas(element, overlayElement)
  }

  /** The marquee internals the mirror tests drive directly. */
  function rawCanvas() {
    return canvas as unknown as {
      _groupSelector: {
        x: number
        y: number
        deltaX: number
        deltaY: number
      } | null
      _drawSelection(ctx: CanvasRenderingContext2D): void
    }
  }

  beforeEach(() => {
    mountMirrorHarness()
  })

  afterEach(async () => {
    await canvas.dispose()
  })

  it("paints a selected object's controls on the overlay, not the lower canvas", () => {
    const shape = createShape("square")
    canvas.add(shape)
    canvas.setActiveObject(shape)
    shape.setCoords()
    canvas.renderAll()
    // The selection border and the four transparent corners paint via
    // strokeRect — on the overlay, where they stay visible past the edge.
    expect(overlayCtx.strokeRect).toHaveBeenCalled()
    expect(overlayCtx.fillRect).not.toHaveBeenCalled() // no marquee this frame
    expect(lowerCtx.strokeRect).not.toHaveBeenCalled() // nothing clipped away
  })

  it("glues the mirrored controls to the Document's position in the overlay", () => {
    const shape = createShape("square")
    canvas.add(shape)
    canvas.setActiveObject(shape)
    shape.setCoords()
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
    // The selection box composes with relative calls on the base — the
    // offset rides the base translate. The handle renderer resets the
    // transform absolutely; the shim folds the offset into that reset —
    // dpr 1 in jsdom, so the offset is literal. Both must land at (100,60).
    expect(overlayCtx.translate).toHaveBeenCalledWith(100, 60)
    expect(overlayCtx.setTransform).toHaveBeenCalledWith(1, 0, 0, 1, 100, 60)
  })

  it("clears the overlay when nothing is selected", () => {
    canvas.renderAll()
    expect(overlayCtx.clearRect).toHaveBeenCalled()
    expect(overlayCtx.strokeRect).not.toHaveBeenCalled()
    expect(overlayCtx.fillRect).not.toHaveBeenCalled()
  })

  it("mirrors a locked object's border only — no handles", () => {
    const shape = createShape("square")
    canvas.add(shape)
    setLocked(shape, true)
    canvas.setActiveObject(shape)
    shape.setCoords()
    canvas.renderAll()
    expect(overlayCtx.strokeRect).toHaveBeenCalled()
    expect(overlayCtx.fillRect).not.toHaveBeenCalled()
  })

  it("a marquee commit wipes the stale rect before painting the new controls", () => {
    const shape = createShape("square")
    canvas.add(shape)
    canvas.selectionColor = "rgba(0, 0, 0, 0.3)"
    canvas.selectionBorderColor = "#000"
    canvas.selectionLineWidth = 1
    // A finished marquee leaves its rect on the overlay.
    const raw = rawCanvas()
    raw._groupSelector = { x: 100, y: 100, deltaX: 150, deltaY: 120 }
    raw._drawSelection(canvas.getContext())
    expect(overlayCtx.fillRect).toHaveBeenCalled() // the marquee fill
    // The commit render (mouseup) selects the object and repaints controls.
    raw._groupSelector = null
    canvas.setActiveObject(shape)
    shape.setCoords()
    canvas.renderAll()
    const [lastClear] = vi.mocked(overlayCtx.clearRect).mock.invocationCallOrder.slice(-1)
    const [lastMarqueeFill] = vi.mocked(overlayCtx.fillRect).mock.invocationCallOrder.slice(-1)
    const [lastStroke] = vi.mocked(overlayCtx.strokeRect).mock.invocationCallOrder.slice(-1)
    expect(lastClear).toBeGreaterThan(lastMarqueeFill) // stale marquee wiped
    expect(lastStroke).toBeGreaterThan(lastClear) // controls survive the wipe
  })

  it("a renderTop-only frame keeps the previous frame's selection chrome", () => {
    const shape = createShape("square")
    canvas.add(shape)
    canvas.setActiveObject(shape)
    shape.setCoords()
    canvas.renderAll()
    expect(overlayCtx.strokeRect).toHaveBeenCalled()
    vi.mocked(overlayCtx.clearRect).mockClear()
    // A zero-delta pointer jitter between down and up paints nothing, and
    // Fabric's mouseup falls back to `renderTop` — whose after:render must
    // not wipe the selection chrome from the previous frame.
    canvas.renderTop()
    expect(overlayCtx.clearRect).not.toHaveBeenCalled()
  })

  it("a deselect wipes the chrome before the armed-marquee commit render", () => {
    const shape = createShape("square")
    canvas.add(shape)
    canvas.setActiveObject(shape)
    shape.setCoords()
    canvas.renderAll()
    const strokesBefore = vi.mocked(overlayCtx.strokeRect).mock.calls.length
    expect(strokesBefore).toBeGreaterThan(0) // chrome painted
    // The deselect click's commit render paints nothing (drawControls
    // early-returns with no active object) and finalizeOverlayFrame keeps
    // the overlay while the marquee is armed by the same pointerdown — so
    // without the wipe, a no-move click (mouse:up renders nothing) would
    // leave the previous frame's handles on the workspace forever.
    canvas.discardActiveObject()
    const clearTimes = vi.mocked(overlayCtx.clearRect).mock.invocationCallOrder
    const strokeTimes = vi.mocked(overlayCtx.strokeRect).mock.invocationCallOrder
    expect(Math.max(...clearTimes)).toBeGreaterThan(Math.max(...strokeTimes))
    // The armed-marquee render that follows paints nothing new.
    const raw = rawCanvas()
    raw._groupSelector = { x: 100, y: 100, deltaX: 0, deltaY: 0 }
    canvas.renderAll()
    expect(vi.mocked(overlayCtx.strokeRect).mock.calls.length).toBe(strokesBefore)
  })

  it("a render during an active marquee does not clear the marquee", () => {
    const raw = rawCanvas()
    raw._groupSelector = { x: 100, y: 100, deltaX: 150, deltaY: 120 }
    raw._drawSelection(canvas.getContext())
    expect(overlayCtx.fillRect).toHaveBeenCalled() // the marquee fill
    // A render while the drag is still in progress — the first render runs
    // the hasLostContext path, which repaints the marquee; the end-of-frame
    // sweep must not erase it (the overlay holds no controls this frame).
    canvas.renderAll()
    const lastClear = Math.max(
      ...vi.mocked(overlayCtx.clearRect).mock.invocationCallOrder,
    )
    const lastFill = Math.max(
      ...vi.mocked(overlayCtx.fillRect).mock.invocationCallOrder,
    )
    expect(lastClear).toBeLessThan(lastFill) // no clear after the marquee
  })
})

/**
 * Mirrored-selection cursor (§7 extension): Fabric's cursor updates stop at
 * the upper-canvas edge — the pointer past the Document is not over it — so
 * the mirrored chrome would read `auto`. The canvas answers the cursor the
 * workspace should show with the same path Fabric's `_setCursorFromEvent`
 * runs in-document: `findControl` at the pointer's viewport point, then the
 * control's own `cursorStyleHandler`. jsdom's disconnected canvases report
 * a zero rect, so client coordinates here are viewport coordinates.
 */
describe("mirrored selection cursor", () => {
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

  /** The cursor the workspace shows for the client point. */
  function cursorAt(clientX: number, clientY: number) {
    return canvas.getWorkspaceCursor(clientX, clientY)
  }

  it("shows the fixed diagonal cursors on corner handles past the Document edge", () => {
    const shape = createShape("square")
    shape.set({ left: -60, top: -60 }) // hangs off the top-left corner
    canvas.add(shape)
    canvas.setActiveObject(shape)
    shape.setCoords()
    // The controls sit at negative viewport coords — past the Document edge,
    // where Fabric's own cursor updates can no longer reach the pointer.
    expect(shape.oCoords.tl.x).toBeLessThan(0)
    expect(cursorAt(shape.oCoords.tl.x, shape.oCoords.tl.y)).toBe("nwse-resize")
    expect(cursorAt(shape.oCoords.br.x, shape.oCoords.br.y)).toBe("nwse-resize")
    expect(cursorAt(shape.oCoords.tr.x, shape.oCoords.tr.y)).toBe("nesw-resize")
    expect(cursorAt(shape.oCoords.bl.x, shape.oCoords.bl.y)).toBe("nesw-resize")
  })

  it("shows the wrap arrows on a text's mirrored wrap handles past the edge", () => {
    // The text's ml/mr wrap handles carry Fabric's stock cursor handler, not
    // the CORNER_CURSORS override — it must not crash on the synthetic
    // event `getWorkspaceCursor` passes (the handler reads the alt key off
    // it), or the workspace would keep its default `auto` cursor.
    const text = createText((s) => s.length * 10)
    text.set({ left: -60, top: -60 }) // hangs off the top-left corner
    canvas.add(text)
    canvas.setActiveObject(text)
    text.setCoords()
    expect(cursorAt(text.oCoords.ml.x, text.oCoords.ml.y)).toBe("w-resize")
    expect(cursorAt(text.oCoords.mr.x, text.oCoords.mr.y)).toBe("e-resize")
  })

  it("shows the fixed diagonal cursors on a mirrored multi-selection's corners", () => {
    // The ActiveSelection wrapper never fires `object:added`, so its corners
    // only get the CORNER_CURSORS override from the selection hooks — and
    // without them the stock quadrant handler would crash the workspace
    // mousemove on the synthetic event, leaving the cursor `auto`.
    const text = createText((s) => s.length * 10)
    text.set({ left: -60, top: -60 })
    const shape = createShape("square")
    shape.set({ left: -140, top: -140 })
    canvas.add(text, shape)
    const selection = new ActiveSelection([text, shape], { canvas })
    canvas.setActiveObject(selection)
    selection.setCoords()
    expect(selection.oCoords.tl.x).toBeLessThan(0) // past the Document edge
    expect(cursorAt(selection.oCoords.tl.x, selection.oCoords.tl.y)).toBe(
      "nwse-resize",
    )
    expect(cursorAt(selection.oCoords.br.x, selection.oCoords.br.y)).toBe(
      "nwse-resize",
    )
    expect(cursorAt(selection.oCoords.tr.x, selection.oCoords.tr.y)).toBe(
      "nesw-resize",
    )
    expect(cursorAt(selection.oCoords.bl.x, selection.oCoords.bl.y)).toBe(
      "nesw-resize",
    )
  })

  it("shows the rotation cursor on the mirrored rotation handle", () => {
    const shape = createShape("square")
    shape.set({ left: -60, top: -60 })
    canvas.add(shape)
    canvas.setActiveObject(shape)
    shape.setCoords()
    expect(cursorAt(shape.oCoords.mtr.x, shape.oCoords.mtr.y)).toBe("crosshair")
  })

  it("shows the object's hover cursor over the mirrored selection box", () => {
    const shape = createShape("square")
    shape.set({ left: 100, top: 100 })
    canvas.add(shape)
    canvas.setActiveObject(shape)
    shape.setCoords()
    // The box interior — off every corner's hit area — is the object's own
    // hover affordance, the "move" an in-document hover would show.
    const { tl, br } = shape.oCoords
    expect(cursorAt((tl.x + br.x) / 2, (tl.y + br.y) / 2)).toBe("move")
  })

  it("keeps the workspace default cursor past no mirrored chrome", () => {
    const shape = createShape("square")
    // left/top are the center (Fabric 7's default origin) — a 192px square
    // centered at (100,100) spans (4,4)-(196,196) plus the handle pads.
    shape.set({ left: 100, top: 100 })
    canvas.add(shape)
    canvas.setActiveObject(shape)
    shape.setCoords()
    expect(cursorAt(400, 400)).toBe("") // in-document, clear of the chrome
    expect(cursorAt(700, 700)).toBe("") // past the edge, empty workspace
  })

  it("keeps the default cursor with no selection", () => {
    expect(cursorAt(30, 30)).toBe("")
  })

  it("keeps the default cursor while a marquee drag is in progress", () => {
    const shape = createShape("square")
    shape.set({ left: -60, top: -60 })
    canvas.add(shape)
    canvas.setActiveObject(shape)
    shape.setCoords()
    // The marquee fills the overlay — no selection chrome to hover, so even
    // a point on a control must not offer its cursor mid-drag.
    const raw = canvas as unknown as {
      _groupSelector: { x: number; y: number; deltaX: number; deltaY: number }
    }
    raw._groupSelector = { x: 100, y: 100, deltaX: 150, deltaY: 120 }
    expect(cursorAt(shape.oCoords.tl.x, shape.oCoords.tl.y)).toBe("")
    expect(cursorAt(shape.oCoords.br.x, shape.oCoords.br.y)).toBe("")
  })
})
