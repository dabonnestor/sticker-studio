import { Textbox, cache } from "fabric"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  FONT_LOAD_TIMEOUT_MS,
  collectCanvasFontFaces,
  collectUsedFontFaces,
  fontCommitWarning,
  fontExportWarning,
  fontFallbackNotice,
  getTextMeasurer,
  healFontsOnArrival,
  loadFontFaces,
  resetFontLoadTestState,
  resolveTextFace,
  type FontFaceSpec,
} from "@/fabric/fonts"
import { groupObjects } from "@/fabric/groups"
import { createStageCanvas } from "@/fabric/stage-canvas"
import { fitToContent } from "@/fabric/text"

/**
 * The font engine (map #71): per-face loading with a bounded await, the
 * arrival fix-up, the used-face collectors, and the §9 wordings. jsdom ships
 * no FontFaceSet — the suite installs a mutable stand-in and the tests drive
 * the "network" through it: resolve a loaded face, resolve an errored one,
 * reject, or hang. The measuring side is driven through the shared canvas
 * stub in vitest.setup.ts (its `measureText` is the mock): wide glyphs stand
 * for the fallback face, narrow glyphs for the real one.
 */

/** What `document.fonts.load` resolves with for a face that loaded. */
const LOADED_FACE = { status: "loaded" } as FontFace
/** What it resolves with for a face whose download failed. */
const ERRORED_FACE = { status: "error" } as FontFace

/** The FontFaceSet stand-in — `load` succeeds by default; tests swap it. */
const fontSet = {
  load: vi.fn<(descriptor: string) => Promise<FontFace[]>>(async () => [LOADED_FACE]),
  ready: Promise.resolve(),
}

Object.defineProperty(document, "fonts", {
  value: fontSet,
  configurable: true,
})

/** The shared measuring context — the same singleton Fabric memoizes. */
const ctx = document.createElement("canvas").getContext("2d")!
const measure = ctx.measureText as ReturnType<typeof vi.fn>

/** The Anton 400 normal face — the tests' arrived face. */
const ANTON: FontFaceSpec = { family: "Anton", weight: 400, style: "normal" }

/** A stage canvas with the default measuring stub, like the Stage's own. */
function makeCanvas(): ReturnType<typeof createStageCanvas> {
  return createStageCanvas(document.createElement("canvas"), document.createElement("canvas"))
}

beforeEach(() => {
  resetFontLoadTestState()
  fontSet.load.mockReset()
  fontSet.load.mockImplementation(async () => [LOADED_FACE])
})

afterEach(() => {
  // Restore the stub's default 10 px/char measure for the other suites.
  measure.mockImplementation((text: string) => ({ width: text.length * 10 }))
  cache.clearFontCache()
})

describe("loadFontFaces — per-face requests", () => {
  it("requests the exact face — weight and style in the descriptor", async () => {
    const failed = await loadFontFaces(null, [
      { family: "Barlow", weight: 700, style: "italic" },
      { family: "Inter", weight: 400, style: "normal" },
    ])
    expect(failed).toEqual([])
    // One file per face — the italic static weight, the variable normal.
    expect(fontSet.load).toHaveBeenCalledWith('italic 700 24px "Barlow"')
    expect(fontSet.load).toHaveBeenCalledWith('400 24px "Inter"')
    expect(fontSet.load).toHaveBeenCalledTimes(2)
  })

  it("dedupes duplicate faces and joins a fulfilled memo on the next touch", async () => {
    await loadFontFaces(null, [ANTON, ANTON])
    expect(fontSet.load).toHaveBeenCalledTimes(1)

    // A second touch with the same face joins the fulfilled memo — no probe.
    const failed = await loadFontFaces(null, [ANTON])
    expect(failed).toEqual([])
    expect(fontSet.load).toHaveBeenCalledTimes(1)
  })

  it("reports failed families in first-use order, deduped by family", async () => {
    fontSet.load.mockImplementation(async (descriptor) =>
      descriptor.includes("Pacifico") ? [] : [LOADED_FACE],
    )
    const failed = await loadFontFaces(null, [
      { family: "Pacifico", weight: 400, style: "normal" },
      ANTON,
      { family: "Pacifico", weight: 400, style: "normal" },
      { family: "Pacifico", weight: 400, style: "italic" },
    ])
    expect(failed).toEqual(["Pacifico"])
  })

  it("reads an empty match, an errored face, and a rejected load as failure — never throws", async () => {
    fontSet.load.mockResolvedValueOnce([])
    await expect(loadFontFaces(null, [ANTON])).resolves.toEqual(["Anton"])

    fontSet.load.mockResolvedValueOnce([ERRORED_FACE])
    await expect(loadFontFaces(null, [ANTON])).resolves.toEqual(["Anton"])

    fontSet.load.mockRejectedValueOnce(new Error("offline"))
    await expect(loadFontFaces(null, [ANTON])).resolves.toEqual(["Anton"])
  })

  it("evicts a failure — the next explicit touch retries the face", async () => {
    fontSet.load.mockImplementationOnce(async () => [])
    expect(await loadFontFaces(null, [ANTON])).toEqual(["Anton"])

    // No negative cache: the retry probes again, and this time it lands.
    expect(await loadFontFaces(null, [ANTON])).toEqual([])
    expect(fontSet.load).toHaveBeenCalledTimes(2)
  })
})

