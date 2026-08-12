import type { TMat2D } from "fabric"
import { describe, expect, it } from "vitest"

import { getMarqueeBox } from "@/fabric/stage-canvas"

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
