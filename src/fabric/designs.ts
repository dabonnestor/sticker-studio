import { getExportHost } from "@/fabric/export"
import { parseDesignFile, type DesignFileV1 } from "@/fabric/design-file"
import { preloadFonts } from "@/fabric/fonts"

/**
 * The predesigns catalog (the sidebar's Designs panel): the ready-made
 * Design files shipped in `public/designs/` — the same envelope a Save writes
 * and an Import reads (ADR 0002) — offered as a gallery. Applying one is the
 * import path with the file picker replaced by a fetch: parse validates loudly,
 * the whole design lands as ONE undoable step, and the working file's basename
 * follows the design, so Save round-trips to the same name.
 *
 * The catalog is a static list — Vite serves `public/` as-is, outside the
 * module graph, so `import.meta.glob` cannot see it; adding a design means
 * dropping the file in `public/designs/` and adding one entry here.
 */

/** One predesign — a Design file shipped with the app. */
export interface Predesign {
  /** The design's id — the file basename, unique per design. */
  id: string
  /** The display name shown on the gallery tile. */
  name: string
  /** The design file's URL (served from /designs at the app root). */
  url: string
}

/** The shipped predesigns — one entry per file in `public/designs/`. */
export const PREDESIGNS: readonly Predesign[] = [
  { id: "no-smoking", name: "No Smoking", url: "/designs/no-smoking.json" },
  { id: "heavy-equipment", name: "Heavy Equipment", url: "/designs/heavy-equipment.json" },
]

/**
 * The fetch seam — injected so the catalog's tests exercise the network path
 * against a stub (the same pattern as the Pixabay catalog's `fetchFn`).
 */
type FetchFn = (url: string) => Promise<Response>

/** The parsed designs, keyed by id — an apply never re-fetches. */
const designCache = new Map<string, DesignFileV1>()

/**
 * Fetch and parse a predesign — the import path's read+validate, with the
 * file picker replaced by a fetch. Validates loudly (ADR 0002): a fetch
 * failure or a malformed file throws with a clear message and nothing is
 * applied. Parsed designs are cached per id, so the gallery's preview render
 * and an apply share one fetch.
 */
export async function loadPredesign(
  predesign: Predesign,
  fetchFn: FetchFn = (url) => fetch(url),
): Promise<DesignFileV1> {
  const cached = designCache.get(predesign.id)
  if (cached) return cached
  let text: string
  try {
    const response = await fetchFn(predesign.url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    text = await response.text()
  } catch {
    throw new Error("That design couldn't be loaded")
  }
  const design = parseDesignFile(text)
  designCache.set(predesign.id, design)
  return design
}

/** The thumbnail's long side in px — the tile is ~96 px, 150 keeps it crisp. */
const PREVIEW_PX = 150

/** The rendered thumbnails, keyed by id — the gallery never re-renders. */
const previewCache = new Map<string, string>()

/**
 * Render a predesign's gallery thumbnail — the design rendered offscreen at a
 * small size, exactly as it would appear on the stage: the same prepare path
 * the export pipeline uses (payload loaded verbatim, the document border
 * drawn inset, the rotation baked in), then a downscaled PNG data URL. Fonts
 * are awaited first so the thumbnail shows the real faces, not the fallback
 * (the app preloads them at startup, so this resolves fast). Returns null on
 * any failure — the tile falls back to its placeholder. Cached per id.
 */
export async function renderPredesignPreview(predesign: Predesign): Promise<string | null> {
  const cached = previewCache.get(predesign.id)
  if (cached) return cached
  try {
    const design = await loadPredesign(predesign)
    await preloadFonts()
    const prepared = await getExportHost().prepare({
      format: "PNG",
      width: design.size.width,
      height: design.size.height,
      rotation: design.rotation,
      borderWidth: design.border.width,
      borderColor: design.border.color,
      payload: design.canvas,
    })
    // The multiplier scales the canvas's own size (the rotated bounds) down
    // to the thumbnail's long side; retina scaling is off so the tile is
    // deterministic across displays.
    const multiplier = PREVIEW_PX / Math.max(prepared.canvas.width, prepared.canvas.height)
    const dataURL = prepared.canvas.toDataURL({
      format: "png",
      multiplier,
      enableRetinaScaling: false,
    })
    void prepared.canvas.dispose()
    previewCache.set(predesign.id, dataURL)
    return dataURL
  } catch {
    return null
  }
}
