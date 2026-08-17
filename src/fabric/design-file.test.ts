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

registerCustomProperties()

/**
 * Design file (ADR 0002, build spec §10) — the v1 envelope, validation, and
 * the migrators register. `serialize`/`parse` round-trip the current Document
 * through the envelope; validation refuses unknown object types loudly (Fabric
 * enlivening fails silently on those — a silent drop is data loss).
 */
describe("design file — v1 envelope", () => {
  it("serializes the Document as the documented envelope shape", () => {
    const canvas = {
      width: 600,
      height: 400,
      rotation: 90,
      borderWidth: 4,
      borderColor: "#ff0000",
    } as unknown as Parameters<typeof serializeDesignFile>[0]
    canvas.toJSON = () => ({ version: "7.4.0", objects: [{ type: "Rect" }] })

    const file = serializeDesignFile(canvas)
    expect(file).toEqual({
      format: "sticker-studio",
      version: 1,
      size: { width: 600, height: 400 },
      rotation: 90,
      border: { width: 4, color: "#ff0000" },
      canvas: { version: "7.4.0", objects: [{ type: "Rect" }] },
    })
  })

  it("parses a matching envelope back round-trip", () => {
    const file = parseDesignFile(
      JSON.stringify({
        format: "sticker-studio",
        version: 1,
        size: { width: 600, height: 400 },
        rotation: 90,
        border: { width: 4, color: "#ff0000" },
        canvas: { version: "7.4.0", objects: [{ type: "Rect" }] },
      }),
    )
    expect(file.size).toEqual({ width: 600, height: 400 })
    expect(file.rotation).toBe(90)
    expect(file.border).toEqual({ width: 4, color: "#ff0000" })
    expect(file.canvas.objects).toEqual([{ type: "Rect" }])
  })

  /**
   * The migrators registry (ADR 0002): keyed by the version a file migrates
   * *from*, each step it one version forward. Empty at v1 (the pattern, not
   * an implementation), so a real v1 file has nothing to run — but the loop
   * resolves sequentially. A hypothetical v0 exercises the seam without
   * touching the shipped registry.
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
      expect(() =>
        parseDesignFile(JSON.stringify({ ...VALID, version: 2 })),
      ).toThrow("Unsupported design file version 2")
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
        toJSON: () => ({
          version: "7.4.0",
          objects: [createShape("square").toObject()],
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