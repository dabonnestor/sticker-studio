import { Ellipse, Rect } from "fabric"
import { describe, expect, it, vi } from "vitest"

import { createStubContext } from "@/fabric/canvas-stub"
import {
  BORDER_STROKE_MULTIPLIER,
  buildOutlineBorder,
  buildOutlineClip,
  traceOutline,
} from "@/fabric/outline-clip"

/**
 * The Cut line's rendering (map #48, tickets #52/#53) — the derived clip, the
 * exported border, and the stage border painter's path. All three are pure
 * functions of the outline kind and the Document size, driven here without a
 * canvas.
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
 * The exported border (ticket #53) — the same geometry as the clip, stroked on
 * the cut at twice its width so the canvas clip trims the outer half. Unlike
 * the clip it must serialize: `toSVG` reads object state and never runs
 * `after:render`, so an SVG export carrying the border needs an object.
 */
describe("buildOutlineBorder", () => {
  it("traces the cut itself, stroked twice the border's width", () => {
    const border = buildOutlineBorder("rect", LANDSCAPE, "#18181b", 4)
    expect(border).toBeInstanceOf(Rect)
    const rect = border as Rect
    // The path is the *full* Document rect — not inset by the border width:
    // the outer half of the stroke lands outside the cut and the clip eats it,
    // which is flush by construction where an inset path is not.
    expect([rect.width, rect.height]).toEqual([288, 192])
    expect([rect.left, rect.top]).toEqual([144, 96])
    expect(rect.strokeWidth).toBe(8)
    expect(BORDER_STROKE_MULTIPLIER).toBe(2)
    expect(rect.stroke).toBe("#18181b")
    // Transparent, not white: the stroke is the whole border.
    expect(rect.fill).toBe("transparent")
  })

  it("rounds a rounded-rect outline's border at the preset radius", () => {
    const border = buildOutlineBorder("rounded-rect", LANDSCAPE, "#18181b", 2) as Rect
    expect([border.rx, border.ry]).toEqual([23.04, 23.04])
  })

  it("traces an oval outline's border as the inscribed ellipse", () => {
    const border = buildOutlineBorder("oval", LANDSCAPE, "#18181b", 3) as Ellipse
    expect(border).toBeInstanceOf(Ellipse)
    expect([border.rx, border.ry]).toEqual([144, 96])
    expect(border.strokeWidth).toBe(6)
  })

  it("is exported — the clip's exclusion is the clip's alone", () => {
    for (const kind of ["rect", "rounded-rect", "oval"] as const) {
      expect(buildOutlineBorder(kind, SQUARE, "#18181b", 2).excludeFromExport).toBe(
        false,
      )
      // Distinct objects: sharing one instance would put the border's stroke
      // on the clip, or the clip's exclusion on the border.
      expect(buildOutlineBorder(kind, SQUARE, "#18181b", 2)).not.toBe(
        buildOutlineClip(kind, SQUARE),
      )
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
