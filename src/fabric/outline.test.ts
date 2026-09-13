import { describe, expect, it } from "vitest"

import {
  BOOT_OUTLINE,
  BOOT_SIZE,
  getStickerShape,
  presetDefaultSize,
  STICKER_PRESETS,
} from "@/fabric/outline"
import { unitToPx } from "@/lib/units"

/** The five shapes a Document's outline state can read as. */
const SHAPES = ["square", "rectangle", "rounded-corner", "oval", "circle"] as const

/**
 * The Document's outline (map #48) — the envelope-owned state, the sticker it
 * reads as, and the size each preset creates at. All derivation: no canvas,
 * no rendering.
 */
describe("getStickerShape", () => {
  it("reads the aspect lock where the outline carries one", () => {
    expect(getStickerShape({ outline: "rect", aspectLocked: true })).toBe(
      "square",
    )
    expect(getStickerShape({ outline: "rect", aspectLocked: false })).toBe(
      "rectangle",
    )
    expect(getStickerShape({ outline: "oval", aspectLocked: true })).toBe(
      "circle",
    )
    expect(getStickerShape({ outline: "oval", aspectLocked: false })).toBe("oval")
  })

  it("rounded-rect is Rounded corner either way — New never sets its lock", () => {
    expect(
      getStickerShape({ outline: "rounded-rect", aspectLocked: false }),
    ).toBe("rounded-corner")
    expect(
      getStickerShape({ outline: "rounded-rect", aspectLocked: true }),
    ).toBe("rounded-corner")
  })

  it("Custom is rect + free, so it reads as Rectangle", () => {
    // The map's note: Custom and Rectangle are the *same* state — only the
    // dropdown entry that made the sheet differs, and that is not a fact
    // about the Document. Hence a custom-sized rectangle correctly shows
    // Rectangle Predesigns.
    expect(getStickerShape(STICKER_PRESETS.custom)).toBe("rectangle")
  })

  it("each preset's own outline state reads back as that preset", () => {
    for (const preset of SHAPES) {
      expect(getStickerShape(STICKER_PRESETS[preset])).toBe(preset)
    }
  })
})

describe("presetDefaultSize", () => {
  it("fixes the size for every shape whose New output is fixed", () => {
    expect(presetDefaultSize({ outline: "rect", aspectLocked: true })).toEqual({
      width: 192,
      height: 192,
    })
    expect(
      presetDefaultSize({ outline: "rounded-rect", aspectLocked: false }),
    ).toEqual({ width: 192, height: 192 })
    expect(presetDefaultSize({ outline: "oval", aspectLocked: true })).toEqual({
      width: 192,
      height: 192,
    })
    expect(presetDefaultSize({ outline: "oval", aspectLocked: false })).toEqual({
      width: 288,
      height: 192,
    })
  })

  it("rect + free has none — Rectangle and Custom share the state", () => {
    // New can produce either at any size, so the state alone never fixes one.
    // The blank-guard leans on this: a Custom sheet must read as factory-fresh
    // at whatever size it was typed at.
    expect(presetDefaultSize({ outline: "rect", aspectLocked: false })).toBeNull()
  })

  it("the Rectangle *preset* still has its Default size", () => {
    // The state carries no size; the preset does.
    expect(STICKER_PRESETS.rectangle.size).toEqual({ width: 288, height: 192 })
  })
})

describe("the sticker preset table", () => {
  it("Custom is rect + free with no Default size; the five shapes each have one", () => {
    expect(STICKER_PRESETS.custom).toEqual({
      outline: "rect",
      aspectLocked: false,
      size: null,
    })
    for (const preset of SHAPES) {
      expect(STICKER_PRESETS[preset].size).not.toBeNull()
    }
  })

  it("locks the aspect ratio on Square and Circle only", () => {
    expect(STICKER_PRESETS.square.aspectLocked).toBe(true)
    expect(STICKER_PRESETS.circle.aspectLocked).toBe(true)
    expect(STICKER_PRESETS.rectangle.aspectLocked).toBe(false)
    expect(STICKER_PRESETS["rounded-corner"].aspectLocked).toBe(false)
    expect(STICKER_PRESETS.oval.aspectLocked).toBe(false)
  })

  it("carries CONTEXT's Default sizes — inches at the 96 DPI basis", () => {
    // Square 2×2 in, Rectangle 3×2 in, Rounded corner 2×2 in, Oval 3×2 in,
    // Circle Ø2 (CONTEXT "Default size"). The inches are the source; the
    // stored px must be exactly their 96 DPI derivation.
    expect(STICKER_PRESETS.square.size).toEqual({
      width: unitToPx(2, "in"),
      height: unitToPx(2, "in"),
    })
    expect(STICKER_PRESETS.rectangle.size).toEqual({
      width: unitToPx(3, "in"),
      height: unitToPx(2, "in"),
    })
    expect(STICKER_PRESETS["rounded-corner"].size).toEqual({
      width: unitToPx(2, "in"),
      height: unitToPx(2, "in"),
    })
    expect(STICKER_PRESETS.oval.size).toEqual({
      width: unitToPx(3, "in"),
      height: unitToPx(2, "in"),
    })
    expect(STICKER_PRESETS.circle.size).toEqual({
      width: unitToPx(2, "in"),
      height: unitToPx(2, "in"),
    })
  })
})

describe("the boot preset", () => {
  it("is a Square sticker — a 192×192 rect, aspect locked (map #48)", () => {
    expect(BOOT_OUTLINE).toEqual({ outline: "rect", aspectLocked: true })
    expect(BOOT_SIZE).toEqual({ width: 192, height: 192 })
    expect(getStickerShape(BOOT_OUTLINE)).toBe("square")
  })
})
