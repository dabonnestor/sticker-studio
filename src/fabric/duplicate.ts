import {
  ActiveSelection,
  Group,
  util,
  type Object as FabricObject,
  type Transform,
  type TPointerEventInfo,
} from "fabric"

import { stampCloneTree } from "@/fabric/clipboard"
import { isGrouped } from "@/fabric/groups"
import type { StageCanvas } from "@/fabric/stage-canvas"
import { bakeTextScale, isTextObject } from "@/fabric/text"

/**
 * Alt-drag duplication: pressing an object with Alt held and dragging
 * duplicates it — the copy takes over the drag exactly where the source
 * stood, and the source stays put. The design-tool standard (Figma's
 * Option-drag, Illustrator's Alt-drag): the duplicate is a
 * live copy of the pressed object — single objects, Groups (whole group
 * cloned) and multi-selections (the ActiveSelection duplicated as the same
 * set of separate objects, the members' world positions baked).
 *
 * Mechanics — the clone is created asynchronously (Fabric's `enlivenObjects`
 * round-trips `toObject()`, the same clone path paste uses), so the gesture
 * starts on the source and is **handed to the clone** when it lands: the
 * in-flight transform's `target` is swapped, and Fabric's `dragHandler`
 * positions the target purely from the pointer (`x − offsetX`), so a clone
 * sitting exactly at the source's pre-drag position continues seamlessly
 * from wherever the pointer stands. The source is restored to its pre-drag
 * position (`transform.original`) in case a pre-swap tick moved it — real
 * for image clones, whose enliven waits on a `load` task; shapes, text, and
 * groups resolve in microtasks, before the first `mousemove` is ever
 * processed.
 *
 * One undoable step (ADR 0001): the gesture ends with `object:modified` on
 * the clone, which the History commits. A press that never drags (an
 * Alt-click) rolls the clone back — nothing was committed (`actionPerformed`
 * stays false), so the document returns to exactly the pre-press state.
 * The whole gesture runs with `canvas.altDragDuplicating` set — the smart
 * guides read it and keep snapping for the duplicate (ADR 0004's Alt
 * suppression is for plain moves: Alt pressed mid-drag, not at press).
 *
 * Skipped entirely: presses on a handle (the transform's action is
 * "scale"/"rotate"/… — Alt-kept handle gestures keep their own meanings),
 * locked objects (selectable but not changed, §7 Q3), group children (fixed
 * in place, §7 Q5), empty-canvas presses (the marquee — no transform), and
 * a text mid-edit. A multi-selection containing a locked member duplicates
 * anyway — the clone comes back unlocked, the copy/paste stance (copy is
 * read-only; a paste is a fresh creation).
 */
export class AltDragDuplicate {
  private readonly canvas: StageCanvas

  /**
   * The armed gesture — set on an Alt press while the clone is pending or
   * has taken over the drag, nulled when the gesture ends. One at a time:
   * Fabric ignores a second press while a gesture is in flight, and the
   * previous gesture's `mouse:up` clears the state before the next `mouse:down`
   * can arm a new one.
   */
  private state: DuplicateState | null = null

  private readonly onDownHandler: (opt: TPointerEventInfo) => void
  private readonly onUpHandler: (opt: TPointerEventInfo) => void

  constructor(canvas: StageCanvas) {
    this.canvas = canvas
    this.onDownHandler = (opt) => this.onDown(opt)
    this.onUpHandler = (opt) => this.onUp(opt)
    canvas.on("mouse:down", this.onDownHandler)
    canvas.on("mouse:up", this.onUpHandler)
  }

  /**
   * Detach the listeners and invalidate a pending clone — the canvas-rebuild
   * lifecycle (dispose and re-create), so an in-flight `enlivenObjects` must
   * not land on the fresh canvas.
   */
  dispose(): void {
    if (this.state) this.state.cancelled = true
    this.state = null
    this.canvas.off("mouse:down", this.onDownHandler)
    this.canvas.off("mouse:up", this.onUpHandler)
  }

  /**
   * Arm the duplicate: an Alt press, with the in-flight drag transform set up
   * for a body drag (action "drag" — handle presses carry their own action
   * and their own Alt meanings) on a moveable target. The source is
   * serialized now, synchronously, so the snapshot captures the pre-drag
   * geometry — the clone lands exactly where the source stood. An
   * ActiveSelection serializes as its group-shaped entry (the paste shape,
   * layoutManager stripped); the enlivened Group dissolves on landing.
   */
  private onDown(opt: TPointerEventInfo): void {
    const transform = opt.transform
    if (!transform || transform.action !== "drag") return
    if (!(opt.e as MouseEvent).altKey) return
    const target = transform.target
    if (!target || target.locked || isGrouped(target)) return
    if (isTextObject(target) && target.isEditing) return
    const selection = target instanceof ActiveSelection
    const state: DuplicateState = {
      transform,
      source: target,
      selection,
      clones: [],
      sourceIds: selection ? target.getObjects().map((obj) => obj.id) : [target.id],
      swapped: false,
      cancelled: false,
    }
    const snapshot = selection
      ? [{ ...target.toObject(), type: "group" }]
      : [target.toObject()]
    this.state = state
    this.canvas.altDragDuplicating = true
    void util
      .enlivenObjects(snapshot)
      .then((enlivened) => this.land(state, enlivened as FabricObject[]))
      .catch(() => {
        // The enliven failed (an unloadable image, say) — the gesture just
        // keeps dragging the source, and mouse:up clears the armed state.
      })
  }

