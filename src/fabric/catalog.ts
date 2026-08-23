/**
 * The Catalog facade (map #34, ticket #39; CONTEXT "Catalog", "Artwork",
 * "Insert", "Inserted"): the app-facing surface a browser both searches and
 * embeds from — the panel and the Insert flow talk to *this*, never to a
 * concrete provider. A provider swap therefore touches only the provider
 * implementation injected at construction; the panel is unchanged (#39's "the
 * caller does not know the provider's shape").
 *
 * `search` returns only license-compliant Artwork (the commercial-sale /
 * no-attribution bar); a genuinely empty result set is an empty array, and a
 * provider outage is a `CatalogError` — the two are never conflated. `embed`
 * returns an Artwork's bytes as a self-contained data URL for Insert (#42).
 */

/** One catalog item — illustrated sticker art cleared for commercial sale. */
export interface Artwork {
  /** The artwork's title — becomes the inserted Image's name (#40). */
  title: string
  /** A preview thumbnail URL for the gallery grid (#41). */
  previewUrl: string
  /** The full-resolution source URL — embedded at Insert time (#42). */
  sourceUrl: string
  /** The license, matched against the no-attribution bar ("CC0", "PD", …). */
  license: string
  /** The catalog source this artwork came from (provenance, #40). */
  source: string
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

/** The provider seam — a future provider follows this shape, only. */
export interface CatalogProvider {
  /**
   * Search the source and return only license-compliant Artwork. A genuine
   * absence of matches is an empty array; a provider outage throws a
   * {@link CatalogError} — the caller tells the two apart.
   */
  search(term: string): Promise<Artwork[]>
  /**
   * Fetch the artwork's full-resolution bytes and return them as a
   * self-contained data URL — embedded into the Document at Insert (#42).
   */
  embed(artwork: Artwork): Promise<string>
}

/** The Catalog's surface — the only shape the caller depends on. */
export interface Catalog {
  search(term: string): Promise<Artwork[]>
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
    async search(term: string): Promise<Artwork[]> {
      try {
        return await provider.search(term)
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