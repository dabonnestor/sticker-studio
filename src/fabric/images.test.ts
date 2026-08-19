import { FabricImage } from "fabric"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  IMAGE_FIT_RATIO,
  createImageFromDataURL,
  imageFitScale,
} from "@/fabric/images"

/**
 * Image placement (build spec §1 — the sidebar's Image section): an uploaded
 * image lands centered at a size fit to the Document, one undoable step.
 * The fit is downscale-only — a natural-size image smaller than the 80% fit
 * box is never upscaled, so no blurry pixels are invented; the user grows it
 * with the drag handles. The data-URL load is async (the caller awaits it),
 * so a decode failure surfaces there and nothing is placed.
 */
describe("image placement", () => {
  describe("imageFitScale — fit to the Document, downscale-only", () => {
    it("shrinks a photo larger than the Document to the 80% fit box, aspect preserved", () => {
      const scale = imageFitScale(4000, 3000, 600, 600)
      expect(scale).toBe((IMAGE_FIT_RATIO * 600) / 4000) // 0.12
      expect(4000 * scale).toBeCloseTo(480, 6) // width within 80% of the doc
      expect(3000 * scale).toBeCloseTo(360, 6) // height within 80%
    })

    it("fits a tall portrait by its height — the wider axis would overflow", () => {
      const scale = imageFitScale(2000, 6000, 600, 600)
      expect(scale).toBe((IMAGE_FIT_RATIO * 600) / 6000) // 0.08
      expect(2000 * scale).toBeCloseTo(160, 6)
      expect(6000 * scale).toBeCloseTo(480, 6)
    })

    it("never upscales — a natural-size image smaller than the fit box stays put", () => {
      expect(imageFitScale(200, 200, 600, 600)).toBe(1)
    })

    it("shrinks when only one axis overflows, keeping the other inside the box", () => {
      const scale = imageFitScale(3000, 200, 600, 600)
      expect(scale).toBe((IMAGE_FIT_RATIO * 600) / 3000) // by width
      expect(200 * scale).toBeCloseTo(32, 6) // the short axis fits easily
    })

    it("answers 1 for degenerate inputs — a zero-sized image or document", () => {
      expect(imageFitScale(0, 200, 600, 600)).toBe(1)
      expect(imageFitScale(200, 0, 600, 600)).toBe(1)
      expect(imageFitScale(200, 200, 0, 600)).toBe(1)
      expect(imageFitScale(200, 200, 600, 0)).toBe(1)
    })
  })

  describe("createImageFromDataURL", () => {
    afterEach(() => vi.restoreAllMocks())

    /** A stand-in FabricImage: records set() and carries width/height. */
    function fakeImage(width: number, height: number) {
      const props: Record<string, unknown> = {}
      return {
        width,
        height,
        id: "",
        locked: false,
        set(patch: Record<string, unknown>) {
          Object.assign(props, patch)
          return this
        },
        props,
      }
    }

    it("loads the data URL, fits it to the Document, and stamps the identity", async () => {
      const fake = fakeImage(4000, 3000)
      vi.spyOn(FabricImage, "fromURL").mockResolvedValue(
        fake as unknown as FabricImage,
      )

      const img = await createImageFromDataURL("data:image/png;base64,AAAA", 600, 600)

      const scale = (IMAGE_FIT_RATIO * 600) / 4000
      expect(img).toBe(fake as unknown as FabricImage)
      expect(fake.props.scaleX).toBeCloseTo(scale, 10)
      expect(fake.props.scaleY).toBeCloseTo(scale, 10)
      expect(fake.id).toMatch(/^[0-9a-f-]{36}$/)
      expect(fake.locked).toBe(false)
    })

    it("places a small image at natural scale — no upscaling", async () => {
      const fake = fakeImage(200, 200)
      vi.spyOn(FabricImage, "fromURL").mockResolvedValue(
        fake as unknown as FabricImage,
      )

      await createImageFromDataURL("data:image/png;base64,AAAA", 600, 600)

      expect(fake.props.scaleX).toBe(1)
      expect(fake.props.scaleY).toBe(1)
    })

    it("propagates a decode failure — nothing is placed", async () => {
      vi.spyOn(FabricImage, "fromURL").mockRejectedValue(new Error("bogus"))
      await expect(
        createImageFromDataURL("data:image/png;base64,AAAA", 600, 600),
      ).rejects.toThrow("bogus")
    })
  })
})