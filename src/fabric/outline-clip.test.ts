import { Ellipse, Rect } from "fabric"
import { describe, expect, it, vi } from "vitest"

import { createStubContext } from "@/fabric/canvas-stub"
import { buildOutlineClip, traceOutline } from "@/fabric/outline-clip"

/**
 * The Cut line's rendering (map #48, ticket #52) — the derived clip and the
 * border painter's path. Both are pure functions of the outline kind and the
 * Document size, driven here without a canvas.
 */

/** A 3×2 in Landscape sheet at the 96 DPI basis — the non-square case. */
const LANDSCAPE = { width: 288, height: 192 }
const SQUARE = { width: 192, height: 192 }

describe("buildOutlineClip", () => {
  it("builds a rect outline as a Rect filling the Document", () => {
    const clip = buildOutlineClip("rect", LANDSCAPE)
    expect(clip).toBeInstanceOf(Rect)
    const rect = clip as Rect
    expect([rect.width, rect.height]).toEqual([288, 192])
    // Centered on the Document, in scene coordinates — Fabric's viewport
    // transform then carries it through zoom and pan.
    expect([rect.left, rect.top]).toEqual([144, 96])
    expect(rect.originX).toBe("center")
    expect(rect.originY).toBe("center")
  })

  it("builds an oval outline as an Ellipse touching all four edges", () => {
    const clip = buildOutlineClip("oval", LANDSCAPE)
    expect(clip).toBeInstanceOf(Ellipse)
    const ellipse = clip as Ellipse
    expect([ellipse.rx, ellipse.ry]).toEqual([144, 96])
    expect([ellipse.left, ellipse.top]).toEqual([144, 96])
  })

  it("a locked oval on a square Document is the Circle preset's circle", () => {
    const clip = buildOutlineClip("oval", SQUARE) as Ellipse
    expect([clip.rx, clip.ry]).toEqual([96, 96])
  })

  it("builds a rounded-rect outline with the preset corner radius", () => {
    const clip = buildOutlineClip("rounded-rect", LANDSCAPE) as Rect
    expect(clip).toBeInstanceOf(Rect)
    expect([clip.rx, clip.ry]).toEqual([23.04, 23.04])
  })

  it("leaves the clip out of serialization", () => {
    // The clip is derived: the envelope carries the outline, and a clip in
    // the payload becomes part of what two Documents *are* — enough to make
    // the History's snapshot comparison call an unchanged document changed.
    // This is the regression guard for the phantom-undo-step the color
    // picker's suite first caught.
    for (const kind of ["rect", "rounded-rect", "oval"] as const) {
      expect(buildOutlineClip(kind, SQUARE).excludeFromExport).toBe(true)
    }
  })
})

/**
 * The border painter's path. The caller strokes it at `2 × borderWidth` and
 * clips to it, so the visible border is the inner half — its outer edge on
 * the cut, flush for every shape (insetting the path is exact for a rect and
 * a circle but leaves a hairline on an oval; the prototype measured it at
 * 300 DPI).
 */
describe("traceOutline", () => {
  /** The stub context's path spies, as the paint the path emits. */
  function trace(kind: "rect" | "rounded-rect" | "oval", size = LANDSCAPE) {
    const ctx = createStubContext()
    traceOutline(ctx, kind, size)
    return ctx
  }

  it("traces a rect outline as the Document rect at the origin", () => {
    const ctx = trace("rect")
    expect(vi.mocked(ctx.beginPath)).toHaveBeenCalled()
    expect(vi.mocked(ctx.rect)).toHaveBeenCalledWith(0, 0, 288, 192)
    expect(vi.mocked(ctx.ellipse)).not.toHaveBeenCalled()
    expect(vi.mocked(ctx.roundRect)).not.toHaveBeenCalled()
  })

  it("traces an oval outline as the inscribed ellipse", () => {
    const ctx = trace("oval")
    expect(vi.mocked(ctx.ellipse)).toHaveBeenCalledWith(
      144,
      96,
      144,
      96,
      0,
      0,
      Math.PI * 2,
    )
    expect(vi.mocked(ctx.rect)).not.toHaveBeenCalled()
  })

  it("traces a rounded-rect outline with the preset radius", () => {
    const ctx = trace("rounded-rect")
    expect(vi.mocked(ctx.roundRect)).toHaveBeenCalledWith(0, 0, 288, 192, 23.04)
    expect(vi.mocked(ctx.rect)).not.toHaveBeenCalled()
  })

  it("opens a path of its own, so a stroke cannot pick up an earlier one", () => {
    const ctx = createStubContext()
    traceOutline(ctx, "rect", SQUARE)
    expect(vi.mocked(ctx.beginPath).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(ctx.rect).mock.invocationCallOrder[0],
    )
  })
})
