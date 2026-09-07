import { describe, expect, it, vi } from "vitest"

import {
  PREDESIGNS,
  loadPredesign,
  type Predesign,
} from "@/fabric/designs"

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
