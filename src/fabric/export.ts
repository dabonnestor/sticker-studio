import { Rect, StaticCanvas, config, type Canvas } from "fabric"

import { designFileBasename, type DocumentEnvelope } from "@/fabric/design-file"

/**
 * Export pipeline (build spec §11): one shared path for the four
 * formats that renders the current *committed* Document offscreen. The live
 * canvas is serialized (the same bytes a Design file carries), the envelope
 * is stripped, and a detached StaticCanvas renders just the Document — no
 * DOM element, no viewport/zoom/pan, no selection chrome, no workspace
 * background. Document rotation applies and the document border renders
 * inset on the edge (the same stroke the stage draws). Export is never an
 * undoable step and never mutates the Document or history — it reads the
 * committed serialization and renders a private copy.
 *
 * The browser-only, effectful steps (rasterization, the DOM font-face set,
 * downloads) are injected through an {@link ExportHost} so the orchestration
 * is unit-testable in jsdom, which has no canvas raster and no real fonts.
 * jsdom exercises every decision the pipeline makes; the real rendering is
 * the browser-side host.
 */

/** The four export formats, in dropdown order (build spec §11). */
export type ExportFormat = "PNG" | "JPEG" | "PDF" | "SVG"

export const EXPORT_FORMATS: readonly ExportFormat[] = ["PNG", "JPEG", "PDF", "SVG"]

/** Export resolution — 300 DPI (build spec §11; also §1's print basis). */
export const RASTER_DPI = 300

/** The raster upscale: 300 DPI over the 96 DPI display basis (300/96). */
export const RASTER_MULTIPLIER = RASTER_DPI / 96

/** Pixels per inch at the display basis — the px→inch bridge for PDF points. */
export const PX_PER_INCH = 96

/** Points per inch — jsPDF's page unit (1 in = 72 pt). */
export const PT_PER_INCH = 72

/** The browser's practical canvas-size ceiling — refusal beyond it (px/axis). */
export const MAX_RASTER_PX = 8192

/** JPEG quality — the raster is composited onto white and re-encoded at 0.95. */
export const JPEG_QUALITY = 0.95

/** A width/height pair — document px, raster px, or PDF points. */
export interface Size {
  width: number
  height: number
}

/** A structural export failure — surfaced in the bottom-bar status area. */
export class ExportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ExportError"
  }
}

/** The 300 DPI raster size for a Document (the pipeline's pixel output). */
export function rasterSize(width: number, height: number): Size {
  return {
    width: Math.round(width * RASTER_MULTIPLIER),
    height: Math.round(height * RASTER_MULTIPLIER),
  }
}

/** The Document's PDF page size in points — px → in → pt (1 in = 72 pt). */
export function pointSize(width: number, height: number): Size {
  return {
    width: (width / PX_PER_INCH) * PT_PER_INCH,
    height: (height / PX_PER_INCH) * PT_PER_INCH,
  }
}

/** True when the 300 DPI raster would exceed {@link MAX_RASTER_PX} on a side. */
export function exceedsRasterCeiling(width: number, height: number): boolean {
  const raster = rasterSize(width, height)
  return raster.width > MAX_RASTER_PX || raster.height > MAX_RASTER_PX
}

/**
 * The axis-aligned bounds of a Document rotated by the given degrees — a
 * W×H rect rotated θ spans `W·|cosθ| + H·|sinθ|` by `W·|sinθ| + H·|cosθ|`.
 * The offscreen render sizes to these bounds and applies the rotation about
 * the center, so the full Document renders without clipping at any angle.
 */
export function rotatedBounds(width: number, height: number, degrees: number): Size {
  const radians = (degrees * Math.PI) / 180
  const cos = Math.abs(Math.cos(radians))
  const sin = Math.abs(Math.sin(radians))
  return {
    width: width * cos + height * sin,
    height: width * sin + height * cos,
  }
}

/** The download filename — `<design-file-basename>.<ext>` (untitled fallback). */
export function exportFilename(baseName: string, format: ExportFormat): string {
  const ext = format.toLowerCase()
  return `${designFileBasename(baseName)}.${ext}`
}

/**
 * The font families actually used in a serialized document — walked through
 * the top-level `objects`, recursing into groups (single-level, §7, but the
 * walk costs nothing and future-proofs) and reading each object's
 * `fontFamily`. These are the faces SVG embeds and the faces the
 * font-readiness check must confirm before rasterizing.
 */
