/**
 * Recent uploads (the sidebar's Uploads panel): the gallery of previously
 * uploaded image files, kept in browser storage so it survives refresh —
 * the same way the working draft does (auto-persist, map #27). Unlike the
 * draft, this store holds no canvas state: it is a small list of image
 * bytes, deduped by data URL and capped so it can never starve the 5 MB
 * budget the working draft shares.
 *
 * What enters the gallery is a **downscaled copy**, not the original file:
 * a phone photo is megabytes as a data URL — it cannot live in localStorage
 * alongside a draft that itself may reach 3.5 M chars. `createGalleryCopy`
 * re-encodes the image at most {@link GALLERY_MAX_DIMENSION} pixels on its
 * long edge (more than an 80% fit in a 600×600 document needs), so typical
 * copies are tens of KB. The caller always places the original bytes on the
 * canvas — only the gallery entry is the copy, and clicking a tile re-inserts
 * the copy's pixels, not the original's.
 *
 * Two guards keep the store honest, mirroring auto-persist's (ticket #31):
 *
 * - **Size guard** — a stored copy over `UPLOAD_CHAR_CAP` is refused
 *   (recordRecentUpload returns null): the caller still places the image on
 *   the canvas, but it never enters the gallery. After downscaling plus
 *   JPEG/WebP encoding the ceiling only trips on pathological images, so a
 *   real upload almost never sees it.
 * - **Quota guard** — when a write is refused by storage (quota or
 *   unavailable), the oldest entries are dropped until the write fits, and a
 *   still-failing write skips the persist entirely. The returned list — the
 *   in-memory truth the panel renders — is unaffected: merging happens
 *   against the caller's current list, never against what storage accepted.
 *   Only a refresh, which re-reads storage, reveals what was dropped.
 *
 * The read is soft: a corrupt stored value wipes the key (the same
 * soft-fail as a corrupt draft, ticket #32) and the store returns empty.
 */

/** The single localStorage key holding the recent-uploads list. */
export const RECENT_UPLOADS_KEY = "sticker-studio:recent-uploads"

/** The gallery's length — the most recent this many uploads are kept. */
export const MAX_RECENT_UPLOADS = 6

/**
 * The per-file size guard: a stored copy whose data URL exceeds this many
 * characters (~1 MB) is refused — it can never enter the gallery. The caller
 * may still place the image on the canvas; it is only gallery material that
 * is refused, never the placement. The ceiling exists so the list's worst
 * case can never dwarf the working draft's share of the 5 MB budget, but a
 * downscaled, JPEG/WebP-encoded copy is far smaller — the ceiling is a
 * backstop for pathological images, not a gate typical uploads hit.
 */
export const UPLOAD_CHAR_CAP = 1_000_000

/**
 * The long-edge limit of a stored gallery copy, in pixels. 800 px is more
 * than an 80%-fit placement in the 600×600 document needs (480 px), so a
 * re-inserted copy reads sharp on screen and survives a typical export
 * without inventing pixels; it also keeps copies small enough for storage.
 */
export const GALLERY_MAX_DIMENSION = 800

/** One gallery entry — the data URL is the identity and the pixels. */
export interface RecentUpload {
  /** The uploaded file's name — shown on the tile's title. */
  name: string
  /** The stored copy's data URL — self-contained, like the Document's images. */
  dataURL: string
}

/**
 * Make the gallery's stored copy of an uploaded image: decode the source
 * data URL, re-draw at most {@link GALLERY_MAX_DIMENSION} pixels on the long
 * edge (never upscaled — a small source stays its own size), and re-encode
 * as JPEG when the source is a JPEG (its bytes already have no alpha) or
 * WebP otherwise, which keeps alpha and compresses photographs far smaller
 * than PNG. A browser that cannot encode WebP falls back to PNG.
 *
 * Browser-only: decoding and re-encoding need a real canvas 2D context,
 * which jsdom does not provide, so this function is deliberately not covered
 * by the suite (the test canvas stub cannot draw). It resolves null on any
 * failure — decode error, missing context, encode error — and the caller
 * falls back to storing the original bytes.
 */
