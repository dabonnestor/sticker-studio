import { type Canvas } from "fabric"

import {
  loadEnvelope,
  parseDesignFile,
  serializeDesignFile,
} from "@/fabric/design-file"
import { OUTLINE_KINDS, presetDefaultSize } from "@/fabric/outline"
import {
  DOCUMENT_BACKGROUND_COLOR,
  DOCUMENT_BORDER_COLOR,
  DOCUMENT_BORDER_WIDTH,
  DOCUMENT_ROTATION,
  type StageCanvas,
} from "@/fabric/stage-canvas"

/**
 * Auto-persist the working design (map #27, tickets #31–#33): the Document
 * writes to browser storage at every interaction boundary — the same signal
 * the History commits on — so the work survives refresh without any explicit
 * Save. Two guards keep it honest (ticket #31):
 *
 * - **Blank-guard** — a factory-fresh canvas (a fresh sheet of its own
 *   sticker preset, zero objects) never overwrites an already-stored draft: a
 *   blank or new session can't clobber the last real design.
 * - **Size guard** — a draft over the ~3.5M-char ceiling is skipped (never a
 *   partially-written value), leaving the older good copy intact, with a clear
 *   notice once per session.
 *
 * The restore (ticket #32) reads the stored envelope back through the same
 * `parseDesignFile` validation as Import, loads it onto the mounted canvas
 * before the mirrors read their first values, and re-seeds the undo stack to a
 * single entry so a resumed design can never undo back to a blank sheet. A
 * corrupt stored value soft-fails: the key is wiped and the app boots blank.
 *
 * View state (zoom, selection, preview) never enters the draft — only the
 * Design-file envelope, the same bytes `serializeDesignFile` produces for
 * manual Save (§10).
 */

/** The single localStorage key holding the working draft (map #28). */
export const WORKING_DRAFT_KEY = "sticker-studio:working-draft"

/**
 * The hard size guard (map #28, ticket #31): a draft over this many characters
 * is never written (~3.5 MB — under localStorage's per-origin ceiling with
 * headroom). A fresh, oversized design must not drop a fallow earlier copy.
 */
export const DRAFT_CHAR_CEILING = 3_500_000

/**
 * True once the oversize notice has been shown this session — a user editing
 * continuously with an oversized design is told once, not every boundary.
 * Reset when a later write succeeds, so a new over-ceiling episode can notice
 * again.
 */
let oversizeNotified = false

/** Test-only reset of the once-per-session oversize notice flag. */
export function resetAutoPersistTestState(): void {
  oversizeNotified = false
}

/**
 * Read the raw working draft from browser storage — null when absent or when
 * storage is unavailable (a private tab that throws on access). Soft: never
 * throws; the caller validates the value via `parseDesignFile`.
 */
export function readWorkingDraft(): string | null {
  try {
    return window.localStorage.getItem(WORKING_DRAFT_KEY)
  } catch {
    return null
  }
}

/**
 * Write the serialized draft string, or refuse. Refuses (returns false) when
 * the value is over the character ceiling or storage throws (quota exceeded or
 * unavailable). The blank-guard lives in the caller (`persistWorkingDraft`).
 */
export function writeWorkingDraft(json: string): boolean {
  if (json.length > DRAFT_CHAR_CEILING) return false
  try {
    window.localStorage.setItem(WORKING_DRAFT_KEY, json)
    return true
  } catch {
    return false
  }
}

/** Clear the working draft — Start-new's escape hatch, and the corrupt path. */
export function clearWorkingDraft(): void {
  try {
    window.localStorage.removeItem(WORKING_DRAFT_KEY)
  } catch {
    // Storage unavailable — nothing to clear.
  }
}

/**
 * The blank-guard predicate (ticket #31, map #48): a document is
 * "factory-fresh" when it is a fresh sheet of its own sticker preset — white,
 * unrotated, borderless, empty, and at the size its preset creates at. That
 * is the state a brand-new session starts from, and the only state that must
 * never claim an existing draft. A styled empty document (background, border,
 * or rotation changed) is not blank and writes normally.
 *
 * The size is read against the *preset* rather than a fixed 600×600 sheet
 * (map #48): now that a Document boots at a preset's Default size, comparing
 * against one fixed size would misread every other preset — the boot sheet
 * included — as a real design, and a blank session would clobber the stored
 * draft it exists to protect.
 *
 * Where the preset fixes the size, a deviation means the user resized the
 * sheet, so it is a real design and writes. Where it does not — rect + free
 * is the state of both Rectangle and Custom — no size can make the sheet read
 * as unfresh, because a Custom sheet that has just replaced a design must not
 * write itself over the draft it replaced.
 */
