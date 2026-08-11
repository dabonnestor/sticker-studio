import { describe, expect, it } from "vitest"

import { commitPx, formatPx, pxToUnit, unitToPx } from "@/lib/units"

/**
 * Unit system (build spec §5): 1 in = 96 px at the display basis; mm is a
 * derivation (px ÷ 96 × 25.4). Units are a label swap over stored px — the
 * math must round-trip exactly for values derived from integer px.
 */
describe("units", () => {
  describe("unitToPx", () => {
    it("converts inches at the 96 DPI basis", () => {
      expect(unitToPx(2, "in")).toBe(192)
      expect(unitToPx(0.5, "in")).toBe(48)
    })

    it("converts millimetres from the inch basis", () => {
      // 1 in = 25.4 mm → 96 px
      expect(unitToPx(25.4, "mm")).toBeCloseTo(96, 10)
      expect(unitToPx(50.8, "mm")).toBeCloseTo(192, 10)
    })

    it("passes px through unchanged", () => {
      expect(unitToPx(192, "px")).toBe(192)
    })
  })

  describe("pxToUnit", () => {
    it("converts px back to inches", () => {
      expect(pxToUnit(192, "in")).toBeCloseTo(2, 10)
      expect(pxToUnit(48, "in")).toBeCloseTo(0.5, 10)
    })

    it("converts px to millimetres", () => {
      expect(pxToUnit(192, "mm")).toBeCloseTo(50.8, 10)
      expect(pxToUnit(96, "mm")).toBeCloseTo(25.4, 10)
    })

    it("is the identity for px", () => {
      expect(pxToUnit(192, "px")).toBe(192)
    })
  })

  describe("commitPx", () => {
    it("rounds converted values to integer px at commit", () => {
      expect(commitPx(1.5, "in")).toBe(144)
      expect(commitPx(50.8, "mm")).toBe(192)
      expect(commitPx(192, "px")).toBe(192)
    })
  })

  describe("formatPx", () => {
    it("formats px as integers (display-only rounding)", () => {
      expect(formatPx(192, "px")).toBe("192")
      expect(formatPx(192.4, "px")).toBe("192")
    })

    it("formats inches with decimals, trimmed of trailing zeros", () => {
      expect(formatPx(192, "in")).toBe("2")
      expect(formatPx(120, "in")).toBe("1.25")
    })

    it("formats millimetres with one decimal", () => {
      expect(formatPx(192, "mm")).toBe("50.8")
      expect(formatPx(96, "mm")).toBe("25.4")
    })
  })
})
