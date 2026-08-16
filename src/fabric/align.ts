import type { Canvas, Object as FabricObject } from "fabric"

import { isGrouped } from "@/fabric/groups"

/**
 * Object alignment commands — a requested addition beyond §7 Q6's control
 * surface (the spec's list is Group/Arrange/Flip/Lock): move the selection's
 * edge or center to a reference. The reference is the Document when a single
 * object is selected (the only sensible anchor), and the selection's own
 * bounds when two or more are — the objects align relative to each other,
 * each edge or center meeting the selection's outermost edge or center. Six
 * commands — the vertical trio (top / middle / bottom) and the horizontal
 * trio (left / center / right), named after the toolbar's labels (Align
 * middle, Align center).
 */
export type AlignCommand =
  | "top"
  | "middle"
  | "bottom"
  | "left"
  | "center"
  | "right"

/** An axis-aligned box in the scene plane. */
interface Box {
  left: number
  top: number
  width: number
  height: number
}

/**
 * The Document bounds — the canvas itself (build spec §5). Every object's
 * absolute position lives in the same scene plane as the canvas origin, so
 * the alignment target is simply the 0,0 → width×height box.
 */
function documentBounds(canvas: Canvas): Box {
  return { left: 0, top: 0, width: canvas.getWidth(), height: canvas.getHeight() }
}

/** The union of several boxes — the multi-object alignment reference. */
function unionBox(boxes: readonly Box[]): Box {
  const left = Math.min(...boxes.map((b) => b.left))
  const top = Math.min(...boxes.map((b) => b.top))
  const right = Math.max(...boxes.map((b) => b.left + b.width))
  const bottom = Math.max(...boxes.map((b) => b.top + b.height))
  return { left, top, width: right - left, height: bottom - top }
}

/**
 * Align the given objects. A lone object aligns to the Document; two or more
 * align to each other — each object's edge or center meets the selection
 * bounds' extreme in that direction, so the outermost object stays put and
 * the rest come to it (the reference falls where the outermost object
 * already sits). The deltas are computed on the rotated bounding boxes and
 * applied to the origins: translation commutes with rotation and scale, so a
 * transformed object lands exactly where its box says. Locked objects are
 * inert (§7 Q3, Q7 — "no arrange"): skipped like arrange's locked skip, and
 * excluded from the selection bounds, so they neither move nor anchor; group
 * children are fixed in place (§7 Q5 — no free movement) and skipped the
 * same way — a fully inert (or empty) selection is a no-op. Callers render
 * explicitly.
 */
export function alignObjects(
  canvas: Canvas,
  objects: readonly FabricObject[],
  command: AlignCommand,
): void {
  // Group children are fixed in place (§7 Q5 — no free movement; aligning
  // would reposition them) and skipped like locked objects; a fully inert
  // (or empty) selection is a no-op.
  const unlocked = objects.filter((obj) => !obj.locked && !isGrouped(obj))
  if (unlocked.length === 0) return

  // Snapshot every box once, before any move: a non-gesture change (a
  // property commit, a programmatic scale) never ran Fabric's setCoords, so
  // the cached corners could be stale. Moves never affect other objects'
  // boxes, so the snapshot stays valid throughout.
  const boxes = unlocked.map((obj) => {
    obj.setCoords()
    return obj.getBoundingRect()
  })

  const target = boxes.length > 1 ? unionBox(boxes) : documentBounds(canvas)
  for (let i = 0; i < unlocked.length; i++) {
    const obj = unlocked[i]
    const rect = boxes[i]
    let dx = 0
    let dy = 0
    switch (command) {
      case "top":
        dy = target.top - rect.top
        break
      case "middle":
        dy = target.top + target.height / 2 - (rect.top + rect.height / 2)
        break
      case "bottom":
        dy = target.top + target.height - (rect.top + rect.height)
        break
      case "left":
        dx = target.left - rect.left
        break
      case "center":
        dx = target.left + target.width / 2 - (rect.left + rect.width / 2)
        break
      case "right":
        dx = target.left + target.width - (rect.left + rect.width)
        break
    }
    obj.set({ left: obj.left + dx, top: obj.top + dy })
    // The move fires no gesture — refresh the cached corners so the next
    // read (a later align, the caller's render) sees the new box.
    obj.setCoords()
  }
}