export function isFactoryBlank(canvas: Canvas): boolean {
  // The decisive check, and the cheapest: a sheet with content is a design.
  if (canvas.getObjects().length > 0) return false
  // An outline state the app does not know cannot be a fresh sheet — and the
  // derivation below has no answer for it.
  if (!OUTLINE_KINDS.has(canvas.outline)) return false
  if (
    canvas.rotation !== DOCUMENT_ROTATION ||
    canvas.backgroundColor !== DOCUMENT_BACKGROUND_COLOR ||
    canvas.borderWidth !== DOCUMENT_BORDER_WIDTH ||
    canvas.borderColor !== DOCUMENT_BORDER_COLOR
  ) {
    return false
  }
  const defaultSize = presetDefaultSize({
    outline: canvas.outline,
    aspectLocked: canvas.aspectLocked,
  })
  if (!defaultSize) return true
  return (
    canvas.width === defaultSize.width && canvas.height === defaultSize.height
  )
}

/**
 * The write path (ticket #31) — called at every interaction boundary (the
 * History's `onCommit`). Serializes the Document as a Design-file envelope,
 * refuses when the canvas is factory-blank (the older draft survives), and
 * writes when it fits — otherwise skips with a once-per-session notice. Export
 * and manual Save are untouched: this layer only ever mirrors a Document
 * boundary to storage.
 */
export function persistWorkingDraft(
  canvas: Canvas,
  onNotice?: (message: string) => void,
): void {
  // A blank or new session must not clobber the last real design (ticket
  // #31). The guard runs before serializing what it would reject — a
  // factory-fresh canvas never touches storage.
  if (isFactoryBlank(canvas)) return
  const json = JSON.stringify(serializeDesignFile(canvas))
  if (writeWorkingDraft(json)) {
    oversizeNotified = false
    return
  }
  // The write failed. Distinguish the two ways (ticket #31): only an actually
  // oversized draft is told "too large" — a below-ceiling value rejected by
  // storage (unavailable/quota) is a different failure, skipped without
  // claiming the ceiling notice. Either way nothing was written (never a
  // partial value) and the older stored draft is left intact.
  if (json.length > DRAFT_CHAR_CEILING && !oversizeNotified) {
    oversizeNotified = true
    onNotice?.("This design is too large to auto-save — it isn't stored")
  }
}

/**
 * The restore path (ticket #32) — called from the Stage's mount, after the
 * canvas is created and before the mirrors read their first values or the
 * load-time Fit runs, so the reflected size/border/rotation and the fit
 * describe the restored sheet. Reads the stored draft, validates it through
 * the same `parseDesignFile` as Import, loads it under suspended recording
 * (the load spawns object:added storms), and re-seeds the undo stack to the
 * single restored state — undo dead until the first new edit.
 *
 * Returns true when a draft was restored. With no draft it is a no-op; with a
 * corrupt (unreadable) value it wipes the key and returns false — the app
 * boots blank with a clear notice and never throws on mount.
 */
export async function restoreWorkingDraft(
  canvas: StageCanvas,
  opts: { onNotice?: (message: string) => void } = {},
): Promise<boolean> {
  const raw = readWorkingDraft()
  if (raw === null) return false

  let design: ReturnType<typeof parseDesignFile>
  try {
    design = parseDesignFile(raw)
  } catch {
    // Unreadable/corrupt — soft-fail: wipe the key so a refresh doesn't
    // retry the same garbage, and boot blank (ticket #32).
    clearWorkingDraft()
    opts.onNotice?.("Couldn't resume the saved design — started fresh")
    return false
  }

  // Import-style: suspend recording across the load, so the object:added
  // storms don't record; the History re-seed below is the only stack change.
  canvas.history.suspendRecording()
  try {
    await loadEnvelope(
      canvas,
      {
        width: design.size.width,
        height: design.size.height,
        rotation: design.rotation,
        borderWidth: design.border.width,
        borderColor: design.border.color,
        outline: design.outline.outline,
        aspectLocked: design.outline.aspectLocked,
      },
      design.canvas,
    )
  } catch {
    // A load failure on a successfully-validated draft is transient, not
    // corrupt: `parseDesignFile` already rejected every structural problem
    // (unknown types, malformed envelope) above, so the only way here is a
    // dispose that raced the restore during a remount (StrictMode's dev
    // double-mount). Wiping would destroy a valid copy a sibling mount just
    // restored — so the key is left in place and the boot soft-fails blank.
    // The ticket's "corrupt → wipe" case is fully the parse branch above.
    return false
  } finally {
    canvas.history.resumeRecording()
    canvas.requestRenderAll()
  }

  // Re-seed the undo stack: the restored Document is the only entry, so the
  // first Undo can never reveal a blank sheet (ticket #32).
  canvas.history.reset()
  return true
}
