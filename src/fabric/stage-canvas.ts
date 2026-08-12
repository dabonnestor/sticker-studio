import {
  Canvas,
  Control,
  Path,
  Point,
  type CanvasOptions,
  type ControlRenderingStyleOverride,
  type InteractiveFabricObject,
  type TMat2D,
  type Object as FabricObject,
} from "fabric"

import { stampDocumentProps } from "@/fabric/document-props"
import { getTextMeasurer } from "@/fabric/fonts"
import { DEFAULT_BORDER_COLOR, getShapeKind } from "@/fabric/shapes"
import { wireTextInteractions } from "@/fabric/text-interactions"
import { isTextObject } from "@/fabric/text"

/**
 * Initial Document size — 600×600 px at the 96 DPI display basis. The canvas
 * dimensions are the Document size (build spec §5); the stage toolbar edits
 * them after mount, and exports will size to them.
 */
export const DOCUMENT_WIDTH = 600
export const DOCUMENT_HEIGHT = 600

/** Default Document background — white (§3); edited in the stage toolbar. */
export const DOCUMENT_BACKGROUND_COLOR = "#ffffff"

/**
 * Default Document border — off (width 0) and the shape border color: §3's
 * canvas starts borderless; the border is a document property the toolbar
 * turns on (ADR 0002, envelope `border`).
 */
export const DOCUMENT_BORDER_WIDTH = 0
export const DOCUMENT_BORDER_COLOR = DEFAULT_BORDER_COLOR

/** Rotation-handle size — larger than the 13px corner handles so the icon reads. */
const ROTATE_HANDLE_SIZE = 20

/** Handle accent color — matches the app's border color (DEFAULT_BORDER_COLOR). */
const ROTATE_ICON_COLOR = "#18181b"

/**
 * The rotation-handle icon: lucide's `rotate-cw` (24×24 viewBox, ISC) — a
 * designer-tuned circular arrow. Rendered as a stroked Fabric Path so the
 * geometry is exact at any size.
 */
const ROTATE_ICON_PATH =
  "M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" + "M21 3v5h-5"

/** Lazily-built drawing template — stateless, safe to share across handles. */
let rotateIcon: Path | null = null
function getRotateIcon(): Path {
  if (!rotateIcon) {
    rotateIcon = new Path(ROTATE_ICON_PATH, {
      fill: "transparent",
      stroke: ROTATE_ICON_COLOR,
      strokeWidth: 2,
      strokeLineCap: "round",
      strokeLineJoin: "round",
    })
  }
  return rotateIcon
}

/**
 * Custom rotation-handle renderer (build spec §7): a white circular badge
 * with a dark outline — so it reads on any canvas — and the rotate icon
 * centered inside it. The arrow rotates with the object.
 */
function renderRotateHandle(
  this: Control,
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  styleOverride: ControlRenderingStyleOverride | undefined,
  fabricObject: InteractiveFabricObject,
) {
  const { xSize } = this.commonRenderProps(ctx, left, top, fabricObject, styleOverride)
  const radius = xSize / 2
  // Badge.
  ctx.beginPath()
  ctx.arc(0, 0, radius, 0, 2 * Math.PI)
  ctx.fillStyle = "#ffffff"
  ctx.fill()
  ctx.strokeStyle = ROTATE_ICON_COLOR
  ctx.lineWidth = 1
  ctx.stroke()
  // Icon, scaled from its 24×24 box to sit inside the badge.
  const icon = getRotateIcon()
  const scale = (radius * 1.44) / 24
  ctx.save()
  ctx.scale(scale, scale)
  icon._render(ctx)
  ctx.restore()
}

/** The marquee rectangle, normalized to a top-left box, in viewport space. */
export interface MarqueeBox {
  left: number
  top: number
  width: number
  height: number
}

/**
 * The marquee rectangle in viewport space (§7 extension): the drag's start
 * and current extent — `_groupSelector`'s scene-plane values — mapped
 * through the viewport transform, normalized to a box. Pure, so the overlay
 * paint and the tests share one mapping.
 */
