import { Canvas, Textbox } from "fabric"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createText, fitTextWidth, type TextMeasurer } from "@/fabric/text"
import { wireTextInteractions } from "@/fabric/text-interactions"

/**
 * Text interaction wiring (build spec §6) — driven end-to-end on a real
 * interactive canvas in jsdom: the hidden textarea is a genuine DOM element,
 * so typing, Escape and Ctrl+Enter run through the same listeners the app
 * installs. The session commits as one boundary on exit; Escape reverts;
 * uppercase is forced while the flag is set and the underlying text is kept
 * as the toggle's restore source.
 */

/** The test measurer — 10 px per character (vitest.setup stub). */
const measure: TextMeasurer = (text) => text.length * 10

describe("wireTextInteractions — session lifecycle", () => {
  let canvas: Canvas
  let textbox: Textbox

  beforeEach(() => {
    canvas = new Canvas(document.createElement("canvas"), {
      width: 600,
      height: 600,
    })
    wireTextInteractions(canvas, measure)
    textbox = createText(measure)
    canvas.add(textbox)
    canvas.setActiveObject(textbox)
  })

  afterEach(async () => {
    await canvas.dispose()
  })

  /**
   * Type into the hidden textarea as Fabric's own input path would: the typed
   * string replaces the current selection and the caret lands after it. The
   * app selects all on add, so tests select all before typing — matching the
   * "typing replaces the placeholder" flow.
   */
  function type(value: string): void {
    const ta = textbox.hiddenTextarea
    if (!ta) throw new Error("no textarea — not editing")
    ta.value = value
    ta.selectionStart = ta.selectionEnd = value.length
    ta.dispatchEvent(new Event("input", { bubbles: true }))
  }

  function pressKey(key: string, keyCode: number, extra: KeyboardEventInit = {}): void {
    const ta = textbox.hiddenTextarea
    if (!ta) throw new Error("no textarea — not editing")
    ta.dispatchEvent(
      new KeyboardEvent("keydown", { key, keyCode, bubbles: true, ...extra }),
    )
  }

  /** Enter the session the way the app's add-text flow does: select all. */
  function edit(): void {
    textbox.enterEditing()
    textbox.selectAll()
  }

  it("enters edit pre-selected — the new box is active and in session", () => {
    edit()
    expect(textbox.isEditing).toBe(true)
    expect(textbox.hiddenTextarea).toBeTruthy()
  })

  it("a width-wrap drag (mr/ml — fires resizing, not scaling) hands the width to the user", () => {
    // The wrap handle fires `object:resizing`; auto-fit must stop there, or
    // the next session exit would re-fit over the manual width.
    expect(textbox.autoFit).toBe(true)
    // Only `target` matters to the handler — the rest of the payload shape
    // (pointer, transform, e) is irrelevant here.
    canvas.fire("object:resizing", { target: textbox } as never)
    expect(textbox.autoFit).toBe(false)
  })

  it("commits the session on Ctrl+Enter; auto-fit re-fits the width", () => {
    edit()
    type("hello")
    expect(textbox.text).toBe("hello")
    pressKey("Enter", 13, { ctrlKey: true })
    expect(textbox.isEditing).toBe(false)
    // Auto-fit still set → the width hugs the committed content.
    expect(textbox.width).toBe(
      fitTextWidth(
        "hello",
        {
          fontSize: textbox.fontSize,
          fontFamily: textbox.fontFamily,
          fontWeight: textbox.fontWeight,
          fontStyle: textbox.fontStyle,
        },
        textbox.charSpacing,
        measure,
      ),
    )
  })

  it("auto width while typing: the box re-fits on every keystroke, mid-session", () => {
    edit()
    type("hello")
    // 5 chars × 10 + 2 — grown live, before the session ever exits.
    expect(textbox.width).toBe(52)
    type("hello world")
    expect(textbox.width).toBe(112) // 11 × 10 + 2
    expect(textbox.isEditing).toBe(true) // still typing — no exit re-fit needed
  })

  it("typing never moves the text down — the top edge stays put (regression)", () => {
    edit()
    const topBefore = textbox.getCoords()[0].y
    // Mid-keystroke the text wraps taller at the old width, then the live
    // re-fit shrinks it back — without pinning the top edge, the center
    // anchor would pivot the box down by half the height change.
    type("hello world")
    type("a\nlonger")
    expect(textbox.getCoords()[0].y).toBe(topBefore)
  })

  it("auto width shrinks live when the longest line shortens", () => {
    edit()
    type("hello world")
    expect(textbox.width).toBe(112)
    type("hi")
    expect(textbox.width).toBe(22)
  })

  it("a newline fits to the longest line, not the first", () => {
    edit()
    type("a\nlonger")
    expect(textbox.width).toBe(62) // "longer" → 6 × 10 + 2
  })

  it("typing stops re-fitting once the user owns the width (autoFit off)", () => {
    // The width-wrap drag handed the width over — live re-fit must not fight
    // the manual width, exactly like the exit re-fit.
    canvas.fire("object:resizing", { target: textbox } as never)
    expect(textbox.autoFit).toBe(false)
    edit()
    type("hello world")
    expect(textbox.width).toBe(42) // still the creation width
  })

  it("plain Enter is a newline, not a commit", () => {
    edit()
    type("a\nb")
    pressKey("Enter", 13)
    expect(textbox.isEditing).toBe(true)
    expect(textbox.text).toBe("a\nb")
  })

  it("Escape reverts the session — the pre-session text is restored", () => {
    textbox.set("text", "before")
    edit()
    type("after")
    expect(textbox.text).toBe("after")
    pressKey("Escape", 27)
    expect(textbox.isEditing).toBe(false)
    expect(textbox.text).toBe("before")
  })

  it("Escape reverts the full pre-session state — the auto-fit width and the uppercase source", () => {
    textbox.set("text", "before")
    const width = textbox.width
    expect(textbox.uppercaseSource).toBeUndefined()
    textbox.uppercase = true
    edit()
    type("much longer text than before")
    // Typing re-fits the width live (auto width, §6) and records the source.
    expect(textbox.width).toBeGreaterThan(width)
    expect(textbox.uppercaseSource).toBe("much longer text than before")
    pressKey("Escape", 27)
    expect(textbox.text).toBe("before")
    expect(textbox.width).toBe(width)
    expect(textbox.uppercaseSource).toBeUndefined()
  })

  it("empty-on-exit restores 'Text'", () => {
    textbox.set("text", "before")
    edit()
    type("")
    pressKey("Escape", 27) // revert → back to "before", not "Text"
    expect(textbox.text).toBe("before")
    edit()
    type("")
    pressKey("Enter", 13, { ctrlKey: true }) // commit empty → "Text"
    expect(textbox.text).toBe("Text")
  })

  it("uppercase is forced on every keystroke while the flag is set", () => {
    textbox.uppercase = true
    edit()
    type("hello")
    expect(textbox.text).toBe("HELLO")
    // The underlying typed text is kept as the toggle's restore source.
    expect(textbox.uppercaseSource).toBe("hello")
    pressKey("Escape", 27)
  })

  it("uppercase stops forcing once the flag is off — the typed case is kept", () => {
    // With the flag on, typed case is forced; the committed session keeps it.
    textbox.uppercase = true
    edit()
    type("hello")
    pressKey("Enter", 13, { ctrlKey: true }) // commit
    expect(textbox.text).toBe("HELLO")

    // With the flag off, typed case is kept as-is.
    textbox.uppercase = false
    edit()
    type("world")
    pressKey("Enter", 13, { ctrlKey: true }) // commit
    expect(textbox.text).toBe("world")
  })
})
