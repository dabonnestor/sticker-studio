import type { Object as FabricObject, TMat2D } from "fabric"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createShape } from "@/fabric/shapes"
import { createStageCanvas, getMarqueeBox } from "@/fabric/stage-canvas"
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
