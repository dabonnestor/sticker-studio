import { Circle, Ellipse, Group, Rect, util } from "fabric"
import { describe, expect, it } from "vitest"

import { registerCustomProperties } from "@/fabric/custom-properties"
import {
  DEFAULT_BORDER_COLOR,
  createStickerShape,
  getCutExtent,
  getCutRadius,
  getStickerShapeKind,
  resizeToCut,
  setBorderColor,
  setBorderWidth,
  setCutRadius,
} from "@/fabric/shapes"

/**
 * Sticker shape model (build spec §4, §5). Default sizes are inches-specified
 * at the 96 DPI display basis: Square 2×2 → 192×192 px, Circle Ø2 → radius 96,
 * Rectangle / Oval / Rounded-rectangle 2×3 → 192×288 px. The inset border
 * model: the object geometry is the area inside the border; turning the border
 * on shrinks it by half the stroke per side while the cut extent (the clipPath,
 * which never moves) stays at the original edge.
 */
describe("shape model", () => {
  describe("createStickerShape — default sizes (§5)", () => {
    it("square: 2×2 in → 192×192 px, sharp corners", () => {
      const s = createStickerShape("square")
      expect(s).toBeInstanceOf(Rect)
      expect(s.width).toBe(192)
      expect(s.height).toBe(192)
      expect(s.rx).toBe(0)
    })

    it("circle: Ø2 in → radius 96 px", () => {
      const s = createStickerShape("circle")
      expect(s).toBeInstanceOf(Circle)
      expect(s.radius).toBe(96)
    })

    it("rectangle: 2×3 in → 192×288 px", () => {
      const s = createStickerShape("rectangle")
      expect(s).toBeInstanceOf(Rect)
      expect(s.width).toBe(192)
      expect(s.height).toBe(288)
      expect(s.rx).toBe(0)
    })

    it("oval: 2×3 in → rx 96, ry 144 px", () => {
      const s = createStickerShape("oval")
      expect(s).toBeInstanceOf(Ellipse)
      expect(s.rx).toBe(96)
      expect(s.ry).toBe(144)
    })

    it("rounded-rectangle: 2×3 in with rx = 20% of the shorter side (38.4 px)", () => {
      const s = createStickerShape("rounded-rectangle")
      expect(s).toBeInstanceOf(Rect)
      expect(s.width).toBe(192)
      expect(s.height).toBe(288)
      expect(s.rx).toBeCloseTo(38.4, 10)
    })

    it("starts with the border off: strokeWidth 0, cut = geometry", () => {
      const s = createStickerShape("square")
      expect(s.strokeWidth).toBe(0)
      expect(s.stroke).toBe(DEFAULT_BORDER_COLOR)
    })

    it("carries the document identity (id generated, locked false, ADR 0002)", () => {
      const s = createStickerShape("square")
      expect(s.id).toMatch(/^[0-9a-f-]{36}$/)
      expect(s.locked).toBe(false)
    })

    it("has a cut clipPath sitting at the creation extent", () => {
      const s = createStickerShape("rounded-rectangle")
      expect(s.clipPath).toBeInstanceOf(Rect)
      expect((s.clipPath as Rect).width).toBe(192)
      expect((s.clipPath as Rect).height).toBe(288)
      expect((s.clipPath as Rect).rx).toBeCloseTo(38.4, 10)
    })
  })

  describe("getStickerShapeKind", () => {
    it("classifies the five kinds", () => {
      expect(getStickerShapeKind(createStickerShape("square"))).toBe("square")
      expect(getStickerShapeKind(createStickerShape("circle"))).toBe("circle")
      expect(getStickerShapeKind(createStickerShape("rectangle"))).toBe("rectangle")
      expect(getStickerShapeKind(createStickerShape("oval"))).toBe("oval")
      expect(getStickerShapeKind(createStickerShape("rounded-rectangle"))).toBe("rounded-rectangle")
    })

    it("returns null for non-sticker objects", () => {
      expect(getStickerShapeKind(new Group([]))).toBeNull()
    })
  })

  describe("setBorderWidth — inset border model (§4)", () => {
    it("square: border on shrinks the interior by half the stroke per side", () => {
      const s = createStickerShape("square")
      setBorderWidth(s, 8)
      expect(s.width).toBe(184) // 192 − 8, i.e. 4 px per side
      expect(s.height).toBe(184)
      expect(s.strokeWidth).toBe(8)
      // cut geometry derives as width + borderWidth
      expect(getCutExtent(s).width).toBe(192)
      expect(getCutExtent(s).height).toBe(192)
    })

    it("circle: radius shrinks by half the stroke, diameter preserved", () => {
      const s = createStickerShape("circle")
      setBorderWidth(s, 8)
      expect(s.radius).toBe(92) // 96 − 8/2
      expect(getCutExtent(s).width).toBeCloseTo(192, 10)
    })

    it("rounded-rectangle: rx shrinks by half the stroke, cut radius preserved", () => {
      const s = createStickerShape("rounded-rectangle")
      setBorderWidth(s, 8)
      expect(s.rx).toBeCloseTo(34.4, 10) // 38.4 − 8/2
      expect(getCutRadius(s)).toBeCloseTo(38.4, 10)
    })

    it("turning the border off restores the original geometry", () => {
      const s = createStickerShape("rounded-rectangle")
      setBorderWidth(s, 8)
      setBorderWidth(s, 0)
      expect(s.width).toBe(192)
      expect(s.height).toBe(288)
      expect(s.rx).toBeCloseTo(38.4, 10)
      expect(s.strokeWidth).toBe(0)
      expect(getCutExtent(s).width).toBe(192)
    })

    it("the clipPath stays at the original edge throughout border changes", () => {
      const s = createStickerShape("rounded-rectangle")
      const clip = s.clipPath as Rect
      setBorderWidth(s, 8)
      setBorderWidth(s, 16)
      setBorderWidth(s, 0)
      expect(clip.width).toBe(192)
      expect(clip.height).toBe(288)
      expect(clip.rx).toBeCloseTo(38.4, 10)
      // and the clip always matches the derived cut geometry
      expect(getCutExtent(s).width).toBe(clip.width)
      expect(getCutRadius(s)).toBeCloseTo(clip.rx, 10)
    })

    it("clamps the border to the sticker's cut extent (interior never inverts)", () => {
      const s = createStickerShape("square")
      setBorderWidth(s, 500)
      expect(s.width).toBe(0)
      expect(s.strokeWidth).toBe(192)
      expect(getCutExtent(s).width).toBe(192)
    })
  })

  describe("getCutExtent", () => {
    it("derives the cut from width + borderWidth", () => {
      const s = createStickerShape("rectangle")
      setBorderWidth(s, 10)
      expect(getCutExtent(s)).toEqual({ width: 192, height: 288 })
    })

    it("accounts for scale", () => {
      const s = createStickerShape("square")
      resizeToCut(s, { width: 384, height: 384 })
      expect(getCutExtent(s)).toEqual({ width: 384, height: 384 })
    })

    it("circle: cut diameter = 2·radius + borderWidth", () => {
      const s = createStickerShape("circle")
      setBorderWidth(s, 8)
      expect(getCutExtent(s).width).toBeCloseTo(192, 10)
      expect(getCutExtent(s).height).toBeCloseTo(192, 10)
    })
  })

  describe("resizeToCut", () => {
    it("scales the sticker so its cut extent matches the target", () => {
      const s = createStickerShape("rectangle")
      resizeToCut(s, { width: 384, height: 288 })
      expect(getCutExtent(s)).toEqual({ width: 384, height: 288 })
      expect(s.width).toBe(192) // local geometry unchanged — scale does the work
    })

    it("preserves the cut extent through a border change", () => {
      const s = createStickerShape("square")
      resizeToCut(s, { width: 384, height: 384 })
      setBorderWidth(s, 8)
      expect(getCutExtent(s)).toEqual({ width: 384, height: 384 })
    })

    it("circle scales by diameter", () => {
      const s = createStickerShape("circle")
      resizeToCut(s, { width: 384, height: 384 })
      expect(s.scaleX).toBe(2)
      expect(s.scaleY).toBe(2)
    })

    it("resize never re-derives the corner radius (§5)", () => {
      const s = createStickerShape("rounded-rectangle")
      resizeToCut(s, { width: 384, height: 576 })
      expect(s.rx).toBeCloseTo(38.4, 10) // not re-derived to 20% of the new side
    })
  })

  describe("setCutRadius", () => {
    it("sets the corner radius as an independent px property", () => {
      const s = createStickerShape("rounded-rectangle")
      setCutRadius(s, 50)
      expect(s.rx).toBe(50)
      expect(getCutRadius(s)).toBe(50)
    })

    it("interior rx accounts for the border (cut rx = rx + border/2)", () => {
      const s = createStickerShape("rounded-rectangle")
      setBorderWidth(s, 8)
      setCutRadius(s, 40)
      expect(s.rx).toBe(36) // 40 − 8/2
      expect(getCutRadius(s)).toBe(40)
    })

    it("clamps to the geometry", () => {
      const s = createStickerShape("rounded-rectangle")
      setCutRadius(s, 500)
      expect(s.rx).toBe(96) // half the shorter interior side
    })

    it("moves the cut clipPath with the radius — the cut line matches the corners", () => {
      const s = createStickerShape("rounded-rectangle")
      setCutRadius(s, 50)
      expect((s.clipPath as Rect).rx).toBe(50)
      expect(getCutRadius(s)).toBe(50)
    })

    it("keeps the cut radius (interior rx + border/2) on the clipPath with a border on", () => {
      const s = createStickerShape("rounded-rectangle")
      setBorderWidth(s, 8)
      setCutRadius(s, 40)
      expect(s.rx).toBe(36) // 40 − 8/2
      expect((s.clipPath as Rect).rx).toBe(40)
      expect(getCutRadius(s)).toBe(40)
    })
  })

  describe("setBorderColor", () => {
    it("sets the stroke", () => {
      const s = createStickerShape("square")
      setBorderColor(s, "#ff0000")
      expect(s.stroke).toBe("#ff0000")
    })
  })

  describe("round-trip (§4, ADR 0002)", () => {
    it("serializes and revives geometry, border, clipPath and identity", async () => {
      registerCustomProperties()
      const s = createStickerShape("rounded-rectangle")
      s.name = "sticker"
      setBorderWidth(s, 8)
      resizeToCut(s, { width: 384, height: 288 })

      const revived = (await util.enlivenObjects([s.toObject()]))[0] as Rect

      expect(revived.id).toBe(s.id)
      expect(revived.name).toBe("sticker")
      expect(revived.locked).toBe(false)
      expect(revived.strokeWidth).toBe(8)
      expect(revived.stroke).toBe(DEFAULT_BORDER_COLOR)
      expect(revived.width).toBe(184) // interior geometry survives
      expect(revived.rx).toBeCloseTo(34.4, 10)
      expect(getCutExtent(revived)).toEqual({ width: 384, height: 288 })
      expect(getCutRadius(revived)).toBeCloseTo(38.4, 10)
      expect(revived.clipPath).toBeInstanceOf(Rect)
      expect((revived.clipPath as Rect).width).toBe(192)
    })
  })
})
