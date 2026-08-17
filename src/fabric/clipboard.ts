import {
  ActiveSelection,
  Group,
  util,
  type Canvas,
  type Object as FabricObject,
} from "fabric"

import { stampDocumentProps } from "@/fabric/document-props"
import { isGrouped } from "@/fabric/groups"
import type { StageCanvas } from "@/fabric/stage-canvas"
import { bakeTextScale, isTextObject, type TextMeasurer } from "@/fabric/text"

/**
 * Copy/paste (§13) — the app's internal clipboard, holding serialized objects
 * (the same `toObject` JSON round-trip the Design file uses, ADR 0002), never
 * the OS clipboard — pasting internal JSON into other apps would be garbage.
 * Copy captures the selection as a snapshot; paste enlivens fresh clones,
 * offsets them down-right from the source (repeat pastes cascade), and the
 * StageProvider commits the paste as one undoable step (ADR 0001).
 *
 * A clone is a fresh creation, not a duplicate: every id is regenerated
 * (group children too — ADR 0002's stable identity) and the locked flag is
 * cleared at every level — the lock protected the original from accidental
 * edits; the object the user just created must be movable. A multi-selection
 * pastes back as the same set of separate objects (the ActiveSelection
 * serializes as one group-shaped entry and dissolves on paste), and a child
 * copied inside an entered group pastes at top level with its world
 * transform baked in — the child's coordinates live in the group's plane.
 */

/** One serialized copyable unit — `toObject()` output, enlivened on paste. */
type SerializedObject = Record<string, unknown>

/** The clipboard's content: the snapshot plus the paste-time placement hints. */
interface ClipEntry {
  /** Serialized copyable units — one for a plain selection, one group-shaped
   * entry for a multi-selection. */
  objects: SerializedObject[]
  /** The copied objects' ids — the z-slot lookup at paste time. */
  sourceIds: string[]
  /**
   * Set when the copied object is a child of a document Group (not of an
   * ActiveSelection): the paste bakes the parent's current world transform
   * into the clone, so it lands at the child's world position, top level.
   */
  parentGroupId?: string
  /** True when the entry is a multi-selection serialized as a group — the
   * paste dissolves it back into separate objects. */
  dissolve: boolean
}

/** The clipboard snapshot, or null when nothing has been copied. */
let clipboard: ClipEntry | null = null

/** Pastes since the last copy — each paste nudges one step further from the
 * source, the cascade that shows repeated pastes piling down-right. */
let pasteCount = 0

/**
 * The paste offset, in screen px at 100% zoom (§13). The scene offset divides
 * by the zoom so the visual nudge reads constant at any magnification — a
 * fixed scene offset would be invisible on a zoomed-out document.
 */
export const PASTE_NUDGE_PX = 16

/**
 * Copy the active object — or, for a multi-selection, the ActiveSelection as
 * a whole (its members' coordinates live in the selection's plane, so
 * serializing the members individually would paste them at stale positions
 * once the selection carries a transform). The entry is a snapshot: edits to
 * the source after the copy never leak into the paste. Locked objects copy —
 * copy is read-only (§7 Q3's inert contract covers move/resize/edit/delete).
 * No-op without a selection — and the previous clipboard is kept, so a stray
 * Ctrl+C never clears it.
 */
export function copyObjects(canvas: Canvas): boolean {
  const active = canvas.getActiveObject()
  if (!active) return false
  if (active instanceof ActiveSelection) {
    // The layoutManager is stripped: ActiveSelectionLayoutManager isn't in
    // the class registry `Group.fromObject` resolves, and the clone is
    // dissolved before its layout could matter anyway.
    const { layoutManager: _layoutManager, ...serialized } = active.toObject()
    clipboard = {
      objects: [{ ...serialized, type: "group" }],
      sourceIds: active.getObjects().map((obj) => obj.id),
      dissolve: true,
    }
  } else {
    clipboard = {
      objects: [active.toObject()],
      sourceIds: [active.id],
      parentGroupId: isGrouped(active) ? active.group?.id : undefined,
      dissolve: false,
    }
  }
  pasteCount = 0
  return true
}

