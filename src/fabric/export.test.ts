import { Ellipse, Rect } from "fabric"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  EXPORT_FORMATS,
  ExportError,
  MAX_RASTER_PX,
  RASTER_MULTIPLIER,
  collectUsedFontFamilies,
  createExportHost,
  exceedsRasterCeiling,
  exportDocument,
  exportFilename,
  pointSize,
  rasterSize,
  rotatedBounds,
  type ExportHost,
  type ExportInput,
  type PreparedExport,
} from "@/fabric/export"

/**
 * Export pipeline (build spec §11) — the shared path for all four
 * formats, with the browser-only steps injected through {@link ExportHost}
 * (jsdom has no canvas raster, no real fonts, no downloads — the real host
 * is `createExportHost`). These tests exercise every decision the pipeline
 * makes: the 300 DPI pixel/point math, the 8192-px ceiling refusal, the
 * offscreen prepare, the font-wait fallback warning, the per-format dispatch
 * and naming, and the fact that export never runs on the live canvas or
 * mutates its input.
 */

/** A canned prepared export whose canvas the mock formats never read. */
const PREPARED: PreparedExport = {
  canvas: {} as never,
  raster: rasterSize(600, 600),
  points: pointSize(600, 600),
}

/** Every host step, kept callable while exposing vitest's mock surface. */
type MockHost = {
  [K in keyof ExportHost]: ExportHost[K] & ReturnType<typeof vi.fn>
}

/** A mock host: every step records its call; formats return canned blobs. */
function createMockHost(overrides: Partial<MockHost> = {}): MockHost {
  const host: MockHost = {
    prepare: vi.fn(async () => PREPARED) as MockHost["prepare"],
    awaitFonts: vi.fn(async () => undefined) as MockHost["awaitFonts"],
    toPng: vi.fn(async () => new Blob(["png"])) as MockHost["toPng"],
    toJpeg: vi.fn(async () => new Blob(["jpeg"])) as MockHost["toJpeg"],
    toSvg: vi.fn(async () => "<svg/>") as MockHost["toSvg"],
    toPdf: vi.fn(async () => new Blob(["pdf"])) as MockHost["toPdf"],
    download: vi.fn() as MockHost["download"],
    ...overrides,
  }
  return host
}

/** A 600×600 document with one work-sans Textbox inside a group. */
function baseInput(overrides: Partial<ExportInput> = {}): ExportInput {
  return {
    format: "PNG",
    baseName: "untitled",
    width: 600,
    height: 600,
    rotation: 0,
    borderWidth: 0,
    borderColor: "#18181b",
    outline: "rect",
    aspectLocked: false,
    payload: {
      version: "7.4.0",
      width: 600,
      height: 600,
      objects: [
        {
          type: "Rect",
          fontFamily: undefined,
        },
        {
          type: "Group",
          objects: [
            { type: "Textbox", fontFamily: "Work Sans" },
            { type: "Textbox", fontFamily: "Inter" },
          ],
        },
      ],
    } as never,
    ...overrides,
  }
}

describe("raster / point math", () => {
  it("scales the document to 300 DPI — the 3.125 multiplier (300/96)", () => {
    expect(RASTER_MULTIPLIER).toBe(3.125)
    expect(rasterSize(600, 600)).toEqual({ width: 1875, height: 1875 })
    // Rounds the fractional pixel — 200×1 at 3.125 = 625 exactly.
    expect(rasterSize(200, 100)).toEqual({ width: 625, height: 313 })
  })

  it("sizes the PDF page in points — px → in → pt (1 in = 72 pt)", () => {
    expect(pointSize(600, 600)).toEqual({ width: 450, height: 450 })
    expect(pointSize(96, 192)).toEqual({ width: 72, height: 144 })
  })

  it("flags a raster that would exceed the 8192-px browser ceiling", () => {
    // 600×600 → 1875 px — comfortably printable.
    expect(exceedsRasterCeiling(600, 600)).toBe(false)
    // 3200 × 3.125 = 10000 > 8192 — refused.
    expect(exceedsRasterCeiling(3200, 100)).toBe(true)
    // Exactly at the ceiling in one axis is allowed (2600 × 3.125 = 8125).
    expect(exceedsRasterCeiling(2600, 100)).toBe(false)
    expect(MAX_RASTER_PX).toBe(8192)
  })

  it("rotates a document bounds onto its axis-aligned extent", () => {
    expect(rotatedBounds(100, 50, 0)).toEqual({ width: 100, height: 50 })
    // 90° swaps the axes.
    expect(rotatedBounds(100, 50, 90).width).toBeCloseTo(50)
    expect(rotatedBounds(100, 50, 90).height).toBeCloseTo(100)
    // 180° is the identity.
    expect(rotatedBounds(100, 50, 180).width).toBeCloseTo(100)
    expect(rotatedBounds(100, 50, 180).height).toBeCloseTo(50)
  })

})

