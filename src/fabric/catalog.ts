/**
 /**
 * The Catalog facade (map #34, ticket #39; CONTEXT "Catalog", "Artwork",
 * "Insert", "Inserted"): the app-facing surface a browser both searches and
 * embeds from — the panel and the Insert flow talk to *this*, never to a
 * concrete provider. A provider swap therefore touches only the provider
 * implementation injected at construction; the panel is unchanged (#39's "the
 * caller does not know the provider's shape").
 *
 * Each provider applies its own content shield — the incumbent (Pixabay)
 * filters to illustrations, forces `safesearch`, and silently drops hits
 * matching a franchise/character/brand denylist. The barrier here is a
 * heuristic, **not** a per-item guarantee like Wikimedia's license bar was:
 * the user still holds the responsibility to confirm an image carries no
 * third-party rights before selling. A genuinely empty result set is an
 * empty array, and a provider outage is a `CatalogError` — the two are never
 * conflated. `embed` returns an Artwork's bytes as a self-contained data URL
 * for Insert (#42).
 */

/**
 * One catalog item — illustrated sticker art (Pixabay) or a photograph
 * (Unsplash), cleared for commercial sale.
 */
export interface Artwork {
  /** The artwork's title — becomes the inserted Image's name (#40). */
  title: string
  /** A preview thumbnail URL for the gallery grid (#41). */
  previewUrl: string
  /** The full-resolution source URL — embedded at Insert time (#42). */
  sourceUrl: string
  /**
   * The license, informational only ("Pixabay Content License", …) — carried
   * for provenance, not as a no-attribution/sale guarantee.
   */
  license: string
  /** The catalog source this artwork came from (provenance, #40). */
  source: string
  /** The original author's display name — the gallery's attribution (#41). */
  author: string
  /**
   * The author's profile page — the attribution chip links there (new tab).
   * Absent when the provider couldn't determine a profile URL.
   */
  authorUrl?: string
}

/**
 * A provider failure — everything that is not a genuine "there was nothing to
 * return" answer: the source is unreachable, it erred, or an embed couldn't be
 * fetched/decoded. Distinct from an empty result set so the caller can tell
 * "provider down" from "no matches" (both #39 acceptance criteria).
 */
export class CatalogError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CatalogError"
  }
}

/**
 * One page of search results: the Artwork on it plus an opaque handle for the
 * next page — `null` means exhausted. The cursor is deliberately opaque so the
 * caller never depends on a provider's pagination shape (a page number here,
 * a token there); it is only ever handed back on the next `search`.
 */
export interface CatalogPage {
  artworks: Artwork[]
  nextCursor: string | null
}

/** The provider seam — a future provider follows this shape, only. */
export interface CatalogProvider {
  /**
   * Search the catalog and return only license-compliant Artwork. `cursor` is
   * the opaque handle from a prior page (`null`/omitted for the first page).
   * A genuine absence of matches is an empty `artworks`; a provider outage
   * throws a {@link CatalogError} — the caller tells the two apart.
   */
  search(term: string, cursor?: string | null): Promise<CatalogPage>
  /**
   * Fetch the artwork's embedded bytes and return them as a self-contained
   * data URL — embedded into the Document at Insert (#42).
   */
  embed(artwork: Artwork): Promise<string>
}

/** The Catalog's surface — the only shape the caller depends on. */
export interface Catalog {
  search(term: string, cursor?: string | null): Promise<CatalogPage>
  embed(artwork: Artwork): Promise<string>
}

/**
 * Wrap a {@link CatalogProvider} in the {@link Catalog} facade. A provider
 * that already started a CatalogError passes it through untouched; any raw
 * failure is normalized to a CatalogError so the panel never has to handle
 * provider-specific errors.
 */
export function createCatalog(provider: CatalogProvider): Catalog {
  /** Pass a provider-initiated CatalogError on untouched; wrap any raw failure. */
  const raiseCatalog = (error: unknown, message: string): never => {
    throw error instanceof CatalogError ? error : new CatalogError(message)
  }
  return {
    async search(term: string, cursor?: string | null): Promise<CatalogPage> {
      try {
        return await provider.search(term, cursor)
      } catch (error) {
        return raiseCatalog(error, "The artwork source couldn't be reached")
      }
    },
    async embed(artwork: Artwork): Promise<string> {
      try {
        return await provider.embed(artwork)
      } catch (error) {
        return raiseCatalog(error, "That artwork couldn't be fetched")
      }
    },
  }
}