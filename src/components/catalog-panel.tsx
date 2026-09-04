import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowLeft, Info, Loader2, Search } from "lucide-react"

import { useStage } from "@/components/stage-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { CatalogError, type Artwork, type Catalog, type CatalogPage } from "@/fabric/catalog"

/** The gallery's states — mirror of the prototype's control-bar states. */
type GalleryState =
  | "idle" // no search yet
  | "loading" // a search is in flight
  | "results" // matching artwork shown
  | "empty" // a search matched nothing
  | "error" // provider-down / network failure (surfaced via the status area)

/**
 * The gallery panel's copy and catalog binding — the only things that differ
 * between the Graphics gallery (Pixabay) and the Images gallery (Unsplash).
 * The wrappers (ArtworkPanel, ImagesPanel) own these; the panel itself is
 * provider-agnostic.
 */
export interface CatalogPanelProps {
  /** True while this panel is the active sidebar view — display:none otherwise. */
  active: boolean
  /** Restore the default sidebar. */
  onBack: () => void
  /** The catalog this panel searches and embeds through. */
  catalog: Catalog
  /** The panel's heading, e.g. "Graphics". */
  heading: string
  /** The search input's placeholder, e.g. "Search graphics…". */
  searchPlaceholder: string
  /** The search input's aria-label. */
  searchLabel: string
  /** The provider's display name for the attribution line, e.g. "Pixabay". */
  providerName: string
  /** The provider's homepage for the attribution link. */
  providerUrl: string
  /** The item noun for the empty/error copy, e.g. "artwork" or "image". */
  noun: string
  /**
   * How a preview fills its card — "cover" crops to fill the square (the
   * current look for both panels), "contain" shows the whole image (the
   * fit for transparent art, if a future panel needs it).
   */
  imageFit: "contain" | "cover"
}

/**
 * One result in the grid: the preview thumbnail with a small
 * author-attribution chip.
 */
function ArtworkCard({
  artwork,
  onInsert,
  loading,
  imageFit,
}: {
  artwork: Artwork
  onInsert: (artwork: Artwork) => void
  /** True while this artwork's embed is in flight — swaps the card for a spinner. */
  loading: boolean
  /** How the preview fills the card — see CatalogPanelProps.imageFit. */
  imageFit: "contain" | "cover"
}) {
  return (
    // The card is a button (insert) with the attribution chip beside it, not
    // inside it — a link nested in a button would be invalid HTML.
    <div className="group relative aspect-square overflow-hidden rounded-md border bg-muted/50">
      <button
        type="button"
        title={`${artwork.title} (${artwork.license})`}
        onClick={() => onInsert(artwork)}
        disabled={loading}
        aria-busy={loading}
        className="absolute inset-0 flex items-center justify-center"
      >
        {/* The preview is a separate fetch; a broken thumbnail keeps the card. */}
        <img
          src={artwork.previewUrl}
          alt={artwork.title}
          className={cn(
            "h-full w-full transition-transform group-hover:scale-105",
            imageFit === "cover" ? "object-cover" : "object-contain",
          )}
          loading="lazy"
        />
        {loading && (
          // The embed (a network fetch + decode) lags the click — a spinner on
          // this card shows the insert is in progress and blocks re-invoking it.
          // z-10 keeps it above the attribution chip while the embed flies.
          <span
            role="status"
            aria-label={`Inserting ${artwork.title}`}
            className="absolute inset-0 z-10 flex items-center justify-center bg-muted/80"
          >
            <Loader2 aria-hidden className="size-4 animate-spin text-foreground" />
          </span>
        )}
      </button>
      {/* The author attribution — a small info chip, bottom-left. A real link
          to the author's profile (new tab) when the provider gave us one; a
          plain chip with a tooltip otherwise. */}
      {artwork.authorUrl ? (
        <a
          href={artwork.authorUrl}
          target="_blank"
          rel="noreferrer noopener"
          title={`By ${artwork.author}`}
          aria-label={`By ${artwork.author}`}
          className="absolute bottom-1 left-1 rounded-sm bg-background/80 p-0.5 text-muted-foreground hover:text-foreground"
        >
          <Info aria-hidden className="size-3" />
        </a>
      ) : (
        <span
          title={`By ${artwork.author}`}
          aria-label={`By ${artwork.author}`}
          className="absolute bottom-1 left-1 rounded-sm bg-background/80 p-0.5 text-muted-foreground"
        >
          <Info aria-hidden className="size-3" />
        </span>
      )}
    </div>
  )
}