describe("naming", () => {
  it("names exports <design-file-basename>.<ext>, untitled falling back", () => {
    expect(exportFilename("untitled", "PNG")).toBe("untitled.png")
    expect(exportFilename("my design.json", "SVG")).toBe("my design.svg")
    expect(exportFilename("", "PDF")).toBe("untitled.pdf")
    expect(exportFilename("logo", "JPEG")).toBe("logo.jpeg")
  })

  it("covers exactly the four formats the export supports", () => {
    expect(EXPORT_FORMATS).toEqual(["PNG", "JPEG", "PDF", "SVG"])
  })
})

describe("collectUsedFontFamilies", () => {
  it("collects the families actually used, recursing into groups, deduped", () => {
    const families = collectUsedFontFamilies(
      baseInput().payload as never,
    )
    expect(families.sort()).toEqual(["Inter", "Work Sans"])
    // The shape (no fontFamily) and the clip-path shape contribute nothing.
    expect(families.length).toBe(2)
  })

  it("returns an empty list when no text is in the document", () => {
    expect(
      collectUsedFontFamilies({ objects: [{ type: "Rect" }] } as never),
    ).toEqual([])
  })
})

describe("exportDocument — dispatch and flow", () => {
  let host: MockHost

  beforeEach(() => {
    host = createMockHost()
  })

  it("renders offscreen, awaits fonts, then downloads — and reports a warning", async () => {
    host.awaitFonts.mockResolvedValue(
      "Some fonts couldn't be loaded — exported with fallback rendering (Inter)",
    )
    const result = await exportDocument(baseInput(), host)

    expect(host.prepare).toHaveBeenCalledTimes(1)
    expect(host.awaitFonts).toHaveBeenCalledWith(["Work Sans", "Inter"])
    expect(host.toPng).toHaveBeenCalledWith(PREPARED)
    expect(host.download).toHaveBeenCalledWith(
      expect.any(Blob),
      "untitled.png",
    )
    expect(result).toEqual({
      filename: "untitled.png",
      warning:
        "Some fonts couldn't be loaded — exported with fallback rendering (Inter)",
    })
  })

  it("dispatches PNG to toPng only", async () => {
    await exportDocument(baseInput({ format: "PNG" }), host)
    expect(host.toPng).toHaveBeenCalledOnce()
    expect(host.toJpeg).not.toHaveBeenCalled()
    expect(host.toSvg).not.toHaveBeenCalled()
    expect(host.toPdf).not.toHaveBeenCalled()
  })

  it("dispatches JPEG to toJpeg only", async () => {
    await exportDocument(baseInput({ format: "JPEG" }), host)
    expect(host.toJpeg).toHaveBeenCalledOnce()
    expect(host.toPng).not.toHaveBeenCalled()
  })

  it("dispatches SVG to toSvg and wraps it as an SVG blob", async () => {
    const result = await exportDocument(baseInput({ format: "SVG" }), host)
    expect(host.toSvg).toHaveBeenCalledWith(PREPARED, ["Work Sans", "Inter"])
    const blob = host.download.mock.calls[0][0] as Blob
    expect(blob.type).toContain("image/svg+xml")
    expect(result.filename).toBe("untitled.svg")
  })

  it("dispatches PDF through PNG then jsPDF", async () => {
    await exportDocument(baseInput({ format: "PDF" }), host)
    expect(host.toPng).toHaveBeenCalledOnce()
    expect(host.toPdf).toHaveBeenCalledWith(expect.any(Blob), PREPARED.points)
    expect(host.download).toHaveBeenCalledWith(expect.any(Blob), "untitled.pdf")
  })

  it("honors the design file's basename in the download name", async () => {
    await exportDocument(baseInput({ baseName: "storefront.json" }), host)
    expect(host.download).toHaveBeenCalledWith(expect.any(Blob), "storefront.png")
  })

  it("never mutates its input document — export reads the committed snapshot", async () => {
    const input = baseInput()
    const deep = JSON.parse(JSON.stringify(input))
    await exportDocument(input, host)
    expect(input).toEqual(deep)
  })
})

