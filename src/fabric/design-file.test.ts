import { describe, expect, it } from "vitest"

import { registerCustomProperties } from "@/fabric/custom-properties"
import {
  DESIGN_FILE_FORMAT,
  DESIGN_FILE_VERSION,
  DesignFileError,
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
 * Design file (ADR 0002, build spec §10) — the envelope and its validation.
 * `serialize`/`parse` round-trip the current Document through the envelope;
 * validation refuses unknown object types loudly (Fabric enlivening fails
 * silently on those — a silent drop is data loss) and refuses any file that
 * is not at the current version (nothing migrates to it).
 */
describe("design file — the envelope", () => {
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

    it("a version that is not the current one", () => {
      // Nothing migrates. 2 is what the build before this one wrote; 3 is
      // past the current one, which an older app cannot read either. Both are
      // refused loudly rather than read forward.
      for (const version of [0, 2, 3]) {
        expect(() =>
          parseDesignFile(JSON.stringify({ ...VALID, version })),
        ).toThrow(`Unsupported design file version ${version}`)
      }
    })

    it("a missing outline", () => {
      // Every file at the current version carries one — nothing classifies
      // the shape from the size on the way in. A file without an outline is
      // malformed.
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