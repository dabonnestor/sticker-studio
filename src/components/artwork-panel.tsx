import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowLeft, Search } from "lucide-react"

import { useStage } from "@/components/stage-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CatalogError, type Artwork } from "@/fabric/catalog"

/** The gallery's states — mirror of the prototype's control-bar states. */
type GalleryState =
  | "idle" // no search yet
  | "loading" // a search is in flight
  | "results" // matching artwork shown
  | "empty" // a search matched nothing
  | "error" // provider-down / network failure (surfaced via the status area)

/**
 * One result in the grid: the preview thumbnail with a small license badge.
 */
function ArtworkCard({
  artwork,
  onInsert,
}: {
  artwork: Artwork
  onInsert: (artwork: Artwork) => void
}) {
  return (
    <button
      type="button"
      title={`${artwork.title} (${artwork.license})`}
      onClick={() => onInsert(artwork)}
      className="group relative flex aspect-square items-center justify-center overflow-hidden rounded-md border bg-muted/50"
    >
      {/* The preview is a separate fetch; a broken thumbnail keeps the card. */}
      <img
        src={artwork.previewUrl}
        alt={artwork.title}
        className="h-full w-full object-contain transition-transform group-hover:scale-105"
        loading="lazy"
      />
    </button>
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
 * The Artwork gallery (map #34, ticket #41 — Variant C): a search-first panel
 * that replaces the whole sidebar until the back affordance restores it. A
 * search box, results as a two-column grid of thumbnails, drawn from the
 * Catalog (ticket #39). Nothing failing the
 * license bar can appear — the Catalog already drops it. An empty search is
 * an explicit empty state; provider-down surfaces through the app's existing
 * status surface (`reportStatus`) rather than a broken grid. Browsing only
 * changes view state — the Document is untouched until `insertArtwork`.
 */
export function ArtworkPanel({ onBack }: { onBack: () => void }) {
  const { catalog, insertArtwork, reportStatus } = useStage()
  const [query, setQuery] = useState("")
  const [state, setState] = useState<GalleryState>("idle")
  const [results, setResults] = useState<Artwork[]>([])
  // Guards against a stale search response clobbering a newer one.
  const searchSeq = useRef(0)

  /** Run a search against the Catalog; surface provider-down via the status. */
  const runSearch = useCallback(
    async (term: string) => {
      const seq = ++searchSeq.current
      const trimmed = term.trim()
      // A blank term resets to the untouched idle state — nothing searched.
      if (!trimmed) {
        setState("idle")
        setResults([])
        return
      }
      setState("loading")
      try {
        const found = await catalog.search(trimmed)
        // Skip a stale response that a newer search already superseded.
        if (seq !== searchSeq.current) return
        setResults(found)
        setState(found.length > 0 ? "results" : "empty")
      } catch (error) {
        if (seq !== searchSeq.current) return
        setResults([])
        setState("error")
        reportStatus(
          error instanceof CatalogError
            ? error.message
            : "The artwork source couldn't be reached",
        )
      }
    },
    [catalog, reportStatus],
  )

  // Search as the user types (debounced), matching a search-first panel.
  useEffect(() => {
    const handle = window.setTimeout(() => void runSearch(query), 250)
    return () => window.clearTimeout(handle)
  }, [query, runSearch])

  const onInsert = useCallback(
    (artwork: Artwork) => {
      void insertArtwork(artwork)
    },
    [insertArtwork],
  )

  return (
    <aside className="flex w-56 shrink-0 flex-col overflow-y-auto border-r bg-background p-3">
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
          Graphics
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
          placeholder="Search graphics…"
          aria-label="Search graphics"
          className="pl-7"
        />
      </div>

      <div className="mt-3 flex flex-1 flex-col gap-3">
        {state === "loading" && <SkeletonGrid />}
        {state === "results" && (
          <div className="grid grid-cols-2 gap-2">
            {results.map((artwork) => (
              <ArtworkCard key={artwork.sourceUrl} artwork={artwork} onInsert={onInsert} />
            ))}
          </div>
        )}
        {state === "empty" && (
          <p className="rounded-md border border-dashed p-3 text-center text-xs leading-relaxed text-muted-foreground">
            No artwork matched “{query.trim()}”.
            <br />
            Try a different word.
          </p>
        )}
        {state === "error" && (
          // Provider-down: the grid stays empty and the status area already
          // explains it — never a broken grid (#41).
          <p className="rounded-md border border-dashed border-destructive p-3 text-center text-xs leading-relaxed text-muted-foreground">
            The artwork source isn’t available right now.
          </p>
        )}
      </div>
    </aside>
  )
}