/**
 * Paste the clipboard: enliven fresh objects from the snapshot, dissolve a
 * multi-selection entry into separate objects, bake a copied child's world
 * transform, stamp fresh identities (id + unlocked), nudge, place the clones
 * in the z-slot right above the topmost copied object, and select them. The
 * paste is one undoable step — the caller (StageProvider) commits the
 * history. No-op with an empty clipboard.
 */
export async function pasteObjects(
  canvas: StageCanvas,
  measure?: TextMeasurer,
): Promise<void> {
  if (!clipboard) return
  pasteCount++
  const enlivened = (await util.enlivenObjects(clipboard.objects)) as FabricObject[]
  const clones: FabricObject[] = []
  for (const obj of enlivened) {
    if (clipboard.dissolve && obj instanceof Group) {
      // The dissolve is Fabric's own ungroup math: `removeAll` exits each
      // member through `exitGroup`, which bakes the selection's transform
      // into it — the members land with their world positions, individually
      // placeable, exactly like the ungroup command (groups.ts extractGroup).
      clones.push(...obj.removeAll())
    } else {
      clones.push(obj)
    }
  }
  if (clones.length === 0) return
  const parentGroup = clipboard.parentGroupId
    ? (canvas
        .getObjects()
        .find((obj) => obj.id === clipboard!.parentGroupId) as Group | undefined)
    : undefined
  // The scene offset per paste — constant screen px at any zoom.
  const nudge = PASTE_NUDGE_PX / (canvas.getZoomPercent() / 100)
  for (const clone of clones) {
    // A copied child of an entered group: its serialized coordinates live in
    // the parent's plane, so the clone must leave it to reach the top level.
    // `exitGroup` on a non-member runs only the transform math — the clone
    // was never in `_activeObjects` and the watched-list cleanup is a no-op
    // on a fresh object — baking the parent's current matrix into the clone.
    if (parentGroup) parentGroup.exitGroup(clone)
    stampCloneTree(clone)
    const offset = pasteCount * nudge
    clone.set({ left: clone.left + offset, top: clone.top + offset })
    // The world bake can leave a text carrying a scale (a child of a scaled
    // group) — fold it into the font size so the toolbar's readout is right,
    // the same fold the ungroup command performs (extractGroup).
    if (isTextObject(clone)) bakeTextScale(clone, measure)
  }
  // The z-slot of the topmost copied object — clones land directly above the
  // copied region, keeping the Document's order around it. A source that no
  // longer exists (copied, deleted, pasted) has no index — the paste lands on
  // top of the stack.
  const stack = canvas.getObjects()
  const sourceIndices = clipboard.sourceIds
    .map((id) => stack.findIndex((obj) => obj.id === id))
    .filter((index) => index >= 0)
  const slot = sourceIndices.length > 0 ? Math.max(...sourceIndices) + 1 : stack.length
  // `insertAt` fires object:added per clone, so the chrome (rotation handle,
  // side-handle visibility, cursors, noScaleCache) applies automatically.
  canvas.insertAt(slot, ...clones)
  if (clones.length === 1) canvas.setActiveObject(clones[0])
  else canvas.setActiveObject(new ActiveSelection(clones, { canvas }))
  canvas.requestRenderAll()
}

/**
 * Stamp the fresh document identity (ADR 0002) onto a clone and every nested
 * child — the serialized snapshot carries the source ids, which must not be
 * duplicated on the canvas; the stamp also clears the locked flag (a paste is
 * a fresh creation, editable like any new object).
 */
function stampCloneTree(obj: FabricObject): void {
  stampDocumentProps(obj)
  if (obj instanceof Group) {
    for (const child of obj.getObjects()) stampCloneTree(child)
  }
}

/** Clear the clipboard — the tests' isolation seam. The app never needs it:
 * a copy is a snapshot that stays pasteable across canvas rebuilds. */
export function clearClipboard(): void {
  clipboard = null
  pasteCount = 0
}