describe("loadFontFaces — the bound", () => {
  it("resolves at the bound when a probe hangs — the caller proceeds", async () => {
    fontSet.load.mockImplementation(() => new Promise(() => {}))
    const started = Date.now()
    const failed = await loadFontFaces(null, [ANTON], 25)
    expect(failed).toEqual(["Anton"])
    expect(Date.now() - started).toBeGreaterThanOrEqual(20)
    // The bound is the app-level constant, ten seconds (§9).
    expect(FONT_LOAD_TIMEOUT_MS).toBe(10_000)
  })

  it("heals the canvas when a hung face arrives after the bound", async () => {
    measure.mockImplementation((text: string) => ({ width: text.length * 500 }))
    const canvas = makeCanvas()
    const text = new Textbox("LATE ARRIVAL", {
      fontFamily: "Anton",
      fontSize: 24,
      lineHeight: 1.2,
      width: 40,
    })
    canvas.add(text)
    const fallbackHeight = text.height

    let land!: (faces: FontFace[]) => void
    fontSet.load.mockImplementation(() => new Promise((resolve) => (land = resolve)))

    // Past the bound the face reads as failed and the caller proceeds…
    expect(await loadFontFaces(canvas, [ANTON], 20)).toEqual(["Anton"])

    // …but the fix-up is still attached to the probe: it lands late, heals.
    measure.mockImplementation((text: string) => ({ width: text.length * 10 }))
    land([LOADED_FACE])
    await vi.waitFor(() => expect(text.height).toBeLessThan(fallbackHeight))
  })
})

