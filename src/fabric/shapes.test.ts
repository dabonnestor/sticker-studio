import { Circle, Ellipse, Group, Rect, Triangle, util } from "fabric"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { registerCustomProperties } from "@/fabric/custom-properties"
import { groupObjects } from "@/fabric/groups"
import {
  DEFAULT_BORDER_COLOR,
  createShape,
  getCutExtent,
  getShapeKind,
  resizeToCut,
  setBorderColor,
  setBorderWidth,
  setFillColor,
} from "@/fabric/shapes"
import { createStageCanvas } from "@/fabric/stage-canvas"

/** The Document these fixtures sit on — 4×4 in, where a shape is 192 px. */
const DOC = { width: 384, height: 384 }

/**
 * Shape model (build spec §4, §5). A shape's created size is the Document's
 * to give: half its short side (SHAPE_DEFAULT_RATIO), so a Square lands 1×1 in
 * on the default 2×2 in sticker and grows with it. The centered border model:
 * the object geometry IS the cut — turning the border on never changes the
 * geometry; the border renders at full width centered on the cut edge because
 * the clipPath grows by half the stroke per side.
 *
 * Every mutator goes through `obj.set()` so Fabric marks the object dirty —
 * a direct assignment would leave the stale cache rendering the old border
 * (regression: border/color changes did not paint).
 */
