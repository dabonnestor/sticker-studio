import { Textbox, cache } from "fabric"
import { afterEach, describe, expect, it, vi } from "vitest"

import { rerenderOnFontsLoaded } from "@/fabric/fonts"
import { groupObjects } from "@/fabric/groups"
import { createStageCanvas } from "@/fabric/stage-canvas"

// jsdom ships no FontFaceSet — preloadFonts reads document.fonts, so the
// suite installs a stand-in that resolves immediately.
Object.defineProperty(document, "fonts", {
  value: {
    load: vi.fn().mockResolvedValue([]),
    ready: Promise.resolve(),
  },
  configurable: true,
})

/**
 * rerenderOnFontsLoaded (the Stage's mount hook): once every webfont lands,
 * the canvas repaints — and, since a Textbox restored or imported before the
 * fonts resolved was measured with the fallback face, re-measures every text
 * box so its wrapping (and thus its height) matches the real face. The
 * measuring context is Fabric's shared offscreen one — in jsdom, the shared
 * stub — so the tests drive the "font" through its `measureText` mock: wide
 * glyphs (the fallback) wrap the line, narrow glyphs (the real face) fit it.
 */
describe("rerenderOnFontsLoaded — re-measure text with the real faces", () => {
  // The shared measuring context Fabric memoizes — the same singleton the
  // suite's getContext override hands every canvas (a fresh stub would be a
  // context Fabric never measures with).
  const ctx = document.createElement("canvas").getContext("2d")!
  const measure = ctx.measureText as ReturnType<typeof vi.fn>

  afterEach(() => {
    // Restore the stub's default 10 px/char measure for the other suites.
    measure.mockImplementation((text: string) => ({ width: text.length * 10 }))
    cache.clearFontCache()
  })

  it("re-measures a Textbox's wrapping once the fonts land", async () => {
    // The fallback face: wide glyphs — the 522 px box wraps both lines
    // (Fabric's measuring cache scales by fontSize/CACHE_FONT_SIZE, so the
    // mock's 500 px/char is ~80 px effective at 64.44 px — past the box).
    measure.mockImplementation((text: string) => ({ width: text.length * 500 }))
    const canvas = createStageCanvas(
      document.createElement("canvas"),
      document.createElement("canvas"),
    )
    const text = new Textbox("THANK YOU FOR\nNOT SMOKING", {
      fontFamily: "Anton",
      fontSize: 64.44,
      lineHeight: 1.2,
      width: 522,
    })
    canvas.add(text)
    const fallbackHeight = text.height

    // The real face lands: narrow glyphs — both lines fit on one line each.
    // The measuring cache still holds the fallback widths under Anton's key —
    // the fix must clear it, or the re-measure would re-read them.
    measure.mockImplementation((text: string) => ({ width: text.length * 10 }))

    rerenderOnFontsLoaded(canvas)
    await vi.waitFor(() => expect(text.height).toBeLessThan(fallbackHeight))

    // The reference: the same text measured fresh with the narrow face.
    const reference = new Textbox("THANK YOU FOR\nNOT SMOKING", {
      fontFamily: "Anton",
      fontSize: 64.44,
      lineHeight: 1.2,
      width: 522,
    })
    expect(text.height).toBeCloseTo(reference.height, 6) // back to two lines
  })

  it("re-measures a Textbox nested in a group", async () => {
    measure.mockImplementation((text: string) => ({ width: text.length * 500 }))
    const canvas = createStageCanvas(
      document.createElement("canvas"),
      document.createElement("canvas"),
    )
    const text = new Textbox("WRAPPED LINE", {
      fontFamily: "Anton",
      fontSize: 24,
      lineHeight: 1.2,
      width: 100,
    })
    const group = groupObjects(canvas, [text, new Textbox("SIBLING", { width: 100 })])!
    const fallbackHeight = text.height

    measure.mockImplementation((text: string) => ({ width: text.length * 10 }))

    rerenderOnFontsLoaded(canvas)
    await vi.waitFor(() => expect(text.height).toBeLessThan(fallbackHeight))
    expect(group.getObjects()).toContain(text)
  })
})
