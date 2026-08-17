import { Rect } from "fabric"
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

  it("draws the document border as an inset stroked rect", async () => {
    const host = createExportHost()
    const prepared = await host.prepare(
      baseInput({ borderWidth: 4, borderColor: "#ff0000" }),
    )
    const border = prepared.canvas.getObjects().at(-1)!
    expect(border).toBeInstanceOf(Rect)
    // A centered (w−bw)×(h−bw) rect stroked at bw spans the document edge.
    expect(border.width).toBe(600 - 4)
    expect(border.height).toBe(600 - 4)
    expect(border.stroke).toBe("#ff0000")
    expect(border.strokeWidth).toBe(4)
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
    // The object's center (300,100) rotated 90° about (150,100) lands at
    // (150,250) — the document's bottom edge — with the angle baked in. The
    // angle is what every renderer honors: the raster renders it, toSVG
    // serializes it.
    const obj = prepared.canvas.getObjects()[0]
    expect(obj.left).toBeCloseTo(150)
    expect(obj.top).toBeCloseTo(250)
    expect(obj.angle).toBeCloseTo(90)
  })
})