export function getMarqueeBox(
  selector: { x: number; y: number; deltaX: number; deltaY: number },
  viewportTransform: TMat2D,
): MarqueeBox {
  const start = new Point(selector.x, selector.y).transform(viewportTransform)
  const extent = new Point(
    selector.x + selector.deltaX,
    selector.y + selector.deltaY,
  ).transform(viewportTransform)
  return {
    left: Math.min(start.x, extent.x),
    top: Math.min(start.y, extent.y),
    width: Math.abs(extent.x - start.x),
    height: Math.abs(extent.y - start.y),
  }
}

/**
 * The stage canvas, with the marquee mirrored onto a workspace overlay
 * (§7 extension). Fabric paints the marquee on the upper canvas, whose
 * bitmap is exactly the Document's size — a marquee dragged past the
 * Document edge would be invisible there. The overlay spans the whole
 * workspace, so the marquee renders — and can select objects — beyond the
 * Document. Hit-testing stays Fabric's own (`collectObjects` does not clamp
 * to the Document); only the paint is mirrored.
 */
class StageCanvas extends Canvas {
  private readonly marqueeOverlay: HTMLCanvasElement

  constructor(
    element: HTMLCanvasElement,
    marqueeOverlay: HTMLCanvasElement,
    options: Partial<CanvasOptions>,
  ) {
    super(element, options)
    this.marqueeOverlay = marqueeOverlay
  }

  /** True while a marquee drag is in progress. */
  isMarqueeActive(): boolean {
    return this._groupSelector !== null
  }

  /** Erase the marquee overlay — the marquee paint lives only on it. */
  clearMarqueeOverlay(): void {
    const ctx = this.marqueeOverlay.getContext("2d")
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.marqueeOverlay.width, this.marqueeOverlay.height)
  }

  /**
   * Mirror Fabric's marquee paint onto the overlay instead of the upper
   * canvas: the same fill and centered dashed stroke (build spec §7's look),
   * in overlay-local viewport coordinates — the canvas origin offset by how
   * far the Document sits inside the overlay, so the paint stays glued to
   * the scene at any zoom or scroll.
   */
  override _drawSelection(_ctx: CanvasRenderingContext2D): void {
    const overlay = this.marqueeOverlay
    const ctx = overlay.getContext("2d")
    if (!ctx) return
    // Size the bitmap to the overlay's CSS size at the device pixel ratio —
    // the overlay spans the workspace, which resizes with the window.
    const dpr = window.devicePixelRatio || 1
    const width = overlay.offsetWidth
    const height = overlay.offsetHeight
    const bitmapWidth = Math.round(width * dpr)
    if (overlay.width !== bitmapWidth) {
      overlay.width = bitmapWidth
      overlay.height = Math.round(height * dpr)
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    const box = getMarqueeBox(this._groupSelector!, this.viewportTransform)
    const canvasRect = this.upperCanvasEl.getBoundingClientRect()
    const overlayRect = overlay.getBoundingClientRect()
    ctx.translate(
      canvasRect.left - overlayRect.left,
      canvasRect.top - overlayRect.top,
    )

    if (this.selectionColor) {
      ctx.fillStyle = this.selectionColor
      ctx.fillRect(box.left, box.top, box.width, box.height)
    }
    if (!this.selectionLineWidth || !this.selectionBorderColor) return
    const strokeOffset = this.selectionLineWidth / 2
    ctx.lineWidth = this.selectionLineWidth
    ctx.strokeStyle = this.selectionBorderColor
    if (this.selectionDashArray.length) ctx.setLineDash(this.selectionDashArray)
    ctx.strokeRect(
      box.left + strokeOffset,
      box.top + strokeOffset,
      box.width - this.selectionLineWidth,
      box.height - this.selectionLineWidth,
    )
  }
}

/**
 * Create the stage Canvas on a fresh canvas element. The white Document
 * background is a document property (serialized, honored at export, build
 * spec §11) — set it here so the stage shows the Document, not CSS paint.
 * The marquee overlay is the workspace-spanning transparent canvas the
 * marquee mirror paints on (§7 extension).
 */