export function collectUsedFontFamilies(payload: {
  objects?: Array<Record<string, unknown>>
}): string[] {
  const seen = new Set<string>()
  const walk = (objs: Array<Record<string, unknown>> | undefined): void => {
    for (const obj of objs ?? []) {
      if (typeof obj.fontFamily === "string" && obj.fontFamily) seen.add(obj.fontFamily)
      const children = obj.objects as Array<Record<string, unknown>> | undefined
      if (Array.isArray(children)) walk(children)
    }
  }
  walk(payload.objects)
  return [...seen]
}

/**
 * A browser-effectful seam of the export pipeline — everything the
 * orchestrator cannot do in jsdom (offscreen rendering, the DOM font set,
 * raster encoding, downloads). Injected so {@link exportDocument} is
 * testable; {@link createExportHost} supplies the real implementations.
 */
export interface ExportHost {
  /**
   * Render the document offscreen: build a detached StaticCanvas, load the
   * payload verbatim, size it to the rotated bounds, apply the document
   * rotation about the center, and draw the inset document border. Returns
   * the prepared canvas plus the sizes the formats need.
   */
  prepare(input: ExportInput): Promise<PreparedExport>
  /**
   * Await the fonts the document uses; return a warning when a family failed
   * to load, so the caller exports with fallback rendering and reports it.
   */
  awaitFonts(usedFamilies: string[]): Promise<string | undefined>
  /** Rasterize the prepared canvas to a PNG blob at 300 DPI (alpha kept). */
  toPng(prepared: PreparedExport): Promise<Blob | null>
  /** Rasterize the prepared canvas composited onto white — a JPEG blob. */
  toJpeg(prepared: PreparedExport): Promise<Blob | null>
  /** Serialize to SVG with each used family's bytes embedded (self-contained). */
  toSvg(prepared: PreparedExport, usedFamilies: string[]): Promise<string>
  /** Build a PDF page sized to the Document in points, 300 DPI PNG embedded. */
  toPdf(png: Blob, sizePt: Size): Promise<Blob>
  /** Trigger the download of a finished artifact. */
  download(blob: Blob, filename: string): void
}

/**
 * The committed Document handed to the export pipeline — the envelope-owned
 * fields (the same five a Design file carries, §11: "the same bytes a Design
 * file would carry", envelope stripped) plus the canvas payload loaded
 * verbatim into the offscreen render.
 */
export interface ExportInput extends DocumentEnvelope {
  format: ExportFormat
  /** The design file's basename — the download's base name (untitled). */
  baseName?: string
  /** `canvas.toJSON()` — loaded verbatim into the offscreen canvas. */
  payload: ReturnType<Canvas["toJSON"]>
}

/** The offscreen canvas plus the sizes the per-format renderers consume. */
export interface PreparedExport {
  canvas: StaticCanvas
  /** The 300 DPI raster size (PNG/JPEG/PDF-pixel dimensions). */
  raster: Size
  /** The PDF page size in points. */
  points: Size
}

/**
 * The export pipeline (build spec §11): commit-first is the caller's job (the
 * live canvas is flushed before the serialization that feeds this), so this
 * runner consumes an already-committed snapshot. It refuses a raster (any
 * non-SVG format — PDF embeds a 300 DPI PNG) that would exceed the browser
 * canvas ceiling; renders the document offscreen; awaits the used fonts
 * (surfacing a fallback warning if one failed); dispatches to the format
 * renderer; downloads; and returns the filename plus any warning. It never
 * runs on the live canvas and never records — export is not an undoable step
 * (§11) and mutates nothing.
 */
export async function exportDocument(
  input: ExportInput,
  host: ExportHost,
): Promise<{ filename: string; warning?: string }> {
  const filename = exportFilename(input.baseName ?? "untitled", input.format)

  // Refuse a raster that would blow the browser's canvas ceiling — before
  // any rendering work. SVG is vector: it carries no pixel limit.
  if (input.format !== "SVG" && exceedsRasterCeiling(input.width, input.height)) {
    const raster = rasterSize(input.width, input.height)
    throw new ExportError(
      `This document is too large to export at ${RASTER_DPI} DPI — the ` +
        `${raster.width}×${raster.height} px render exceeds the ${MAX_RASTER_PX} px limit.`,
    )
  }

  const prepared = await host.prepare(input)
  const usedFamilies = collectUsedFontFamilies(input.payload)
  const warning = await host.awaitFonts(usedFamilies)

  let blob: Blob
  switch (input.format) {
    case "PNG": {
      const png = await host.toPng(prepared)
      if (!png) throw new ExportError("Couldn't render the PNG export")
      blob = png
      break
    }
    case "JPEG": {
      const jpeg = await host.toJpeg(prepared)
      if (!jpeg) throw new ExportError("Couldn't render the JPEG export")
      blob = jpeg
      break
    }
    case "SVG": {
      const svg = await host.toSvg(prepared, usedFamilies)
      blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" })
      break
    }
    case "PDF": {
      const png = await host.toPng(prepared)
      if (!png) throw new ExportError("Couldn't render the PDF export")
      blob = await host.toPdf(png, prepared.points)
      break
    }
  }

  host.download(blob, filename)
  return { filename, warning }
}

