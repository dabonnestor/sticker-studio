import type { Canvas, Object as FabricObject } from "fabric"

/**
 * Z-order arrange commands (build spec §7 Q6) — the stage toolbar's Arrange
 * menu and the Ctrl+] / Ctrl+[ hotkeys (§13): one slot forward or backward,
 * or to the very front or back of the Document's stack.
 */
export type ArrangeCommand = "forward" | "backward" | "to-front" | "to-back"

/**
 * Per-command move spec. `bottomFirst` is the iteration order over the
 * selection — the order that keeps the selection's own relative order while
 * it moves as a block: forward and to-back walk topmost-first (each selected
 * object swaps with the first unselected one above it), backward and
 * to-front walk bottommost-first. A topmost-first walk with to-front would
 * flip the selection's order as each object lands above the previous one.
 */
const COMMANDS: Record<
  ArrangeCommand,
  { bottomFirst: boolean; apply: (canvas: Canvas, obj: FabricObject) => void }
> = {
  forward: { bottomFirst: false, apply: (canvas, obj) => canvas.bringObjectForward(obj) },
  backward: { bottomFirst: true, apply: (canvas, obj) => canvas.sendObjectBackwards(obj) },
  "to-front": { bottomFirst: true, apply: (canvas, obj) => canvas.bringObjectToFront(obj) },
  "to-back": { bottomFirst: false, apply: (canvas, obj) => canvas.sendObjectToBack(obj) },
}

/**
 * Rearrange the given objects' z-order (§7 Q6). The selection moves as one
 * unit — each command is a single step, so forward/backward shift it one
 * slot and to-front/to-back move it to the end of the stack, the selection's
 * internal order always preserved. Locked objects are inert (§7 Q3, Q7 —
 * "no arrange"), so they are skipped like delete's locked skip; a fully
 * locked (or empty) selection is a no-op. The Fabric moves fire their own
 * render via `renderOnAddRemove`; callers render explicitly regardless.
 */
export function arrangeObjects(
  canvas: Canvas,
  objects: readonly FabricObject[],
  command: ArrangeCommand,
): void {
  const unlocked = objects.filter((obj) => !obj.locked)
  if (unlocked.length === 0) return

  const { bottomFirst, apply } = COMMANDS[command]
  // Sort by canvas z-order, not selection order — an ActiveSelection's array
  // is click order, not z-order (ADR 0003), and the walk must run along the
  // stack. Indexed once; comparisons only need the starting order.
  const stack = canvas.getObjects()
  const zIndex = new Map(unlocked.map((obj) => [obj, stack.indexOf(obj)]))
  const compare = (a: FabricObject, b: FabricObject) => zIndex.get(a)! - zIndex.get(b)!
  const ordered = [...unlocked].sort(bottomFirst ? compare : (a, b) => compare(b, a))
  for (const obj of ordered) apply(canvas, obj)
}
