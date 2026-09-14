/**
 * The Cut line's rendering — what makes the Document's outline the boundary
 * of the sticker (map #48, ticket #52).
 *
 * The clip is derived, never stored: {@link buildOutlineClip} is a pure
 * function of the outline kind and the Document size, and both renders
 * re-derive it — the stage whenever that pair moves (see
 * `StageCanvas.syncOutlineClip`), the offscreen export render once, as it
 * prepares (see `createExportHost().prepare`). A stored copy would only be a
 * second place for the shape to be wrong — the envelope's
 * `outline`/`aspectLocked` are the source of truth.
 *
 * Everything here is authored in scene coordinates, centered on the Document,
 * so Fabric's viewport transform carries the outline through zoom and pan.
 *
 * Fabric applies the clip *after* the background and the objects but *before*
 * `_renderOverlay` and `after:render` — which is why the document border, whose
 * painter lives in `after:render`, traces the outline itself rather than
 * riding the clip ({@link traceOutline}).
 */
import { Ellipse, Rect, type Object as FabricObject } from "fabric"

import {
  cornerRadius,
  type DocumentSize,
  type OutlineKind,
} from "@/fabric/outline"

/**
 * The visible border's stroke width as a multiple of the border's own width:
 * the path is the cut itself and the stroke is *twice* as wide, so the outer
 * half is trimmed by the clip and the visible band has its outer edge exactly
 * on the cut — flush by construction, for every shape (see
 * {@link traceOutline} for why insetting loses on an oval).
 *
 * Both borders are the same rule in two media — {@link buildOutlineBorder}
 * strokes a Fabric object with it, the stage's `after:render` painter strokes
 * a canvas-2D path with it — so it lives here, named once, rather than as a
 * bare `* 2` in each.
 */
export const BORDER_STROKE_MULTIPLIER = 2

/**
 * The cut as a Fabric object, in scene coordinates — the geometry the clip and
 * the exported border are both built from, so the two cannot disagree about
 * the shape.
 *
 * The shape is inscribed in the Document rect: rect and rounded-rect are that
 * rect (the rounded one at the preset radius), and oval is the ellipse
 * touching all four edges — a circle exactly when the Document is square, as
 * it is on the Circle preset.
 */
function outlineShape(outline: OutlineKind, size: DocumentSize): FabricObject {
  const common = {
    left: size.width / 2,
    top: size.height / 2,
    originX: "center" as const,
    originY: "center" as const,
  }
  if (outline === "oval") {
    return new Ellipse({ ...common, rx: size.width / 2, ry: size.height / 2 })
  }
  const radius = outline === "rounded-rect" ? cornerRadius(size) : 0
  return new Rect({
    ...common,
    width: size.width,
    height: size.height,
    rx: radius,
    ry: radius,
  })
}

/**
 * The outline as a Fabric object — what the live canvas holds as its
 * `clipPath`, and what the offscreen export render installs as its own (map
 * #48, ticket #53).
 *
 * `excludeFromExport` keeps the derived clip out of every serialization —
 * which is what "derived" has to mean, because the serializer is not only the
 * save path. The History snapshots the canvas with `toJSON`, so a clip in the
 * payload becomes part of what two Documents *are*: the seed snapshot is
 * taken before the first render (no clip) and every later one after it (clip
 * present), and a commit that changed nothing then reads as changed and
 * stacks a phantom undo step. Derived render state must not be able to make
 * two identical Documents compare unequal.
 *
 * Note that this flag is the clip's alone — {@link buildOutlineBorder} builds
 * the *same* geometry and must stay in the serialization, which is why the
 * two share {@link outlineShape} rather than one calling the other.
 */
export function buildOutlineClip(
  outline: OutlineKind,
  size: DocumentSize,
): FabricObject {
  const clip = outlineShape(outline, size)
  clip.set({ excludeFromExport: true })
  return clip
}

/**
 * The document border as a Fabric object — the export render's border, which
 * unlike the stage's is real geometry rather than a painter: `toSVG`
 * serializes object state and never runs `after:render`, so an SVG export
 * carrying the border needs an object to serialize.
 *
 * The path is the cut, stroked at {@link BORDER_STROKE_MULTIPLIER} × its
 * width; the canvas clip trims the outer half, leaving the visible border
 * exactly `width` wide with its outer edge on the cut — the same rule, and so
 * the same pixels, as the stage paints. On a rect outline that lands on the
 * old `(w−bw)×(h−bw)` rect stroked at `bw` exactly; on a circle it traces the
 * circle instead of wrapping it in wedges, which is the whole point.
 *
 * Deliberately *not* `excludeFromExport`: this one is the artifact.
 */
export function buildOutlineBorder(
  outline: OutlineKind,
  size: DocumentSize,
  color: string,
  width: number,
): FabricObject {
  const border = outlineShape(outline, size)
  border.set({
    fill: "transparent",
    stroke: color,
    strokeWidth: width * BORDER_STROKE_MULTIPLIER,
    selectable: false,
    evented: false,
  })
  return border
}

/**
 * Trace the outline onto a 2D context, in scene coordinates — the border
 * painter's path.
 *
 * Canvas 2D rather than a Fabric object because the document border is
 * envelope-owned chrome, not an object (ADR 0002, §4): it is painted in
 * `after:render`, which Fabric runs *after* the clip has been applied, so it
 * must trace the outline itself — the previous rect stroke would wrap a
 * circle sticker in a rectangle.
 *
 * The caller strokes this path at {@link BORDER_STROKE_MULTIPLIER} × the
 * border's width and lets the clip trim the outer half. Insetting the path by
 * half the border instead is exact for a rect and a circle but *not* for an
 * oval: the outward offset curve of an ellipse is not the ellipse with its
 * radii grown by that distance, so the stroke falls short of the cut along
 * the flanks and leaves a hairline of Document background outside the border
 * (measured at 300 DPI on the prototype, #50). Overshoot-and-clip is flush by
 * construction, for every shape.
 */
export function traceOutline(
  ctx: CanvasRenderingContext2D,
  outline: OutlineKind,
  size: DocumentSize,
): void {
  const { width, height } = size
  ctx.beginPath()
  if (outline === "oval") {
    ctx.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2)
    return
  }
  if (outline === "rounded-rect") {
    ctx.roundRect(0, 0, width, height, cornerRadius(size))
    return
  }
  ctx.rect(0, 0, width, height)
}