/** Whether the given family is actually usable, once loaded — the readiness
 * probe's answer. `document.fonts.load` resolves when the face is ready (or
 * the check can answer); `check` then reports whether the face is usable.
 * The family is wrapped in quotes so names with spaces ("Work Sans") parse as
 * one. */
async function checkFontLoaded(family: string): Promise<boolean> {
  await document.fonts.load(`16px "${family}"`)
  return document.fonts.check(`16px "${family}"`)
}

/** A Blob rendered as a data URL — the bridge into drawImage and jsPDF. */
async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** Fetch a bundled font file and return it base64 (null on failure). */
async function fetchFontBase64(url: string): Promise<string | null> {
  try {
    const response = await fetch(url)
    const buffer = await response.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    let binary = ""
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary)
  } catch {
    return null
  }
}

/**
 * Bake the document rotation into the offscreen scene: rotate every
 * top-level object's center about the document center and add the rotation to
 * its angle. Fabric's `toCanvasElement` — the raster path behind `toBlob` and
 * `toDataURL` — rebuilds the viewport as a pure-scale matrix, silently
 * dropping any rotation it carried, so a viewport transform can never rotate
 * a raster. Angles live on the objects, which every renderer honors: the
 * raster renders the rotated scene and `toSVG` serializes the angles. The
 * rotated-bounds canvas (sized by the caller) then contains the full scene.
 */
