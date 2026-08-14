import type { Object as FabricObject } from "fabric"

/**
 * Flip commands (build spec §7 Q6) — the Flip card's two mirror directions,
 * named after the toolbar's labels (Flip horizontal, Flip vertical).
 */
export type FlipCommand = "horizontal" | "vertical"

/**
 * Flip the given objects (§7 Q6) — horizontally or vertically, each object
 * mirroring around its own center. A toggle: applying the same command again
 * un-flips. The core Fabric flip props are a mirror flag read at render time,
 * so a flip never touches position, size, or rotation — the box is unchanged
 * and the corners stay valid, no `setCoords` needed. Locked objects are inert
 * (§7 Q3, Q7 — "no flip"): skipped like arrange's locked skip, so a fully
 * locked (or empty) selection is a no-op. Callers render explicitly.
 */
export function flipObjects(
  objects: readonly FabricObject[],
  command: FlipCommand,
): void {
  for (const obj of objects) {
    if (obj.locked) continue
    if (command === "horizontal") obj.set("flipX", !obj.flipX)
    else obj.set("flipY", !obj.flipY)
  }
}
