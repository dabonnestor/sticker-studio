/**
 * The Cut line's rendering — what makes the Document's outline the boundary
 * of the sticker (map #48, ticket #52).
 *
 * The clip is derived, never stored: {@link buildOutlineClip} is a pure
 * function of the outline kind and the Document size, and the stage re-derives
 * it whenever that pair moves (see `StageCanvas.syncOutlineClip`). A stored
 * copy would only be a second place for the shape to be wrong — the envelope's
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
 * The outline as a Fabric object — what the live canvas holds as its
 * `clipPath`.
 *
 * The shape is inscribed in the Document rect: rect and rounded-rect are that
 * rect (the rounded one at the preset radius), and oval is the ellipse
 * touching all four edges — a circle exactly when the Document is square, as
 * it is on the Circle preset.
 *
 * `excludeFromExport` keeps the derived clip out of every serialization —
 * which is what "derived" has to mean, because the serializer is not only the
 * save path. The History snapshots the canvas with `toJSON`, so a clip in the
 * payload becomes part of what two Documents *are*: the seed snapshot is
 * taken before the first render (no clip) and every later one after it (clip
 * present), and a commit that changed nothing then reads as changed and
 * stacks a phantom undo step. Derived render state must not be able to make
 * two identical Documents compare unequal.
 */
export function buildOutlineClip(
  outline: OutlineKind,
  size: DocumentSize,
): FabricObject {
  const common = {
    left: size.width / 2,
    top: size.height / 2,
    originX: "center" as const,
    originY: "center" as const,
    excludeFromExport: true,
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
 * Trace the outline onto a 2D context, in scene coordinates — the border
 * painter's path.
 *
 * Canvas 2D rather than a Fabric object because the document border is
 * envelope-owned chrome, not an object (ADR 0002, §4): it is painted in
 * `after:render`, which Fabric runs *after* the clip has been applied, so it
 * must trace the outline itself — the previous rect stroke would wrap a
 * circle sticker in a rectangle.
 *
 * The caller strokes this path at `2 × borderWidth` and lets the clip trim
 * the outer half. Insetting the path by half the border instead is exact for
 * a rect and a circle but *not* for an oval: the outward offset curve of an
 * ellipse is not the ellipse with its radii grown by that distance, so the
 * stroke falls short of the cut along the flanks and leaves a hairline of
 * Document background outside the border (measured at 300 DPI on the
 * prototype, #50). Overshoot-and-clip is flush by construction, for every
 * shape.
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
