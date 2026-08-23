import {
  CatalogError,
  type Artwork,
  type CatalogProvider,
} from "@/fabric/catalog"

/**
 * The Pixabay provider (ticket #39; research #35 addendum 2026-08-24) — the
 * production graphic source, swapped in for Wikimedia at the
 * {@link CatalogProvider} seam. CORS-open on both the search API and the CDN
 * image host, callable from a static site.
 *
 * The license semantics differ from Wikimedia's (research #35 §3): Pixabay
 * returns **no** per-item metadata (no `AttributionRequired` analogue), so the
 * app cannot guarantee an item is cleared for standalone-merchandise sale the
 * way the Wikimedia license bar did. The shield here is heuristic — a
 * `safesearch` flag on every request plus a keyword denylist (franchise,
 * character, brand, and logo terms) applied verbatim to each hit's tags and
 * page URL. Anything that trips the denylist is never returned — silently, so
 * it can't be shown. The user still holds the responsibility to verify an
 * image carries no third-party rights before selling (Pixabay Content
 * License); this provider only filters the obvious.
 */

/** The catalog source name carried on every Artwork as provenance (#40). */
export const PIXABAY_SOURCE = "Pixabay"

/** The Pixabay search endpoint. */
const SEARCH_ENDPOINT = "https://pixabay.com/api/"

/**
 * A franchise / character / brand / logo keyword whose art must never surface
 * — the heuristic stand-in for the license bar. Pixabay's Content License bars
 * printing trademarked content on merchandise, and offers no per-item metadata
 * to test for it, so the app blocks the obvious categories. The list is
 * deliberately focused (character/brand nouns — not generic words like "star"
 * or "apple") to avoid starving the catalog for ordinary searches.
 *
 * Reviewer-maintainable: add recognizable franchise/character/brand names here
 * as they surface. This is a heuristic, not a guarantee — the user holds the
 * responsibility to confirm rights before selling.
 */
const BLOCKED_TERMS = [
  "disney",
  "pokemon",
  "pikachu",
  "marvel",
  "avengers",
  "dc comics",
  "batman",
  "superman",
  "spider-man",
  "star wars",
  "lego",
  "nintendo",
  "mario",
  "sonic",
  "hello kitty",
  "mickey",
  "minions",
  "emoji",
  "mascot",
  "logo",
  "brand",
  "trademark",
  "copyright",
]

/** A blocked term matches the hit's tags or page URL — it must not surface. */
function isBlocked(tags: string, pageUrl: string): boolean {
  const haystack = `${tags} ${pageUrl}`.toLowerCase()
  return BLOCKED_TERMS.some((term) => haystack.includes(term))
}

/**
 * A Pixabay hit's human-facing title. The API has no title field — the first
 * tag is the closest proxy, so the artwork's title (and its Document name,
 * #40) is the first tag, capitalized.
 */
function artworkTitle(rawTags: string): string {
  const first = rawTags.split(",")[0]?.trim() ?? ""
  if (!first) return "Untitled"
  return first.charAt(0).toUpperCase() + first.slice(1)
}

/**
 * Map Pixabay `data.hits` to {@link Artwork}s. A hit blocked by the denylist
 * is dropped here — the caller never sees it.
 */
function hitsToArtworks(data: any): Artwork[] {
  const hits: any[] = Array.isArray(data?.hits) ? data.hits : []
  const out: Artwork[] = []
  for (const hit of hits) {
    const tags = typeof hit.tags === "string" ? hit.tags : ""
    const pageUrl = typeof hit.pageURL === "string" ? hit.pageURL : ""
    if (isBlocked(tags, pageUrl)) continue
    out.push({
      title: artworkTitle(tags),
      previewUrl: hit.previewURL,
      sourceUrl: hit.webformatURL,
      license: "Pixabay Content License",
      source: PIXABAY_SOURCE,
    })
  }
  return out
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
 * Build the Pixabay {@link CatalogProvider}. The `key` is supplied by the
 * caller (typically from the build environment — Pixabay's own client-side
 * example embeds it the same way); the `fetchFn` is injected so the contract
 * tests exercise the network path against a stubbed fetch.
 */
export function createPixabayCatalog(
  key = import.meta.env.VITE_PIXABAY_KEY ?? "",
  fetchFn: (url: string, init?: RequestInit) => Promise<Response> =
    (input: string, init?: RequestInit) => fetch(input, init),
): CatalogProvider {
  return {
    async search(term: string): Promise<Artwork[]> {
      const trimmed = term.trim()
      // A blank term is a genuine "nothing to search for" — an empty set, not
      // a call to the source.
      if (!trimmed) return []

      // Fail-fast on a missing key, not a silent empty grid — the panel
      // surfaces this through reportStatus (ADR 0002: validates loudly).
      if (!key) {
        throw new CatalogError(
          "The artwork source isn't configured — set VITE_PIXABAY_KEY",
        )
      }

      const url = new URL(SEARCH_ENDPOINT)
      url.searchParams.set("key", key)
      url.searchParams.set("q", trimmed)
      // The sticker-art constraint (research #35 §3): illustrations, the
      // closest Pixabay match to the transparent-PNG art the app surfaces.
      url.searchParams.set("image_type", "illustration")
      // The #35-stand-in shield: no adult/edited imagery, always on.
      url.searchParams.set("safesearch", "1")
      url.searchParams.set("per_page", "30")

      let response: Response
      try {
        response = await fetchFn(url.toString())
      } catch {
        throw new CatalogError("The artwork source couldn't be reached")
      }
      if (!response.ok) {
        // A 400 is Pixabay's bad-key signal; 429 is the per-key rate limit —
        // both are "provider unavailable" to the caller, not an empty set.
        throw new CatalogError(`The artwork source failed (${response.status})`)
      }
      const data = await response.json()
      return hitsToArtworks(data)
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