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
 * Border model (§4): the object geometry IS the cut area — turning the
 * border on never changes the geometry. The stroke is centered on the cut
 * edge (middle alignment): half of it sits on the fill, the other half lies
 * beyond the cut, where the clipPath clips it away — so a border of width w
 * renders at w/2, and the cut line runs through the border's middle, exactly
 * as a cut sticker behaves. The border renders at a fixed pixel width
 * (`strokeUniform`): scaling the shape never thickens it — the fill and the
 * cut line scale, the border stays put, the design-tool standard. The
 * strokeUniform compensation is baked into the object's cache, so the shape
 * re-renders its cache every frame of a live scale gesture (`noScaleCache`
 * off) — a stale gesture-start cache would stretch the baked stroke and the
 * border would grow with the shape until the gesture commits. The clipPath
 * always sits at the cut edge and never moves — the geometry never does
 * either — and the cut geometry is the geometry itself (scale-inclusive),
 * which is why it survives JSON restore.
 *
 * All mutations go through `obj.set()` — Fabric marks the object dirty from
 * there; a direct assignment would leave the cached render stale.
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
  obj.strokeUniform = true // border renders at fixed px — scaling never thickens it
  obj.noScaleCache = false // live cache re-render while scaling — the fixed px holds mid-gesture
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
 * The cut extent (scale-inclusive) — the geometry itself: the border is
 * centered on the cut edge and never moves it, so one formula for both,
 * border on or off.
 */
export function getCutExtent(obj: FabricObject): CutExtent {
  if (obj instanceof Circle) {
    const diameter = 2 * obj.radius
    return { width: diameter * obj.scaleX, height: diameter * obj.scaleY }
  }
  if (obj instanceof Ellipse) {
    return {
      width: 2 * obj.rx * obj.scaleX,
      height: 2 * obj.ry * obj.scaleY,
    }
  }
  return {
    width: obj.width * obj.scaleX,
    height: obj.height * obj.scaleY,
  }
}

/** Border width in px — the object's strokeWidth (0 = off). */
export function getBorderWidth(obj: FabricObject): number {
  return obj.strokeWidth
}

/**
 * Set the border width (0 = off). The cut extent never changes — the
 * geometry doesn't either: the stroke is centered on the cut edge (middle
 * alignment), half over the fill, half beyond the cut where the clipPath
 * clips it away. Clamped so the border never exceeds the shape's smallest
 * side. Goes through `set()` so Fabric marks the object dirty and the cached
 * render repaints.
 */
export function setBorderWidth(obj: FabricObject, width: number): void {
  const cut = getCutExtent(obj)
  const localMinSide = Math.min(cut.width / obj.scaleX, cut.height / obj.scaleY)
  obj.set("strokeWidth", Math.min(width, localMinSide))
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
