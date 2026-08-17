import {
  ActiveSelection,
  Group,
  type Canvas,
  type Object as FabricObject,
} from "fabric"

import { loadEnvelope } from "@/fabric/design-file"

/**
 * Snapshot-based undo/redo (ADR 0001, build spec §8). Fabric ships no
 * undo/redo and documents are a few KB of JSON, so history is a document-
 * state stack: one full `canvas.toJSON()` snapshot pushed per interaction
 * boundary — the end of a transform gesture (`object:modified`), the exit of
 * a text session (Fabric fires `object:modified` after `text:editing:exited`,
 * §6), and once per structural command (the StageProvider commits after add,
 * delete, group, arrange, lock, property commits). The stack's previous entry
 * is the pre-interaction state, so nothing is captured mid-gesture and no
 * debouncing is needed.
 *
 * Restore is an async `loadFromJSON` with recording suppressed while it runs
 * (restores fire `object:added` storms). Selection is view state and never
 * serialized — each entry carries the object ids to reselect after restore.
 * Redo is linear and cleared by any new edit; depth is fixed at 100 snapshots,
 * oldest dropped.
 *
 * A boundary that left the document unchanged pushes nothing: a reverted text
 * session restores the pre-session state (which equals the top of the stack)
 * and a no-op gesture or property commit would make undo appear dead. The
 * comparison is the serializable state only — the selection is view state, so
 * a selection-only change is never a step.
 */

/** Fixed history depth — the oldest snapshots are dropped (ADR 0001, §8). */
export const HISTORY_DEPTH = 100

/**
 * One document-state snapshot — the canvas payload plus the envelope (§8).
 * The envelope fields — size, rotation, and the document border — are
 * document state, snapshotted alongside the canvas payload (ADR 0002).
 */
export interface HistoryEntry {
  /** `canvas.toJSON()` — the canvas payload, restored verbatim. */
  payload: ReturnType<Canvas["toJSON"]>
  /** Document size in px (envelope — the canvas dimensions, §5). */
  width: number
  height: number
  /** Document border — envelope-owned (ADR 0002); width 0 = off. */
  borderWidth: number
  borderColor: string
  /** Document rotation in degrees — envelope-owned (ADR 0002). */
  rotation: number
  /** Object ids to reselect after restore — selection is never serialized. */
  selectionIds: string[]
}

/** The stack's visible state — what the React chrome mirrors. */
export interface HistoryState {
  canUndo: boolean
  canRedo: boolean
}

/** The serializable document state — the payload plus the envelope fields. */
function entriesEqual(a: HistoryEntry, b: HistoryEntry): boolean {
  return (
    a.width === b.width &&
    a.height === b.height &&
    a.borderWidth === b.borderWidth &&
    a.borderColor === b.borderColor &&
    a.rotation === b.rotation &&
    JSON.stringify(a.payload) === JSON.stringify(b.payload)
  )
}

/** Find an object by its stable id — top level, or nested in a group (§7). */
function findObjectById(canvas: Canvas, id: string): FabricObject | undefined {
  for (const obj of canvas.getObjects()) {
    if (obj.id === id) return obj
    if (obj instanceof Group) {
      const child = obj.getObjects().find((o) => o.id === id)
      if (child) return child
    }
  }
  return undefined
}

/**
 * The undo/redo stack for one stage canvas. Created by the stage factory
 * (createStageCanvas), disposed with the canvas — the canvas-rebuild
 * lifecycle disposes and re-creates, and each rebuild starts a fresh history.
 */
export class History {
  private readonly canvas: Canvas

  /** The document states, newest last — the top is the current state. */
  private undoStack: HistoryEntry[] = []

  /** Redo states — linear, cleared by any new edit (§8). */
  private redoStack: HistoryEntry[] = []

  /**
   * Restores scheduled but not yet finished — recording is suppressed for
   * the whole window, from the synchronous `undo()`/`redo()` pop through the
   * queued restore's completion (ADR 0001). A counter, not a flag: a restore
   * queued behind another keeps suppression active across the gap.
   */
  private pendingRestores = 0

  /**
   * Import-time recording suppression (build spec §8, §10): a Design-file
   * import is ONE undoable step, but its flush of a pending text edit fires
   * `object:modified` (a commit boundary) before the import's own commit.
   * The import suspends recording around the flush + load, then commits the
   * whole import as the single step. A counter: nested suspensions balance.
   */
  private suppressedWrites = 0

  /**
   * Suppress commit recording — the design-file import path (build spec §10)
   * wraps its flush + loadWithEnvelope so the import snapshots once.
   */
  suspendRecording(): void {
    this.suppressedWrites++
  }

  /** Re-enable commit recording — must balance every suspendRecording. */
  resumeRecording(): void {
    this.suppressedWrites--
  }

