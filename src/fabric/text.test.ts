import { Textbox, util } from "fabric"
import { describe, expect, it } from "vitest"

import { registerCustomProperties } from "@/fabric/custom-properties"
import { createShape } from "@/fabric/shapes"
import {
  FONT_FAMILIES,
  TEXT_DEFAULT_FAMILY,
  TEXT_DEFAULT_FONT_SIZE,
  TEXT_DEFAULT_LINE_HEIGHT,
  TEXT_DEFAULT_STRING,
  TEXT_FILL,
  applyTextProps,
  bakeTextScale,
  createText,
  fitTextWidth,
  fitToContent,
  getBoldWeight,
  isTextObject,
  type TextMeasurer,
  type TextMeasureStyle,
} from "@/fabric/text"
import {
  captureTextSession,
  commitTextSession,
  revertTextSession,
} from "@/fabric/text-interactions"

/**
 * Text model (build spec §6). Text is a Fabric Textbox — a Document object,
 * not a shape: no shape of its own, no cut line (no clipPath). Auto-fit
 * measures the longest line with the injected measurer (the jsdom stub
 * measures 10 px per character, so widths are deterministic); the session
 * commits on exit, reverts on Escape; scaling is uniform (stage-owned).
 */

/** The test measurer — 10 px per character (vitest.setup stub). */
const measure: TextMeasurer = (text) => text.length * 10

/** The default face the fit tests measure against. */
const STYLE: TextMeasureStyle = {
  fontSize: 24,
  fontFamily: "Inter",
  fontWeight: 400,
  fontStyle: "",
}

describe("FONT_FAMILIES — the ten bundled families (§12)", () => {
  it("lists ten families in picker order", () => {
    expect(FONT_FAMILIES.map((s) => s.family)).toEqual([
      "Inter",
      "Work Sans",
      "Barlow",
      "Lora",
      "Playfair Display",
      "Bebas Neue",
      "Anton",
      "Pacifico",
      "Dancing Script",
      "JetBrains Mono",
    ])
  })

  it("static 400-only families are exactly that", () => {
    for (const family of ["Bebas Neue", "Anton", "Pacifico"]) {
      const spec = FONT_FAMILIES.find((s) => s.family === family)!
      expect(spec.weights).toEqual([400])
      expect(spec.italic).toBe(false)
    }
  })
})

describe("getBoldWeight — the Bold toggle's weight (§6)", () => {
  it("resolves every multi-weight family to 700 — the weight nearest CSS bold", () => {
    for (const { family } of FONT_FAMILIES.filter((s) => s.weights.length > 1)) {
      expect(getBoldWeight(family)).toBe(700)
    }
  })

  it("is undefined for static 400-only families — no faux bold", () => {
    for (const family of ["Bebas Neue", "Anton", "Pacifico"]) {
      expect(getBoldWeight(family)).toBeUndefined()
    }
  })

  it("is undefined for families outside the bundle", () => {
    expect(getBoldWeight("Comic Sans")).toBeUndefined()
  })
})

