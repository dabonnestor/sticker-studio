import {
  Circle,
  Ellipse,
  Rect,
  type Object as FabricObject,
} from "fabric"

import { stampDocumentProps } from "@/fabric/document-props"

/**
 * Sticker shape model (build spec §4, §5). One Fabric object per sticker:
 * fill = background, stroke = border, clipPath = cut line.
 *
 * Inset border model (§4): the object geometry is the area *inside* the
 * border — turning the border on shrinks it by half the stroke per side
 * (`width − border`, `rx/radius − border/2`) so the stroke's outer edge sits
 * exactly on the cut path. The clipPath always sits at the original (cut)
 * edge and never moves; the cut geometry is derived as `width + borderWidth`
 * (scale-inclusive), which is why it survives JSON restore.
 */
export type StickerShapeKind =
  | "square"
  | "circle"
  | "rectangle"
  | "oval"
  | "rounded-rectangle"

/** Default sticker fill (background) at creation. */
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
 * Rectangle / Oval / Rounded-rectangle 2×3 → 192×288. The rounded-rectangle
 * corner radius is 20% of the shorter side at creation (38.4), then an
 * independent px property — resize never re-derives it.
 */
interface ShapeSpec {
  kind: StickerShapeKind
  /** Cut-extent width at creation (border off), px. */
  width: number
  /** Cut-extent height at creation (border off), px. */
  height: number
  /** Circle radius (circle) or corner radius (rounded-rectangle), px. */
  radius?: number
  /** Ellipse radii (oval), px. */
  ellipseRadii?: { x: number; y: number }
}

const SHAPE_SPECS: Record<StickerShapeKind, ShapeSpec> = {
  square: { kind: "square", width: 192, height: 192 },
  circle: { kind: "circle", width: 192, height: 192, radius: 96 },
  rectangle: { kind: "rectangle", width: 192, height: 288 },
  oval: { kind: "oval", width: 192, height: 288, ellipseRadii: { x: 96, y: 144 } },
  "rounded-rectangle": {
    kind: "rounded-rectangle",
    width: 192,
    height: 288,
    radius: 38.4,
  },
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
    case "rounded-rectangle":
      return new Rect({ width: spec.width, height: spec.height, rx: spec.radius! })
  }
}

/**
 * Create a sticker of the given kind: default size at the 96 DPI basis, border
 * off (cut = geometry), the cut clipPath at the original edge, and the
 * document identity stamped (id, locked=false, ADR 0002).
 */
export function createStickerShape(kind: "square" | "rectangle"): Rect
export function createStickerShape(kind: "circle"): Circle
export function createStickerShape(kind: "oval"): Ellipse
export function createStickerShape(kind: "rounded-rectangle"): Rect
export function createStickerShape(kind: StickerShapeKind): FabricObject
export function createStickerShape(kind: StickerShapeKind): FabricObject {
  const spec = SHAPE_SPECS[kind]
  const obj = buildShape(spec)
  obj.fill = DEFAULT_FILL
  obj.stroke = DEFAULT_BORDER_COLOR
  obj.strokeWidth = 0 // border off — a stroke would sit exactly on the cut path
  obj.clipPath = buildShape(spec) // cut line, fixed at the original edge
  return stampDocumentProps(obj)
}

/**
 * Classify an object as one of the five sticker kinds by its current
 * geometry — square vs rectangle is the local width === height (a distorted
 * square just reads as a rectangle); anything else (text, groups, imported
 * objects) is not a sticker.
 */
export function getStickerShapeKind(obj: FabricObject): StickerShapeKind | null {
  if (obj instanceof Circle) return "circle"
  if (obj instanceof Ellipse) return "oval"
  if (obj instanceof Rect) {
    if (obj.rx > 0) return "rounded-rectangle"
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
 */
export function setBorderWidth(obj: FabricObject, width: number): void {
  const cut = getCutExtent(obj)
  const localMinSide = Math.min(cut.width / obj.scaleX, cut.height / obj.scaleY)
  const stroke = Math.min(width, localMinSide)
  const delta = stroke - obj.strokeWidth
  if (obj instanceof Circle) {
    obj.radius -= delta / 2
  } else if (obj instanceof Ellipse) {
    obj.rx -= delta / 2
    obj.ry -= delta / 2
  } else if (obj instanceof Rect) {
    obj.width -= delta
    obj.height -= delta
    if (obj.rx > 0) obj.rx = Math.max(0, obj.rx - delta / 2)
  }
  obj.strokeWidth = stroke
}

/**
 * Scale the sticker so its cut extent matches the target (toolbar size
 * commit). Axes scale independently; the corner radius scales along with the
 * object — never re-derived from the new side (§5).
 */
export function resizeToCut(obj: FabricObject, target: CutExtent): void {
  const cut = getCutExtent(obj)
  obj.scaleX *= target.width / cut.width
  obj.scaleY *= target.height / cut.height
}

/** The visible (cut) corner radius in px — the stored rx plus half the border. */
export function getCutRadius(obj: FabricObject): number {
  return obj instanceof Rect ? obj.rx + obj.strokeWidth / 2 : 0
}

/**
 * Set the visible corner radius as an independent px property (§5). The
 * stored interior rx accounts for the border; the cut clipPath — the cut
 * line — follows the visible radius, so the cutter matches the sticker's
 * corners. Clamped to the geometry.
 */
export function setCutRadius(obj: FabricObject, cutRadius: number): void {
  if (!(obj instanceof Rect)) return
  const maxRx = Math.max(0, (Math.min(obj.width, obj.height) - obj.strokeWidth) / 2)
  const rx = Math.min(Math.max(cutRadius - obj.strokeWidth / 2, 0), maxRx)
  obj.rx = rx
  if (obj.clipPath instanceof Rect) obj.clipPath.rx = rx + obj.strokeWidth / 2
}

/** Set the border color — the object's stroke (§4: stroke = border). */
export function setBorderColor(obj: FabricObject, color: string): void {
  obj.stroke = color
}
