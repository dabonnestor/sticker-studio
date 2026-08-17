import {
  ActiveSelection,
  Group,
  type Canvas,
  type Object as FabricObject,
} from "fabric"

import { stampDocumentProps } from "@/fabric/document-props"
import { bakeTextScale, isTextObject, type TextMeasurer } from "@/fabric/text"

/**
 * Single-level grouping (build spec §7, ADR 0003) — the structural commands
 * behind the toolbar's Group / Ungroup and their hotkeys. Groups never
 * contain groups: a selection containing a group flattens it first (children
 * rise to the top level, keeping their ids, transforms, and cut lines), then
 * groups everything together.
 *
 * Mechanics honored from the spike (ADR 0003): the Group constructor does
 * not detach its children — the members must leave the canvas first, or JSON
 * serializes them twice; members are sorted by canvas index, since an
 * ActiveSelection's order is click order, not z-order; ungroup is the
 * mirror. A group lands in the z-slot of its topmost member — the slot the
 * selection occupied — so grouping never reorders the Document around the
 * selection, and ungroup returns the children to exactly that slot.
 */

/** True for a Group — the one document-level container (§7). */
export function isGroup(obj: FabricObject): boolean {
  return obj instanceof Group
}

/**
 * True for a document-Group child — while grouped, an object is fixed in
 * place: no free dragging, no individual resize, no delete, no reorder
 * (§7 Q5). `group` is the parent collection; for a multi-selection's members
 * that is the ActiveSelection — which *is* a Group subclass in Fabric — so
 * the check must exclude it, or every multi-select command would read its
 * members as fixed.
 */
export function isGrouped(obj: FabricObject): boolean {
  return obj.group instanceof Group && !(obj.group instanceof ActiveSelection)
}

/**
 * Re-fit the parent group to its children's current bounds after an edit
 * that changed a child's size (a text property commit, a border-width
 * change, an auto-fit re-hug). The group's bounds are computed at group time
 * and Fabric re-fits them only on child *gesture* events (`changed`,
 * `modified`, …) — a toolbar property commit fires none, so the group stays
 * sized to the pre-edit child, and the grown child renders past the group's
 * cached bounds: clipped at the cache canvas edge. `triggerLayout` (the
 * fit-content layout) re-measures the union bounds and shifts the group so
 * every child keeps its world position. A no-op outside a group — top-level
 * objects are already their own bounds, and ActiveSelection members are the
 * selection's, not a document Group's (§7 Q5).
 */
export function refitParentGroup(obj: FabricObject): void {
  const group = obj.group
  if (group instanceof Group && !(group instanceof ActiveSelection)) {
    group.triggerLayout()
  }
}

/**
 * Dissolve one group in place: the group leaves its z-slot and its children
 * land in that same slot, internal order preserved. The exit bakes the
 * group's transform into each child (`removeAll` → `_onObjectRemoved` →
 * `exitGroup` applies it), so every child keeps its world position,
 * rotation, scale, flip, and cut geometry. Returns the children in group
 * order — topmost child last, the Document's internal order.
 */
function extractGroup(
  canvas: Canvas,
  group: Group,
  measure?: TextMeasurer,
): FabricObject[] {
  const slot = canvas.getObjects().indexOf(group)
  canvas.remove(group)
  const children = group.removeAll()
  // A text child scaled inside the group exits it carrying the folded scale
  // and a stale font size — bake the scale into the size here, so the size
  // field (the text's source of truth) reads correctly the moment the
  // ungroup commits (re-hugging the content while the box still auto-fits).
  for (const child of children) {
    if (isTextObject(child)) bakeTextScale(child, measure)
  }
  children.forEach((child, i) => canvas.insertAt(slot + i, child))
  return children
}

/**
 * Replace every Group in the selection with its children — flatten-on-group
 * (§7 Q4): the selection's groups dissolve in place, their children taking
 * the slots, ready for the re-group. Returns the flattened selection,
 * top-level objects only.
 */
export function flattenGroups(
  canvas: Canvas,
  objects: readonly FabricObject[],
  measure?: TextMeasurer,
): FabricObject[] {
  const flat: FabricObject[] = []
  for (const obj of objects) {
    if (obj instanceof Group) flat.push(...extractGroup(canvas, obj, measure))
    else flat.push(obj)
  }
  return flat
}

/**
 * Group the selection (§7 Q4): require at least two selected objects (the
 * toolbar disables below that — a lone group must not flatten+regroup into
 * a fresh identity); group children are fixed in place (§7 Q5) and never
 * groupable — they are not even in the canvas collection, so the z-order
 * math would corrupt the Document; then flatten existing groups first,
 * sort the members by canvas index, so the group's internal order is the
 * Document's, not the click order; remove the members, construct the Group
 * — children keep their transforms, the constructor adapts the group to
 * them — and land it in the z-slot of the topmost member. The group carries
 * the document identity (ADR 0002) and is returned for the caller to
 * select; null when the selection is too small or contains grouped children
 * (a no-op — nothing removed).
 */
export function groupObjects(
  canvas: Canvas,
  objects: readonly FabricObject[],
  measure?: TextMeasurer,
): Group | null {
  if (objects.length < 2) return null
  if (objects.some(isGrouped)) return null
  const flat = flattenGroups(canvas, objects, measure)
  if (flat.length < 2) return null
  const stack = canvas.getObjects()
  const zIndex = new Map(flat.map((obj) => [obj, stack.indexOf(obj)]))
  const sorted = [...flat].sort((a, b) => zIndex.get(a)! - zIndex.get(b)!)
  const slot = zIndex.get(sorted[sorted.length - 1])!
  canvas.remove(...sorted)
  const group = stampDocumentProps(new Group(sorted, { canvas }))
  canvas.insertAt(slot, group)
  // The members' cached coords (`aCoords`) predate the group — captured at
  // top level in scene space (e.g. by the flatten that just ran). `getCoords`
  // never recomputes its cache, so the hit test would read a double-
  // translated box; refresh each child now that the group owns it.
  for (const child of group.getObjects()) child.setCoords()
  group.setCoords()
  return group
}

/**
 * Ungroup the selection (§7 Q4/Q5): every selected unlocked Group dissolves
 * in place — children rise to the top level at the group's z-slot, world
 * transforms intact. Locked groups are inert and skipped, like arrange and
 * delete skip locked objects. Returns the extracted children — the caller
 * selects them.
 */
export function ungroupObjects(
  canvas: Canvas,
  objects: readonly FabricObject[],
  measure?: TextMeasurer,
): FabricObject[] {
  const children: FabricObject[] = []
  for (const obj of objects) {
    if (obj instanceof Group && !obj.locked) {
      children.push(...extractGroup(canvas, obj, measure))
    }
  }
  return children
}