describe("exportDocument — ceiling refusal", () => {
  let host: MockHost

  beforeEach(() => {
    host = createMockHost()
  })

  it("refuses a raster that exceeds the 8192-px ceiling, before rendering", async () => {
    await expect(
      exportDocument(baseInput({ format: "PNG", width: 4000, height: 4000 }), host),
    ).rejects.toBeInstanceOf(ExportError)
    // No offscreen render or download happened — the refusal is up front.
    expect(host.prepare).not.toHaveBeenCalled()
    expect(host.download).not.toHaveBeenCalled()
  })

  it("refuses PDF the same way — it embeds a 300 DPI raster", async () => {
    await expect(
      exportDocument(baseInput({ format: "PDF", width: 4000, height: 4000 }), host),
    ).rejects.toBeInstanceOf(ExportError)
  })

  it("exempts SVG — a vector carries no pixel limit", async () => {
    await expect(
      exportDocument(baseInput({ format: "SVG", width: 4000, height: 4000 }), host),
    ).resolves.toMatchObject({ filename: "untitled.svg" })
    expect(host.prepare).toHaveBeenCalledOnce()
  })

  it("surfaces a render failure as an ExportError", async () => {
    host.toJpeg.mockResolvedValue(null)
    await expect(
      exportDocument(baseInput({ format: "JPEG" }), host),
    ).rejects.toBeInstanceOf(ExportError)
  })
})