describe("createText — a new text box (§6)", () => {
  it("is a Textbox with the defaults: 'Text', Inter 24, line height 1.2", () => {
    const t = createText()
    expect(t).toBeInstanceOf(Textbox)
    expect(t.text).toBe(TEXT_DEFAULT_STRING)
    expect(t.fontFamily).toBe(TEXT_DEFAULT_FAMILY)
    expect(t.fontSize).toBe(TEXT_DEFAULT_FONT_SIZE)
    expect(t.lineHeight).toBe(TEXT_DEFAULT_LINE_HEIGHT)
    expect(t.fill).toBe(TEXT_FILL)
  })

  it("is not a shape — no cut line (no clipPath)", () => {
    expect(createText().clipPath).toBeUndefined()
  })

  it("starts auto-fit on, uppercase off, with the document identity", () => {
    const t = createText()
    expect(t.autoFit).toBe(true)
    expect(t.uppercase).toBe(false)
    expect(t.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(t.locked).toBe(false)
  })

  it("auto-fits the width to the content at creation when a measurer is given", () => {
    // "Text" measures 40 px (4 chars × 10) + 2 breathing room.
    const t = createText(measure)
    expect(t.width).toBe(42)
  })

  it("is classified as a text object; shapes are not", () => {
    expect(isTextObject(createText())).toBe(true)
    expect(isTextObject(createShape("square"))).toBe(false)
    expect(isTextObject(null)).toBe(false)
  })
})

describe("fitTextWidth — auto-fit measures the longest line (§6)", () => {
  it("measures the longest line across newlines", () => {
    expect(fitTextWidth("AB\nCDEF", STYLE, 0, measure)).toBe(42) // CDEF → 40 + 2
  })

  it("rounds up and adds breathing room", () => {
    expect(fitTextWidth("ABC", STYLE, 0, measure)).toBe(32) // 30 + 2
  })

  it("is empty-text safe", () => {
    expect(fitTextWidth("", STYLE, 0, measure)).toBe(2) // 0 + 2
  })

  it("re-fitting never moves the box — the top edge is pinned (regression)", () => {
    const t = createText(measure) // "Text" → 42 wide
    t.set({ left: 100, top: 50 })
    t.set("text", "hello world") // wider than 42 → wraps, box grows taller
    t.setCoords()
    const topBefore = t.getCoords()[0].y
    fitToContent(t, measure) // shrinks the height back — top must not pivot
    expect(t.getCoords()[0].y).toBe(topBefore)
  })

  it("folds letter spacing into the width — a gap per character", () => {
    // charSpacing 100 = 0.1 em = 2.4 px at 24 px; "ABC" has 2 gaps:
    // 30 + 2 × 2.4 + 2 = 36.8 → 37.
    expect(fitTextWidth("ABC", STYLE, 100, measure)).toBe(37)
  })

  it("measures in the object's face — weight and italic are part of it", () => {
    const bold = measure("ABC", { ...STYLE, fontWeight: 800 })
    expect(fitTextWidth("ABC", { ...STYLE, fontWeight: 800 }, 0, measure)).toBe(
      Math.ceil(bold + 2),
    )
  })
})

describe("applyTextProps — the nine properties (§6)", () => {
  it("applies family, size, weight, italic, underline, alignment, line height, spacing", () => {
    const t = createText()
    applyTextProps(t, {
      fontFamily: "Lora",
      fontSize: 32,
      fontWeight: 700,
      fontStyle: "italic",
      underline: true,
      textAlign: "center",
      lineHeight: 1.5,
      charSpacing: 120,
    })
    expect(t.fontFamily).toBe("Lora")
    expect(t.fontSize).toBe(32)
    expect(t.fontWeight).toBe(700)
    expect(t.fontStyle).toBe("italic")
    expect(t.underline).toBe(true)
    expect(t.textAlign).toBe("center")
    expect(t.lineHeight).toBe(1.5)
    expect(t.charSpacing).toBe(120)
  })

  it("sets the text color — the object's fill", () => {
    const t = createText()
    applyTextProps(t, { fillColor: "#ff0000" })
    expect(t.fill).toBe("#ff0000")
  })

  it("marks the object dirty — the cached render is invalidated (regression)", () => {
    const t = createText()
    t.dirty = false
    applyTextProps(t, { fontSize: 30 })
    expect(t.dirty).toBe(true)
  })

  describe("uppercase — two-way toggle", () => {
    it("turning the flag on uppercases the stored string and saves the source", () => {
      const t = createText()
      t.set("text", "hello sticker")
      applyTextProps(t, { uppercase: true })
      expect(t.text).toBe("HELLO STICKER")
      expect(t.uppercaseSource).toBe("hello sticker")
    })

    it("turning the flag off restores the original case", () => {
      const t = createText()
      t.set("text", "hello sticker")
      applyTextProps(t, { uppercase: true })
      applyTextProps(t, { uppercase: false })
      expect(t.text).toBe("hello sticker")
      expect(t.uppercaseSource).toBeUndefined()
    })

    it("turning the flag on again re-uppercases from the restored base", () => {
      const t = createText()
      t.set("text", "hello sticker")
      applyTextProps(t, { uppercase: true })
      applyTextProps(t, { uppercase: false })
      applyTextProps(t, { uppercase: true })
      expect(t.text).toBe("HELLO STICKER")
      expect(t.uppercaseSource).toBe("hello sticker")
    })

    it("turning the flag off without a source leaves the text alone", () => {
      const t = createText()
      t.set("text", "HELLO STICKER") // already upper, never forced — no source
      applyTextProps(t, { uppercase: true })
      applyTextProps(t, { uppercase: false })
      expect(t.text).toBe("HELLO STICKER")
    })
  })

  describe("real faces only — weight/italic snap on family change", () => {
    it("snaps an unavailable weight down to 400", () => {
      const t = createText()
      applyTextProps(t, { fontWeight: 800 })
      applyTextProps(t, { fontFamily: "Bebas Neue" })
      expect(t.fontFamily).toBe("Bebas Neue")
      expect(t.fontWeight).toBe(400)
    })

    it("keeps a weight the new family bundles", () => {
      const t = createText()
      applyTextProps(t, { fontWeight: 700 })
      applyTextProps(t, { fontFamily: "Barlow" })
      expect(t.fontWeight).toBe(700)
    })

    it("snaps italic off for families without an italic face", () => {
      const t = createText()
      applyTextProps(t, { fontStyle: "italic" })
      applyTextProps(t, { fontFamily: "Dancing Script" })
      expect(t.fontStyle).toBe("normal")
    })
  })

  describe("auto-fit re-fits on family/size/letter-spacing changes while never resized", () => {
    it("re-fits the width when the size changes", () => {
      const t = createText(measure) // "Text" → 42
      applyTextProps(t, { fontSize: 48 }, measure)
      // The stub measurer is size-agnostic, so the re-fit lands back at 42 —
      // the point is the width was re-measured at the new size, not stale.
      expect(t.width).toBe(42)
    })

    it("re-fits the width when the family changes", () => {
      const t = createText(measure)
      applyTextProps(t, { fontFamily: "Lora" }, measure)
      expect(t.width).toBe(fitTextWidth(t.text, { ...STYLE, fontFamily: "Lora" }, 0, measure))
    })

    it("re-fits the width when the letter spacing changes", () => {
      const t = createText(measure)
      t.set("text", "ABC")
      fitToContent(t, measure) // 3 × 10 + 2 = 32
      applyTextProps(t, { charSpacing: 100 }, measure)
      // The spacing widens the measured longest line, gap per character:
      // 30 + 2 × 2.4 (0.1 em at 24 px) + 2 = 36.8 → 37.
      expect(t.width).toBe(37)
    })
  })

  describe("the re-fit grows from the alignment edge, never the center (§6)", () => {
    it("left-aligned text keeps its left edge — the box grows right, not left", () => {
      const t = createText(measure)
      t.set("text", "ABC")
      fitToContent(t, measure) // 32 wide
      t.set({ left: 100, top: 100 })
      t.setCoords()
      const leftEdge = t.getPositionByOrigin("left", "top").x
      applyTextProps(t, { charSpacing: 100 }, measure) // re-fits to 37 — Δ5
      expect(t.width).toBe(37)
      // Center-anchored re-pin would walk the left edge left by ΔW/2 = 2.5.
      expect(t.getPositionByOrigin("left", "top").x).toBe(leftEdge)
    })

    it("centered text keeps its center — the grow is symmetric", () => {
      const t = createText(measure)
      t.set("text", "ABC")
      fitToContent(t, measure)
      t.set({ left: 100, top: 100, textAlign: "center" })
      t.setCoords()
      const center = t.getPositionByOrigin("center", "top").x
      applyTextProps(t, { charSpacing: 100 }, measure)
      expect(t.getPositionByOrigin("center", "top").x).toBe(center)
    })

    it("right-aligned text keeps its right edge — the grow is leftward", () => {
      const t = createText(measure)
      t.set("text", "ABC")
      fitToContent(t, measure)
      t.set({ left: 100, top: 100, textAlign: "right" })
      t.setCoords()
      const rightEdge = t.getPositionByOrigin("right", "top").x
      applyTextProps(t, { charSpacing: 100 }, measure)
      expect(t.getPositionByOrigin("right", "top").x).toBe(rightEdge)
    })

    it("a patch that changes the alignment re-anchors to the new side", () => {
      const t = createText(measure)
      t.set("text", "ABC")
      fitToContent(t, measure)
      t.set({ left: 100, top: 100 })
      t.setCoords()
      const centerBefore = t.getPositionByOrigin("center", "top").x
      applyTextProps(t, { textAlign: "center", charSpacing: 100 }, measure)
      // The box centered itself where it stood — the alignment set landed
      // before the anchor capture, then the re-fit grew from the center.
      expect(t.getPositionByOrigin("center", "top").x).toBe(centerBefore)
    })
  })
})

describe("top-edge pinning — property commits never nudge the box (§6)", () => {
  it("keeps the top edge across a family change that re-wraps the box", () => {
    // Family-sensitive widths (Pacifico measures half of Inter): switching
    // to a wider family re-wraps the 2-line box against the old width
    // (4 lines) before the re-fit — without the pin, the center-anchored
    // box pivots and the text walks up by Δh/2. The shared stub context is
    // mutated (and restored) so Fabric's own per-char measurement agrees
    // with the injected measurer. Widths are proportional to the measuring
    // font size — Fabric measures glyphs at its 400 px cache size and
    // scales by fontSize/400, so a linear per-character stub would never
    // re-wrap.
    const ctx = document.createElement("canvas").getContext("2d")!
    const original = ctx.measureText
    const perChar = (family: string | undefined) => (family === "Pacifico" ? 2000 : 4000)
    ctx.measureText = ((text: string) => {
      const family = /\b(Inter|Pacifico)\b/.exec(ctx.font)?.[1]
      const size = /(\d+)px/.exec(ctx.font)?.[1]
      return { width: text.length * perChar(family) * (Number(size) / 400) } as TextMetrics
    }) as typeof ctx.measureText
    try {
      const familyMeasure: TextMeasurer = (text, style) =>
        text.length * perChar(style.fontFamily) * (style.fontSize / 400)
      const t = createText(familyMeasure)
      t.set("text", "line one\nline two")
      fitToContent(t, familyMeasure) // Inter → 1922 px, 2 lines
      applyTextProps(t, { fontFamily: "Pacifico" }, familyMeasure) // narrower → 962 px
      const topBefore = t.getCoords()[0].y
      applyTextProps(t, { fontFamily: "Inter" }, familyMeasure) // re-wraps at 962, fits to 1922
      expect(t.getCoords()[0].y).toBe(topBefore)
    } finally {
      ctx.measureText = original
    }
  })

  it("keeps the top edge across a size change that pivots the height", () => {
    const t = createText(measure)
    t.set("text", "line one\nline two")
    fitToContent(t, measure)
    const topBefore = t.getCoords()[0].y
    applyTextProps(t, { fontSize: 48 }, measure)
    expect(t.getCoords()[0].y).toBe(topBefore)
  })
})

describe("bakeTextScale — a corner drag folds into the font size (§6)", () => {
  it("bakes a uniform scale into the size and width, and resets the transform", () => {
    const t = createText(measure)
    t.set("text", "hello")
    fitToContent(t, measure) // width 52
    t.set({ scaleX: 2, scaleY: 2 })
    bakeTextScale(t)
    expect(t.fontSize).toBe(TEXT_DEFAULT_FONT_SIZE * 2)
    expect(t.width).toBe(104)
    expect(t.scaleX).toBe(1)
    expect(t.scaleY).toBe(1)
  })

  it("re-hugs the content at the folded size while auto-fit is set", () => {
    // A corner scale is a size change — scaling "hello" (width 52) down to
    // half would leave the proportional width (26) short of the text at the
    // folded size; the box re-measures and hugs the content instead.
    const t = createText(measure)
    t.set("text", "hello")
    fitToContent(t, measure) // width 52
    t.set({ scaleX: 0.5, scaleY: 0.5 })
    bakeTextScale(t, measure)
    expect(t.fontSize).toBe(12)
    expect(t.width).toBe(52)
    expect(t.scaleX).toBe(1)
    expect(t.scaleY).toBe(1)
  })

  it("a wrap box keeps its manual width, scaled — no re-hug over the handoff", () => {
    // The width-wrap drag handed the width over (autoFit off): the bake
    // scales the manual width proportionally and never re-fits over it.
    const t = createText(measure)
    t.autoFit = false
    t.set("width", 200)
    t.set({ scaleX: 0.5, scaleY: 0.5 })
    bakeTextScale(t, measure)
    expect(t.fontSize).toBe(12)
    expect(t.width).toBe(100)
    expect(t.autoFit).toBe(false)
  })

  it("rounds the baked size to integer px — the toolbar's readout stays clean", () => {
    const t = createText(measure)
    t.set("text", "hello")
    t.set({ scaleX: 1.37, scaleY: 1.37 })
    bakeTextScale(t)
    expect(t.fontSize).toBe(Math.round(24 * 1.37))
    expect(t.scaleX).toBe(1)
  })

  it("is a no-op at scale 1 — moves, rotations, and session exits pass through", () => {
    const t = createText(measure)
    const fontSize = t.fontSize
    const width = t.width
    t.set({ scaleX: 1, scaleY: 1 })
    bakeTextScale(t)
    expect(t.fontSize).toBe(fontSize)
    expect(t.width).toBe(width)
  })

  it("keeps the top edge pinned across the re-measure", () => {
    // The creation-fitted box: "Text" at width 42, one line. Doubling the
    // size re-measures the height (the center anchor would pivot the box by
    // Δh/2 without the pin).
    const t = createText(measure)
    t.set({ scaleX: 2, scaleY: 2 })
    t.setCoords() // a real drag refreshes the coords on every tick
    const topBefore = t.getCoords()[0].y
    bakeTextScale(t)
    expect(t.getCoords()[0].y).toBe(topBefore)
    expect(t.width).toBe(84)
  })

  it("uses the geometric mean — a text folded out of a scaled group can decompose per-axis", () => {
    const t = createText(measure)
    t.set("text", "hello")
    // A fold can leave the axes unequal (a rotated group matrix decomposes
    // per-axis); the mean preserves the glyph area.
    t.set({ scaleX: 2, scaleY: 8 })
    bakeTextScale(t)
    expect(t.fontSize).toBe(96) // √(2·8) = 4 → 24 × 4
    expect(t.scaleX).toBe(1)
    expect(t.scaleY).toBe(1)
  })

  it("treats a mirrored axis as a magnitude — a flipped fold bakes the same size", () => {
    const t = createText(measure)
    t.set("text", "hello")
    t.set({ scaleX: -2, scaleY: 2 }) // a group flip folded into the child
    bakeTextScale(t)
    expect(t.fontSize).toBe(48)
    expect(t.scaleX).toBe(1)
    expect(t.scaleY).toBe(1)
  })
})

describe("text session — one interaction boundary (§6)", () => {
  it("captures the pre-session text and styles", () => {
    const t = createText()
    t.set("text", "before")
    const state = captureTextSession(t)
    expect(state).toMatchObject({ text: "before", revert: false })
    expect(state.styles).toEqual({})
  })

  describe("commit", () => {
    it("empty-on-exit restores 'Text'", () => {
      const t = createText()
      t.set("text", "")
      commitTextSession(t, measure)
      expect(t.text).toBe(TEXT_DEFAULT_STRING)
    })

    it("forces the uppercase flag on the committed string", () => {
      const t = createText()
      t.uppercase = true
      t.set("text", "hello")
      commitTextSession(t, measure)
      expect(t.text).toBe("HELLO")
    })

    it("re-fits the width while auto-fit is still set", () => {
      const t = createText(measure)
      t.set("text", "hello")
      commitTextSession(t, measure)
      expect(t.width).toBe(52) // 5 chars × 10 + 2
      expect(t.autoFit).toBe(true)
    })
  })

  describe("revert (Escape)", () => {
    it("restores the pre-session text and styles", () => {
      const t = createText()
      t.set("text", "before")
      const state = captureTextSession(t)
      t.set("text", "after")
      revertTextSession(t, state)
      expect(t.text).toBe("before")
    })

    it("keeps the top edge across the restore — the box does not pivot (§6)", () => {
      // The session grew the box (2 lines); reverting to the short
      // pre-session text shrinks it — without the pin, the center-anchored
      // box pivots and the text walks down by Δh/2.
      const t = createText(measure)
      t.set({ left: 100, top: 200 })
      t.setCoords()
      const state = captureTextSession(t) // pre-session: "Text", one line
      t.set("text", "line one\nline two")
      fitToContent(t, measure)
      const topBefore = t.getCoords()[0].y
      revertTextSession(t, state)
      expect(t.getCoords()[0].y).toBe(topBefore)
    })

    it("pins the alignment edge across the restore — no half-width nudge (§6)", () => {
      // The session's live re-fits pinned the left edge (left-aligned text),
      // so the restore must put it back exactly there. Re-pinning the
      // center-anchored box's middle instead walks the text right by
      // ΔW/2 — the more text typed, the farther the nudge.
      const t = createText(measure)
      t.set({ left: 100, top: 100 })
      t.setCoords()
      const state = captureTextSession(t) // pre-session: "Text", 42 wide
      t.set("text", "much longer text than before")
      fitToContent(t, measure)
      const edgeBefore = t.getPositionByOrigin("left", "top")
      revertTextSession(t, state)
      expect(t.text).toBe("Text")
      expect(t.getPositionByOrigin("left", "top")).toEqual(edgeBefore)
    })
  })
})

describe("round-trip (§6, ADR 0002)", () => {
  it("serializes and revives text, flags and identity", async () => {
    registerCustomProperties()
    const t = createText(measure)
    t.set("text", "hello")
    t.uppercase = true
    t.uppercaseSource = "hello"
    t.fontWeight = 700

    const revived = (await util.enlivenObjects([t.toObject()]))[0] as Textbox

    expect(revived.id).toBe(t.id)
    expect(revived.locked).toBe(false)
    expect(revived.text).toBe("hello")
    expect(revived.uppercase).toBe(true)
    expect(revived.uppercaseSource).toBe("hello")
    expect(revived.autoFit).toBe(true)
    expect(revived.fontFamily).toBe(TEXT_DEFAULT_FAMILY)
    expect(revived.fontSize).toBe(TEXT_DEFAULT_FONT_SIZE)
    expect(revived.fontWeight).toBe(700)
  })

  it("never serializes view state — no selection or editing leftovers", () => {
    const t = createText()
    const obj = t.toObject() as unknown as Record<string, unknown>
    expect(obj.type).toBe("Textbox")
    expect(obj).not.toHaveProperty("isEditing")
    expect(obj).not.toHaveProperty("selected")
  })
})