/**
 * Placeholder cards while a search is in flight — the prototype's shimmer.
 */
function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 gap-2">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="aspect-square animate-pulse rounded-md bg-muted/60" />
      ))}
    </div>
  )
}

/**
 * The catalog gallery (map #34, ticket #41 — Variant C): a search-first panel
 * that replaces the whole sidebar until the back affordance restores it. A
 * search box, results as a two-column grid of thumbnails, drawn from the
 * bound Catalog (ticket #39). Nothing failing the license bar can appear —
 * the Catalog already drops it. An empty search is an explicit empty state;
 * provider-down surfaces through the app's existing status surface
 * (`reportStatus`) rather than a broken grid. Browsing only changes view
 * state — the Document is untouched until `insertArtwork`.
 */
export function CatalogPanel({
  active,
  onBack,
  catalog,
  heading,
  searchPlaceholder,
  searchLabel,
  providerName,
  providerUrl,
  noun,
  imageFit,
}: CatalogPanelProps) {
  const { insertArtwork, reportStatus } = useStage()
  const [query, setQuery] = useState("")
  const [state, setState] = useState<GalleryState>("idle")
  const [results, setResults] = useState<Artwork[]>([])
  // The opaque handle to the next page; null means the feed is exhausted.
  const [cursor, setCursor] = useState<string | null>(null)
  // True while a follow-up page is in flight — shows the "more" shimmer.
  const [loadingMore, setLoadingMore] = useState(false)
  // Guards against a stale search response clobbering a newer one.
  const searchSeq = useRef(0)
  // The source URLs whose embeds are still in flight — the matching card shows
  // a spinner: multiple inserts can overlap, so each is tracked independently.
  const [inserting, setInserting] = useState<Set<string>>(() => new Set())
  // The current term, readable without re-creating the loadMore closure.
  const queryRef = useRef("")
  // The current page handle, read synchronously by the loadMore guard.
  const cursorRef = useRef<string | null>(null)
  // Re-entry guard — the observer can fire faster than a page resolves.
  const fetchingMore = useRef(false)

  /** Run a search against the Catalog; surface provider-down via the status. */
  const runSearch = useCallback(
    async (term: string) => {
      const seq = ++searchSeq.current
      const trimmed = term.trim()
      // A blank term resets to the untouched idle state — nothing searched.
      if (!trimmed) {
        setState("idle")
        setResults([])
        setCursor(null)
        cursorRef.current = null
        return
      }
      setState("loading")
      try {
        const page = await catalog.search(trimmed)
        // Skip a stale response that a newer search already superseded.
        if (seq !== searchSeq.current) return
        setResults(page.artworks)
        setCursor(page.nextCursor)
        cursorRef.current = page.nextCursor
        setState(page.artworks.length > 0 ? "results" : "empty")
      } catch (error) {
        if (seq !== searchSeq.current) return
        setResults([])
        setCursor(null)
        cursorRef.current = null
        setState("error")
        reportStatus(
          error instanceof CatalogError
            ? error.message
            : `The ${noun} source couldn't be reached`,
        )
      }
    },
    [catalog, reportStatus, noun],
  )

  /** Append the next page once the grid's tail scrolls into view. */
  const loadMore = useCallback(async () => {
    // No page buffered yet, a fetch is already flying, or we've gone stale.
    if (fetchingMore.current || !cursorRef.current) return
    const seq = searchSeq.current
    const term = queryRef.current.trim()
    fetchingMore.current = true
    setLoadingMore(true)
    try {
      const page: CatalogPage = await catalog.search(term, cursorRef.current)
      // A newer search (or an edited term) superseded us — drop the page.
      if (seq !== searchSeq.current || term !== queryRef.current.trim()) return
      setResults((prev) => {
        // De-dupe by source URL — page-offset drift can repeat a hit.
        const seen = new Set(prev.map((artwork) => artwork.sourceUrl))
        return [...prev, ...page.artworks.filter((a) => !seen.has(a.sourceUrl))]
      })
      setCursor(page.nextCursor)
      cursorRef.current = page.nextCursor
    } catch {
      // A failed next page stops the feed; the prior results stay intact.
      setCursor(null)
      cursorRef.current = null
    } finally {
      fetchingMore.current = false
      setLoadingMore(false)
    }
  }, [catalog])

  // Keep the refs in step with the rendered query as it changes.
  useEffect(() => {
    queryRef.current = query
  }, [query])

  // The dominant scroll container and the "load more" tail it observes.
  const asideRef = useRef<HTMLElement | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  // A stable handle to the latest loadMore — the observer must not capture a
  // stale closure across re-renders.
  const loadMoreRef = useRef<() => void>(() => {})
  loadMoreRef.current = loadMore

  // Fire loadMore the moment the grid's tail enters the aside's viewport. The
  // aside is the scroll container (overflow-y-auto), so it is the observer's
  // root — infinite scroll stops naturally once nextCursor runs out (#41).
  useEffect(() => {
    const sentinel = sentinelRef.current
    const root = asideRef.current
    if (!sentinel || !root) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) loadMoreRef.current()
      },
      { root, rootMargin: "0px 0px 32px 0px" },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [cursor, state])

  // Search as the user types (debounced), matching a search-first panel.
  useEffect(() => {
    const handle = window.setTimeout(() => void runSearch(query), 250)
    return () => window.clearTimeout(handle)
  }, [query, runSearch])

  const onInsert = useCallback(
    (artwork: Artwork) => {
      // The embed resolves in ms-to-seconds — key the spinner by source URL
      // (unique per card) so the right card spins, and skip an already-in-
      // flight insert so clicking a spinning card never double-inserts.
      const source = artwork.sourceUrl
      if (inserting.has(source)) return
      setInserting((prev) => new Set(prev).add(source))
      // insertArtwork resolves true/false (never rejects), so finally is only
      // the spinner's teardown — it always clears. The embed goes through the
      // catalog this panel searched with.
      void insertArtwork(artwork, catalog).finally(() => {
        setInserting((prev) => {
          const next = new Set(prev)
          next.delete(source)
          return next
        })
      })
    },
    [insertArtwork, inserting, catalog],
  )

  return (
    // The panel stays mounted across navigation away/back so its search state
    // (query, results, scroll) survives; display:none hides it when another
    // panel is active. Only a browser refresh remounts it, resetting the term.
    <aside
      ref={asideRef}
      style={{ display: active ? "flex" : "none" }}
      className="flex w-56 shrink-0 flex-col overflow-y-auto border-r bg-background p-3"
    >
      <div className="mb-2 flex items-center gap-1.5">
        <Button
          variant="outline"
          size="icon-sm"
          className="shrink-0"
          onClick={onBack}
          aria-label="Back to the default sidebar"
        >
          <ArrowLeft aria-hidden />
        </Button>
        <span className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          {heading}
        </span>
      </div>

      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchLabel}
          className="pl-7"
        />
      </div>

      {state === "results" && query.trim() && (
        <p className="mt-3 text-xs text-muted-foreground">
          Showing results for “{query.trim()}” from{" "}
          <a
            href={providerUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="underline text-muted-foreground hover:text-foreground"
          >
            {providerName}
          </a>
        </p>
      )}

      <div className="mt-3 flex flex-1 flex-col gap-3">
        {state === "loading" && <SkeletonGrid />}
        {state === "results" && (
          <div className="grid grid-cols-2 gap-2">
            {results.map((artwork) => (
              <ArtworkCard
                key={artwork.sourceUrl}
                artwork={artwork}
                onInsert={onInsert}
                loading={inserting.has(artwork.sourceUrl)}
                imageFit={imageFit}
              />
            ))}
          </div>
        )}
        {state === "results" && cursor !== null && (
          // The "load more" tail: observing it loads the next page. It stays
          // only while the provider says a next page exists; loadingMore keeps
          // a rapid viewport re-fire from stacking fetches.
          <div
            ref={sentinelRef}
            aria-hidden="true"
            className="flex items-center justify-center py-2 text-xs text-muted-foreground"
          >
            {loadingMore ? "Loading more…" : "Scroll for more"}
          </div>
        )}
        {state === "empty" && (
          <p className="rounded-md border border-dashed p-3 text-center text-xs leading-relaxed text-muted-foreground">
            No {noun} matched “{query.trim()}”.
            <br />
            Try a different word.
          </p>
        )}
        {state === "error" && (
          // Provider-down: the grid stays empty and the status area already
          // explains it — never a broken grid (#41).
          <p className="rounded-md border border-dashed border-destructive p-3 text-center text-xs leading-relaxed text-muted-foreground">
            The {noun} source isn’t available right now.
          </p>
        )}
      </div>
    </aside>
  )
}
