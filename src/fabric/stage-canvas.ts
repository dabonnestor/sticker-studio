import {
  Canvas,
  Control,
  Path,
  type ControlRenderingStyleOverride,
  type InteractiveFabricObject,
  type Object as FabricObject,
} from "fabric"

import { stampDocumentProps } from "@/fabric/document-props"
import { DEFAULT_BORDER_COLOR, getShapeKind } from "@/fabric/shapes"

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

/**
 * Create the stage Canvas on a fresh canvas element. The white Document
 * background is a document property (serialized, honored at export, build
 * spec §11) — set it here so the stage shows the Document, not CSS paint.
 */
export function createStageCanvas(element: HTMLCanvasElement): Canvas {
  const canvas = new Canvas(element, {
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
  // is replaced with the icon version on every add path; shapes also expose
  // corner handles only (uniform scaling).
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

  // Shapes scale uniformly — the aspect ratio is frozen at the
  // gesture start, so a corner drag never distorts the shape. The first
  // `object:scaling` tick records the ratio; later ticks keep it; the end of
  // the gesture (any transform commit) clears it for the next one.
  const gestureRatios = new WeakMap<FabricObject, number>()
  canvas.on("object:scaling", (event) => {
    const obj = event.target
    if (!obj || !getShapeKind(obj)) return
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

  return canvas
}
