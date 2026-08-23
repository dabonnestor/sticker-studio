import {
  CatalogError,
  type Artwork,
  type CatalogProvider,
} from "@/fabric/catalog"

/**
 * The Wikimedia Commons provider (ticket #39; research #35) — the reference
 * implementation of the {@link CatalogProvider} seam. Keyless and CORS-open
 * on both the MediaWiki search API and the `upload.wikimedia.org` image host,
 * filterable to "free for commercial sale, no attribution" through per-item
 * `extmetadata`. A replacement provider swaps only in at the seam.
 *
 * The license filter (#35 §2.3) is applied **verbatim**: an item is kept only
 * when its `LicenseShortName` is public-domain/CC0/PD *and* its
 * `AttributionRequired` is `"false"`. Anything that fails the bar is never
 * returned — silently, so it can't be shown.
 */

/** The catalog source name carried on every Artwork as provenance (#40). */
export const WIKIMEDIA_SOURCE = "Wikimedia Commons"

/** The MediaWiki search API for the Commons content. */
const SEARCH_ENDPOINT = "https://commons.wikimedia.org/w/api.php"

/** A meaningful user-agent, as MediaWiki etiquette requires (research #35). */
const USER_AGENT = "Sticker Studio (client-side sticker editor; contact via GitHub)"

/**
 * Read one `extmetadata` field. MediaWiki serves these as `{ value: "…" }`
 * objects, but the filter must also be forgiving of a plain string — so the
 * #35 expression holds against either shape. Unknown/absent fields read "".
 */
function metadataValue(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string {
  const v = metadata?.[key]
  if (typeof v === "string") return v
  if (v && typeof v === "object" && "value" in v) {
    const value = (v as { value?: unknown }).value
    if (typeof value === "string") return value
  }
  return ""
}

/**
 * The license bar from research #35, applied verbatim — the product of two
 * checks that must both hold: the `LicenseShortName` is public-domain/CC0/PD,
 * and `AttributionRequired` is `"false"`. Fails closed: absent metadata never
 * sneaks past.
 */
export function passLicenseBar(
  metadata: Record<string, unknown> | undefined,
): boolean {
  const short = metadataValue(metadata, "LicenseShortName")
  if (!/public ?domain|cc-?0|pd/i.test(short)) return false
  return metadataValue(metadata, "AttributionRequired").toLowerCase() === "false"
}

/** The entitlement MediaWiki's `iiurlwidth` thumbnail width for previews. */
const PREVIEW_WIDTH = 512

/**
 * Normalize a page title — MediaWiki titles are `File:<name>.<ext>`; the
 * artwork's human-facing title (and its Document name, #40) drops both the
 * namespace and the file extension.
 */
function artworkTitle(raw: string): string {
  return raw.replace(/^File:/, "").replace(/\.[A-Za-z0-9]{1,5}$/, "")
}

/**
 * Map a MediaWiki `query.pages` map to licensed {@link Artwork}s. Pages with
 * no imageinfo, or that fail the license bar, are dropped here — the caller
 * never sees them.
 */
function pagesToArtworks(
  pages: Record<string, any> | undefined,
): Artwork[] {
  if (!pages || typeof pages !== "object") return []
  const out: Artwork[] = []
  for (const key of Object.keys(pages)) {
    const imageinfo = pages[key]?.imageinfo?.[0]
    if (!imageinfo) continue
    if (!passLicenseBar(imageinfo.extmetadata)) continue
    out.push({
      title: artworkTitle(pages[key].title ?? ""),
      previewUrl: imageinfo.thumburl ?? imageinfo.url,
      sourceUrl: imageinfo.url,
      license: metadataValue(imageinfo.extmetadata, "LicenseShortName"),
      source: WIKIMEDIA_SOURCE,
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
 * Build the Wikimedia {@link CatalogProvider}. The `fetchFn` is injected so
 * the contract tests exercise the network path against a stubbed fetch — the
 * live endpoint is exercised manually (research #35 verified CORS + data live
 * from a static context).
 */
export function createWikimediaCatalog(
  fetchFn: (url: string, init?: RequestInit) => Promise<Response> =
    (input: string, init?: RequestInit) => fetch(input, init),
): CatalogProvider {
  return {
    async search(term: string): Promise<Artwork[]> {
      const trimmed = term.trim()
      // A blank term is a genuine "nothing to search for" — an empty set, not
      // a call to the source.
      if (!trimmed) return []

      const url = new URL(SEARCH_ENDPOINT)
      url.searchParams.set("action", "query")
      url.searchParams.set("generator", "search")
      // The #35 search constraint: bitmap (raster) transparent PNGs — the
      // sticker-art shape the app surfaces.
      url.searchParams.set(
        "gsrsearch",
        `filetype:bitmap filemime:image/png ${trimmed}`,
      )
      url.searchParams.set("gsrnamespace", "6")
      url.searchParams.set("gsrlimit", "30")
      url.searchParams.set("prop", "imageinfo")
      url.searchParams.set("iiprop", "url|size|mime|extmetadata")
      url.searchParams.set("iiurlwidth", String(PREVIEW_WIDTH))
      url.searchParams.set("format", "json")
      url.searchParams.set("origin", "*")

      let response: Response
      try {
        response = await fetchFn(url.toString(), {
          headers: { "Api-User-Agent": USER_AGENT },
        })
      } catch {
        throw new CatalogError("The artwork source couldn't be reached")
      }
      if (!response.ok) {
        throw new CatalogError(`The artwork source failed (${response.status})`)
      }
      const data = await response.json()
      return pagesToArtworks(data?.query?.pages)
    },

    async embed(artwork: Artwork): Promise<string> {
      // The full-resolution source URL, per #42 — the inserted Document is
      // self-contained (a large embed is refused by the size ceiling, #42).
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