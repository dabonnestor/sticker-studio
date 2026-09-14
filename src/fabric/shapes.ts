import {
  Circle,
  Ellipse,
  Rect,
  Triangle,
  type Object as FabricObject,
} from "fabric"

import { stampDocumentProps } from "@/fabric/document-props"
import { refitParentGroup } from "@/fabric/groups"
import type { DocumentSize } from "@/fabric/outline"

/**
 * Shape model (build spec §4, §5). One Fabric object per shape:
 * fill = background, stroke = border, clipPath = cut line.
 *
 * Centered border model (§4): the object geometry IS the cut — turning the
 * border on never changes the geometry. The border is centered on the cut
 * edge and renders at its full width: the clipPath extends half the stroke
 * beyond the geometry (per side), so the stroke's outer half is not clipped
 * away — the cut line runs through the middle of the full border, exactly
 * as a cut sticker behaves (the cutter halves the border). The cut geometry
 * is the geometry itself (scale-inclusive), which is why it survives JSON
 * restore.
 *
 * The border renders at a fixed pixel width (`strokeUniform`): scaling the
 * shape never thickens it — the fill and the cut line scale, the border
 * stays put. The clip extension is therefore scale-dependent — stroke/2
 * divided by the object's scale in the shape's local units — so the clip is
 * re-stamped on every scale change (`restampBorderClip`). The strokeUniform
 * compensation is baked into the object's cache, so the shape re-renders
 * its cache every frame of a live scale gesture (`noScaleCache` off) — a
 * stale gesture-start cache would stretch the baked stroke and the border
 * would grow with the shape until the gesture commits.
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
 * The fraction of the Document's short side a sidebar shape is created at
 * (§5, map #48). A shape is an element *on* the sticker rather than the
 * sticker itself, so it is sized against the Document it lands on instead of
 * against a fixed sheet: it arrives with room to move, and it stays in
 * proportion whatever size the sticker is — the same instinct as an image's
 * fit to the Document (IMAGE_FIT_RATIO, which sizes a whole design at 0.8
 * where this sizes one element at half).
 *
 * It is a ratio and not an inch size for that reason: the Document's own
 * Default size is 2×2 in, so a fixed 2×2 in shape would exactly cover the
 * sticker it was added to, and a 3×2 in one would hang off the edge.
 */
export const SHAPE_DEFAULT_RATIO = 0.5

/**
 * Per-kind creation spec, in multiples of the shape's short side: Square and
 * Circle 1:1, Rectangle / Oval / Triangle 3:2 landscape. The short side itself
 * comes from the Document at creation ({@link SHAPE_DEFAULT_RATIO}).
 */
interface ShapeSpec {
  kind: ShapeKind
  /** Cut-extent width, as a multiple of the short side. */
  widthRatio: number
  /** Cut-extent height, as a multiple of the short side. */
  heightRatio: number
}

const SHAPE_SPECS: Record<ShapeKind, ShapeSpec> = {
  square: { kind: "square", widthRatio: 1, heightRatio: 1 },
  circle: { kind: "circle", widthRatio: 1, heightRatio: 1 },
  rectangle: { kind: "rectangle", widthRatio: 1.5, heightRatio: 1 },
  oval: { kind: "oval", widthRatio: 1.5, heightRatio: 1 },
  triangle: { kind: "triangle", widthRatio: 1.5, heightRatio: 1 },
}

/** A shape's cut extent at creation, in px at the 96 DPI display basis. */
export interface ShapeGeometry {
  width: number
  height: number
}

/**
 * The cut extent a kind is created at on a Document of this size: the shape's
 * short side is {@link SHAPE_DEFAULT_RATIO} of the Document's short side, and
 * its own proportions follow from there. The Document's *short* side governs
 * both, so the shape reads the same on a landscape sticker as on a square one.
 */
export function shapeGeometry(
  kind: ShapeKind,
  documentSize: DocumentSize,
): ShapeGeometry {
  const spec = SHAPE_SPECS[kind]
  const short = SHAPE_DEFAULT_RATIO * Math.min(documentSize.width, documentSize.height)
  return {
    width: spec.widthRatio * short,
    height: spec.heightRatio * short,
  }
}

/** Build the Fabric object for a kind at a geometry — shape and cut share it. */
function buildShape(kind: ShapeKind, geometry: ShapeGeometry): FabricObject {
  switch (kind) {
    case "square":
    case "rectangle":
      return new Rect({ width: geometry.width, height: geometry.height })
    case "circle":
      return new Circle({ radius: geometry.height / 2 })
    case "oval":
      return new Ellipse({ rx: geometry.width / 2, ry: geometry.height / 2 })
    case "triangle":
      return new Triangle({ width: geometry.width, height: geometry.height })
  }
}