describe("shape model", () => {
  describe("createShape — the size is the Document's (§5, map #48)", () => {
    /** The Document a fresh session boots as: a 2×2 in Square sticker. */
    const BOOT = { width: 192, height: 192 }

    it("square: half the Document's short side", () => {
      const s = createShape("square", BOOT)
      expect(s).toBeInstanceOf(Rect)
      expect(s.width).toBe(96)
      expect(s.height).toBe(96)
      expect(s.rx).toBe(0)
    })

    it("circle: a diameter of half the short side", () => {
      const s = createShape("circle", BOOT)
      expect(s).toBeInstanceOf(Circle)
      expect(s.radius).toBe(48)
    })

    it("rectangle / oval / triangle: 3:2 landscape, off the same short side", () => {
      const r = createShape("rectangle", BOOT)
      expect([r.width, r.height]).toEqual([144, 96])
      expect(r.rx).toBe(0)

      const o = createShape("oval", BOOT)
      expect([o.rx, o.ry]).toEqual([72, 48])

      const t = createShape("triangle", BOOT)
      expect([t.width, t.height]).toEqual([144, 96])
    })

    it("scales with the Document, each kind keeping its own aspect", () => {
      // A 6×4 in sticker: a 384 px short side, so the same shapes at double.
      const wide = { width: 576, height: 384 }
      expect(createShape("square", wide).width).toBe(192)
      expect(createShape("rectangle", wide).width).toBe(288)
      expect(createShape("circle", wide).radius).toBe(96)
    })

    it("reads the short side, so a landscape Document does not stretch it", () => {
      // 6×2 in: the shape follows the 2 in side, not the 6 in one.
      const band = { width: 576, height: 192 }
      const s = createShape("square", band)
      expect([s.width, s.height]).toEqual([96, 96])
    })

    it("leaves room on the Document it was made for — every kind fits", () => {
      // The regression this replaced: a fixed 2×2 in Square exactly covered
      // the 2×2 in sticker it was added to, and a 3×2 in Rectangle hung off
      // the edge entirely. Half the short side cannot.
      const kinds = ["square", "rectangle", "oval", "circle", "triangle"] as const
      for (const kind of kinds) {
        const extent = getCutExtent(createShape(kind, BOOT))
        expect(extent.width).toBeLessThan(BOOT.width)
        expect(extent.height).toBeLessThan(BOOT.height)
      }
    })

    it("starts with the border off: strokeWidth 0, cut = geometry", () => {
      const s = createShape("square", DOC)
      expect(s.strokeWidth).toBe(0)
      expect(s.stroke).toBe(DEFAULT_BORDER_COLOR)
    })

    it("renders the border at a fixed px — strokeUniform, so scaling never thickens it", () => {
      const s = createShape("square", DOC)
      expect(s.strokeUniform).toBe(true)
      // The cache re-renders live during a scale gesture — a stale
      // gesture-start cache would stretch the baked stroke, growing the
      // border until the gesture commits.
      expect(s.noScaleCache).toBe(false)
    })

    it("carries the document identity (id generated, locked false, ADR 0002)", () => {
      const s = createShape("square", DOC)
      expect(s.id).toMatch(/^[0-9a-f-]{36}$/)
      expect(s.locked).toBe(false)
    })

    it("has a cut clipPath sitting at the creation extent", () => {
      const s = createShape("triangle", DOC)
      expect(s.clipPath).toBeInstanceOf(Triangle)
      expect((s.clipPath as Triangle).width).toBe(288)
      expect((s.clipPath as Triangle).height).toBe(192)
    })
  })

  describe("getShapeKind", () => {
    it("classifies the kinds", () => {
      expect(getShapeKind(createShape("square", DOC))).toBe("square")
      expect(getShapeKind(createShape("circle", DOC))).toBe("circle")
      expect(getShapeKind(createShape("rectangle", DOC))).toBe("rectangle")
      expect(getShapeKind(createShape("oval", DOC))).toBe("oval")
      expect(getShapeKind(createShape("triangle", DOC))).toBe("triangle")
    })

    it("returns null for non-shape objects", () => {
      expect(getShapeKind(new Group([]))).toBeNull()
    })
  })

  describe("setBorderWidth — centered border model (§4)", () => {
    it("square: the geometry IS the cut — the border is centered on it, never moving it", () => {
      const s = createShape("square", DOC)
      setBorderWidth(s, 8)
      expect(s.width).toBe(192) // geometry untouched
      expect(s.height).toBe(192)
      expect(s.strokeWidth).toBe(8)
      // the cut line runs through the middle of the full border
      expect(getCutExtent(s).width).toBe(192)
      expect(getCutExtent(s).height).toBe(192)
    })

    it("the clip grows by the stroke — the border's outer half isn't clipped away", () => {
      const s = createShape("square", DOC)
      setBorderWidth(s, 8)
      const clip = s.clipPath as Rect
      expect(clip.width).toBe(200) // 192 + 8 — the stroke's outer edge
      expect(clip.height).toBe(200)
    })

    it("rectangle: geometry untouched, the clip grows by the stroke", () => {
      const s = createShape("rectangle", DOC)
      setBorderWidth(s, 10)
      expect(s.width).toBe(288)
      expect(s.height).toBe(192)
      expect((s.clipPath as Rect).width).toBe(298)
      expect((s.clipPath as Rect).height).toBe(202)
      expect(getCutExtent(s)).toEqual({ width: 288, height: 192 })
    })

    it("triangle: geometry untouched, the clip grows by the stroke", () => {
      const s = createShape("triangle", DOC)
      setBorderWidth(s, 8)
      expect(s.width).toBe(288)
      expect(s.height).toBe(192)
      expect(s.strokeWidth).toBe(8)
      expect((s.clipPath as Triangle).width).toBe(296)
      expect((s.clipPath as Triangle).height).toBe(200)
      expect(getCutExtent(s)).toEqual({ width: 288, height: 192 })
    })

    it("circle: radius untouched, the clip grows by half the stroke", () => {
      const s = createShape("circle", DOC)
      setBorderWidth(s, 8)
      expect(s.radius).toBe(96)
      expect((s.clipPath as Circle).radius).toBe(100) // 96 + 8/2
      expect(getCutExtent(s).width).toBeCloseTo(192, 10)
    })

    it("oval: radii untouched, the clip grows by half the stroke per axis", () => {
      const s = createShape("oval", DOC)
      setBorderWidth(s, 8)
      expect(s.rx).toBe(144)
      expect(s.ry).toBe(96)
      expect((s.clipPath as Ellipse).rx).toBe(148)
      expect((s.clipPath as Ellipse).ry).toBe(100)
      expect(getCutExtent(s)).toEqual({ width: 288, height: 192 })
    })

    it("turning the border off restores strokeWidth 0 and the clip to the cut", () => {
      const s = createShape("rectangle", DOC)
      setBorderWidth(s, 8)
      setBorderWidth(s, 0)
      expect(s.width).toBe(288)
      expect(s.height).toBe(192)
      expect(s.strokeWidth).toBe(0)
      expect((s.clipPath as Rect).width).toBe(288)
      expect(getCutExtent(s)).toEqual({ width: 288, height: 192 })
    })

    it("the clip returns to the cut through any border changes", () => {
      const s = createShape("triangle", DOC)
      const clip = s.clipPath as Triangle
      setBorderWidth(s, 8)
      setBorderWidth(s, 16)
      setBorderWidth(s, 0)
      expect(clip.width).toBe(288)
      expect(clip.height).toBe(192)
      // the cut line always runs through the middle of the full border
      expect(getCutExtent(s)).toEqual({ width: clip.width, height: clip.height })
    })

    it("clamps the border to the shape's smallest side at the current scale", () => {
      const s = createShape("square", DOC)
      setBorderWidth(s, 500)
      expect(s.strokeWidth).toBe(192)
      expect(s.width).toBe(192) // geometry never changes
      expect((s.clipPath as Rect).width).toBe(384) // 192 + 192
      expect(getCutExtent(s).width).toBe(192)
    })

    it("scaling re-stamps the clip — the fixed-px border's extension divides by the scale", () => {
      const s = createShape("square", DOC)
      setBorderWidth(s, 8)
      resizeToCut(s, { width: 384, height: 384 }) // ×2
      expect(s.scaleX).toBe(2)
      expect(s.strokeWidth).toBe(8) // the border is a screen-px constant
      // the clip extension is 8/2 = 4 local px — 192 + 4 at ×2, holding
      // the stroke's outer edge on screen
      expect((s.clipPath as Rect).width).toBe(196)
      expect((s.clipPath as Rect).height).toBe(196)
      // the cut (the geometry) scaled with the shape
      expect(getCutExtent(s)).toEqual({ width: 384, height: 384 })
    })

    it("marks the object dirty — the cached render is invalidated (regression)", () => {
      const s = createShape("rectangle", DOC)
      s.dirty = false // as after a clean render
      setBorderWidth(s, 8)
      expect(s.dirty).toBe(true)
    })
  })

  describe("getCutExtent", () => {
    it("the cut is the geometry — the border never moves it", () => {
      const s = createShape("rectangle", DOC)
      setBorderWidth(s, 10)
      expect(getCutExtent(s)).toEqual({ width: 288, height: 192 })
    })

    it("accounts for scale", () => {
      const s = createShape("square", DOC)
      resizeToCut(s, { width: 384, height: 384 })
      expect(getCutExtent(s)).toEqual({ width: 384, height: 384 })
    })

    it("circle: cut diameter = 2·radius", () => {
      const s = createShape("circle", DOC)
      setBorderWidth(s, 8)
      expect(getCutExtent(s).width).toBeCloseTo(192, 10)
      expect(getCutExtent(s).height).toBeCloseTo(192, 10)
    })
  })

  describe("resizeToCut", () => {
    it("scales the shape so its cut extent matches the target", () => {
      const s = createShape("rectangle", DOC)
      resizeToCut(s, { width: 384, height: 192 })
      expect(getCutExtent(s)).toEqual({ width: 384, height: 192 })
      expect(s.width).toBe(288) // local geometry unchanged — scale does the work
    })

    it("preserves the cut extent through a border change", () => {
      const s = createShape("square", DOC)
      resizeToCut(s, { width: 384, height: 384 })
      setBorderWidth(s, 8)
      expect(getCutExtent(s)).toEqual({ width: 384, height: 384 })
    })

    it("scaling keeps the border fixed — strokeWidth is a screen-px constant", () => {
      const s = createShape("square", DOC)
      setBorderWidth(s, 8)
      resizeToCut(s, { width: 384, height: 384 }) // ×2 — the cut doubles…
      expect(s.scaleX).toBe(2)
      expect(s.strokeWidth).toBe(8) // …the border does not
      expect(s.strokeUniform).toBe(true)
    })

    it("circle scales by diameter", () => {
      const s = createShape("circle", DOC)
      resizeToCut(s, { width: 384, height: 384 })
      expect(s.scaleX).toBe(2)
      expect(s.scaleY).toBe(2)
    })

    it("goes through set() — scale is constrained, not just assigned", () => {
      const s = createShape("square", DOC)
      resizeToCut(s, { width: 384, height: 384 })
      expect(s.scaleX).toBe(2)
    })
  })

  describe("setFillColor", () => {
    it("sets the fill", () => {
      const s = createShape("square", DOC)
      setFillColor(s, "#00ff00")
      expect(s.fill).toBe("#00ff00")
    })

    it("marks the object dirty — the cached render is invalidated (regression)", () => {
      const s = createShape("square", DOC)
      s.dirty = false
      setFillColor(s, "#00ff00")
      expect(s.dirty).toBe(true)
    })
  })

  describe("setBorderColor", () => {
    it("sets the stroke", () => {
      const s = createShape("square", DOC)
      setBorderColor(s, "#ff0000")
      expect(s.stroke).toBe("#ff0000")
    })

    it("marks the object dirty — the cached render is invalidated (regression)", () => {
      const s = createShape("square", DOC)
      s.dirty = false
      setBorderColor(s, "#ff0000")
      expect(s.dirty).toBe(true)
    })
  })

  describe("round-trip (§4, ADR 0002)", () => {
    it("serializes and revives geometry, border, clipPath and identity", async () => {
      registerCustomProperties()
      const s = createShape("triangle", DOC)
      s.name = "shape"
      setBorderWidth(s, 8)
      resizeToCut(s, { width: 576, height: 192 })

      const revived = (await util.enlivenObjects([s.toObject()]))[0] as Triangle

      expect(revived.id).toBe(s.id)
      expect(revived.name).toBe("shape")
      expect(revived.locked).toBe(false)
      expect(revived.strokeWidth).toBe(8)
      expect(revived.stroke).toBe(DEFAULT_BORDER_COLOR)
      expect(revived.strokeUniform).toBe(true) // the fixed-px border survives
      expect(revived.width).toBe(288) // the geometry IS the cut — never shrunk
      expect(getCutExtent(revived)).toEqual({ width: 576, height: 192 })
      expect(revived.clipPath).toBeInstanceOf(Triangle)
      // the grown clip survives — at ×2 the extension is 8/2 = 4 local px
      expect((revived.clipPath as Triangle).width).toBe(292)
    })
  })

  describe("grouped shapes — an edit re-fits the group, never clipping it (regression)", () => {
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

    /** Two 192 px squares at 0..192 and 204..396, grouped. */
    function groupedSquares() {
      const a = createShape("square", DOC)
      a.set({ left: 0, top: 0 })
      const b = createShape("square", DOC)
      b.set({ left: 300, top: 0 })
      canvas.add(a, b)
      const group = groupObjects(canvas, [a, b])!
      return { a, b, group }
    }

    it("a border-width change re-fits the group — the border renders past the cut edge", () => {
      const { a, group } = groupedSquares()
      const widthBefore = group.width
      setBorderWidth(a, 20)
      // The stroke is centered on the cut — the group hugs the full border
      // (half a stroke beyond the cut on the outer side) instead of clipping
      // it at the pre-edit bounds.
      expect(group.width).toBeCloseTo(widthBefore + 10, 6)
    })

    it("a cut-size change re-fits the group — the scaled shape is never clipped", () => {
      const { a, group } = groupedSquares()
      const widthBefore = group.width
      resizeToCut(a, { width: 500, height: 192 })
      // a's cut grows to ±250 around its center (0) — past b's right edge
      // (396) — and the group hugs the new union, -250..396.
      expect(group.width).toBeCloseTo(646, 6)
      expect(group.width).toBeGreaterThan(widthBefore)
    })
  })
})