describe("the real host — offscreen prepare", () => {
  it("loads a serialized payload and sizes the render for the formats", async () => {
    const host = createExportHost()
    const prepared = await host.prepare(baseInput())
    expect(prepared.raster).toEqual({ width: 1875, height: 1875 })
    expect(prepared.points).toEqual({ width: 450, height: 450 })
    expect(prepared.canvas.width).toBe(600)
    expect(prepared.canvas.height).toBe(600)
  })

  it("strokes the document border on the Cut line, twice as wide to be trimmed", async () => {
    const host = createExportHost()
    const prepared = await host.prepare(
      baseInput({ borderWidth: 4, borderColor: "#ff0000" }),
    )
    const border = prepared.canvas.getObjects().at(-1)!
    expect(border).toBeInstanceOf(Rect)
    // The path *is* the cut — the full Document rect, not an inset one — and
    // the stroke is 2 × 4 so the clip below trims the outer half, leaving the
    // visible border 4 px wide with its outer edge exactly on the cut. (On a
    // rect this lands on the same pixels as the old (w−bw)×(h−bw) inset rect
    // stroked at bw; on a circle it traces the circle instead of wedging.)
    expect(border.width).toBe(600)
    expect(border.height).toBe(600)
    expect(border.stroke).toBe("#ff0000")
    expect(border.strokeWidth).toBe(8)
    // The border is the artifact — unlike the derived clip, it must serialize.
    expect(border.excludeFromExport).toBe(false)
  })

  it("traces an oval outline's border as the inscribed ellipse, not a rect", async () => {
    const host = createExportHost()
    const payload = { version: "7.4.0", width: 288, height: 192, objects: [] }
    const prepared = await host.prepare(
      baseInput({
        width: 288,
        height: 192,
        outline: "oval",
        borderWidth: 3,
        borderColor: "#18181b",
        payload: payload as never,
      }),
    )
    const border = prepared.canvas.getObjects().at(-1)!
    expect(border).toBeInstanceOf(Ellipse)
    expect([(border as Ellipse).rx, (border as Ellipse).ry]).toEqual([144, 96])
    expect(border.strokeWidth).toBe(6)
  })

  it("traces a rounded-rect outline's border at the preset corner radius", async () => {
    const host = createExportHost()
    const payload = { version: "7.4.0", width: 288, height: 192, objects: [] }
    const prepared = await host.prepare(
      baseInput({
        width: 288,
        height: 192,
        outline: "rounded-rect",
        borderWidth: 2,
        payload: payload as never,
      }),
    )
    const border = prepared.canvas.getObjects().at(-1)! as Rect
    expect(border).toBeInstanceOf(Rect)
    expect([border.rx, border.ry]).toEqual([23.04, 23.04])
  })
  it("exports shape borders at the raster's proportional width — no SVG stroke pin", async () => {
    const host = createExportHost()
    const prepared = await host.prepare(
      baseInput({
        borderWidth: 0,
        // A shape at scale 3 with an 8px fixed-px border (strokeUniform).
        payload: {
          width: 600,
          height: 600,
          objects: [
            {
              type: "Rect",
              left: 300,
              top: 300,
              width: 192,
              height: 192,
              scaleX: 3,
              scaleY: 3,
              originX: "center",
              originY: "center",
              stroke: "#18181b",
              strokeWidth: 8,
              strokeUniform: true,
              fill: "#ffd23f",
            },
          ],
        } as never,
      }),
    )
    const svg = await host.toSvg(prepared, [])
    // The editor's fixed-px flag must not survive as a viewport-pinned stroke:
    // `non-scaling-stroke` would keep the border at 8 px no matter how the SVG
    // is scaled, unlike the rasters which bake it proportionally. Instead the
    // serializer writes 8/scale = 8/3 so the scale(3) transform multiplies it
    // back to 8 design units — the same proportion the 300 DPI raster paints.
    expect(svg).not.toContain("non-scaling-stroke")
    expect(svg).toMatch(/stroke-width: 2\.6[67]/)
  })

  it("sizes a rotated document to its rotated bounds and bakes the angle in", async () => {
    const host = createExportHost()
    const payload = {
      version: "7.4.0",
      width: 300,
      height: 200,
      // A 10×10 rect centered at (300, 100) — on the document's right edge.
      objects: [
        {
          type: "Rect",
          left: 300,
          top: 100,
          width: 10,
          height: 10,
          originX: "center",
          originY: "center",
        },
      ],
    }
    const prepared = await host.prepare(
      baseInput({ width: 300, height: 200, rotation: 90, payload: payload as never }),
    )
    // A 300×200 rect rotated 90° spans 200×300.
    expect(prepared.canvas.width).toBeCloseTo(200)
    expect(prepared.canvas.height).toBeCloseTo(300)
    // The object's center (300,100) rotated 90° about (150,100) lands on the
    // document's bottom edge — and the rotated content must re-center into the
    // resized canvas, so that edge sits on the canvas's own: left 100 (its
    // center), top 300 (its height). The angle is baked in — the raster
    // renders it, toSVG serializes it. (Content left at the old document
    // center would render off-center and clip the far edge — the regression
    // this guards.)
    const obj = prepared.canvas.getObjects()[0]
    expect(obj.left).toBeCloseTo(100)
    expect(obj.top).toBeCloseTo(300)
    expect(obj.angle).toBeCloseTo(90)
  })

  it("sizes a rotated document's raster and points to the rotated bounds", async () => {
    const host = createExportHost()
    const prepared = await host.prepare(
      baseInput({ width: 300, height: 200, rotation: 90 }),
    )
    // The canvas is the rotated bounds (below), so the 300 DPI raster and the
    // PDF page must follow the same box. The JPEG compositing canvas and the
    // jsPDF addImage rect are built from these — if they stayed on the
    // unrotated 300×200, the 625×938 raster would be drawn into a 938×625
    // (JPEG) / 225×150 pt (PDF) frame and come out squashed. This guards the
    // JPEG/PDF distortion at 90°/270° (PNG/SVG render directly and were fine).
    expect(prepared.canvas.width).toBeCloseTo(200)
    expect(prepared.canvas.height).toBeCloseTo(300)
    expect(prepared.raster).toEqual(rasterSize(200, 300))
    expect(prepared.points).toEqual(pointSize(200, 300))
  })
})

/**
 * The Cut line's clip (map #48, ticket #53) — the offscreen render is the
 * sticker, not a rectangle containing one. The clip is *derived* from the
 * envelope and installed by `prepare` itself: the payload never carries one
 * (`excludeFromExport` keeps it out of every serialization), so anything that
 * arrives in one is stale or foreign.
 */