describe("the arrival fix-up — re-measure with the real faces", () => {
  it("re-measures a restored Textbox's wrapping once its face lands", async () => {
    // The fallback face: wide glyphs — the 522 px box wraps both lines
    // (Fabric's measuring cache scales by fontSize/CACHE_FONT_SIZE, so the
    // mock's 500 px/char is ~80 px effective at 64.44 px — past the box).
    measure.mockImplementation((text: string) => ({ width: text.length * 500 }))
    const canvas = makeCanvas()
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
    // the fix-up must clear it, or the re-measure would re-read them.
    measure.mockImplementation((text: string) => ({ width: text.length * 10 }))

    const failed = await loadFontFaces(canvas, [ANTON])
    expect(failed).toEqual([])
    expect(text.height).toBeLessThan(fallbackHeight)

    // The reference: the same text measured fresh with the narrow face.
    const reference = new Textbox("THANK YOU FOR\nNOT SMOKING", {
      fontFamily: "Anton",
      fontSize: 64.44,
      lineHeight: 1.2,
      width: 522,
    })
    expect(text.height).toBeCloseTo(reference.height, 6) // back to two lines
  })

  it("re-measures a Textbox nested in a group and re-fits the group", async () => {
    measure.mockImplementation((text: string) => ({ width: text.length * 500 }))
    const canvas = makeCanvas()
    const text = new Textbox("WRAPPED LINE", {
      fontFamily: "Anton",
      fontSize: 24,
      lineHeight: 1.2,
      width: 100,
    })
    const group = groupObjects(canvas, [text, new Textbox("SIBLING", { width: 100 })])!
    const fallbackHeight = text.height

    measure.mockImplementation((text: string) => ({ width: text.length * 10 }))

    await loadFontFaces(canvas, [ANTON])
    expect(text.height).toBeLessThan(fallbackHeight)
    expect(group.getObjects()).toContain(text)
  })

  it("re-fits an autoFit box's width to the real face's metrics", async () => {
    measure.mockImplementation((text: string) => ({ width: text.length * 500 }))
    const canvas = makeCanvas()
    const text = new Textbox("AUTO", { fontFamily: "Anton", fontSize: 24 })
    // A box that hugged the fallback face — the app's auto-fit state.
    text.autoFit = true
    fitToContent(text, getTextMeasurer())
    const fallbackWidth = text.width
    canvas.add(text)

    measure.mockImplementation((text: string) => ({ width: text.length * 10 }))
    await loadFontFaces(canvas, [ANTON])
    // The real metric fit: 4 chars × 10 px + the two-pixel hair (fitTextWidth).
    expect(text.width).toBe(42)
    expect(text.width).toBeLessThan(fallbackWidth)
  })

  it("skips a live text session — its own re-fit settles at session exit", () => {
    measure.mockImplementation((text: string) => ({ width: text.length * 500 }))
    const canvas = makeCanvas()
    const text = new Textbox("LIVE", { fontFamily: "Anton", fontSize: 24 })
    text.autoFit = true
    fitToContent(text, getTextMeasurer())
    const fallbackWidth = text.width
    canvas.add(text)

    text.isEditing = true
    measure.mockImplementation((text: string) => ({ width: text.length * 10 }))
    healFontsOnArrival(canvas, ["Anton"])
    expect(text.width).toBe(fallbackWidth)
  })

  it("is scoped — only the arrived family's texts are re-measured", () => {
    measure.mockImplementation((text: string) => ({ width: text.length * 500 }))
    const canvas = makeCanvas()
    // A word pair — Fabric's Textbox wraps at spaces, not inside a word.
    const anton = new Textbox("SCOPED TEXT", { fontFamily: "Anton", fontSize: 24, width: 60 })
    const inter = new Textbox("SCOPED TEXT", { fontFamily: "Inter", fontSize: 24, width: 60 })
    canvas.add(anton, inter)
    const antonFallback = anton.height
    const interFallback = inter.height

    measure.mockImplementation((text: string) => ({ width: text.length * 10 }))
    healFontsOnArrival(canvas, ["Anton"])
    expect(anton.height).toBeLessThan(antonFallback)
    // Inter did not arrive — its fallback-measured box is untouched.
    expect(inter.height).toBe(interFallback)
  })

  it("one failed family never skips the fix-up for the family that arrived", async () => {
    measure.mockImplementation((text: string) => ({ width: text.length * 500 }))
    const canvas = makeCanvas()
    const text = new Textbox("SURVIVOR WORD", {
      fontFamily: "Anton",
      fontSize: 24,
      width: 60,
    })
    canvas.add(text)
    const fallbackHeight = text.height

    fontSet.load.mockImplementation(async (descriptor) => {
      if (descriptor.includes("Pacifico")) throw new Error("404")
      return [LOADED_FACE]
    })
    measure.mockImplementation((text: string) => ({ width: text.length * 10 }))

    const failed = await loadFontFaces(canvas, [
      { family: "Pacifico", weight: 400, style: "normal" },
      ANTON,
    ])
    expect(failed).toEqual(["Pacifico"])
    // The arrived family healed despite the sibling failure (allSettled).
    expect(text.height).toBeLessThan(fallbackHeight)
  })
})