  /**
   * Land the clone and hand the gesture to it: restore the source to its
   * pre-drag position (undoing any pre-swap tick — an image clone can land
   * after the first `mousemove`), place the clone(s) in the z-slot directly
   * above the source (the paste convention), select them, and swap the
   * in-flight transform's target. The swap is seamless: `dragHandler`
   * positions the target from the pointer minus the offset captured at
   * press, and the clone sits at the source's coordinate from that moment —
   * the next tick puts the clone exactly where the pointer indicates.
   * Guarded by the state's `cancelled` flag — a `mouse:up` before the async
   * enliven resolved (an Alt-click on an image) or a dispose invalidates
   * this landing; nothing is added to the canvas then.
   */
  private land(state: DuplicateState, enlivened: FabricObject[]): void {
    if (state.cancelled || state.swapped) return
    const canvas = this.canvas
    const transform = state.transform
    // Undo pre-swap ticks — the source must rest at its pre-drag position
    // while the clone takes over the drag.
    const original = transform.original
    state.source.set({ left: original.left, top: original.top })
    state.source.setCoords()
    let clones: FabricObject[]
    if (state.selection) {
      // The dissolve is Fabric's own ungroup math — `removeAll` exits each
      // member through `exitGroup`, baking the (pre-drag) selection transform
      // into it, so the members land with their world positions as separate
      // top-level objects (the paste path, clipboard.ts).
      clones = (enlivened[0] as Group).removeAll()
    } else {
      clones = enlivened
    }
    if (clones.length === 0) return
    for (const clone of clones) {
      // Fresh identities at every level, unlocked — a duplicate is a fresh
      // creation, the same stamp a paste gives (ADR 0002).
      stampCloneTree(clone)
      // A text clone can carry a scale (a scaled selection's member) — fold
      // it into the font size so the toolbar's readout is right, the same
      // fold the paste and ungroup commands perform.
      if (isTextObject(clone)) bakeTextScale(clone)
      // Fresh geometry: the enlivened clone's `aCoords` were computed at its
      // creation coordinates; the in-flight gesture reads them during the
      // tick (Fabric sets the position, fires `object:moving`, then
      // `setCoords`) — a stale box offset by the press would misalign the
      // smart guides for the whole drag.
      clone.setCoords()
    }
    // The z-slot of the topmost source — the clone lands directly above it,
    // keeping the Document's order around it.
    const stack = canvas.getObjects()
    const sourceIndices = state.sourceIds
      .map((id) => stack.findIndex((obj) => obj.id === id))
      .filter((index) => index >= 0)
    const slot = sourceIndices.length > 0 ? Math.max(...sourceIndices) + 1 : stack.length
    // `insertAt` fires object:added per clone, so the chrome (rotation
    // handle, side-handle visibility, cursors, noScaleCache) applies
    // automatically.
    canvas.insertAt(slot, ...clones)
    const active =
      clones.length === 1 ? clones[0] : new ActiveSelection(clones, { canvas })
    // Hand the gesture to the clone BEFORE the selection swap: Fabric ends
    // the in-flight transform when a deselection touches its target, and
    // `setActiveObject` deselects the source — the transform must already
    // point at the clone so the deselection check misses and the gesture
    // survives (the next moving tick and the gesture-end commit act on it).
    transform.target = active
    canvas.setActiveObject(active)
    state.clones = clones
    state.swapped = true
    // The pre-swap ticks may have snapshotted the drag-start references from
    // the source's displaced position — reset so the next tick re-snapshots
    // from the clone (the smart guides' tautological-skip baseline).
    if (canvas.smartGuides?.dragStartRefs) canvas.smartGuides.dragStartRefs = null
    canvas.requestRenderAll()
  }

  /**
   * The gesture ended. A clone that never landed is invalidated — the
   * enliven result is discarded when it arrives; nothing was on the canvas
   * to clean. A landed clone whose gesture committed (`actionPerformed` —
   * Fabric fired `object:modified` on the clone, one undoable step) stays.
   * A landed clone whose press never dragged (an Alt-click) rolls back: the
   * gesture's finalize fired nothing, so removing the clone returns the
   * document to exactly the pre-press state, and the source is re-selected.
   */
  private onUp(opt: TPointerEventInfo): void {
    const state = this.state
    this.state = null
    if (!state) return
    const canvas = this.canvas
    state.cancelled = true
    canvas.altDragDuplicating = false
    if (!state.swapped) return
    if (opt.transform?.actionPerformed) return
    canvas.remove(...state.clones)
    canvas.setActiveObject(state.source)
    canvas.requestRenderAll()
  }
}

/** One armed Alt-duplicate gesture — the source, its pre-drag snapshot, and
 * the landing state the async enliven hands over. */
interface DuplicateState {
  /** The in-flight drag transform — its `target` is swapped to the clone. */
  transform: Transform
  /** The pressed object — dragged until the clone lands, then restored. */
  source: FabricObject
  /** True when the source is an ActiveSelection (duplicated as a set). */
  selection: boolean
  /** The placed clones — the rollback's removal list. */
  clones: FabricObject[]
  /** The source's ids — the z-slot lookup at landing. */
  sourceIds: string[]
  /** True once the clone landed and took over the drag. */
  swapped: boolean
  /** True once the gesture ended or the canvas disposed — a pending landing
   * must discard itself. */
  cancelled: boolean
}