function rotateSceneAboutCenter(canvas: StaticCanvas, degrees: number): void {
  const radians = (degrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const cx = canvas.width / 2
  const cy = canvas.height / 2
  for (const obj of canvas.getObjects()) {
    const x = obj.left - cx
    const y = obj.top - cy
    obj.set({
      left: x * cos - y * sin + cx,
      top: x * sin + y * cos + cy,
      angle: obj.angle + degrees,
    })
  }
}

/** Load a PNG image element from a data URL. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("Couldn't load the rendered image"))
    img.src = src
  })
}

/**
 * The real browser host: a detached StaticCanvas renders the document
 * (rotation baked into the scene — see rotateSceneAboutCenter — onto the
 * rotated bounds; the inset border drawn as a real Rect), fonts are awaited
 * against the DOM font set, and each format encodes through Fabric / the DOM
 * canvas / jsPDF.
 */
export function createExportHost(): ExportHost {
  return {
    async prepare(input) {
      // An offscreen, non-interactive canvas — no DOM element is shown.
      const element = document.createElement("canvas")
      const canvas = new StaticCanvas(element, {
        width: input.width,
        height: input.height,
      })
      // Load verbatim (the payload carries the Document's width/height, so
      // the canvas dimensions settle there), awaiting the async enliven
      // before the rotation and border are applied and the canvas is read.
      await canvas.loadFromJSON(input.payload)
      // Document border — a centered rect at (w−bw)×(h−bw) stroked at bw spans
      // the document edge exactly: the same inset stroke the stage draws
      // (§11). As a real object it renders through the same pipeline as the
      // shapes — full width under the 3.125× raster, and serialized into the
      // SVG as a vector stroke.
      if (input.borderWidth) {
        canvas.add(
          new Rect({
            left: input.width / 2,
            top: input.height / 2,
            width: input.width - input.borderWidth,
            height: input.height - input.borderWidth,
            fill: "transparent",
            stroke: input.borderColor,
            strokeWidth: input.borderWidth,
            selectable: false,
            evented: false,
          }),
        )
      }
      // Document rotation — bake it into the scene (see rotateSceneAboutCenter),
      // sizing the canvas to the rotated bounds so the full rotated Document
      // fits without clipping; the center point is unchanged.
      if (input.rotation) {
        const bounds = rotatedBounds(input.width, input.height, input.rotation)
        rotateSceneAboutCenter(canvas, input.rotation)
        canvas.setDimensions({ width: bounds.width, height: bounds.height })
      }
      canvas.requestRenderAll()
      return {
        canvas,
        raster: rasterSize(input.width, input.height),
        points: pointSize(input.width, input.height),
      }
    },

    async awaitFonts(usedFamilies) {
      if (usedFamilies.length === 0) return undefined
      // Wait for every pending face, then confirm the used families loaded.
      await document.fonts.ready
      const failed: string[] = []
      for (const family of usedFamilies) {
        const loaded = await checkFontLoaded(family).catch(() => false)
        if (!loaded) failed.push(family)
      }
      if (failed.length === 0) return undefined
      return `Some fonts couldn't be loaded — exported with fallback rendering (${failed.join(", ")})`
    },

    async toPng(prepared) {
      const { canvas } = prepared
      return await canvas.toBlob({
        format: "png",
        multiplier: RASTER_MULTIPLIER,
      })
    },

    async toJpeg(prepared) {
      // The raster, composited onto white — the alpha channel has no JPEG
      // representation, so a transparent PNG would encode black. The
      // document background (when set) already painted into the raster and
      // renders above the white fill, exactly as §11 describes.
      const { canvas, raster } = prepared
      const png = canvas.toDataURL({ format: "png", multiplier: RASTER_MULTIPLIER })
      const image = await loadImage(png).catch(() => null)
      if (!image) return null
      const composite = document.createElement("canvas")
      composite.width = raster.width
      composite.height = raster.height
      const ctx = composite.getContext("2d")
      if (!ctx) return null
      ctx.fillStyle = "#ffffff"
      ctx.fillRect(0, 0, raster.width, raster.height)
      ctx.drawImage(image, 0, 0, raster.width, raster.height)
      return await new Promise<Blob | null>((resolve) => {
        composite.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
      })
    },

    async toSvg(prepared, usedFamilies) {
      // Shape borders are a fixed screen-px constant in the editor
      // (strokeUniform, §4) — an interactive convenience. Dragged verbatim into
      // an SVG that becomes `vector-effect="non-scaling-stroke"`, which pins
      // the stroke to the viewport px: the border would never scale with the
      // document, so the vector export falls behind the rasters as soon as the
      // SVG is placed or viewed larger than 100%. Neutralize the flag for
      // export only — divide the width by the element's total scale so the
      // SVG transform multiplies it back to the design px, exactly like the
      // 300 DPI raster bakes it. The raw serializer reads object state (no
      // re-render) and the canvas is a private export copy, so neither the
      // raster formats nor the live Document are affected.
      for (const obj of prepared.canvas.getObjects()) {
        if (!obj.strokeUniform || !obj.strokeWidth) continue
        obj.strokeUniform = false
        obj.strokeWidth = obj.strokeWidth / Math.abs(obj.getObjectScaling().x)
      }
      let svg = prepared.canvas.toSVG()
      // Embed each used family's bytes as a base64 data URI — Fabric's
      // createSVGFontFacesMarkup references `config.fontPaths[family]` as an
      // external URL; a self-contained SVG must carry the face. Fabric 7.4
      // sanitization stays on. A fetch failure leaves the external URL, so
      // the file still opens (it just needs the network for that face).
      for (const family of usedFamilies) {
        const url = config.fontPaths[family]
        if (!url) continue
        const href = `url('${url}')`
        if (!svg.includes(href)) continue
        const base64 = await fetchFontBase64(url)
        if (base64) {
          svg = svg.split(href).join(`url(data:font/woff2;base64,${base64})`)
        }
      }
      return svg
    },

    async toPdf(png, sizePt) {
      const { jsPDF } = await import("jspdf")
      const dataUrl = await blobToDataUrl(png)
      // A single page sized exactly to the Document in points, zero margins:
      // 1 in = 72 pt, inch = px / 96. The 300 DPI PNG is embedded lossless.
      const doc = new jsPDF({
        orientation: sizePt.width > sizePt.height ? "landscape" : "portrait",
        unit: "pt",
        format: [sizePt.width, sizePt.height],
      })
      doc.addImage(dataUrl, "PNG", 0, 0, sizePt.width, sizePt.height)
      return doc.output("blob")
    },

    download(blob, filename) {
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = filename
      anchor.click()
      // Revoke on the next tick — revoking synchronously after click() can
      // cancel the download before the browser starts reading the blob.
      setTimeout(() => URL.revokeObjectURL(url), 0)
    },
  }
}

/** A memoized copy of {@link createExportHost} — one host for all exports. */
let sharedExportHost: ExportHost | null = null

/** The app's shared export host — created once, reused across exports. */
export function getExportHost(): ExportHost {
  sharedExportHost ??= createExportHost()
  return sharedExportHost
}