describe("collectUsedFontFaces", () => {
  it("walks top level and groups, dedupes triples, snaps to real faces", () => {
    const faces = collectUsedFontFaces({
      objects: [
        { type: "Rect" },
        { type: "Textbox", fontFamily: "Work Sans" },
        {
          type: "Group",
          objects: [
            { type: "Textbox", fontFamily: "Work Sans" },
            {
              type: "Textbox",
              fontFamily: "Barlow",
              fontWeight: 700,
              fontStyle: "italic",
            },
            // Beyond the real set — snaps to the face that really renders.
            { type: "Textbox", fontFamily: "Anton", fontWeight: 700, fontStyle: "italic" },
            // Outside the bundle — passes through, the probe warns.
            { type: "Textbox", fontFamily: "Comic Sans", fontWeight: 400 },
          ],
        },
      ],
    })
    expect(faces).toEqual([
      { family: "Work Sans", weight: 400, style: "normal" },
      { family: "Barlow", weight: 700, style: "italic" },
      { family: "Anton", weight: 400, style: "normal" },
      { family: "Comic Sans", weight: 400, style: "normal" },
    ])
  })

  it("returns an empty list when no text is in the document", () => {
    expect(collectUsedFontFaces({ objects: [{ type: "Rect" }] })).toEqual([])
    expect(collectUsedFontFaces({})).toEqual([])
  })
})

describe("collectCanvasFontFaces", () => {
  it("reads the live canvas's text objects — groups included, deduped", () => {
    const canvas = makeCanvas()
    canvas.add(new Textbox("TOP", { fontFamily: "Lora", fontWeight: 600 }))
    const child = new Textbox("CHILD", { fontFamily: "Lora", fontWeight: 600 })
    groupObjects(canvas, [
      child,
      new Textbox("SIBLING", { width: 10, fontFamily: "Anton" }),
    ])
    canvas.add(new Textbox("DUP", { fontFamily: "Lora", fontWeight: 600 }))

    expect(collectCanvasFontFaces(canvas)).toEqual([
      { family: "Lora", weight: 600, style: "normal" },
      { family: "Anton", weight: 400, style: "normal" },
    ])
  })
})

describe("resolveTextFace", () => {
  it("computes the post-patch face without mutating the object", () => {
    const text = new Textbox("Text", { fontFamily: "Inter", fontWeight: 700, fontStyle: "italic" })
    expect(resolveTextFace(text, { fontFamily: "Anton" })).toEqual({
      family: "Anton",
      weight: 400,
      style: "normal",
    })
    expect(text.fontFamily).toBe("Inter")
    expect(text.fontWeight).toBe(700)
    expect(text.fontStyle).toBe("italic")
  })

  it("keeps the current face when the patch doesn't touch it", () => {
    const text = new Textbox("Text", { fontFamily: "Inter", fontWeight: 700, fontStyle: "italic" })
    expect(resolveTextFace(text, { fontSize: 48 })).toEqual({
      family: "Inter",
      weight: 700,
      style: "italic",
    })
    expect(resolveTextFace(text, { fontWeight: 400 })).toEqual({
      family: "Inter",
      weight: 400,
      style: "italic",
    })
    expect(resolveTextFace(text, { fontStyle: "normal" })).toEqual({
      family: "Inter",
      weight: 700,
      style: "normal",
    })
  })

  it("snaps a stale weight and passes unknown families through", () => {
    // Barlow bundles 400/600/700/900 — not 500.
    const barlow = new Textbox("Text", { fontFamily: "Barlow", fontWeight: 500 })
    expect(resolveTextFace(barlow, {})).toEqual({
      family: "Barlow",
      weight: 400,
      style: "normal",
    })
    const unknown = new Textbox("Text", { fontFamily: "Comic Sans", fontWeight: 700 })
    expect(resolveTextFace(unknown, {})).toEqual({
      family: "Comic Sans",
      weight: 700,
      style: "normal",
    })
  })
})

describe("the §9 wordings", () => {
  it("names the commit warning (family — using a fallback font)", () => {
    expect(fontCommitWarning("Anton")).toBe("Anton couldn't be loaded — using a fallback font")
  })

  it("sums the restore/import notice — plural and singular", () => {
    expect(fontFallbackNotice(["Anton"])).toBe("Couldn't load Anton — using a fallback")
    expect(fontFallbackNotice(["Anton", "Pacifico"])).toBe(
      "Couldn't load 2 fonts — using fallbacks (Anton, Pacifico)",
    )
  })

  it("keeps the export warning's existing shape", () => {
    expect(fontExportWarning(["Anton"])).toBe(
      "Some fonts couldn't be loaded — exported with fallback rendering (Anton)",
    )
  })
})
