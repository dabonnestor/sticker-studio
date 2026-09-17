import { describe, expect, it, vi } from "vitest"

import { parseDesignFile } from "@/fabric/design-file"
import {
  PREDESIGNS,
  loadPredesign,
  predesignShape,
  type Predesign,
} from "@/fabric/designs"
import { BOOT_OUTLINE, getStickerShape } from "@/fabric/outline"

/**
 * The predesigns catalog (the sidebar's Designs panel): the ready-made
 * Design files shipped in `public/designs/` — the same envelope a Save writes
 * and an Import reads (ADR 0002). `loadPredesign` is the import path with the
 * file picker replaced by a fetch: it validates loudly (a fetch failure or a
 * malformed file throws with a clear message and nothing is applied) and
 * caches the parsed design per id, so the gallery's preview render and an
 * apply share one fetch.
 */

/** A minimal valid Design file body (the envelope + one known object type). */
function validFileBody(): string {
  return JSON.stringify({
    format: "sticker-studio",
    version: 1,
    size: { width: 600, height: 600 },
    rotation: 0,
    border: { width: 16, color: "#18181B" },
    canvas: { version: "7.4.0", objects: [{ type: "Rect" }] },
  })
}

/** A v2 file body carrying an explicit outline (map #48). */
function outlinedFileBody(
  outline: { outline: string; aspectLocked: boolean },
  size = { width: 600, height: 600 },
): string {
  return JSON.stringify({
    format: "sticker-studio",
    version: 2,
    size,
    rotation: 0,
    outline,
    border: { width: 16, color: "#18181B" },
    canvas: { version: "7.4.0", objects: [{ type: "Rect" }] },
  })
}

/** A fetch stub serving this body — the catalog's injected seam. */
function serve(text: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => text,
  })
}

/** A predesign fixture with a unique id — the module's cache is keyed by id. */
function predesign(id: string): Predesign {
  return { id, name: "Test Design", url: `/designs/${id}.json` }
}

describe("predesigns catalog — the shipped list", () => {
  it("lists one entry per design file in public/designs, each pointing at it", () => {
    expect(PREDESIGNS.length).toBeGreaterThan(0)
    for (const design of PREDESIGNS) {
      expect(design.id).toBeTruthy()
      expect(design.name).toBeTruthy()
      expect(design.url).toBe(`/designs/${design.id}.json`)
    }
  })
})

/**
 * Every shipped design file, read at build time. Vite serves `public/`
 * outside the module graph, so a relative `?raw` glob is the way to reach the
 * bytes from a test.
 */
const SHIPPED_FILES = import.meta.glob("../../public/designs/*.json", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>

/**
 * The shipped files themselves, each with the id the catalog keys it by. The
 * migration these files once exercised now lives in `design-file.test.ts`,
 * which carries its own v1 fixtures — every file here is at the current
 * version.
 */
function shippedFiles(): Array<{
  id: string
  /** The file's text — exactly the bytes the app fetches. */
  text: string
}> {
  return Object.entries(SHIPPED_FILES).map(([path, text]) => ({
    id: path.replace(/^.*\//, "").replace(/\.json$/, ""),
    text,
  }))
}

describe("the shipped design files", () => {
  it("the catalog lists exactly the files that ship", () => {
    expect(shippedFiles().map((file) => file.id).sort()).toEqual(
      PREDESIGNS.map((design) => design.id).sort(),
    )
  })

  it("every one passes the import validation the app runs on load", () => {
    for (const { id, text } of shippedFiles()) {
      expect(() => parseDesignFile(text), id).not.toThrow()
    }
  })

  it("has designs for the boot shape — a fresh session's gallery is never empty", () => {
    // The Designs panel shows only the designs made for the Document's shape
    // (map #48), and a fresh session boots as a Square sticker. If the boot
    // preset and the shipped set ever part ways, the first Designs panel a
    // user opens is bare — a "none yet" state for a shape that has designs,
    // which is exactly the state that must mean "nothing authored".
    const shapes = shippedFiles().map(({ text }) =>
      getStickerShape(parseDesignFile(text).outline),
    )

    expect(shapes).toContain(getStickerShape(BOOT_OUTLINE))
  })
})

describe("predesignShape — the sticker a design is made for", () => {
  it("derives the shape from the design's own envelope", async () => {
    const body = outlinedFileBody(
      { outline: "oval", aspectLocked: false },
      { width: 288, height: 192 },
    )

    await expect(predesignShape(predesign("oval-design"), serve(body))).resolves.toBe(
      "oval",
    )
  })

  it("lets the file's outline outrank its size — a 600×600 design can be a Circle", async () => {
    // The authored non-square case (map #48): once a file carries an outline,
    // the size says nothing about the shape. Reading the shape off the size
    // instead would file this Circle among the Square designs — and an Oval
    // sticker would then offer a design drawn for a circle.
    const body = outlinedFileBody({ outline: "oval", aspectLocked: true })

    await expect(
      predesignShape(predesign("circle-design"), serve(body)),
    ).resolves.toBe("circle")
  })

  it("classifies a v1 file by its size — through the migrator, not a stored outline", async () => {
    await expect(
      predesignShape(predesign("legacy-square"), serve(validFileBody())),
    ).resolves.toBe("square")
  })

  it("shares loadPredesign's cache — the shape costs no second fetch", async () => {
    const fetchFn = serve(validFileBody())
    const design = predesign("shared-load")

    await loadPredesign(design, fetchFn)
    await predesignShape(design, fetchFn)

    expect(fetchFn).toHaveBeenCalledOnce()
  })

  it("throws loudly on a design that cannot be read (ADR 0002)", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 404 })

    await expect(predesignShape(predesign("missing"), fetchFn)).rejects.toThrow(
      "That design couldn't be loaded",
    )
  })
})

describe("loadPredesign — fetch + loud validation", () => {
  it("fetches the design file and parses it as a Design file", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => validFileBody(),
    })

    const design = await loadPredesign(predesign("parse-ok"), fetchFn)

    expect(fetchFn).toHaveBeenCalledOnce()
    expect(fetchFn).toHaveBeenCalledWith("/designs/parse-ok.json")
    expect(design.size).toEqual({ width: 600, height: 600 })
    expect(design.canvas.objects).toEqual([{ type: "Rect" }])
  })

  it("caches the parsed design — a second load never re-fetches", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => validFileBody(),
    })
    const design = predesign("cached")

    await loadPredesign(design, fetchFn)
    await loadPredesign(design, fetchFn)

    expect(fetchFn).toHaveBeenCalledOnce()
  })

  it("throws a clear error when the fetch fails — nothing is applied", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 404 })

    await expect(loadPredesign(predesign("fetch-fail"), fetchFn)).rejects.toThrow(
      "That design couldn't be loaded",
    )
  })

  it("throws the loud validation error on a malformed file (ADR 0002)", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ format: "not-a-design" }),
    })

    await expect(loadPredesign(predesign("bad-file"), fetchFn)).rejects.toThrow(
      "not a Sticker Studio design",
    )
  })
})
