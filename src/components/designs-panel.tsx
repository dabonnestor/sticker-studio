import { useEffect, useState } from "react"
import { ArrowLeft, Loader2 } from "lucide-react"

import { useStage } from "@/components/stage-context"
import { Button } from "@/components/ui/button"
import {
  PREDESIGNS,
  renderPredesignPreview,
} from "@/fabric/designs"

/**
 * The Designs panel — the sidebar given over to the predesigns gallery,
 * mirroring the Shapes panel's pattern: a back affordance in the header
 * restores the default sidebar, and the designs render as a two-column grid
 * of square tiles (thumbnail over name). Choosing a tile applies that design
 * to the canvas — the import path with the file picker replaced by a fetch:
 * one undoable step, the working file's name following the design. Browsing
 * only changes view state — the Document is untouched until a tile is picked.
 */
export function DesignsPanel({ onBack, active }: { onBack: () => void; active: boolean }) {
  const { insertPredesign } = useStage()
  // The rendered thumbnails, keyed by design id — rendered once on mount and
  // cached in the designs module, so returning to the panel never re-renders.
  const [previews, setPreviews] = useState<Record<string, string>>({})
  // The design whose apply is in flight — its tile shows a spinner and the
  // grid ignores further clicks until it lands (an apply replaces the whole
  // Document, so overlapping applies would race).
  const [applying, setApplying] = useState<string | null>(null)

  // Render every thumbnail on mount. The panel stays mounted across
  // navigation (see the Shapes panel), so this runs once per app session.
  useEffect(() => {
    let cancelled = false
    void Promise.all(
      PREDESIGNS.map(async (predesign) => {
        const dataURL = await renderPredesignPreview(predesign)
        if (!cancelled && dataURL) {
          setPreviews((prev) => ({ ...prev, [predesign.id]: dataURL }))
        }
      }),
    )
    return () => {
      cancelled = true
    }
  }, [])

  return (
    // Kept mounted across navigation (see the Shapes panel) so returning to a
    // panel doesn't rebuild it; display:none hides it when another view is up.
    <aside
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
          Designs
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {PREDESIGNS.map((predesign) => (
          <div key={predesign.id} className="flex flex-col gap-1">
            {/* A wrapper div keeps the tile and its overlay siblings — the
                spinner overlay covers the whole tile without swallowing the
                insert click. */}
            <div className="group relative aspect-square overflow-hidden rounded-md border bg-muted/50">
              <button
                type="button"
                title={predesign.name}
                onClick={() => {
                  if (applying) return
                  setApplying(predesign.id)
                  // insertPredesign resolves (never rejects), so finally is
                  // only the spinner's teardown — it always clears.
                  void insertPredesign(predesign).finally(() => setApplying(null))
                }}
                disabled={applying !== null}
                aria-busy={applying === predesign.id}
                className="absolute inset-0 flex items-center justify-center"
              >
                {previews[predesign.id] ? (
                  <img
                    src={previews[predesign.id]}
                    alt={predesign.name}
                    className="h-full w-full object-cover transition-transform group-hover:scale-105"
                  />
                ) : (
                  // The thumbnail render (a fetch + offscreen render) lags
                  // the mount — a spinner shows the tile is on its way.
                  <Loader2
                    aria-hidden
                    className="size-4 animate-spin text-muted-foreground"
                  />
                )}
                {applying === predesign.id && (
                  // The apply (a fetch + full load) lags the click — a spinner
                  // on this tile shows the apply is in progress and blocks
                  // re-invoking it. z-10 keeps it above the thumbnail.
                  <span
                    role="status"
                    aria-label={`Applying ${predesign.name}`}
                    className="absolute inset-0 z-10 flex items-center justify-center bg-muted/80"
                  >
                    <Loader2 aria-hidden className="size-4 animate-spin text-foreground" />
                  </span>
                )}
              </button>
            </div>
            <span className="truncate text-center text-[11px] leading-tight font-normal text-muted-foreground">
              {predesign.name}
            </span>
          </div>
        ))}
      </div>
    </aside>
  )
}
