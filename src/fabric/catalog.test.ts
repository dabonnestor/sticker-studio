import { describe, expect, it, vi } from "vitest"

import {
  createCatalog,
  CatalogError,
  type Artwork,
  type CatalogProvider,
} from "@/fabric/catalog"
import {
  PIXABAY_SOURCE,
  createPixabayCatalog,
} from "@/fabric/pixabay-catalog"

/**
 * The Catalog (map #34, ticket #39; CONTEXT "Catalog", "Artwork", "Insert",
 * "Inserted"): a third-party illustrated-art source the app searches and
 * embeds from. Given a term the provider returns illustration Artwork —
 * filtered heuristically (safesearch + a franchise/character/brand denylist,
 * per the 2026-08-24 research addendum) — each carrying a title, preview,
 * source URL, and an informational license; embedding an Artwork returns its
 * bytes as a self-contained data URL. The provider seam means the caller
 * never knows the provider's shape, and a provider outage is a distinct,
 * catchable `CatalogError` — never conflated with an empty result set.
 */

/** A Pixabay search response body built from raw hits (bypasses the filter). */
function hitsBody(hits: unknown[]): unknown {
  return { hits }
}

/** A clean, unblocked hit fixture. */
function cleanHit() {
  return {
    id: 1,
    tags: "emoticon, sticker, face",
    pageURL: "https://pixabay.com/illustrations/emoticon-sticker-1/",
    previewURL: "https://cdn.pixabay.com/photo/emoticon_150.jpg",
    webformatURL: "https://cdn.pixabay.com/photo/emoticon_640.jpg",
  }
}

describe("Catalog — the content shield (2026 addendum)", () => {
  it("answers an empty array for a genuinely empty result set — not an error", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ hits: [] }),
    })

    await expect(createPixabayCatalog("test-key", fetchFn).search("sticker")).resolves.toEqual(
      [],
    )
  })
})

describe("Pixabay catalog — search", () => {
  it("returns Artwork for unblocked hits, each with title/preview/source/license", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => hitsBody([cleanHit()]),
    })
    const catalog = createPixabayCatalog("test-key", fetchFn)

    const results = await catalog.search("sticker")

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      title: "Emoticon",
      previewUrl: "https://cdn.pixabay.com/photo/emoticon_150.jpg",
      sourceUrl: "https://cdn.pixabay.com/photo/emoticon_640.jpg",
      license: "Pixabay Content License",
      source: PIXABAY_SOURCE,
    })
    // The request carries the key and the sticker-art / safesearch constraints.
    expect(fetchFn).toHaveBeenCalledOnce()
    const url = new URL(fetchFn.mock.calls[0][0])
    expect(url.searchParams.get("key")).toBe("test-key")
    expect(url.searchParams.get("q")).toBe("sticker")
    expect(url.searchParams.get("image_type")).toBe("illustration")
    expect(url.searchParams.get("safesearch")).toBe("1")
    expect(url.searchParams.get("per_page")).toBe("30")
  })

  it("silently drops hits that trip the franchise/character/brand denylist", async () => {
    const blocked = {
      ...cleanHit(),
      id: 2,
      tags: "pokemon, pikachu, cartoon",
      pageURL: "https://pixabay.com/illustrations/pokemon-2/",
    }
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => hitsBody([cleanHit(), blocked]),
    })

    const results = await createPixabayCatalog("test-key", fetchFn).search("sticker")

    expect(results).toHaveLength(1)
    expect(results[0].title).toBe("Emoticon")
  })

  it("reports provider-down as a distinct CatalogError, not an empty set", async () => {
    for (const badRes of [
      () => Promise.reject(new Error("network down")),
      () => Promise.resolve({ ok: false, status: 503 }),
    ]) {
      const fetchFn = vi.fn().mockImplementationOnce(badRes)
      await expect(
        createPixabayCatalog("test-key", fetchFn as unknown as typeof fetch).search(
          "sticker",
        ),
      ).rejects.toBeInstanceOf(CatalogError)
    }
  })

  it("fails fast with a clear CatalogError when no key is configured", async () => {
    const fetchFn = vi.fn()
    await expect(
      createPixabayCatalog("", fetchFn).search("sticker"),
    ).rejects.toMatchObject({ name: "CatalogError" })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it("treats a blank search term as an empty result set", async () => {
    const fetchFn = vi.fn()
    await expect(
      createPixabayCatalog("test-key", fetchFn).search("   "),
    ).resolves.toEqual([])
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe("Pixabay catalog — embed", () => {
  it("returns the artwork's bytes as a self-contained data URL", async () => {
    const artwork: Artwork = {
      title: "emoticon",
      previewUrl: "https://cdn.pixabay.com/photo/emoticon_150.jpg",
      sourceUrl: "https://cdn.pixabay.com/photo/emoticon_640.jpg",
      license: "Pixabay Content License",
      source: PIXABAY_SOURCE,
    }
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => new Blob([bytes], { type: "image/jpeg" }),
    })

    const data = await createPixabayCatalog("test-key", fetchFn).embed(artwork)

    expect(data.startsWith("data:image/jpeg;base64,")).toBe(true)
    expect(fetchFn).toHaveBeenCalledWith(artwork.sourceUrl, expect.anything())
  })

  it("reports a fetch failure as a distinct CatalogError", async () => {
    const artwork = { title: "a", previewUrl: "p", sourceUrl: "s", license: "Pixabay Content License", source: PIXABAY_SOURCE }
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 404 })

    await expect(
      createPixabayCatalog("test-key", fetchFn).embed(artwork),
    ).rejects.toBeInstanceOf(CatalogError)
  })
})

describe("Catalog facade — the caller never knows the provider", () => {
  const artwork: Artwork = {
    title: "a",
    previewUrl: "p",
    sourceUrl: "s",
    license: "Pixabay Content License",
    source: PIXABAY_SOURCE,
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