/**
 * Create a shape of the given kind on a Document of the given size: the cut
 * extent {@link shapeGeometry} answers with, border off (cut = geometry), the
 * cut clipPath at the original edge, and the document identity stamped (id,
 * locked=false, ADR 0002).
 *
 * The Document size is required rather than defaulted because there is no
 * answer without it: a shape's created size is a fraction of the Document, so
 * a caller that has no Document in hand has no shape to create.
 */
export function createShape(
  kind: "square" | "rectangle",
  documentSize: DocumentSize,
): Rect
export function createShape(kind: "circle", documentSize: DocumentSize): Circle
export function createShape(kind: "oval", documentSize: DocumentSize): Ellipse
export function createShape(
  kind: "triangle",
  documentSize: DocumentSize,
): Triangle
export function createShape(
  kind: ShapeKind,
  documentSize: DocumentSize,
): FabricObject
export function createShape(
  kind: ShapeKind,
  documentSize: DocumentSize,
): FabricObject {
  const geometry = shapeGeometry(kind, documentSize)
  const obj = buildShape(kind, geometry)
  obj.fill = DEFAULT_FILL
  obj.stroke = DEFAULT_BORDER_COLOR
  obj.strokeWidth = 0 // border off — a stroke would sit exactly on the cut path
  obj.strokeUniform = true // border renders at fixed px — scaling never thickens it
  obj.noScaleCache = false // live cache re-render while scaling — the fixed px holds mid-gesture
  obj.clipPath = buildShape(kind, geometry) // cut line — grows with the border (§4)
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
 * geometry doesn't either: the border is centered on the cut edge and
 * renders at a fixed pixel width, so the clipPath re-stamps to stay on the
 * stroke's outer edge. Clamped so the border never exceeds the shape's
 * smallest side at the current scale (the border's inner half would
 * otherwise cover the fill entirely). Goes through `set()` so Fabric marks
 * the object dirty and the cached render repaints.
 */
export function setBorderWidth(obj: FabricObject, width: number): void {
  const cut = getCutExtent(obj)
  const stroke = Math.min(width, Math.min(cut.width, cut.height))
  obj.set("strokeWidth", stroke)
  restampBorderClip(obj)
  // The border renders past the cut edge — a group sized to the pre-edit
  // child would clip the thicker border (see refitParentGroup).
  refitParentGroup(obj)
}

/**
 * Re-stamp the clipPath to the stroke's outer edge. The border renders at a
 * fixed pixel width (strokeUniform), so its extension past the geometry is
 * scale-dependent: stroke/2 divided by the object's scale in the shape's
 * local units. Called whenever the border width or the scale changes
 * (setBorderWidth, resizeToCut, and the live-scale handler — the clip
 * itself is serialized, so a JSON restore needs no re-stamp).
 */
export function restampBorderClip(obj: FabricObject): void {
  const clip = obj.clipPath
  if (!clip) return
  const half = obj.strokeWidth / 2
  // The shape's own geometry extends the clip — `radius`/`rx`/`ry` exist
  // only on the circle/ellipse classes; the base FabricObject type is
  // geometry-agnostic, so the shape narrows to the kind matching its clip.
  if (clip instanceof Circle) {
    clip.set("radius", (obj as Circle).radius + half / obj.scaleX)
  } else if (clip instanceof Ellipse) {
    clip.set({
      rx: (obj as Ellipse).rx + half / obj.scaleX,
      ry: (obj as Ellipse).ry + half / obj.scaleY,
    })
  } else {
    clip.set({
      width: obj.width + obj.strokeWidth / obj.scaleX,
      height: obj.height + obj.strokeWidth / obj.scaleY,
    })
  }
}

/**
 * Scale the shape so its cut extent matches the target. Axes scale
 * independently; the clip re-stamps after — the fixed-px border's extension
 * divides by the new scale.
 */
export function resizeToCut(obj: FabricObject, target: CutExtent): void {
  const cut = getCutExtent(obj)
  obj.set({
    scaleX: obj.scaleX * (target.width / cut.width),
    scaleY: obj.scaleY * (target.height / cut.height),
  })
  restampBorderClip(obj)
  // A group sized to the pre-edit child would clip the scaled cut (see
  // refitParentGroup) — the size edit is a property commit, no gesture
  // event for the group's layout to re-fit on.
  refitParentGroup(obj)
}

/** Set the shape background — the object's fill (§4: fill = background). */
export function setFillColor(obj: FabricObject, color: string): void {
  obj.set("fill", color)
}

/** Set the border color — the object's stroke (§4: stroke = border). */
export function setBorderColor(obj: FabricObject, color: string): void {
  obj.set("stroke", color)
}
