import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createStubContext } from "@/fabric/canvas-stub"
import { createStageCanvas } from "@/fabric/stage-canvas"

/**
 * Document background coverage (build spec §11 / the zoom layout §9). The
 * stage's zoom enlarges the element to `document × zoom` while
 * `canvas.width`/`canvas.height` stay the Document size and the viewport
 * transform carries the zoom. The background is a Document property, so it
 * must fill the *whole* element at any zoom — not the `0..width / 0..height`
 * Document rect, which Fabric's renderer paints under the pre-zoom matrix and
 * leaves the enlarged element's outer ring uncovered.
 *
 * Regression: the base `_renderBackground` builds the fill path for the
 * Document rect and applies the viewport transform *after* path construction —
 * but a Canvas 2D path is rasterized under the matrix active at build time,
 * so the zoom never reached the fill and zooming in revealed a transparent
 * strip. The override fills the element's full bitmap directly.
 */
describe("document background coverage at zoom", () => {
  let canvas: ReturnType<typeof createStageCanvas>
  let lowerCtx: ReturnType<typeof createStubContext>

  /**
   * A stage canvas whose lower context is stubbed, so the render's paint into
   * it is observable (the working-context setup the stage tests share).
   */
  function mount() {
    const element = document.createElement("canvas")
    lowerCtx = createStubContext()
    vi.spyOn(element, "getContext").mockReturnValue(lowerCtx)
    const canvas = createStageCanvas(element, document.createElement("canvas"))
    // A 600×600 Document — the size this suite's coverage assertions are
    // written in. It boots at its Square preset's 192×192 (map #48).
    canvas.setDimensions({ width: 600, height: 600 })
    return canvas
  }

  beforeEach(() => {
    canvas = mount()
    canvas.backgroundColor = "#ff0000"
  })

  afterEach(async () => {
    await canvas.dispose()
  })

  it("fills the whole zoomed element, not the Document-sized top-left corner", () => {
    canvas.setZoomPercent(200)
    canvas.renderAll()
    // jsdom dpr is 1, so the element bitmap at 200% of a 600-doc is 1200².
    const element = canvas.getElement()
    expect(element.width).toBe(1200)
    expect(element.height).toBe(1200)
    // The background spread across the full element bitmap.
    const fillRects = vi.mocked(lowerCtx.fillRect).mock.calls
    expect(fillRects).toEqual(expect.arrayContaining([[0, 0, 1200, 1200]]))
  })

  it("still fills the whole element at 100% (bitmap == element, no regression)", () => {
    canvas.renderAll()
    const element = canvas.getElement()
    expect(element.width).toBe(600)
    expect(vi.mocked(lowerCtx.fillRect).mock.calls).toContainEqual([
      0, 0, 600, 600,
    ])
  })

  it("covers the full element at every preset zoom through the range", () => {
    for (const pct of [100, 150, 200, 400, 800]) {
      canvas.setZoomPercent(pct)
      canvas.renderAll()
      const element = canvas.getElement()
      const filled = vi
        .mocked(lowerCtx.fillRect)
        .mock.calls.some(
          (call) =>
            call[2] === element.width && call[3] === element.height,
        )
      expect(filled).toBe(true)
    }
  })
})