import { Circle, Ellipse, Group, Rect, Triangle, util } from "fabric"
import { describe, expect, it } from "vitest"

import { registerCustomProperties } from "@/fabric/custom-properties"
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

/**
 * Shape model (build spec §4, §5). Default sizes are inches-specified
 * at the 96 DPI display basis: Square 2×2 → 192×192 px, Circle Ø2 → radius 96,
 * Rectangle / Oval / Triangle 3×2 (landscape) → 288×192 px. The inset border
 * model: the object geometry is the area inside the border; turning the border
 * on shrinks it by half the stroke per side while the cut extent (the clipPath,
 * which never moves) stays at the original edge.
 *
 * Every mutator goes through `obj.set()` so Fabric marks the object dirty:
 * the inset model keeps `width + strokeWidth` constant, so the cache canvas
 * dimensions never change and a direct assignment would leave the stale cache
 * rendering the old border (regression: border/color changes did not paint).
 */
describe("shape model", () => {
  describe("createShape — default sizes (§5)", () => {
    it("square: 2×2 in → 192×192 px, sharp corners", () => {
      const s = createShape("square")
      expect(s).toBeInstanceOf(Rect)
      expect(s.width).toBe(192)
      expect(s.height).toBe(192)
      expect(s.rx).toBe(0)
    })

    it("circle: Ø2 in → radius 96 px", () => {
      const s = createShape("circle")
      expect(s).toBeInstanceOf(Circle)
      expect(s.radius).toBe(96)
    })

    it("rectangle: 3×2 in (landscape) → 288×192 px", () => {
      const s = createShape("rectangle")
      expect(s).toBeInstanceOf(Rect)
      expect(s.width).toBe(288)
      expect(s.height).toBe(192)
      expect(s.rx).toBe(0)
    })

    it("oval: 3×2 in (landscape) → rx 144, ry 96 px", () => {
      const s = createShape("oval")
      expect(s).toBeInstanceOf(Ellipse)
      expect(s.rx).toBe(144)
      expect(s.ry).toBe(96)
    })

    it("triangle: 3×2 in (landscape) → 288×192 px", () => {
      const s = createShape("triangle")
      expect(s).toBeInstanceOf(Triangle)
      expect(s.width).toBe(288)
      expect(s.height).toBe(192)
    })

    it("starts with the border off: strokeWidth 0, cut = geometry", () => {
      const s = createShape("square")
      expect(s.strokeWidth).toBe(0)
      expect(s.stroke).toBe(DEFAULT_BORDER_COLOR)
    })

    it("carries the document identity (id generated, locked false, ADR 0002)", () => {
      const s = createShape("square")
      expect(s.id).toMatch(/^[0-9a-f-]{36}$/)
      expect(s.locked).toBe(false)
    })

    it("has a cut clipPath sitting at the creation extent", () => {
      const s = createShape("triangle")
      expect(s.clipPath).toBeInstanceOf(Triangle)
      expect((s.clipPath as Triangle).width).toBe(288)
      expect((s.clipPath as Triangle).height).toBe(192)
    })
  })

  describe("getShapeKind", () => {
    it("classifies the kinds", () => {
      expect(getShapeKind(createShape("square"))).toBe("square")
      expect(getShapeKind(createShape("circle"))).toBe("circle")
      expect(getShapeKind(createShape("rectangle"))).toBe("rectangle")
      expect(getShapeKind(createShape("oval"))).toBe("oval")
      expect(getShapeKind(createShape("triangle"))).toBe("triangle")
    })

    it("returns null for non-shape objects", () => {
      expect(getShapeKind(new Group([]))).toBeNull()
    })
  })

  describe("setBorderWidth — inset border model (§4)", () => {
    it("square: border on shrinks the interior by half the stroke per side", () => {
      const s = createShape("square")
      setBorderWidth(s, 8)
      expect(s.width).toBe(184) // 192 − 8, i.e. 4 px per side
      expect(s.height).toBe(184)
      expect(s.strokeWidth).toBe(8)
      // cut geometry derives as width + borderWidth
      expect(getCutExtent(s).width).toBe(192)
      expect(getCutExtent(s).height).toBe(192)
    })

    it("rectangle: border on shrinks the interior, cut preserved", () => {
      const s = createShape("rectangle")
      setBorderWidth(s, 10)
      expect(s.width).toBe(278) // 288 − 10
      expect(s.height).toBe(182) // 192 − 10
      expect(getCutExtent(s)).toEqual({ width: 288, height: 192 })
    })

    it("triangle: border on shrinks the interior, cut preserved", () => {
      const s = createShape("triangle")
      setBorderWidth(s, 8)
      expect(s.width).toBe(280)
      expect(s.height).toBe(184)
      expect(s.strokeWidth).toBe(8)
      expect(getCutExtent(s)).toEqual({ width: 288, height: 192 })
    })

    it("circle: radius shrinks by half the stroke, diameter preserved", () => {
      const s = createShape("circle")
      setBorderWidth(s, 8)
      expect(s.radius).toBe(92) // 96 − 8/2
      expect(getCutExtent(s).width).toBeCloseTo(192, 10)
    })

    it("oval: radii shrink by half the stroke, cut preserved", () => {
      const s = createShape("oval")
      setBorderWidth(s, 8)
      expect(s.rx).toBe(140) // 144 − 4
      expect(s.ry).toBe(92) // 96 − 4
      expect(getCutExtent(s)).toEqual({ width: 288, height: 192 })
    })

    it("turning the border off restores the original geometry", () => {
      const s = createShape("rectangle")
      setBorderWidth(s, 8)
      setBorderWidth(s, 0)
      expect(s.width).toBe(288)
      expect(s.height).toBe(192)
      expect(s.strokeWidth).toBe(0)
      expect(getCutExtent(s)).toEqual({ width: 288, height: 192 })
    })

    it("the clipPath stays at the original edge throughout border changes", () => {
      const s = createShape("triangle")
      const clip = s.clipPath as Triangle
      setBorderWidth(s, 8)
      setBorderWidth(s, 16)
      setBorderWidth(s, 0)
      expect(clip.width).toBe(288)
      expect(clip.height).toBe(192)
      // and the clip always matches the derived cut geometry
      expect(getCutExtent(s)).toEqual({ width: clip.width, height: clip.height })
    })

    it("clamps the border to the shape's cut extent (interior never inverts)", () => {
      const s = createShape("square")
      setBorderWidth(s, 500)
      expect(s.width).toBe(0)
      expect(s.strokeWidth).toBe(192)
      expect(getCutExtent(s).width).toBe(192)
    })

    it("marks the object dirty — the cached render is invalidated (regression)", () => {
      const s = createShape("rectangle")
      s.dirty = false // as after a clean render
      setBorderWidth(s, 8)
      expect(s.dirty).toBe(true)
    })
  })

  describe("getCutExtent", () => {
    it("derives the cut from width + borderWidth", () => {
      const s = createShape("rectangle")
      setBorderWidth(s, 10)
      expect(getCutExtent(s)).toEqual({ width: 288, height: 192 })
    })

    it("accounts for scale", () => {
      const s = createShape("square")
      resizeToCut(s, { width: 384, height: 384 })
      expect(getCutExtent(s)).toEqual({ width: 384, height: 384 })
    })

    it("circle: cut diameter = 2·radius + borderWidth", () => {
      const s = createShape("circle")
      setBorderWidth(s, 8)
      expect(getCutExtent(s).width).toBeCloseTo(192, 10)
      expect(getCutExtent(s).height).toBeCloseTo(192, 10)
    })
  })

  describe("resizeToCut", () => {
    it("scales the shape so its cut extent matches the target", () => {
      const s = createShape("rectangle")
      resizeToCut(s, { width: 384, height: 192 })
      expect(getCutExtent(s)).toEqual({ width: 384, height: 192 })
      expect(s.width).toBe(288) // local geometry unchanged — scale does the work
    })

    it("preserves the cut extent through a border change", () => {
      const s = createShape("square")
      resizeToCut(s, { width: 384, height: 384 })
      setBorderWidth(s, 8)
      expect(getCutExtent(s)).toEqual({ width: 384, height: 384 })
    })

    it("circle scales by diameter", () => {
      const s = createShape("circle")
      resizeToCut(s, { width: 384, height: 384 })
      expect(s.scaleX).toBe(2)
      expect(s.scaleY).toBe(2)
    })

    it("goes through set() — scale is constrained, not just assigned", () => {
      const s = createShape("square")
      resizeToCut(s, { width: 384, height: 384 })
      expect(s.scaleX).toBe(2)
    })
  })

  describe("setFillColor", () => {
    it("sets the fill", () => {
      const s = createShape("square")
      setFillColor(s, "#00ff00")
      expect(s.fill).toBe("#00ff00")
    })

    it("marks the object dirty — the cached render is invalidated (regression)", () => {
      const s = createShape("square")
      s.dirty = false
      setFillColor(s, "#00ff00")
      expect(s.dirty).toBe(true)
    })
  })

  describe("setBorderColor", () => {
    it("sets the stroke", () => {
      const s = createShape("square")
      setBorderColor(s, "#ff0000")
      expect(s.stroke).toBe("#ff0000")
    })

    it("marks the object dirty — the cached render is invalidated (regression)", () => {
      const s = createShape("square")
      s.dirty = false
      setBorderColor(s, "#ff0000")
      expect(s.dirty).toBe(true)
    })
  })

  describe("round-trip (§4, ADR 0002)", () => {
    it("serializes and revives geometry, border, clipPath and identity", async () => {
      registerCustomProperties()
      const s = createShape("triangle")
      s.name = "shape"
      setBorderWidth(s, 8)
      resizeToCut(s, { width: 576, height: 192 })

      const revived = (await util.enlivenObjects([s.toObject()]))[0] as Triangle

      expect(revived.id).toBe(s.id)
      expect(revived.name).toBe("shape")
      expect(revived.locked).toBe(false)
      expect(revived.strokeWidth).toBe(8)
      expect(revived.stroke).toBe(DEFAULT_BORDER_COLOR)
      expect(revived.width).toBe(280) // interior geometry survives
      expect(getCutExtent(revived)).toEqual({ width: 576, height: 192 })
      expect(revived.clipPath).toBeInstanceOf(Triangle)
      expect((revived.clipPath as Triangle).width).toBe(288)
    })
  })
})
