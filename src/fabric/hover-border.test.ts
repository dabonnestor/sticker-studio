import { ActiveSelection, type FabricObject } from "fabric"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createStubContext } from "@/fabric/canvas-stub"
import { createShape } from "@/fabric/shapes"
import { createStageCanvas, type StageCanvas } from "@/fabric/stage-canvas"

/** The Document these fixtures sit on — 4×4 in, where a shape is 192 px. */
const DOC = { width: 384, height: 384 }

/**
 * Hover border: the object under the pointer shows its selection-style
 * border — 1 px, the object's own borderColor — before any click. The
 * border paints on the workspace overlay, the same mirror as the marquee,
 * the selection controls, and the smart guides; `mouse:over` / `mouse:out`
 * track the target (each change requests a render, since plain hover moves
 * render nothing), and an `after:render` painter draws it. Driven with
 * synthetic events, the same way the interaction wiring is tested
 * elsewhere; the overlay context's recorded calls are the observable paint.
 */
describe("hover border", () => {
  let canvas: StageCanvas
  let overlayCtx: CanvasRenderingContext2D
  let overlayElement: HTMLCanvasElement

  /**
   * A stage canvas whose overlay carries a distinct stubbed context — the
   * lower canvas's own context is swapped before creation, so the hover
   * border's mirror paint into the overlay is observable.
   */
  function mountHarness() {
    const element = document.createElement("canvas")
    overlayElement = document.createElement("canvas")
    overlayCtx = createStubContext()
    vi.spyOn(element, "getContext").mockReturnValue(createStubContext())
    vi.spyOn(overlayElement, "getContext").mockReturnValue(overlayCtx)
    canvas = createStageCanvas(element, overlayElement)
  }

  beforeEach(() => {
    mountHarness()
  })

  afterEach(async () => {
    await canvas.dispose()
  })

  /** The pointer moved onto the object — Fabric's `mouse:over` answer. */
  function hover(obj: FabricObject | null) {
    canvas.fire("mouse:over", { target: obj ?? undefined } as never)
  }

  /** The pointer moved off the object — or left the canvas. */
  function hoverOut() {
    canvas.fire("mouse:out", { target: null } as never)
  }

  /** The hover painter's call — the selection renderer, controls off. */
  function hoverCall() {
    return expect.objectContaining({ hasBorders: true, hasControls: false })
  }

  it("paints the hovered object's selection-style border on the overlay", () => {
    const shape = createShape("square", DOC)
    canvas.add(shape)
    shape.setCoords()
    // The change requests a frame — plain hover moves render nothing.
    const render = vi.spyOn(canvas, "requestRenderAll")
    // The border renders with the object's own borderColor — the selected
    // look, 1 px — as a stroked rect on the overlay, no marquee fill.
    const strokeStyle = vi.spyOn(overlayCtx, "strokeStyle", "set")
    const lineWidth = vi.spyOn(overlayCtx, "lineWidth", "set")
    hover(shape)
    expect(render).toHaveBeenCalled()
    canvas.renderAll()
    expect(strokeStyle).toHaveBeenCalledWith(shape.borderColor)
    expect(lineWidth).toHaveBeenCalledWith(1)
    expect(overlayCtx.strokeRect).toHaveBeenCalled()
    expect(overlayCtx.fillRect).not.toHaveBeenCalled()
  })

  it("glues the hover border to the Document's position in the overlay", () => {
    const shape = createShape("square", DOC)
    canvas.add(shape)
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
    hover(shape)
    canvas.renderAll()
    expect(overlayCtx.translate).toHaveBeenCalledWith(100, 60)
  })

  it("clears the border when the pointer leaves the object", () => {
    const shape = createShape("square", DOC)
    canvas.add(shape)
    shape.setCoords()
    hover(shape)
    canvas.renderAll()
    expect(overlayCtx.strokeRect).toHaveBeenCalled()
    vi.mocked(overlayCtx.strokeRect).mockClear()
    vi.mocked(overlayCtx.clearRect).mockClear()
    hoverOut()
    canvas.renderAll()
    // The exit frame paints nothing, and the sweep wipes the stale border.
    expect(overlayCtx.strokeRect).not.toHaveBeenCalled()
    expect(overlayCtx.clearRect).toHaveBeenCalled()
    expect(canvas.hoverBorder!.getHoveredObject()).toBeNull()
  })

  it("a target-less entry clears the border — the canvas entered over empty space", () => {
    const shape = createShape("square", DOC)
    canvas.add(shape)
    shape.setCoords()
    hover(shape)
    expect(canvas.hoverBorder!.getHoveredObject()).toBe(shape)
    hover(null)
    expect(canvas.hoverBorder!.getHoveredObject()).toBeNull()
  })

  it("paints nothing over the active object's own selection chrome", () => {
    const shape = createShape("square", DOC)
    canvas.add(shape)
    shape.setCoords()
    canvas.setActiveObject(shape)
    const renderControls = vi.spyOn(shape, "_renderControls")
    hover(shape)
    canvas.renderAll()
    // The controls mirror's call is the only one — no double stroke.
    expect(renderControls).not.toHaveBeenCalledWith(hoverCall())
  })

  it("paints nothing over a member of an active selection — its member box already shows", () => {
    const shape = createShape("square", DOC)
    const other = createShape("circle", DOC)
    other.set({ left: 300, top: 300 })
    canvas.add(shape, other)
    const selection = new ActiveSelection([shape, other], { canvas })
    canvas.setActiveObject(selection)
    selection.setCoords()
    const renderControls = vi.spyOn(shape, "_renderControls")
    hover(shape)
    canvas.renderAll()
    expect(renderControls).not.toHaveBeenCalledWith(hoverCall())
  })

  it("paints the hover border alongside an active object's controls", () => {
    const shape = createShape("square", DOC)
    shape.set({ left: 100, top: 100 })
    const other = createShape("circle", DOC)
    other.set({ left: 300, top: 300 })
    canvas.add(shape, other)
    canvas.setActiveObject(shape)
    shape.setCoords()
    other.setCoords()
    const renderControls = vi.spyOn(other, "_renderControls")
    hover(other)
    canvas.renderAll()
    // Both mirrors paint in one frame — the hover survives the controls'
    // per-frame clear and the end-of-frame sweep keeps the overlay.
    expect(renderControls).toHaveBeenCalledWith(expect.anything(), hoverCall())
    const lastClear = Math.max(
      ...vi.mocked(overlayCtx.clearRect).mock.invocationCallOrder,
    )
    const lastStroke = Math.max(
      ...vi.mocked(overlayCtx.strokeRect).mock.invocationCallOrder,
    )
    expect(lastClear).toBeLessThan(lastStroke)
  })

  it("does not paint during an active marquee — its paint owns the overlay", () => {
    const shape = createShape("square", DOC)
    canvas.add(shape)
    shape.setCoords()
    const raw = canvas as unknown as {
      _groupSelector: { x: number; y: number; deltaX: number; deltaY: number }
    }
    raw._groupSelector = { x: 100, y: 100, deltaX: 150, deltaY: 120 }
    const renderControls = vi.spyOn(shape, "_renderControls")
    hover(shape)
    canvas.renderAll()
    expect(renderControls).not.toHaveBeenCalledWith(hoverCall())
    // The target is still tracked — the next over/out self-heals it.
    expect(canvas.hoverBorder!.getHoveredObject()).toBe(shape)
  })

  it("removing the hovered object clears the target at once", () => {
    const shape = createShape("square", DOC)
    canvas.add(shape)
    shape.setCoords()
    hover(shape)
    expect(canvas.hoverBorder!.getHoveredObject()).toBe(shape)
    canvas.remove(shape)
    expect(canvas.hoverBorder!.getHoveredObject()).toBeNull()
  })

  it("a renderTop-only frame keeps the hover border", () => {
    const shape = createShape("square", DOC)
    canvas.add(shape)
    shape.setCoords()
    hover(shape)
    canvas.renderAll()
    expect(overlayCtx.strokeRect).toHaveBeenCalled()
    vi.mocked(overlayCtx.clearRect).mockClear()
    // A zero-delta pointer jitter between down and up paints nothing, and
    // Fabric's mouseup falls back to `renderTop` — the hover painter
    // repaints the border, and the sweep must not wipe it.
    canvas.renderTop()
    expect(overlayCtx.strokeRect).toHaveBeenCalled()
    const lastClear = Math.max(
      ...vi.mocked(overlayCtx.clearRect).mock.invocationCallOrder,
    )
    const lastStroke = Math.max(
      ...vi.mocked(overlayCtx.strokeRect).mock.invocationCallOrder,
    )
    expect(lastClear).toBeLessThan(lastStroke)
  })
})
