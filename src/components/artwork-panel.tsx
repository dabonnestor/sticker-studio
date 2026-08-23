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
      <span className="absolute top-1 right-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[9px] leading-none text-white">
        {artwork.license}
      </span>
    </button>
  )
}

/**
 * Placeholder cards while a search is in flight — the prototype's shimmer.
 */
function SkeletonGrid() {
  return (
    <div className="grid grid-cols-3 gap-2">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="aspect-square animate-pulse rounded-md bg-muted/60" />
      ))}
    </div>
  )
}

/**
 * The Artwork gallery (map #34, ticket #41 — Variant C): a search-first panel
 * that replaces the whole sidebar until the back affordance restores it. A
 * search box, results as a 3-across grid of thumbnails each carrying a small
 * license badge, drawn from the Catalog (ticket #39). Nothing failing the
 * license bar can appear — the Catalog already drops it. An empty search is
 * an explicit empty state; provider-down surfaces through the app's existing
 * status surface (`reportStatus`) rather than a broken grid. Browsing only
 * changes view state — the Document is untouched until `insertArtwork`.
 *
 * On Insert (#42) the panel stays open showing an "Inserted · Undo" line;
 * Undo reverts the insertion alone, and because the grid stays mounted its
 * scroll position survives.
 */
export function ArtworkPanel({ onBack }: { onBack: () => void }) {
  const { catalog, insertArtwork, undo, reportStatus } = useStage()
  const [query, setQuery] = useState("")
  const [state, setState] = useState<GalleryState>("idle")
  const [results, setResults] = useState<Artwork[]>([])
  const [inserted, setInserted] = useState<Artwork | null>(null)
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
    async (artwork: Artwork) => {
      setInserted(artwork)
      const ok = await insertArtwork(artwork)
      // Only a landed insert shows the Inserted line; a refusal or failure
      // already surfaced its own message in the status area (#42).
      if (!ok) setInserted(null)
    },
    [insertArtwork],
  )

  const onUndo = useCallback(() => {
    void undo()
    setInserted(null)
  }, [undo])

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
          Artwork
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
          placeholder="Search artwork…"
          aria-label="Search artwork"
          className="pl-7"
        />
      </div>

      <div className="mt-3 flex flex-1 flex-col gap-3">
        {state === "loading" && <SkeletonGrid />}
        {state === "results" && (
          <div className="grid grid-cols-3 gap-2">
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

      {/* Insert feedback (#42), above the grid — Undo reverts the insertion. */}
      {inserted && (
        <div className="mt-2 flex items-center justify-between gap-1.5 rounded-md border bg-background px-2 py-1.5 text-xs">
          <span className="min-w-0 truncate text-muted-foreground">
            Inserted “{inserted.title}”
          </span>
          <Button variant="ghost" size="sm" className="h-6 shrink-0 px-2" onClick={onUndo}>
            Undo
          </Button>
        </div>
      )}
    </aside>
  )
}