import { describe, expect, it, vi } from "vitest"

import { CatalogError, type Artwork } from "@/fabric/catalog"
import {
  UNSPLASH_SOURCE,
  createUnsplashCatalog,
} from "@/fabric/unsplash-catalog"

/**
 * The Unsplash provider (the Images panel's source, beside Pixabay): a
 * third-party photograph source the app searches and embeds from. Given a
 * term the provider returns photograph Artwork — filtered heuristically
 * (`content_filter=high` + the shared franchise/character/brand denylist) —
 * each carrying a title, preview, source URL, and an informational license;
 * embedding an Artwork returns its bytes as a self-contained data URL. The
 * provider seam means the caller never knows the provider's shape, and a
 * provider outage is a distinct, catchable `CatalogError` — never conflated
 * with an empty result set.
 */

/** An Unsplash search response body built from raw results (bypasses the filter). */
function resultsBody(results: unknown[], totalPages = 1): unknown {
  return { total: results.length, total_pages: totalPages, results }
}

/** A clean, unblocked result fixture. */
function cleanResult() {
  return {
    id: "abc123",
    alt_description: "a red balloon floating in the sky",
    description: null,
    urls: {
      thumb: "https://images.unsplash.com/photo-1?w=200",
      regular: "https://images.unsplash.com/photo-1?w=1080",
    },
    tags: [{ title: "balloon" }, { title: "sky" }],
    links: { html: "https://unsplash.com/photos/abc123" },
  }
}

describe("Unsplash catalog — search", () => {
  it("returns Artwork for unblocked results, each with title/preview/source/license", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => resultsBody([cleanResult()]),
    })
    const catalog = createUnsplashCatalog("test-key", fetchFn)

    const page = await catalog.search("balloon")

    expect(page.artworks).toHaveLength(1)
    expect(page.artworks[0]).toMatchObject({
      title: "A red balloon floating in the sky",
      previewUrl: "https://images.unsplash.com/photo-1?w=200",
      sourceUrl: "https://images.unsplash.com/photo-1?w=1080",
      license: "Unsplash License",
      source: UNSPLASH_SOURCE,
    })
    // One result on the first page and the search is exhausted — no next page.
    expect(page.nextCursor).toBeNull()
    // A fresh search with no cursor starts on page 1.
    expect(fetchFn).toHaveBeenCalledOnce()
    const url = new URL(fetchFn.mock.calls[0][0])
    expect(url.searchParams.get("query")).toBe("balloon")
    expect(url.searchParams.get("per_page")).toBe("30")
    expect(url.searchParams.get("page")).toBe("1")
    expect(url.searchParams.get("content_filter")).toBe("high")
    const init = fetchFn.mock.calls[0][1] as RequestInit
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe("Client-ID test-key")
    expect(headers["Accept-Version"]).toBe("v1")
  })

  it("silently drops results that trip the franchise/character/brand denylist", async () => {
    const blocked = {
      ...cleanResult(),
      id: "def456",
      alt_description: "a pokemon character sticker on a wall",
      links: { html: "https://unsplash.com/photos/def456" },
    }
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => resultsBody([cleanResult(), blocked]),
    })

    const results = await createUnsplashCatalog("test-key", fetchFn).search("sticker")

    expect(results.artworks).toHaveLength(1)
    expect(results.artworks[0].title).toBe("A red balloon floating in the sky")
  })

  it("reports provider-down as a distinct CatalogError, not an empty set", async () => {
    for (const badRes of [
      () => Promise.reject(new Error("network down")),
      () => Promise.resolve({ ok: false, status: 503 }),
    ]) {
      const fetchFn = vi.fn().mockImplementationOnce(badRes)
      await expect(
        createUnsplashCatalog("test-key", fetchFn as unknown as typeof fetch).search(
          "balloon",
        ),
      ).rejects.toBeInstanceOf(CatalogError)
    }
  })

  it("fails fast with a clear CatalogError when no key is configured", async () => {
    const fetchFn = vi.fn()
    await expect(
      createUnsplashCatalog("", fetchFn).search("balloon"),
    ).rejects.toMatchObject({ name: "CatalogError" })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it("treats a blank search term as an empty page", async () => {
    const fetchFn = vi.fn()
    await expect(
      createUnsplashCatalog("test-key", fetchFn).search("   "),
    ).resolves.toEqual({ artworks: [], nextCursor: null })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it("falls back to the description, then Untitled, when alt text is missing", async () => {
    const described = {
      ...cleanResult(),
      id: "ghi789",
      alt_description: null,
      description: "a cat sleeping on a windowsill",
      links: { html: "https://unsplash.com/photos/ghi789" },
    }
    const untitled = {
      ...cleanResult(),
      id: "jkl012",
      alt_description: null,
      description: null,
      links: { html: "https://unsplash.com/photos/jkl012" },
    }
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => resultsBody([described, untitled]),
    })

    const results = await createUnsplashCatalog("test-key", fetchFn).search("cat")

    expect(results.artworks.map((a) => a.title)).toEqual([
      "A cat sleeping on a windowsill",
      "Untitled",
    ])
  })
})

describe("Unsplash catalog — pagination (#41 infinite scroll)", () => {
  it("hands back a next cursor while pages remain to fetch", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => resultsBody([cleanResult()], 2),
    })

    const page = await createUnsplashCatalog("test-key", fetchFn).search("balloon")

    expect(page.artworks).toHaveLength(1)
    // Page 1 of 2 — one more page remains.
    expect(page.nextCursor).toBe("2")
  })

  it("returns a null next cursor once the last page is covered", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => resultsBody([cleanResult()], 1),
    })

    const page = await createUnsplashCatalog("test-key", fetchFn).search("balloon")

    expect(page.artworks).toHaveLength(1)
    expect(page.nextCursor).toBeNull()
  })

  it("passes the cursor back as the page number on the follow-up request", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => resultsBody([cleanResult()], 0),
    })

    await createUnsplashCatalog("test-key", fetchFn).search("balloon", "3")

    const url = new URL(fetchFn.mock.calls[0][0])
    expect(url.searchParams.get("page")).toBe("3")
  })
})

describe("Unsplash catalog — embed", () => {
  it("returns the artwork's bytes as a self-contained data URL", async () => {
    const artwork: Artwork = {
      title: "a red balloon",
      previewUrl: "https://images.unsplash.com/photo-1?w=200",
      sourceUrl: "https://images.unsplash.com/photo-1?w=1080",
      license: "Unsplash License",
      source: UNSPLASH_SOURCE,
    }
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => new Blob([bytes], { type: "image/jpeg" }),
    })

    const data = await createUnsplashCatalog("test-key", fetchFn).embed(artwork)

    expect(data.startsWith("data:image/jpeg;base64,")).toBe(true)
    expect(fetchFn).toHaveBeenCalledWith(artwork.sourceUrl, expect.anything())
  })

  it("reports a fetch failure as a distinct CatalogError", async () => {
    const artwork = {
      title: "a",
      previewUrl: "p",
      sourceUrl: "s",
      license: "Unsplash License",
      source: UNSPLASH_SOURCE,
    }
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 404 })

    await expect(
      createUnsplashCatalog("test-key", fetchFn).embed(artwork),
    ).rejects.toBeInstanceOf(CatalogError)
  })
})
