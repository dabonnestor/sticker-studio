import {
  Circle,
  Ellipse,
  Rect,
  Triangle,
  type Object as FabricObject,
} from "fabric"

import { stampDocumentProps } from "@/fabric/document-props"

/**
 * Shape model (build spec §4, §5). One Fabric object per shape:
 * fill = background, stroke = border, clipPath = cut line.
 *
 * Inset border model (§4): the object geometry is the area *inside* the
 * border — turning the border on shrinks it by half the stroke per side
 * (`width − border`, `radius − border/2`) so the stroke's outer edge sits
 * exactly on the cut path. The clipPath always sits at the original (cut)
 * edge and never moves; the cut geometry is derived as `width + borderWidth`
 * (scale-inclusive), which is why it survives JSON restore.
 *
 * All mutations go through `obj.set()` — Fabric marks the object dirty from
 * there; direct assignment would leave the cached render stale (the inset
 * model keeps `width + borderWidth` constant, so the cache canvas dimensions
 * never change and Fabric would never notice).
 */
export type ShapeKind =
  | "square"
  | "circle"
  | "rectangle"
  | "oval"
  | "triangle"

/** Default shape fill (background) at creation. */
export const DEFAULT_FILL = "#ffd23f"

/** Default border color (§4: stroke = border; width 0 = off). */
export const DEFAULT_BORDER_COLOR = "#18181b"

/** The cut extent of an object, scale-inclusive, in px. */
export interface CutExtent {
  width: number
  height: number
}

/**
 * Per-kind creation spec. Default sizes are inches-specified at the 96 DPI
 * display basis (§5): Square 2×2 → 192×192, Circle Ø2 → radius 96,
 * Rectangle / Oval / Triangle 3×2 (landscape) → 288×192.
 */
interface ShapeSpec {
  kind: ShapeKind
  /** Cut-extent width at creation (border off), px. */
  width: number
  /** Cut-extent height at creation (border off), px. */
  height: number
  /** Circle radius, px. */
  radius?: number
  /** Ellipse radii (oval), px. */
  ellipseRadii?: { x: number; y: number }
}

const SHAPE_SPECS: Record<ShapeKind, ShapeSpec> = {
  square: { kind: "square", width: 192, height: 192 },
  circle: { kind: "circle", width: 192, height: 192, radius: 96 },
  rectangle: { kind: "rectangle", width: 288, height: 192 },
  oval: { kind: "oval", width: 288, height: 192, ellipseRadii: { x: 144, y: 96 } },
  triangle: { kind: "triangle", width: 288, height: 192 },
}

/** Build the Fabric object for a spec — shape and cut clipPath share it. */
function buildShape(spec: ShapeSpec): FabricObject {
  switch (spec.kind) {
    case "square":
    case "rectangle":
      return new Rect({ width: spec.width, height: spec.height })
    case "circle":
      return new Circle({ radius: spec.radius! })
    case "oval":
      return new Ellipse({ rx: spec.ellipseRadii!.x, ry: spec.ellipseRadii!.y })
    case "triangle":
      return new Triangle({ width: spec.width, height: spec.height })
  }
}

/**
 * Create a shape of the given kind: default size at the 96 DPI basis, border
 * off (cut = geometry), the cut clipPath at the original edge, and the
 * document identity stamped (id, locked=false, ADR 0002).
 */
export function createShape(kind: "square" | "rectangle"): Rect
export function createShape(kind: "circle"): Circle
export function createShape(kind: "oval"): Ellipse
export function createShape(kind: "triangle"): Triangle
export function createShape(kind: ShapeKind): FabricObject
export function createShape(kind: ShapeKind): FabricObject {
  const spec = SHAPE_SPECS[kind]
  const obj = buildShape(spec)
  obj.fill = DEFAULT_FILL
  obj.stroke = DEFAULT_BORDER_COLOR
  obj.strokeWidth = 0 // border off — a stroke would sit exactly on the cut path
  obj.clipPath = buildShape(spec) // cut line, fixed at the original edge
  return stampDocumentProps(obj)
}

/**
 * Classify an object as one of the shape kinds by its current geometry —
 * square vs rectangle is the local width === height (a distorted square just
 * reads as a rectangle); anything else (text, groups, imported objects) is
 * not a shape.
 */
export function getShapeKind(obj: FabricObject): ShapeKind | null {
  if (obj instanceof Circle) return "circle"
  if (obj instanceof Ellipse) return "oval"
  if (obj instanceof Triangle) return "triangle"
  if (obj instanceof Rect) {
    return obj.width === obj.height ? "square" : "rectangle"
  }
  return null
}

/**
 * The cut extent (scale-inclusive): `width + borderWidth` when the border is
 * on, plain `width` when it's off — one formula for both, per §4.
 */
export function getCutExtent(obj: FabricObject): CutExtent {
  if (obj instanceof Circle) {
    const diameter = 2 * obj.radius + obj.strokeWidth
    return { width: diameter * obj.scaleX, height: diameter * obj.scaleY }
  }
  if (obj instanceof Ellipse) {
    return {
      width: (2 * obj.rx + obj.strokeWidth) * obj.scaleX,
      height: (2 * obj.ry + obj.strokeWidth) * obj.scaleY,
    }
  }
  return {
    width: (obj.width + obj.strokeWidth) * obj.scaleX,
    height: (obj.height + obj.strokeWidth) * obj.scaleY,
  }
}

/** Border width in px — the object's strokeWidth (0 = off). */
export function getBorderWidth(obj: FabricObject): number {
  return obj.strokeWidth
}

/**
 * Set the border width (0 = off). The cut extent never changes: the interior
 * geometry shrinks/grows by half the stroke per side so the stroke's outer
 * edge stays exactly on the cut path, and the clipPath is never touched.
 * Clamped so the interior geometry never inverts.
 *
 * Mutations go through `set()` so Fabric marks the object dirty: the inset
 * model keeps the bounding box (`width + borderWidth`) constant, so the cache
 * canvas dimensions never change and a direct assignment would leave the
 * stale cache rendering the old border.
 */
export function setBorderWidth(obj: FabricObject, width: number): void {
  const cut = getCutExtent(obj)
  const localMinSide = Math.min(cut.width / obj.scaleX, cut.height / obj.scaleY)
  const stroke = Math.min(width, localMinSide)
  const delta = stroke - obj.strokeWidth
  if (obj instanceof Circle) {
    obj.set("radius", obj.radius - delta / 2)
  } else if (obj instanceof Ellipse) {
    obj.set({ rx: obj.rx - delta / 2, ry: obj.ry - delta / 2 })
  } else if (obj instanceof Rect || obj instanceof Triangle) {
    obj.set({ width: obj.width - delta, height: obj.height - delta })
    if (obj instanceof Rect && obj.rx > 0) {
      obj.set("rx", Math.max(0, obj.rx - delta / 2))
    }
  }
  obj.set("strokeWidth", stroke)
}

/**
 * Scale the shape so its cut extent matches the target. Axes scale
 * independently.
 */
export function resizeToCut(obj: FabricObject, target: CutExtent): void {
  const cut = getCutExtent(obj)
  obj.set({
    scaleX: obj.scaleX * (target.width / cut.width),
    scaleY: obj.scaleY * (target.height / cut.height),
  })
}

/** Set the shape background — the object's fill (§4: fill = background). */
export function setFillColor(obj: FabricObject, color: string): void {
  obj.set("fill", color)
}

/** Set the border color — the object's stroke (§4: stroke = border). */
export function setBorderColor(obj: FabricObject, color: string): void {
  obj.set("stroke", color)
}
