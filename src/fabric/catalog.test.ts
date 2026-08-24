import { describe, expect, it, vi } from "vitest"

import {
  createCatalog,
  CatalogError,
  type Artwork,
  type CatalogPage,
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
function hitsBody(hits: unknown[], totalHits = hits.length): unknown {
  return { hits, totalHits }
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
  it("answers an empty page for a genuinely empty result set — not an error", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ hits: [], totalHits: 0 }),
    })

    await expect(createPixabayCatalog("test-key", fetchFn).search("sticker")).resolves.toEqual(
      { artworks: [], nextCursor: null },
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

    const page = await catalog.search("sticker")

    expect(page.artworks).toHaveLength(1)
    expect(page.artworks[0]).toMatchObject({
      title: "Emoticon",
      previewUrl: "https://cdn.pixabay.com/photo/emoticon_150.jpg",
      sourceUrl: "https://cdn.pixabay.com/photo/emoticon_640.jpg",
      license: "Pixabay Content License",
      source: PIXABAY_SOURCE,
    })
    // One hit on the first page and the search is exhausted — no next page.
    expect(page.nextCursor).toBeNull()
    // A fresh search with no cursor starts on page 1.
    expect(fetchFn).toHaveBeenCalledOnce()
    const url = new URL(fetchFn.mock.calls[0][0])
    expect(url.searchParams.get("key")).toBe("test-key")
    expect(url.searchParams.get("q")).toBe("sticker")
    expect(url.searchParams.get("image_type")).toBe("illustration")
    expect(url.searchParams.get("safesearch")).toBe("1")
    expect(url.searchParams.get("per_page")).toBe("30")
    expect(url.searchParams.get("page")).toBe("1")
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

    expect(results.artworks).toHaveLength(1)
    expect(results.artworks[0].title).toBe("Emoticon")
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

  it("treats a blank search term as an empty page", async () => {
    const fetchFn = vi.fn()
    await expect(
      createPixabayCatalog("test-key", fetchFn).search("   "),
    ).resolves.toEqual({ artworks: [], nextCursor: null })
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe("Pixabay catalog — pagination (#41 infinite scroll)", () => {
  it("hands back a next cursor while the offset still has hits left to fetch", async () => {
    const hits = [
      { ...cleanHit(), id: 1 },
      { ...cleanHit(), id: 2, tags: "bee, bug", pageURL: "https://pixabay.com/illustrations/bee-2/" },
    ]
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => hitsBody(hits, 31),
    })

    const page = await createPixabayCatalog("test-key", fetchFn).search("sticker")

    expect(page.artworks).toHaveLength(2)
    // 30 per page × page 1 < 31 total — one more page remains.
    expect(page.nextCursor).toBe("2")
  })

  it("returns a null next cursor once the offset has covered every hit", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => hitsBody([cleanHit()], 30),
    })

    const page = await createPixabayCatalog("test-key", fetchFn).search("sticker")

    expect(page.artworks).toHaveLength(1)
    // 30 per page × page 1 == 30 total — nothing left beyond this page.
    expect(page.nextCursor).toBeNull()
  })

  it("passes the cursor back as the page number on the follow-up request", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => hitsBody([cleanHit()], 0),
    })

    await createPixabayCatalog("test-key", fetchFn).search("sticker", "3")

    const url = new URL(fetchFn.mock.calls[0][0])
    expect(url.searchParams.get("page")).toBe("3")
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

  it("passes the CatalogPage through unchanged, cursor included", async () => {
    const page: CatalogPage = { artworks: [artwork], nextCursor: "2" }
    const provider: CatalogProvider = {
      search: () => Promise.resolve(page),
      embed: () => Promise.resolve("data:image/png;base64,AAAA"),
    }
    const catalog = createCatalog(provider)
    await expect(catalog.search("x", "2")).resolves.toEqual(page)
    await expect(catalog.embed(artwork)).resolves.toBe("data:image/png;base64,AAAA")
  })
})