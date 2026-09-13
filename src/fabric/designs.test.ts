import { describe, expect, it, vi } from "vitest"

import { parseDesignFile } from "@/fabric/design-file"
import {
  PREDESIGNS,
  loadPredesign,
  type Predesign,
} from "@/fabric/designs"
import { getStickerShape } from "@/fabric/outline"

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

/** The envelope fields these assertions read, before validation or migration. */
interface ShippedEnvelope {
  version: number
  size: { width: number; height: number }
}

/**
 * The shipped files themselves. These are the only real v1 Design files in
 * existence, so they are the honest test of the v1 → v2 migration (map #48) —
 * a fixture written here would only prove the rule against itself.
 */
function shippedFiles(): Array<{
  id: string
  /** The file's text — exactly the bytes the app fetches. */
  text: string
  /** Its raw envelope, ahead of validation and migration. */
  envelope: ShippedEnvelope
}> {
  return Object.entries(SHIPPED_FILES).map(([path, text]) => ({
    id: path.replace(/^.*\//, "").replace(/\.json$/, ""),
    text,
    envelope: JSON.parse(text) as ShippedEnvelope,
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

  it("a v1 Predesign's outline follows its size — the three shipped are Square", () => {
    const v1 = shippedFiles().filter((file) => file.envelope.version === 1)
    expect(v1.length).toBeGreaterThan(0)

    for (const { id, text, envelope } of v1) {
      // No stored outline — the migrator classifies it, mirroring
      // `getShapeKind`: square when width === height, otherwise rectangle.
      expect(getStickerShape(parseDesignFile(text).outline), id).toBe(
        envelope.size.width === envelope.size.height ? "square" : "rectangle",
      )

      // The three shipped are 600×600, so they land as Square (map #48). A
      // *non-square* v1 file would land as a Rectangle and silently lose its
      // intended shape — so an authored oval/circle Predesign has to be
      // written at the current file version with an explicit outline.
      expect(
        envelope.size.width,
        `${id} is not square — author it at the current version, with an outline`,
      ).toBe(envelope.size.height)
    }
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
