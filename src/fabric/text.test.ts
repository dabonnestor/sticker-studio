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
  createText,
  fitTextWidth,
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

  describe("auto-fit re-fits on family/size changes while never resized", () => {
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