  /**
   * Serializes restores: `loadFromJSON` is async and not re-entrant-safe, so
   * rapid undo/redo keypresses chain onto the previous restore instead of
   * interleaving. The stacks are authoritative regardless — undo/redo move
   * entries between them synchronously, and the queued restores bring the
   * canvas to whatever entry the queue finally points at.
   */
  private pendingRestore: Promise<void> = Promise.resolve()

  /** Fired after every commit/undo/redo — the React mirror's subscription. */
  onChange?: (state: HistoryState) => void

  /** The gesture-end boundary listener, named so dispose can detach it. */
  private readonly onObjectModified = () => {
    this.commit()
  }

  constructor(canvas: Canvas) {
    this.canvas = canvas
    // The end of a move/scale/rotate gesture — and of a committed text
    // session (Fabric fires object:modified after text:editing:exited, §6) —
    // is one interaction boundary (ADR 0001). A reverted session leaves the
    // document back at the top of the stack, so the commit's dedup skips it.
    canvas.on("object:modified", this.onObjectModified)
    // Seed the initial state: the stack's previous entry is the pre-
    // interaction state, so the first edit's undo must have an entry to
    // restore to — the empty Document this canvas starts from.
    this.commit()
  }

  get canUndo(): boolean {
    // The top of the stack is the current state — with only it, nothing
    // precedes the present to restore.
    return this.undoStack.length > 1
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  /**
   * Push the current document state as one undoable step (§8). A boundary
   * that left the serializable state unchanged pushes nothing; any push
   * clears the linear redo stack; the depth cap drops the oldest entry.
   */
  commit(): void {
    // A restore replays whole documents — its object:added storms must not
    // record (ADR 0001). Suppression spans the schedule-to-completion window:
    // a commit between the synchronous stack pop and the queued restore
    // would serialize a state the restore is about to overwrite, clear redo,
    // and leave the stack inconsistent with the canvas.
    if (this.pendingRestores > 0 || this.suppressedWrites > 0) return
    const entry: HistoryEntry = {
      payload: this.canvas.toJSON(),
      width: this.canvas.width,
      height: this.canvas.height,
      borderWidth: this.canvas.borderWidth,
      borderColor: this.canvas.borderColor,
      rotation: this.canvas.rotation,
      selectionIds: this.canvas.getActiveObjects().map((obj) => obj.id),
    }
    const top = this.undoStack[this.undoStack.length - 1]
    if (top && entriesEqual(top, entry)) return
    this.undoStack.push(entry)
    if (this.undoStack.length > HISTORY_DEPTH) this.undoStack.shift()
    if (this.redoStack.length > 0) this.redoStack.length = 0
    this.emitChange()
  }

  /** Restore the previous document state — one step back (§8). */
  undo(): Promise<void> {
    if (this.undoStack.length < 2) return this.pendingRestore
    const entry = this.undoStack.pop()!
    this.redoStack.push(entry)
    return this.scheduleRestore(this.undoStack[this.undoStack.length - 1])
  }

  /** Restore the next document state — linear, cleared by any new edit. */
  redo(): Promise<void> {
    const entry = this.redoStack.pop()
    if (!entry) return this.pendingRestore
    this.undoStack.push(entry)
    return this.scheduleRestore(entry)
  }

  /**
   * Detach the canvas listener — called by the stage canvas's dispose. The
   * stacks stay intact so the detachment is observable (a dispose is the
   * history's death; nothing calls undo on it afterwards).
   */
  dispose(): void {
    this.canvas.off("object:modified", this.onObjectModified)
    this.onChange = undefined
  }

  /** Chain a restore onto the previous one — never interleave restores. */
  private scheduleRestore(entry: HistoryEntry): Promise<void> {
    this.pendingRestores++
    this.pendingRestore = this.pendingRestore.then(() => this.restore(entry))
    return this.pendingRestore
  }

  /**
   * Async full-document restore (ADR 0001): apply the envelope — dimensions,
   * rotation, and the document border, the same `loadEnvelope` path a
   * Design-file import uses (never touched by `loadFromJSON`) — then the
   * payload. Recording is suppressed for the whole restore. The selection is
   * recreated from the entry's ids — missing ids (an object deleted since)
   * are silently skipped; nothing selected when none survive.
   */
  private async restore(entry: HistoryEntry): Promise<void> {
    try {
      const canvas = this.canvas
      await loadEnvelope(canvas, entry, entry.payload)
      const objects = entry.selectionIds
        .map((id) => findObjectById(canvas, id))
        .filter((obj): obj is FabricObject => obj !== undefined)
      if (objects.length > 1) {
        // Fabric 7 multi-select: wrap the members in an ActiveSelection.
        canvas.setActiveObject(new ActiveSelection(objects, { canvas }))
      } else if (objects.length === 1) {
        canvas.setActiveObject(objects[0])
      }
      canvas.requestRenderAll()
    } finally {
      this.pendingRestores--
      this.emitChange()
    }
  }

  private emitChange(): void {
    this.onChange?.({ canUndo: this.canUndo, canRedo: this.canRedo })
  }
}
