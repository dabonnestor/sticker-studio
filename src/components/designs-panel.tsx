import { useEffect, useState } from "react"
import { ArrowLeft, Loader2 } from "lucide-react"

import { useStage } from "@/components/stage-context"
import { Button } from "@/components/ui/button"
import {
  PREDESIGNS,
  predesignShape,
  renderPredesignPreview,
} from "@/fabric/designs"
import {
  getStickerShape,
  STICKER_SHAPE_LABELS,
  type StickerShape,
} from "@/fabric/outline"

/**
 * The Designs panel — the sidebar given over to the predesigns gallery,
 * mirroring the Shapes panel's pattern: a back affordance in the header
 * restores the default sidebar, and the designs render as a two-column grid
 * of square tiles (thumbnail over name). Choosing a tile applies that design
 * to the canvas — the import path with the file picker replaced by a fetch:
 * one undoable step, the working file's name following the design. Browsing
 * only changes view state — the Document is untouched until a tile is picked.
 *
 * The gallery offers only the designs made for the Document's own sticker
 * shape (map #48): a Predesign is drawn for a cut line, and one made for a
 * Square would be trimmed by an Oval's clip — so a shape that has no designs
 * yet (Rounded corner, Oval, Circle) shows a "none yet" state, empty on
 * purpose rather than broken.
 */
export function DesignsPanel({ onBack, active }: { onBack: () => void; active: boolean }) {
  const { insertPredesign, documentOutline } = useStage()
  // The rendered thumbnails, keyed by design id — rendered once on mount and
  // cached in the designs module, so returning to the panel never re-renders.
  const [previews, setPreviews] = useState<Record<string, string>>({})
  // The sticker each design is made for, keyed by design id — read from the
  // design's own envelope (map #48), so it cannot drift from the file.
  const [shapes, setShapes] = useState<Record<string, StickerShape>>({})
  // True once every design has been read (or failed to be) — the gallery
  // below can then tell "nothing matches this shape" from "nothing is
  // loaded yet", which is the difference between the empty state and a flash
  // of it on the way in.
  const [settled, setSettled] = useState(false)
  // The design whose apply is in flight — its tile shows a spinner and the
  // grid ignores further clicks until it lands (an apply replaces the whole
  // Document, so overlapping applies would race).
  const [applying, setApplying] = useState<string | null>(null)

  // Read every design on mount — its thumbnail and its sticker shape, from
  // the one cached load. The panel stays mounted across navigation (see the
  // Shapes panel), so this runs once per app session.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      await Promise.all(
        PREDESIGNS.map(async (predesign) => {
          const [dataURL, shape] = await Promise.all([
            renderPredesignPreview(predesign),
            // A design that cannot be read has no shape to match, so it stays
            // out of every gallery — a broken file is never offered as a tile.
            predesignShape(predesign).catch(() => null),
          ])
          if (cancelled) return
          if (dataURL) {
            setPreviews((prev) => ({ ...prev, [predesign.id]: dataURL }))
          }
          if (shape) {
            setShapes((prev) => ({ ...prev, [predesign.id]: shape }))
          }
        }),
      )
      if (!cancelled) setSettled(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // The shape the Document on the stage reads as. Derived here rather than
  // mirrored — it is a reading of the outline, not a second copy of it.
  const shape = getStickerShape(documentOutline)
  const matching = PREDESIGNS.filter((predesign) => shapes[predesign.id] === shape)

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

      {settled && matching.length === 0 ? (
        // The gallery's empty state, for a shape nothing has been drawn for
        // yet (map #48). It reads as "none yet" rather than as a failure:
        // nothing is broken, the shelf is bare, and more designs are the
        // author's to add. The line under it explains the filter — without it
        // a bare gallery reads as a bug.
        <p className="mt-3 rounded-md border border-dashed p-3 text-center text-xs leading-relaxed text-muted-foreground">
          No {STICKER_SHAPE_LABELS[shape]} designs yet.
          <br />
          The gallery shows designs made for this sticker’s shape.
        </p>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {matching.map((predesign) => (
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
      )}
    </aside>
  )
}