describe("the real host — the Cut line clips the export", () => {
  /** A payload whose own canvas-level clipPath is a 10×10 square at the origin. */
  const FOREIGN_CLIP_PAYLOAD = {
    version: "7.4.0",
    width: 288,
    height: 192,
    objects: [],
    clipPath: { type: "Rect", left: 5, top: 5, width: 10, height: 10 },
  }

  it("installs the outline's clip — derived from the envelope, not the payload", async () => {
    const host = createExportHost()
    const prepared = await host.prepare(
      baseInput({
        width: 288,
        height: 192,
        outline: "oval",
        payload: FOREIGN_CLIP_PAYLOAD as never,
      }),
    )
    const clip = prepared.canvas.clipPath as Ellipse
    // The envelope's oval, not the 10×10 square the payload carried.
    expect(clip).toBeInstanceOf(Ellipse)
    expect([clip.rx, clip.ry]).toEqual([144, 96])
    // Derived render state — it must never round-trip into a payload.
    expect(clip.excludeFromExport).toBe(true)
  })

  it("clips at the Document's own size — a rect outline's clip is the rect", async () => {
    const host = createExportHost()
    const prepared = await host.prepare(baseInput())
    const clip = prepared.canvas.clipPath as Rect
    expect(clip).toBeInstanceOf(Rect)
    expect([clip.width, clip.height]).toEqual([600, 600])
    // Unrounded — a sharp-cornered Custom/Rectangle sheet.
    expect(clip.rx).toBe(0)
  })

  it("carries the clip through the document rotation, centered on the bounds", async () => {
    const host = createExportHost()
    const payload = { version: "7.4.0", width: 300, height: 200, objects: [] }
    const prepared = await host.prepare(
      baseInput({
        width: 300,
        height: 200,
        rotation: 90,
        payload: payload as never,
      }),
    )
    const clip = prepared.canvas.clipPath as Rect
    // The 300×200 sheet rotated 90° spans 200×300 — the canvas *and* the clip.
    expect([clip.width, clip.height]).toEqual([300, 200])
    // An unrotated clip would leave the content and border turning inside a
    // stationary cut: the clip lands turned, centered on the resized canvas.
    expect(clip.angle).toBe(90)
    expect(clip.left).toBeCloseTo(100)
    expect(clip.top).toBeCloseTo(150)
  })

  it("writes the clip into the SVG as a real vector clipPath", async () => {
    const host = createExportHost()
    const payload = { version: "7.4.0", width: 288, height: 192, objects: [] }
    const prepared = await host.prepare(
      baseInput({
        width: 288,
        height: 192,
        outline: "oval",
        borderWidth: 4,
        borderColor: "#ff0000",
        payload: payload as never,
      }),
    )
    const svg = await host.toSvg(prepared, [])
    // A real `<clipPath>` wrapping the content — not a traced bitmap, so the
    // cut stays vector-true at any scale. Its body is the oval itself.
    expect(svg).toMatch(/<clipPath id="CLIPPATH_\d+" >\n\s*<ellipse /)
    expect(svg).toMatch(/<g clip-path="url\(#CLIPPATH_\d+\)" >\n/)
    // The border rides inside that group, so the SVG trims its outer half
    // exactly as the raster does — and it is there at all, unlike the clip,
    // which `excludeFromExport` would have dropped from the `<defs>`.
    expect(svg).toContain("stroke: rgb(255,0,0)")
    expect(svg).toContain("stroke-width: 8;")
  })

  it("keeps the raster and PDF boxing the Document — the clip is not a crop", async () => {
    const host = createExportHost()
    const payload = { version: "7.4.0", width: 288, height: 192, objects: [] }
    const prepared = await host.prepare(
      baseInput({
        width: 288,
        height: 192,
        outline: "oval",
        payload: payload as never,
      }),
    )
    // The shaped sticker is drawn *on* a rectangular page/bitmap sized to the
    // Document: PNG keeps alpha in the corners, JPEG composites them white,
    // and PDF gets a plain page. A true die-cut page box is out of scope.
    expect(prepared.canvas.width).toBe(288)
    expect(prepared.canvas.height).toBe(192)
    expect(prepared.raster).toEqual(rasterSize(288, 192))
    expect(prepared.points).toEqual(pointSize(288, 192))
  })
})
