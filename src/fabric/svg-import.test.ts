import { describe, expect, it } from "vitest"

import {
  SVG_MIME,
  SVG_RASTER_LONG_EDGE,
  isSvgDataUrl,
  isSvgFile,
  parseSvgDimensions,
  svgMarkupFromDataUrl,
  svgRasterSize,
  svgTypedFile,
} from "@/fabric/svg-import"

/**
 * SVG entry (the upload/paste report): a `.svg` file is recognized (by MIME
 * and by extension — Windows leaves the MIME empty), re-typed so its data
 * URL carries the recognizable `image/svg+xml` prefix, and its raster aspect
 * is derived from its own markup — never the browser's natural-size report,
 * which the engines disagree on for dimension-less SVGs. The DOM half
 * (`rasterizeSvgToPng`) is browser-only and deliberately outside the suite
 * (module header — the same stand as createGalleryCopy).
 */
describe("SVG file recognition", () => {
  it("recognizes an SVG by MIME", () => {
    const file = new File(["<svg/>"], "art.svg", { type: SVG_MIME })
    expect(isSvgFile(file)).toBe(true)
  })

  it("recognizes an SVG by extension when the OS reports no MIME — Windows", () => {
    const file = new File(["<svg/>"], "art.svg") // type defaults to ""
    expect(isSvgFile(file)).toBe(true)
  })

  it("ignores extension case — ART.SVG is still an SVG", () => {
    const file = new File(["<svg/>"], "ART.SVG")
    expect(isSvgFile(file)).toBe(true)
  })

  it("rejects a raster file", () => {
    const file = new File(["x"], "photo.png", { type: "image/png" })
    expect(isSvgFile(file)).toBe(false)
  })

  it("rejects a non-image with an .svg-looking name extension", () => {
    const file = new File(["x"], "notes.docx")
    expect(isSvgFile(file)).toBe(false)
  })
})

describe("svgTypedFile — re-type the MIME for the data URL", () => {
  it("re-types an empty-MIME SVG so readAsDataURL encodes image/svg+xml", () => {
    const file = new File(["<svg/>"], "art.svg")
    const typed = svgTypedFile(file)
    expect(typed.type).toBe(SVG_MIME)
    expect(typed.name).toBe("art.svg")
  })

  it("leaves a mis-typed SVG alone when already image/svg+xml", () => {
    const file = new File(["<svg/>"], "art.svg", { type: SVG_MIME })
    expect(svgTypedFile(file)).toBe(file)
  })

  it("passes a raster file through untouched", () => {
    const file = new File(["x"], "photo.png", { type: "image/png" })
    expect(svgTypedFile(file)).toBe(file)
  })
})

describe("isSvgDataUrl", () => {
  it("recognizes the base64 data URL FileReader produces for an SVG", () => {
    expect(isSvgDataUrl("data:image/svg+xml;base64,PHN2Zy8+")).toBe(true)
  })

  it("rejects a raster data URL", () => {
    expect(isSvgDataUrl("data:image/png;base64,AAAA")).toBe(false)
  })
})

describe("svgMarkupFromDataUrl", () => {
  it("decodes the base64 markup FileReader produces", () => {
    const markup = '<svg xmlns="http://www.w3.org/2000/svg"/>'
    const url = `data:image/svg+xml;base64,${btoa(markup)}`
    expect(svgMarkupFromDataUrl(url)).toBe(markup)
  })

  it("reads a percent-encoded (utf8) payload raw", () => {
    const url = "data:image/svg+xml;utf8,%3Csvg%20width%3D%2210%22%2F%3E"
    expect(svgMarkupFromDataUrl(url)).toBe('<svg width="10"/>')
  })

  it("answers null for a raster data URL", () => {
    expect(svgMarkupFromDataUrl("data:image/png;base64,AAAA")).toBeNull()
  })

  it("answers null for an undecodable payload", () => {
    expect(svgMarkupFromDataUrl("data:image/svg+xml;base64,!!!")).toBeNull()
  })
})

describe("parseSvgDimensions — the size facts from the SVG's own markup", () => {
  it("reads declared px width and height — the image viewport", () => {
    expect(parseSvgDimensions('<svg width="400" height="300"/>')).toEqual({
      width: 400,
      height: 300,
      aspect: 4 / 3,
    })
  })

  it("reads the px suffix as a plain number", () => {
    expect(parseSvgDimensions('<svg width="400px" height="300px"/>')?.aspect).toBe(
      4 / 3,
    )
  })

  it("falls back to the viewBox aspect when dimensions are absent", () => {
    expect(parseSvgDimensions('<svg viewBox="0 0 100 200"/>')?.aspect).toBe(0.5)
  })

  it("tolerates a comma-separated viewBox", () => {
    expect(parseSvgDimensions('<svg viewBox="0,0,800,600"/>')?.aspect).toBe(4 / 3)
  })

  it("ignores percentage dimensions — the browser resolves them nowhere", () => {
    const parsed = parseSvgDimensions('<svg width="100%" viewBox="0 0 2 1"/>')
    expect(parsed?.width).toBeUndefined()
    expect(parsed?.aspect).toBe(2)
  })

  it("uses the viewBox aspect when only one axis is declared", () => {
    expect(parseSvgDimensions('<svg width="500" viewBox="0 0 3 2"/>')?.aspect).toBe(
      3 / 2,
    )
  })

  it("never reads `stroke-width` as `width`", () => {
    expect(
      parseSvgDimensions('<svg stroke-width="3" width="100" height="50"/>')
        ?.aspect,
    ).toBe(2)
  })

  it("answers null when the markup has no geometry", () => {
    expect(parseSvgDimensions("<svg/>")).toBeNull()
    expect(parseSvgDimensions("<html></html>")).toBeNull()
  })
})

describe("svgRasterSize — the raster pinned to the long edge", () => {
  it("squares a missing aspect", () => {
    expect(svgRasterSize(null)).toEqual({
      width: SVG_RASTER_LONG_EDGE,
      height: SVG_RASTER_LONG_EDGE,
    })
  })

  it("derives the short edge for a wide aspect", () => {
    expect(svgRasterSize(4 / 3)).toEqual({
      width: 2048,
      height: Math.round(2048 / (4 / 3)), // 1536
    })
  })

  it("derives the width for a tall aspect", () => {
    expect(svgRasterSize(0.5)).toEqual({
      width: Math.round(2048 * 0.5), // 1024
      height: 2048,
    })
  })

  it("squares a non-finite or non-positive aspect instead of dividing by it", () => {
    expect(svgRasterSize(0)).toEqual({
      width: SVG_RASTER_LONG_EDGE,
      height: SVG_RASTER_LONG_EDGE,
    })
    expect(svgRasterSize(Number.NaN)).toEqual({
      width: SVG_RASTER_LONG_EDGE,
      height: SVG_RASTER_LONG_EDGE,
    })
  })
})
