import { describe, expect, it, vi } from "vitest"

import {
  createCatalog,
  CatalogError,
  type Artwork,
  type CatalogProvider,
} from "@/fabric/catalog"
import {
  passLicenseBar,
  WIKIMEDIA_SOURCE,
  createWikimediaCatalog,
} from "@/fabric/wikimedia-catalog"

/**
 * The Catalog (map #34, ticket #39; CONTEXT "Catalog", "Artwork", "Insert",
 * "Inserted"): a third-party illustrated-art source the app searches and
 * embeds from. Given a term it returns only license-compliant Artwork — the
 * commercial-sale/no-attribution bar, applied verbatim from the #35 research —
 * each carrying a title, preview, full-resolution URL, and license; embedding
 * an Artwork returns its bytes as a self-contained data URL. The provider
 * seam means the caller never knows the provider's shape, and a provider
 * outage is a distinct, catchable `CatalogError` — never conflated with an
 * empty result set.
 */

/** A minimal extmetadata stand-in shaped like MediaWiki's `{ value }` entries. */
function em(short: string | undefined, attribution: string | undefined) {
  return {
    LicenseShortName: short === undefined ? undefined : { value: short },
    AttributionRequired:
      attribution === undefined ? undefined : { value: attribution },
  }
}

/** A Wikimedia search JSON body built from raw pages (bypasses the filter). */
function searchBody(parts: unknown[]): unknown {
  return { query: { pages: { p1: parts[0], p2: parts[1], p3: parts[2] } } }
}

/** A fully compliant page fixture. */
function compliantPage() {
  return {
    pageid: 1,
    ns: 6,
    title: "File:Emoticon sticker.png",
    imageinfo: [
      {
        url: "https://upload.wikimedia.org/wikipedia/commons/a.png",
        thumburl: "https://upload.wikimedia.org/wikipedia/commons/512px-a.png",
        mime: "image/png",
        extmetadata: em("CC0", "false"),
      },
    ],
  }
}

describe("Catalog — the license bar (#39)", () => {
  it("passes public domain / CC0 / PD with no attribution", () => {
    for (const short of ["Public domain", "CC0", "CC0 1.0", "PD"]) {
      expect(passLicenseBar(em(short, "false")), short).toBe(true)
    }
  })

  it("excludes anything requiring attribution or a restrictive license", () => {
    expect(passLicenseBar(em("CC0", "true"))).toBe(false)
    expect(passLicenseBar(em("CC BY-SA 4.0", "true"))).toBe(false)
    expect(passLicenseBar(em("CC BY", "false"))).toBe(false)
    expect(passLicenseBar(em("Public domain", "true"))).toBe(false)
  })

  it("fails closed when a result carries no metadata at all", () => {
    expect(passLicenseBar(undefined as unknown as Record<string, unknown>)).toBe(false)
    expect(passLicenseBar(em(undefined, undefined))).toBe(false)
  })
})

describe("Wikimedia catalog — search", () => {
  it("returns only license-compliant Artwork, each with title/preview/source/license", async () => {
    const pages = [compliantPage()]
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => searchBody(pages),
    })
    const catalog = createWikimediaCatalog(fetchFn)

    const results = await catalog.search("sticker")

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      title: "Emoticon sticker",
      previewUrl: "https://upload.wikimedia.org/wikipedia/commons/512px-a.png",
      sourceUrl: "https://upload.wikimedia.org/wikipedia/commons/a.png",
      license: "CC0",
      source: WIKIMEDIA_SOURCE,
    })
    // The request carries the gsrsearch that constrains to transparent PNGs.
    expect(fetchFn).toHaveBeenCalledOnce()
    const url = new URL(fetchFn.mock.calls[0][0])
    expect(url.searchParams.get("gsrsearch")).toContain("filetype:bitmap")
    expect(url.searchParams.get("gsrsearch")).toContain("filemime:image/png")
  })

  it("silently drops items that fail the license bar — they never surface", async () => {
    const bad = structuredClone(compliantPage())
    bad.imageinfo[0].extmetadata = em("CC BY-SA 4.0", "true")
    const noMeta = { pageid: 2, ns: 6, title: "File:photo.png", imageinfo: [{}] }
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => searchBody([compliantPage(), bad, noMeta]),
    })

    const results = await createWikimediaCatalog(fetchFn).search("sticker")

    expect(results).toHaveLength(1)
    expect(results[0].title).toBe("Emoticon sticker")
  })

  it("answers an empty array for a genuinely empty result set — not an error", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ batchcomplete: "" }),
    })

    await expect(createWikimediaCatalog(fetchFn).search("sticker")).resolves.toEqual([])
  })

  it("reports provider-down as a distinct CatalogError, not an empty set", async () => {
    for (const badRes of [
      () => Promise.reject(new Error("network down")),
      () => Promise.resolve({ ok: false, status: 503 }),
    ]) {
      const fetchFn = vi.fn().mockImplementationOnce(badRes)
      await expect(
        createWikimediaCatalog(fetchFn as unknown as typeof fetch).search("sticker"),
      ).rejects.toBeInstanceOf(CatalogError)
    }
  })

  it("treats a blank search term as an empty result set", async () => {
    const fetchFn = vi.fn()
    await expect(createWikimediaCatalog(fetchFn).search("   ")).resolves.toEqual([])
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe("Wikimedia catalog — embed", () => {
  it("returns the artwork's bytes as a self-contained data URL", async () => {
    const artwork: Artwork = {
      title: "Emoticon sticker.png",
      previewUrl: "https://upload.wikimedia.org/wikipedia/commons/512px-a.png",
      sourceUrl: "https://upload.wikimedia.org/wikipedia/commons/a.png",
      license: "CC0",
      source: WIKIMEDIA_SOURCE,
    }
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => new Blob([bytes], { type: "image/png" }),
    })

    const dataURL = await createWikimediaCatalog(fetchFn).embed(artwork)

    expect(dataURL.startsWith("data:image/png;base64,")).toBe(true)
    expect(fetchFn).toHaveBeenCalledWith(artwork.sourceUrl, expect.anything())
  })

  it("reports a fetch failure as a distinct CatalogError", async () => {
    const artwork = { title: "a", previewUrl: "p", sourceUrl: "s", license: "CC0", source: WIKIMEDIA_SOURCE }
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 404 })

    await expect(
      createWikimediaCatalog(fetchFn).embed(artwork),
    ).rejects.toBeInstanceOf(CatalogError)
  })
})

describe("Catalog facade — the caller never knows the provider", () => {
  const artwork: Artwork = {
    title: "a",
    previewUrl: "p",
    sourceUrl: "s",
    license: "CC0",
    source: WIKIMEDIA_SOURCE,
  }

  it("wraps raw provider failures in a CatalogError", async () => {
    const provider: CatalogProvider = {
      search: () => Promise.reject(new Error("boom")),
      embed: () => Promise.reject(new Error("boom")),
    }
    const catalog = createCatalog(provider)
    await expect(catalog.search("x")).rejects.toBeInstanceOf(CatalogError)
    await expect(catalog.embed(artwork)).rejects.toBeInstanceOf(CatalogError)
  })

  it("passes through Artwork unchanged", async () => {
    const provider: CatalogProvider = {
      search: () => Promise.resolve([artwork]),
      embed: () => Promise.resolve("data:image/png;base64,AAAA"),
    }
    const catalog = createCatalog(provider)
    await expect(catalog.search("x")).resolves.toEqual([artwork])
    await expect(catalog.embed(artwork)).resolves.toBe("data:image/png;base64,AAAA")
  })
})