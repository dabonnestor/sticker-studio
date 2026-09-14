import { describe, expect, it } from "vitest"

import {
  BOOT_OUTLINE,
  BOOT_SIZE,
  cornerRadius,
  CUSTOM_DEFAULT_SIZE,
  getStickerShape,
  MIN_DOCUMENT_SIZE_PX,
  mirrorLockedSize,
  presetDefaultSize,
  presetDocument,
  presetLabel,
  ROUNDED_CORNER_RADIUS_RATIO,
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

/**
 * How New names a preset (map #48): the shape and the Default size it creates
 * at, read in the unit the app is showing. A preset is a shape *at a size*, so
 * the name carries both — and CONTEXT's Default size vocabulary is where the
 * numbers come from (Square 2×2, Circle Ø2, Rectangle/Oval 3×2).
 */
describe("presetLabel", () => {
  it("names the shape and its Default size, as CONTEXT gives them", () => {
    expect(presetLabel("square", "in")).toBe("Square sticker (2×2 in)")
    expect(presetLabel("rectangle", "in")).toBe("Rectangle sticker (3×2 in)")
    expect(presetLabel("rounded-corner", "in")).toBe(
      "Rounded corner sticker (2×2 in)",
    )
    expect(presetLabel("oval", "in")).toBe("Oval sticker (3×2 in)")
    // A Circle is named by its width×height like every other shape: the
    // Default size the preset table holds for it is the 192×192 box it is
    // drawn in, which is the same size CONTEXT "Default size" writes as Ø2.
    expect(presetLabel("circle", "in")).toBe("Circle sticker (2×2 in)")
    expect(presetLabel("circle", "px")).toBe("Circle sticker (192×192 px)")
  })

  it("reads the size in the unit asked for — mm included", () => {
    expect(presetLabel("square", "px")).toBe("Square sticker (192×192 px)")
    // 2 in at the 96 DPI basis is 50.8 mm, the way the toolbar reads it.
    expect(presetLabel("square", "mm")).toBe("Square sticker (50.8×50.8 mm)")
  })

  it("Custom carries no size, being the one preset with none", () => {
    // Its width and height are typed at New, so there is no Default size to
    // name — in any unit.
    for (const unit of ["in", "mm", "px"] as const) {
      expect(presetLabel("custom", unit)).toBe("Custom size")
    }
  })
})

/**
 * The Document a preset creates at New (ticket #55) — the outline state and
 * the size in one answer, because a preset is a shape *at a size*, and the
 * shape alone inscribes itself in whatever sheet is already on the stage.
 */
describe("presetDocument", () => {
  it("carries each shape preset's outline state and its Default size", () => {
    for (const preset of SHAPES) {
      const spec = STICKER_PRESETS[preset]
      expect(presetDocument(preset)).toEqual({
        outline: spec.outline,
        aspectLocked: spec.aspectLocked,
        width: spec.size!.width,
        height: spec.size!.height,
      })
    }
  })

  it("reads back as the preset it was created from", () => {
    // The round trip that makes the table and the derivation one vocabulary:
    // whatever New creates, the Designs panel filters and the blank-guard
    // reads as that same sticker.
    for (const preset of SHAPES) {
      expect(getStickerShape(presetDocument(preset))).toBe(preset)
    }
  })

  it("takes Custom's size from the caller — Custom's spec carries none", () => {
    expect(presetDocument("custom", { width: 400, height: 250 })).toEqual({
      outline: "rect",
      aspectLocked: false,
      width: 400,
      height: 250,
    })
  })

  it("is sharp-cornered and free-sizing — Custom is rect + free, not a sixth outline", () => {
    const custom = presetDocument("custom", { width: 400, height: 250 })
    expect(custom.outline).toBe("rect")
    expect(custom.aspectLocked).toBe(false)
    // Which is why a custom sheet reads as Rectangle, and shows Rectangle
    // Predesigns (§#51's derivation) — how it was made is not a fact about it.
    expect(getStickerShape(custom)).toBe("rectangle")
  })

  it("falls back to Custom's opening size, so every preset answers with a Document", () => {
    expect(presetDocument("custom")).toEqual({
      outline: "rect",
      aspectLocked: false,
      ...CUSTOM_DEFAULT_SIZE,
    })
  })

  it("opens Custom on Rectangle's Default size", () => {
    // Rectangle is the rect + free entry, so it is the vocabulary's own answer
    // to "a rectangle's size" — no separate constant to drift from it.
    expect(CUSTOM_DEFAULT_SIZE).toEqual(STICKER_PRESETS.rectangle.size)
  })

  it("creates no sheet under the Document size floor", () => {
    // A preset's Default size must be one the toolbar would hold: create a
    // sheet the size fields then refuse to edit and the app contradicts
    // itself. Custom is the caller's to guard (the popover's floor).
    for (const preset of SHAPES) {
      const doc = presetDocument(preset)
      expect(doc.width).toBeGreaterThanOrEqual(MIN_DOCUMENT_SIZE_PX)
      expect(doc.height).toBeGreaterThanOrEqual(MIN_DOCUMENT_SIZE_PX)
    }
  })
})

describe("the boot preset", () => {
  it("is a Square sticker — a 192×192 rect, aspect locked (map #48)", () => {
    expect(BOOT_OUTLINE).toEqual({ outline: "rect", aspectLocked: true })
    expect(BOOT_SIZE).toEqual({ width: 192, height: 192 })
    expect(getStickerShape(BOOT_OUTLINE)).toBe("square")
  })
})

describe("cornerRadius", () => {
  it("is the preset ratio of the short side", () => {
    // Rounded corner's radius is a fixed preset (map #48) — a proportion, so
    // the corner survives the free resize the preset allows.
    expect(cornerRadius({ width: 192, height: 192 })).toBe(
      192 * ROUNDED_CORNER_RADIUS_RATIO,
    )
    expect(cornerRadius({ width: 288, height: 192 })).toBe(
      192 * ROUNDED_CORNER_RADIUS_RATIO,
    )
    // The short side governs, whichever axis it is.
    expect(cornerRadius({ width: 192, height: 288 })).toBe(
      192 * ROUNDED_CORNER_RADIUS_RATIO,
    )
  })

  it("tracks the Document at the square preset's own size", () => {
    expect(cornerRadius(STICKER_PRESETS["rounded-corner"].size!)).toBeCloseTo(
      23.04,
      6,
    )
  })
})

/**
 * The aspect lock's one rule (map #48): the axis the user typed wins, the
 * other mirrors it. Square and Circle both lock 1:1, so there is one rule
 * rather than two — and it is a mirror, never a disabled field, which on a
 * locked sticker reads as broken rather than as a rule.
 */
describe("mirrorLockedSize", () => {
  const square = { width: 192, height: 192 }

  it("mirrors a typed width onto the height", () => {
    expect(mirrorLockedSize(square, { width: 300, height: 192 })).toEqual({
      width: 300,
      height: 300,
    })
  })

  it("mirrors a typed height onto the width", () => {
    expect(mirrorLockedSize(square, { width: 192, height: 300 })).toEqual({
      width: 300,
      height: 300,
    })
  })

  it("passes a commit that moves neither axis through untouched", () => {
    // A re-typed value: no axis moved, so no mirror. The no-op is the
    // History's to dedup, not this rule's to guess at.
    expect(mirrorLockedSize(square, { width: 192, height: 192 })).toEqual(square)
  })

  it("mirrors from a Document that is not square to begin with", () => {
    // Reachable only from a file (the fields keep a locked sheet 1:1), and
    // the rule still reads the typed axis off the Document's own size.
    const odd = { width: 300, height: 200 }
    expect(mirrorLockedSize(odd, { width: 400, height: 200 })).toEqual({
      width: 400,
      height: 400,
    })
    expect(mirrorLockedSize(odd, { width: 300, height: 100 })).toEqual({
      width: 100,
      height: 100,
    })
  })
})
