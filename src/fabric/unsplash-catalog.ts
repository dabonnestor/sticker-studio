import {
  CatalogError,
  type Artwork,
  type CatalogPage,
  type CatalogProvider,
} from "@/fabric/catalog"
import { isBlockedByShield } from "@/fabric/catalog-shield"

/**
 * The Unsplash provider — the Images panel's photograph source, a second
 * {@link CatalogProvider} beside Pixabay. CORS-open on both the search API
 * and the images.unsplash.com CDN, callable from a static site.
 *
 * The license semantics match Pixabay's (research #35 §3): Unsplash returns
 * **no** per-item metadata (no `AttributionRequired` analogue), so the app
 * cannot guarantee an item is cleared for standalone-merchandise sale the way
 * the Wikimedia license bar did. The shield here is heuristic — a
 * `content_filter=high` flag on every request plus the shared keyword
 * denylist (catalog-shield.ts) applied verbatim to each hit's alt text,
 * description, tags, and page URL. Anything that trips the denylist is never
 * returned — silently, so it can't be shown. The user still holds the
 * responsibility to verify an image carries no third-party rights before
 * selling (Unsplash License); this provider only filters the obvious.
 */

/** The catalog source name carried on every Artwork as provenance (#40). */
export const UNSPLASH_SOURCE = "Unsplash"

/** The Unsplash search endpoint. */
const SEARCH_ENDPOINT = "https://api.unsplash.com/search/photos"

/** Results per request — the page size the cursor math anchors to. */
const PER_PAGE = 30

/**
 * A hit's human-facing title. Unsplash has no title field — the alt text is
 * the closest proxy, with the description as fallback, so the artwork's title
 * (and its Document name, #40) is the first non-empty one, capitalized.
 */
function artworkTitle(altDescription: string, description: string): string {
  const raw = altDescription.trim() || description.trim()
  if (!raw) return "Untitled"
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

/**
 * Map Unsplash `data.results` to {@link Artwork}s. A result blocked by the
 * denylist is dropped here — the caller never sees it.
 */
function resultsToArtworks(data: any): Artwork[] {
  const results: any[] = Array.isArray(data?.results) ? data.results : []
  const out: Artwork[] = []
  for (const result of results) {
    const alt = typeof result.alt_description === "string" ? result.alt_description : ""
    const description =
      typeof result.description === "string" ? result.description : ""
    const tags = Array.isArray(result.tags)
      ? result.tags
          .map((tag: any) => (typeof tag?.title === "string" ? tag.title : ""))
          .join(" ")
      : ""
    const pageUrl = typeof result.links?.html === "string" ? result.links.html : ""
    if (isBlockedByShield(alt, description, tags, pageUrl)) continue
    out.push({
      title: artworkTitle(alt, description),
      // The 200px grid thumbnail — the preview is a separate fetch, so a
      // broken thumbnail keeps the card.
      previewUrl: result.urls?.thumb,
      // The bounded 1080px rendition — the embed path (#42): large enough to
      // fill the Document's 80% fit, small enough to stay under the
      // self-containment ceiling (full/raw would be unbounded).
      sourceUrl: result.urls?.regular,
      license: "Unsplash License",
      source: UNSPLASH_SOURCE,
    })
  }
  return out
}

/**
 * The page number an opaque cursor encodes. A cursor the provider itself
 * issued is a page number as a string; `null`/undefined/garbage all mean "the
 * first page". The first-page case is the common one (the panel passes a fresh
 * search through with no cursor), so it stays on page 1 — never on 0. A local
 * copy of the Pixabay provider's helper — cursor math is provider-agnostic
 * mechanics, not policy (the denylist, the policy, lives in catalog-shield.ts).
 */
function pageFromCursor(cursor?: string | null): number {
  const page = cursor ? parseInt(cursor, 10) : NaN
  return Number.isFinite(page) && page > 0 ? page : 1
}

/** Read the artwork's bytes as a base64 data URL — the embed path (#42). */
function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new CatalogError("That artwork couldn't be decoded"))
    reader.readAsDataURL(blob)
  })
}

/**
 * Build the Unsplash {@link CatalogProvider}. The `key` is supplied by the
 * caller (typically from the build environment — Unsplash's own client-side
 * examples embed it the same way); the `fetchFn` is injected so the contract
 * tests exercise the network path against a stubbed fetch.
 */
export function createUnsplashCatalog(
  key = import.meta.env.VITE_UNSPLASH_KEY ?? "",
  fetchFn: (url: string, init?: RequestInit) => Promise<Response> =
    (input: string, init?: RequestInit) => fetch(input, init),
): CatalogProvider {
  return {
    async search(term: string, cursor?: string | null): Promise<CatalogPage> {
      const trimmed = term.trim()
      // A blank term is a genuine "nothing to search for" — an empty set, not
      // a call to the source.
      if (!trimmed) return { artworks: [], nextCursor: null }

      // Fail-fast on a missing key, not a silent empty grid — the panel
      // surfaces this through reportStatus (ADR 0002: validates loudly).
      if (!key) {
        throw new CatalogError(
          "The artwork source isn't configured — set VITE_UNSPLASH_KEY",
        )
      }

      // The caller passes back our own opaque cursor verbatim; its only
      // purpose is to recover the page number we stamped on it (#41 scroll).
      const page = pageFromCursor(cursor)

      const url = new URL(SEARCH_ENDPOINT)
      url.searchParams.set("query", trimmed)
      url.searchParams.set("page", String(page))
      url.searchParams.set("per_page", String(PER_PAGE))
      // The #35-stand-in shield: content unsuitable for younger audiences is
      // filtered out, always on — the Unsplash analogue of Pixabay's
      // safesearch=1.
      url.searchParams.set("content_filter", "high")

      let response: Response
      try {
        response = await fetchFn(url.toString(), {
          headers: {
            // The API's public-access auth — the key is a client-side
            // identifier, never a secret (see .env.example).
            Authorization: `Client-ID ${key}`,
            // The API is versioned; pin the stable v1 surface.
            "Accept-Version": "v1",
          },
        })
      } catch {
        throw new CatalogError("The artwork source couldn't be reached")
      }
      if (!response.ok) {
        // A 401/403 is Unsplash's bad-key signal; 429 is the per-key rate
        // limit — both are "provider unavailable" to the caller, not an
        // empty set.
        throw new CatalogError(`The artwork source failed (${response.status})`)
      }
      const data = await response.json()
      const totalPages = Number(data?.total_pages ?? 0)
      return {
        artworks: resultsToArtworks(data),
        // One more page while the offset still has pages left to fetch.
        nextCursor: page < totalPages ? String(page + 1) : null,
      }
    },

    async embed(artwork: Artwork): Promise<string> {
      // The full-resolution bytes at the bounded source URL (#42) — the
      // inserted Document is self-contained (a large embed is refused by the
      // size ceiling, #42).
      let response: Response
      try {
        response = await fetchFn(artwork.sourceUrl, { mode: "cors" })
      } catch {
        throw new CatalogError("That artwork couldn't be fetched")
      }
      if (!response.ok) {
        throw new CatalogError(`That artwork couldn't be fetched (${response.status})`)
      }
      const blob = await response.blob()
      return blobToDataURL(blob)
    },
  }
}