export function createStageCanvas(
  element: HTMLCanvasElement,
  marqueeOverlay: HTMLCanvasElement,
): StageCanvas {
  const canvas = new StageCanvas(element, marqueeOverlay, {
    width: DOCUMENT_WIDTH,
    height: DOCUMENT_HEIGHT,
    backgroundColor: DOCUMENT_BACKGROUND_COLOR,
  })

  // Document border (envelope-owned, ADR 0002) — off at creation. The canvas
  // is the document: the border lives here, mirrored by the stage toolbar.
  canvas.borderWidth = DOCUMENT_BORDER_WIDTH
  canvas.borderColor = DOCUMENT_BORDER_COLOR

  // Document identity (ADR 0002): stamp the id/locked defaults at the
  // document boundary so every creation path — sidebar, console-added
  // objects, imports — carries a stable id. Objects restored from a Design
  // file already have their ids and are left untouched. The rotation handle
  // is replaced with the icon version on every add path; shapes expose
  // corner handles only (uniform scaling), and text hides the top/bottom
  // handles — a Y-only drag would distort the glyphs, and the uniform-scaling
  // lock (§5) pins it dead anyway. Text keeps the ml/mr wrap handles (§6).
  canvas.on("object:added", (event) => {
    const obj = event.target
    if (!obj) return
    if (!obj.id) stampDocumentProps(obj)
    const rotate = obj.controls.mtr
    if (rotate) {
      rotate.sizeX = ROTATE_HANDLE_SIZE
      rotate.sizeY = ROTATE_HANDLE_SIZE
      rotate.render = renderRotateHandle
    }
    if (getShapeKind(obj)) {
      obj.setControlsVisibility({ ml: false, mt: false, mr: false, mb: false })
    } else if (isTextObject(obj)) {
      obj.setControlsVisibility({ mt: false, mb: false })
    }
  })

  // The document border (envelope-owned, ADR 0002) renders as an inset stroke
  // on the document edge — same inset model as shape borders (§4): the stroke
  // sits inside the edge, so exports (which render only the document area)
  // show the full border. `after:render` paints in the background's base
  // space, so the stroke hugs the document edge at any zoom.
  canvas.on("after:render", () => {
    const borderWidth = canvas.borderWidth
    if (!borderWidth) return
    const ctx = canvas.getContext()
    ctx.save()
    ctx.strokeStyle = canvas.borderColor
    ctx.lineWidth = borderWidth
    ctx.strokeRect(
      borderWidth / 2,
      borderWidth / 2,
      canvas.width - borderWidth,
      canvas.height - borderWidth,
    )
    ctx.restore()
  })

  // The marquee mirror lives on the workspace overlay, not the upper canvas
  // (whose bitmap is the Document's size), so Fabric never clears it. Clear
  // it at the end of every render while no marquee is active — the rect from
  // a finished drag would otherwise linger on the workspace.
  canvas.on("after:render", () => {
    if (!canvas.isMarqueeActive()) canvas.clearMarqueeOverlay()
  })

  // Shapes and text scale uniformly — the aspect ratio is frozen at the
  // gesture start, so a corner drag never distorts the object (§5 shapes,
  // §6 text: the scale fold is gone — text scales like a shape, scale stays
  // on the object). The first `object:scaling` tick records the ratio; later
  // ticks keep it; the end of the gesture (any transform commit) clears it
  // for the next one. Scaling also hands a text's width to the user — a
  // re-fit at session exit would measure in local units and fight the scale.
  const gestureRatios = new WeakMap<FabricObject, number>()
  canvas.on("object:scaling", (event) => {
    const obj = event.target
    if (!obj || (!getShapeKind(obj) && !isTextObject(obj))) return
    if (isTextObject(obj)) obj.set("autoFit", false)
    const ratio = gestureRatios.get(obj)
    if (ratio === undefined) {
      gestureRatios.set(obj, obj.scaleX / obj.scaleY)
      return
    }
    obj.set("scaleY", obj.scaleX / ratio)
  })
  canvas.on("object:modified", (event) => {
    if (event.target) gestureRatios.delete(event.target)
  })

  // Text (§6): text scales uniformly with the shapes above, and the text
  // session lifecycle (commit on exit, Escape reverts, auto-fit re-fits,
  // uppercase) wires here.
  wireTextInteractions(canvas, getTextMeasurer())

  return canvas
}