export function createGalleryCopy(dataURL: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      try {
        const scale = Math.min(
          1,
          GALLERY_MAX_DIMENSION / img.width,
          GALLERY_MAX_DIMENSION / img.height,
        )
        const canvas = document.createElement("canvas")
        canvas.width = Math.max(1, Math.round(img.width * scale))
        canvas.height = Math.max(1, Math.round(img.height * scale))
        const ctx = canvas.getContext("2d")
        if (!ctx) {
          resolve(null)
          return
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        if (dataURL.startsWith("data:image/jpeg")) {
          // A JPEG source stays JPEG — re-encoding it as PNG would bloat
          // the copy, and there is no alpha to preserve.
          resolve(canvas.toDataURL("image/jpeg", 0.85))
          return
        }
        // Alpha-capable sources (PNG screenshots, WebP, GIF) re-encode as
        // WebP; an encoder that can't produce WebP falls back to PNG.
        const encoded = canvas.toDataURL("image/webp", 0.85)
        resolve(
          encoded.startsWith("data:image/webp")
            ? encoded
            : canvas.toDataURL("image/png"),
        )
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = dataURL
  })
}

/**
 * Read the stored list, newest first. Absent → empty; a corrupt value wipes
 * the key (a refresh must not retry the same garbage) and reads empty. Soft:
 * never throws — storage unavailable reads as empty.
 */
export function readRecentUploads(): RecentUpload[] {
  let raw: string | null
  try {
    raw = window.localStorage.getItem(RECENT_UPLOADS_KEY)
  } catch {
    return []
  }
  if (raw === null) return []
  try {
    const list = JSON.parse(raw) as unknown
    if (!Array.isArray(list)) throw new Error("not a list")
    return list.filter(
      (entry): entry is RecentUpload =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as RecentUpload).name === "string" &&
        typeof (entry as RecentUpload).dataURL === "string",
    )
  } catch {
    // Unreadable/corrupt — wipe so a refresh doesn't retry the garbage.
    clearRecentUploads()
    return []
  }
}

/**
 * Record an upload as the newest entry. The merge happens against `current`
 * — the caller's in-memory gallery (seeded from {@link readRecentUploads} at
 * mount) — so entries that storage refused earlier in the session survive
 * the merge; storage is only ever the write target. Deduped by data URL
 * (re-uploading the same bytes moves it to the front instead of doubling the
 * tile) and trimmed to {@link MAX_RECENT_UPLOADS}, the returned list is the
 * gallery's truth, newest first. Null when the upload is refused as over the
 * size guard — nothing is written and the caller decides what to tell the
 * user; the placement itself is untouched.
 */
export function recordRecentUpload(
  dataURL: string,
  name: string,
  current: RecentUpload[],
): RecentUpload[] | null {
  if (dataURL.length > UPLOAD_CHAR_CAP) return null
  // Dedup by data URL, then prepend the new upload — the gallery shows the
  // most recent placement of each distinct image.
  const list = [
    { name, dataURL },
    ...current.filter((entry) => entry.dataURL !== dataURL),
  ].slice(0, MAX_RECENT_UPLOADS)
  writeRecentUploads(list)
  return list
}

/**
 * Remove an upload from the gallery — the inverse of
 * {@link recordRecentUpload}. The merge happens against `current`, the
 * caller's in-memory gallery (same contract as recording), so the entry is
 * dropped wherever it sits; the trimmed list is persisted, and removing the
 * last entry clears the key entirely. A missing data URL is a no-op that
 * still returns the list unchanged.
 */
export function removeStoredUpload(
  dataURL: string,
  current: RecentUpload[],
): RecentUpload[] {
  const list = current.filter((entry) => entry.dataURL !== dataURL)
  if (list.length === 0) clearRecentUploads()
  else writeRecentUploads(list)
  return list
}

/**
 * Write the list, dropping the oldest entries until storage accepts it:
 * a write refused by quota (or unavailable storage) shrinks the list by its
 * oldest entry and retries — the newest uploads are the ones worth keeping.
 * A still-failing write gives up: nothing is stored and the caller's
 * in-memory list simply won't survive a refresh.
 */
function writeRecentUploads(list: RecentUpload[]): void {
  try {
    window.localStorage.setItem(RECENT_UPLOADS_KEY, JSON.stringify(list))
  } catch {
    if (list.length <= 1) return
    writeRecentUploads(list.slice(0, -1))
  }
}

/** Clear the stored list — the corrupt path, and future escape hatches. */
export function clearRecentUploads(): void {
  try {
    window.localStorage.removeItem(RECENT_UPLOADS_KEY)
  } catch {
    // Storage unavailable — nothing to clear.
  }
}
