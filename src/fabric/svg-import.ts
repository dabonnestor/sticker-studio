/**
 * SVG entry (the upload/paste report): an uploaded or pasted `.svg` file is a
 * vector, but the Document is a raster model — an Image is pixels (CONTEXT
 * "Artwork": a picture placed in a design, never editable geometry). Fabric's
 * image placement (`createImageFromDataURL`) loads the bytes into a browser
 * `<img>` and sizes the placement from its natural size, and SVG is the one
 * input the engines genuinely disagree on: a dimension-less SVG (no
 * `width`/`height`, `viewBox`-only) reports a 0×0 natural size in some
 * engines — the placement math then answers scale 1 and the object lands as
 * an invisible zero-pixel artifact — and the fallback dimensions vary per
 * engine (w3c/svgwg#1044, whatwg/html#3510). So an SVG data URL is
 * rasterized at the placement seam (images.ts): re-rendered into an offscreen
 * canvas at a fixed long edge and re-encoded as PNG, then placed as ordinary
 * pixels. The Document, the recent-uploads gallery, undo, and every export
 * then treat it exactly like any uploaded image.
 *
 * The raster is sized from the SVG's *own* geometry (declared width/height,
 * else the viewBox aspect), never from the browser's natural-size report —
 * the engine disagreement is exactly what this path replaces. The long edge
 * is generous because the redraw is a vector upsample: a tiny icon re-renders
 * crisply at full size, and the 2048 px covers the 300-DPI export of the
 * default 600×600 Document's 80% fit (480 placed px → 1500 raster px) with
 * headroom for larger documents.
 *
 * Browser-only: decoding and the canvas 2D context need a real DOM, which
 * jsdom does not provide, so the DOM half (`rasterizeSvgToPng`) is
 * deliberately not covered by the suite (the same stand the gallery copy
 * takes, recent-uploads.ts); the parsing and sizing math are pure and fully
 * tested.
 */

/** The SVG MIME type — what `image/svg+xml` files are re-typed to. */
export const SVG_MIME = "image/svg+xml"

/** The data-URL prefix FileReader produces for an SVG file (base64). */
export const SVG_DATA_URL_PREFIX = "data:image/svg+xml"

/** The raster's long edge, in px — see the module header for the math. */
export const SVG_RASTER_LONG_EDGE = 2048

/** A placement-stopping SVG failure — surfaced verbatim in the status area. */
export class SvgRasterizeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SvgRasterizeError"
  }
}

/** True for `.svg` files — by MIME, or by extension when the OS reports none
 * (Windows regularly leaves the SVG MIME empty in the file picker). */
export function isSvgFile(file: File): boolean {
  return file.type === SVG_MIME || file.name.toLowerCase().endsWith(".svg")
}

/** Re-type an SVG file to the SVG MIME. A File whose OS-reported MIME is
 * empty or wrong (common for `.svg` on Windows) otherwise encodes into a data
 * URL the placement seam can't recognize as an SVG — `readAsDataURL` types
 * from `file.type`. Non-SVG files pass through untouched. */
export function svgTypedFile(file: File): File {
  if (isSvgFile(file) && file.type !== SVG_MIME) {
    return new File([file], file.name, { type: SVG_MIME })
  }
  return file
}

/** True when a data URL carries SVG bytes (the `data:image/svg+xml` prefix). */
export function isSvgDataUrl(dataUrl: string): boolean {
  return dataUrl.startsWith(SVG_DATA_URL_PREFIX)
}

/** The intrinsic-size facts of an SVG file, parsed from its own markup. */
export interface SvgIntrinsicSize {
  /** Declared pixel width — present only when width/height are px or plain. */
  width?: number
  /** Declared pixel height — present only when width/height are px or plain. */
  height?: number
  /** The content aspect (width/height) — the declared box, else the viewBox. */
  aspect: number
}

/**
 * Parse the size facts of an SVG document from its markup: the root's
 * `width`/`height` (px or unitless — percentages and `auto` are ignored, the
 * browser resolves them against nothing here), else its `viewBox` aspect.
 * Returns null when the markup yields neither — the caller falls back to the
 * browser's natural-size report, then to a square. The parse is a heuristic
 * (regex over the root tag), not an XML walk; it exists only to pick a raster
 * aspect when the engine's report is unreliable.
 */
export function parseSvgDimensions(markup: string): SvgIntrinsicSize | null {
  const root = markup.match(/<svg\b[^>]*>/i)?.[0]
  if (!root) return null
  // Attribute lookups are anchored to a preceding space so `stroke-width`
  // never reads as `width`. The first `width="..."` wins (the root's).
  const attr = (name: string): string | undefined => {
    const match = root.match(new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, "i"))
    return match?.[1]
  }
  const px = (value: string | undefined): number | undefined => {
    if (!value) return undefined
    const trimmed = value.trim().replace(/px$/i, "")
    if (!/^\d+(\.\d+)?$/.test(trimmed)) return undefined
    return Number(trimmed)
  }
  const width = px(attr("width"))
  const height = px(attr("height"))
  const viewBox = attr("viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number)
  const vb =
    viewBox && viewBox.length === 4 && viewBox.every(Number.isFinite)
      ? viewBox
      : undefined
  if (width !== undefined && height !== undefined && width > 0 && height > 0) {
    return { width, height, aspect: width / height }
  }
  if (vb) {
    const vbWidth = vb[2]
    const vbHeight = vb[3]
    if (vbWidth > 0 && vbHeight > 0) return { aspect: vbWidth / vbHeight }
  }
  return null
}

