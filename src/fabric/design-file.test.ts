import { afterEach, describe, expect, it, vi } from "vitest"

import { registerCustomProperties } from "@/fabric/custom-properties"
import {
  DESIGN_FILE_FORMAT,
  DESIGN_FILE_VERSION,
  DesignFileError,
  MIGRATORS,
  designFileBasename,
  parseDesignFile,
  serializeDesignFile,
} from "@/fabric/design-file"
import { createShape } from "@/fabric/shapes"
import { createStageCanvas } from "@/fabric/stage-canvas"

/** The Document these fixtures sit on — 4×4 in, where a shape is 192 px. */
const DOC = { width: 384, height: 384 }

registerCustomProperties()

/**
 * Design file (ADR 0002, build spec §10) — the v2 envelope, validation, and
 * the migrators register. `serialize`/`parse` round-trip the current Document
 * through the envelope; validation refuses unknown object types loudly (Fabric
 * enlivening fails silently on those — a silent drop is data loss).
 */
describe("design file — v2 envelope", () => {
  it("serializes the Document as the documented envelope shape", () => {
    const canvas = {
      width: 288,
      height: 192,
      rotation: 90,
      borderWidth: 4,
      borderColor: "#ff0000",
      outline: "oval",
      aspectLocked: false,
    } as unknown as Parameters<typeof serializeDesignFile>[0]
    canvas.toJSON = () => ({ version: "7.4.0", objects: [{ type: "Rect" }] })

    const file = serializeDesignFile(canvas)
    expect(file).toEqual({
      format: "sticker-studio",
      version: DESIGN_FILE_VERSION,
      size: { width: 288, height: 192 },
      rotation: 90,
      outline: { outline: "oval", aspectLocked: false },
      border: { width: 4, color: "#ff0000" },
      canvas: { version: "7.4.0", objects: [{ type: "Rect" }] },
    })
  })

  it("parses a matching envelope back round-trip", () => {
    const file = parseDesignFile(
      JSON.stringify({
        format: "sticker-studio",
        version: DESIGN_FILE_VERSION,
        size: { width: 288, height: 192 },
        rotation: 90,
        outline: { outline: "rounded-rect", aspectLocked: false },
        border: { width: 4, color: "#ff0000" },
        canvas: { version: "7.4.0", objects: [{ type: "Rect" }] },
      }),
    )
    expect(file.size).toEqual({ width: 288, height: 192 })
    expect(file.rotation).toBe(90)
    expect(file.outline).toEqual({ outline: "rounded-rect", aspectLocked: false })
    expect(file.border).toEqual({ width: 4, color: "#ff0000" })
    expect(file.canvas.objects).toEqual([{ type: "Rect" }])
  })

  /**
   * The outline survives a real serialize/parse cycle — the Document model's
   * round-trip contract (map #48), through the same envelope Save writes and
   * Import reads.
   */
  it("round-trips the outline through a real canvas", async () => {
    const canvas = createStageCanvas(
      document.createElement("canvas"),
      document.createElement("canvas"),
    )
    try {
      canvas.outline = "oval"
      canvas.aspectLocked = false
      canvas.setDimensions({ width: 288, height: 192 })

      const file = parseDesignFile(JSON.stringify(serializeDesignFile(canvas)))
      expect(file.outline).toEqual({ outline: "oval", aspectLocked: false })
      expect(file.size).toEqual({ width: 288, height: 192 })
    } finally {
      await canvas.dispose()
    }
  })

  /**
   * The migrators registry (ADR 0002): keyed by the version a file migrates
   * *from*, each step it one version forward. A hypothetical v0 exercises the
   * sequencing seam on top of the real v1 → v2 step, so a v0 file has to
   * traverse two migrators to land current.
   */
  it("runs the migrators registry sequentially on load", () => {
    const legacy = vi.fn((file) => ({ ...file, version: 1 }))
    MIGRATORS[0] = legacy as never
    const file = parseDesignFile(
      JSON.stringify({
        format: "sticker-studio",
        version: 0,
        size: { width: 600, height: 400 },
        rotation: 0,
        border: { width: 0, color: "#18181b" },
        canvas: { objects: [{ type: "Rect" }] },
      }),
    )
    expect(legacy).toHaveBeenCalledTimes(1)
    expect(file.version).toBe(DESIGN_FILE_VERSION)
    // The real v1 → v2 step ran after the stub, on its output.
    expect(file.outline).toEqual({ outline: "rect", aspectLocked: false })
  })

  /**
   * v1 → v2 (map #48): a v1 file predates the Document outline entirely. The
   * migrator classifies from the size, mirroring `getShapeKind` for a shape
   * object — square when width === height, otherwise rectangle — so the
   * shipped 600×600 Predesigns land as Square, and a v1 file of any other
   * shape lands as Rectangle (rect + free, the state Custom shares).
   */
  describe("v1 → v2 migration", () => {
    /** A v1 file as the app wrote it — no `outline` field at all. */
    const v1File = (size: { width: number; height: number }) => ({
      format: DESIGN_FILE_FORMAT,
      version: 1,
      size,
      rotation: 0,
      border: { width: 0, color: "#18181b" },
      canvas: { version: "7.4.0", objects: [{ type: "Rect" }] },
    })

    it("a square v1 Document becomes a Square sticker — rect, aspect locked", () => {
      const file = parseDesignFile(JSON.stringify(v1File({ width: 600, height: 600 })))
      expect(file.version).toBe(DESIGN_FILE_VERSION)
      expect(file.outline).toEqual({ outline: "rect", aspectLocked: true })
    })

    it("a non-square v1 Document becomes a Rectangle — rect, free", () => {
      const file = parseDesignFile(JSON.stringify(v1File({ width: 800, height: 400 })))
      expect(file.version).toBe(DESIGN_FILE_VERSION)
      expect(file.outline).toEqual({ outline: "rect", aspectLocked: false })
    })

    it("leaves the rest of the envelope untouched", () => {
      const file = parseDesignFile(JSON.stringify(v1File({ width: 600, height: 600 })))
      expect(file.size).toEqual({ width: 600, height: 600 })
      expect(file.rotation).toBe(0)
      expect(file.border).toEqual({ width: 0, color: "#18181b" })
      expect(file.canvas.objects).toEqual([{ type: "Rect" }])
    })

    it("a v1 file with a malformed size is still refused loudly", () => {
      // The migrator runs first and must not throw on the way to validation.
      expect(() =>
        parseDesignFile(JSON.stringify({ ...v1File({ width: 1, height: 1 }), size: {} })),
      ).toThrow("The file's size is missing or malformed")
    })
  })

  // The migration test above mutates the shared MIGRATORS registry — restore
  // it even if an expect throws mid-test, or a leaked v0 entry would silently
  // migrate real v1 files in sibling cases.
  afterEach(() => {
    delete MIGRATORS[0]
  })

  describe("validation rejects loudly", () => {
    const VALID = {
      format: DESIGN_FILE_FORMAT,
      version: DESIGN_FILE_VERSION,
      size: { width: 600, height: 400 },
      rotation: 0,
      outline: { outline: "rect", aspectLocked: false },
      border: { width: 0, color: "#18181b" },
      canvas: { objects: [] },
    }

    it("a file that is not JSON", () => {
      expect(() => parseDesignFile("not json")).toThrow(DesignFileError)
      expect(() => parseDesignFile("not json")).toThrow(
        "This file is not valid JSON",
      )
    })

    it("a missing format marker", () => {
      expect(() =>
        parseDesignFile(JSON.stringify({ ...VALID, format: undefined })),
      ).toThrow("This file is not a Sticker Studio design")
    })

    it("a wrong version", () => {
      // Past the current one: an older app cannot read a newer file, and
      // there is no migrator to run.
      expect(() =>
        parseDesignFile(JSON.stringify({ ...VALID, version: 3 })),
      ).toThrow("Unsupported design file version 3")
    })

    it("a missing outline", () => {
      // Only a v1 file may lack one — and that is the migrator's job. A
      // current-version file without an outline is malformed, not legacy.
      expect(() =>
        parseDesignFile(JSON.stringify({ ...VALID, outline: undefined })),
      ).toThrow("The file's outline is missing or malformed")
    })

    it("an outline kind the app does not know", () => {
      expect(() =>
        parseDesignFile(
          JSON.stringify({ ...VALID, outline: { outline: "hexagon", aspectLocked: false } }),
        ),
      ).toThrow("The file's outline is missing or malformed")
    })

    it("an outline whose aspect lock is not a boolean", () => {
      expect(() =>
        parseDesignFile(
          JSON.stringify({ ...VALID, outline: { outline: "rect", aspectLocked: "yes" } }),
        ),
      ).toThrow("The file's outline is missing or malformed")
    })

    it("every outline kind the app knows passes", () => {
      for (const kind of ["rect", "rounded-rect", "oval"] as const) {
        const file = parseDesignFile(
          JSON.stringify({ ...VALID, outline: { outline: kind, aspectLocked: true } }),
        )
        expect(file.outline.outline).toBe(kind)
      }
    })

    it("an unknown top-level object type", () => {
      expect(() =>
        parseDesignFile(
          JSON.stringify({
            ...VALID,
            canvas: { objects: [{ type: "totally-unknown" }] },
          }),
        ),
      ).toThrow('Unknown object type "totally-unknown"')
    })

    it("an unknown type inside a group", () => {
      expect(() =>
        parseDesignFile(
          JSON.stringify({
            ...VALID,
            canvas: {
              objects: [
                { type: "Group", objects: [{ type: "bogus" }] },
              ],
            },
          }),
        ),
      ).toThrow('Unknown object type "bogus"')
    })

    it("an unknown type in a clipPath", () => {
      expect(() =>
        parseDesignFile(
          JSON.stringify({
            ...VALID,
            canvas: {
              objects: [{ type: "Rect", clipPath: { type: "fake" } }],
            },
          }),
        ),
      ).toThrow('Unknown object type "fake"')
    })

    it("known shape, text, group, and clip-path types pass", () => {
      const file = parseDesignFile(
        JSON.stringify({
          ...VALID,
          canvas: {
            objects: [
              { type: "Rect" },
              { type: "Circle" },
              { type: "Ellipse" },
              { type: "Triangle" },
              { type: "Textbox" },
              { type: "Path" },
              { type: "Image" },
              { type: "Group", objects: [{ type: "Rect" }] },
            ],
          },
        }),
      )
      expect(file.canvas.objects?.length).toBe(8)
    })
  })

  describe("serialize round-trips real shapes", () => {
    it("a real shape's envelope carries its type and clipPath", () => {
      const canvas = {
        width: 600,
        height: 400,
        rotation: 0,
        borderWidth: 0,
        borderColor: "#18181b",
        outline: "rect",
        aspectLocked: false,
        toJSON: () => ({
          version: "7.4.0",
          objects: [createShape("square", DOC).toObject()],
        }),
      } as unknown as Parameters<typeof serializeDesignFile>[0]
      const file = serializeDesignFile(canvas)
      // A shape serializes with its own type and a clipPath — both known.
      expect(parseDesignFile(JSON.stringify(file)).canvas.objects?.length).toBe(
        1,
      )
    })
  })
})

describe("designFileBasename", () => {
  it("strips a .json extension", () => {
    expect(designFileBasename("my-design.json")).toBe("my-design")
  })

  it("falls back to untitled", () => {
    expect(designFileBasename("")).toBe("untitled")
    expect(designFileBasename("   ")).toBe("untitled")
  })

  it("keeps a name without the extension", () => {
    expect(designFileBasename("my-design")).toBe("my-design")
  })
})