/**
 * The raster canvas size for the parsed aspect: the long edge pinned to
 * {@link SVG_RASTER_LONG_EDGE}, the short edge derived (rounded), so the
 * redrawn vector keeps its shape at the target resolution. Degenerate aspects
 * (missing, zero, or non-finite) fall back to a square.
 */
export function svgRasterSize(aspect: number | null | undefined): {
  width: number
  height: number
} {
  const ratio = aspect && Number.isFinite(aspect) && aspect > 0 ? aspect : 1
  if (ratio >= 1) {
    return {
      width: SVG_RASTER_LONG_EDGE,
      height: Math.max(1, Math.round(SVG_RASTER_LONG_EDGE / ratio)),
    }
  }
  return {
    width: Math.max(1, Math.round(SVG_RASTER_LONG_EDGE * ratio)),
    height: SVG_RASTER_LONG_EDGE,
  }
}

/** The SVG markup behind a data URL — base64 (FileReader's encoding) or a
 * raw percent-encoded string; null for anything unparseable. The decode feeds
 * {@link parseSvgDimensions}; the parse tolerates garbled non-ASCII text
 * nodes, since only the root tag's numeric attributes are read. */
export function svgMarkupFromDataUrl(dataUrl: string): string | null {
  if (!isSvgDataUrl(dataUrl)) return null
  const payload = dataUrl.slice(dataUrl.indexOf(",") + 1)
  if (!payload) return null
  try {
    // Base64 is the FileReader encoding; a percent-encoded payload (rare) is
    // decoded raw — the base64 alphabet check tells the two apart, and a
    // payload without a single % can't be percent-encoded at all (bare
    // markup in a data URL is not an encoding this parser feeds on).
    if (/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) return atob(payload)
    if (!payload.includes("%")) return null
    return decodeURIComponent(payload)
  } catch {
    return null
  }
}

/** Load an SVG data URL into a decodable `<img>` — the decode fails loudly. */
function loadSvgImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new SvgRasterizeError("That SVG couldn't be decoded"))
    img.src = dataUrl
  })
}

/**
 * Rasterize an SVG data URL into a PNG data URL — the vector redrawn into an
 * offscreen canvas at {@link svgRasterSize}, re-encoded lossless. The raster
 * aspect prefers the browser's natural-size report (its authoritative answer
 * when the markup is opaque — the engine disagreement this seam replaces only
 * shows up in *absent* dimensions, guarded below), then the parsed markup,
 * then a square. A raster with nothing painted — a fully transparent canvas,
 * e.g. an SVG whose ink comes from fonts or external files the img pipeline
 * cannot load — is refused with an explanatory error instead of placing a
 * silent blank. Rejects with {@link SvgRasterizeError} on any failure.
 *
 * Browser-only: needs a real canvas 2D context and image decode, which jsdom
 * does not provide — deliberately not covered by the suite (module header).
 */
export async function rasterizeSvgToPng(dataUrl: string): Promise<string> {
  const img = await loadSvgImage(dataUrl)
  const natural =
    img.naturalWidth > 0 && img.naturalHeight > 0
      ? img.naturalWidth / img.naturalHeight
      : null
  const markup = svgMarkupFromDataUrl(dataUrl)
  const parsed = markup ? parseSvgDimensions(markup) : null
  const { width, height } = svgRasterSize(natural ?? parsed?.aspect ?? 1)

  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new SvgRasterizeError("That SVG couldn't be rendered")
  ctx.drawImage(img, 0, 0, width, height)

  // Refuse a blank: a raster with no painted pixel would place an invisible
  // "image" — the exact symptom this seam exists to kill. Unreadable pixels
  // (a taint the data-URL source should never cause) skip the check, not the
  // placement — the drawing itself still painted.
  try {
    const pixels = ctx.getImageData(0, 0, width, height).data
    let hasInk = false
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] !== 0) {
        hasInk = true
        break
      }
    }
    if (!hasInk) {
      throw new SvgRasterizeError(
        "That SVG has nothing visible to place — it may rely on fonts or " +
          "external files the editor can't load",
      )
    }
  } catch (error) {
    if (error instanceof SvgRasterizeError) throw error
  }

  const png = canvas.toDataURL("image/png")
  if (!png.startsWith("data:image/png")) {
    throw new SvgRasterizeError("That SVG couldn't be converted to an image")
  }
  return png
}
