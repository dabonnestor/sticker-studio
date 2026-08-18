import { config } from "fabric"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createStageCanvas } from "@/fabric/stage-canvas"
import { createShape } from "@/fabric/shapes"
import {
  FIT_MARGIN_PX,
  WHEEL_ZOOM_SENSITIVITY,
  ZOOM_MAX_PERCENT,
  ZOOM_MIN_PERCENT,
  ZOOM_PRESETS,
  ZOOM_STEP_PERCENT,
  clampZoomPercent,
  computeFitZoom,
  rotatedBounds,
  stepZoomPercent,
  wheelZoomFactor,
} from "@/fabric/zoom"

/**
 * Fit zoom (build spec §9): always-fit — the whole Document scales up or down
 * into the workspace minus a fixed 48 px margin, clamped to 10–800%. The
 * smaller axis wins, so the whole Document fits on both. Pure, so the
 * calculation and the tests share one source.
 */
describe("computeFitZoom", () => {
  it("fits a 600×600 Document into a 1000×700 workspace with the 48px margin", () => {
    // x: (1000 − 96) / 600 = 1.5067 → 150.7%; y: (700 − 96) / 600 = 1.0067
    expect(computeFitZoom(600, 600, 1000, 700)).toBeCloseTo(100.6667, 4)
  })

  it("the smaller axis wins — a 400×800 Document in a 1000×1000 workspace", () => {
    // x: (1000 − 96) / 400 = 2.26 → 226%; y: (1000 − 96) / 800 = 1.13
    expect(computeFitZoom(400, 800, 1000, 1000)).toBeCloseTo(113, 4)
  })

  it("always-fit scales UP — a small Document grows into a large workspace", () => {
    // 600×600 into 2000×1600: y binds at (1600 − 96) / 600 = 2.5067
    expect(computeFitZoom(600, 600, 2000, 1600)).toBeCloseTo(250.6667, 4)
    expect(computeFitZoom(600, 600, 2000, 1600)).toBeGreaterThan(100)
  })

  it("clamps to the 800% ceiling — a tiny Document in a huge workspace", () => {
    expect(computeFitZoom(100, 100, 4000, 3000)).toBe(ZOOM_MAX_PERCENT)
  })

  it("a workspace barely bigger than the margins fits at the floor's edge", () => {
    // (200 − 96) / 600 = 0.1733 — above the floor, never clamped.
    expect(computeFitZoom(600, 600, 200, 200)).toBeCloseTo(17.3333, 4)
  })

  it("clamps to the 10% floor — a workspace smaller than the margins", () => {
    expect(computeFitZoom(600, 600, 100, 100)).toBe(ZOOM_MIN_PERCENT)
    expect(computeFitZoom(600, 600, 10, 10)).toBe(ZOOM_MIN_PERCENT)
  })

  it("uses the rotated bounds — a 45° square needs the diagonal", () => {
    // 600×600 rotated 45° → bounding box 848.5×848.5:
    // (1000 − 96) / 848.5 = 1.065 → 106.5%, not the axis-aligned 150.7%.
    const fit = computeFitZoom(600, 600, 1000, 1000, 45)
    expect(fit).toBeLessThan(computeFitZoom(600, 600, 1000, 1000))
    expect(fit).toBeCloseTo(106.537, 3)
  })

  it("a 90° rotation swaps the axes — a 600×1200 Document fits its width", () => {
    // Rotated 90°: 1200 wide × 600 tall → x: (1000 − 96) / 1200 = 0.7533
    expect(computeFitZoom(600, 1200, 1000, 1000, 90)).toBeCloseTo(75.3333, 4)
  })
})

/**
 * Rotation-ready bounds (build spec §9 — the document rotation arrives with
 * the design-file build): the axis-aligned box a rotated rectangle needs.
 */
describe("rotatedBounds", () => {
  it("leaves an unrotated rectangle alone", () => {
    expect(rotatedBounds(600, 400, 0)).toEqual({ width: 600, height: 400 })
  })

  it("90° swaps the axes", () => {
    const bounds = rotatedBounds(600, 400, 90)
    expect(bounds.width).toBeCloseTo(400, 10)
    expect(bounds.height).toBeCloseTo(600, 10)
  })

  it("45° expands to the diagonal box", () => {
    const bounds = rotatedBounds(600, 600, 45)
    expect(bounds.width).toBeCloseTo(848.528, 3)
    expect(bounds.height).toBeCloseTo(848.528, 3)
  })

  it("is symmetric in sign — −45° is the same box as 45°", () => {
    const negative = rotatedBounds(600, 400, -45)
    const positive = rotatedBounds(600, 400, 45)
    expect(negative.width).toBeCloseTo(positive.width, 10)
    expect(negative.height).toBeCloseTo(positive.height, 10)
  })
})

/**
 * The zoom range and step (build spec §9): 10–800%, ±10 per step, the %
 * readout shows rounded integers.
 */
describe("zoom stepping", () => {
  it("steps ±10%", () => {
    expect(stepZoomPercent(100, 1)).toBe(110)
    expect(stepZoomPercent(100, -1)).toBe(90)
    expect(ZOOM_STEP_PERCENT).toBe(10)
  })

  it("clamps at the 10% floor", () => {
    expect(stepZoomPercent(ZOOM_MIN_PERCENT, -1)).toBe(ZOOM_MIN_PERCENT)
  })

  it("clamps at the 800% ceiling", () => {
    expect(stepZoomPercent(ZOOM_MAX_PERCENT, 1)).toBe(ZOOM_MAX_PERCENT)
    expect(stepZoomPercent(795, 1)).toBe(ZOOM_MAX_PERCENT)
  })

  it("steps from a Fit zoom (a non-round value) like any other", () => {
    expect(stepZoomPercent(106.67, 1)).toBeCloseTo(116.67, 4)
  })

  it("clamps any percent to the range", () => {
    expect(clampZoomPercent(5)).toBe(ZOOM_MIN_PERCENT)
    expect(clampZoomPercent(900)).toBe(ZOOM_MAX_PERCENT)
    expect(clampZoomPercent(150)).toBe(150)
  })

  it("ships the §9 presets — Fit handled separately", () => {
    expect(ZOOM_PRESETS).toEqual([100, 150, 200])
  })

  it("the fit margin is the fixed 48px", () => {
    expect(FIT_MARGIN_PX).toBe(48)
  })
})

/**
 * The wheel zoom factor (build spec §9 extension): exponential in deltaY — a
 * pinch gesture's summed deltas ride the same curve as a wheel notch, zooming
 * in then out returns exactly to the start, and ~100 px per notch lands near
 * the ±10% keyboard step.
 */
describe("wheelZoomFactor", () => {
  it("zooms in on a negative delta (wheel up / pinch out), out on a positive one", () => {
    expect(wheelZoomFactor(-100)).toBeGreaterThan(1)
    expect(wheelZoomFactor(100)).toBeLessThan(1)
    expect(wheelZoomFactor(0)).toBe(1)
  })

  it("a mouse-wheel notch (≈100 px) lands near the ±10% keyboard step", () => {
    expect(wheelZoomFactor(-100)).toBeCloseTo(1.1052, 4)
    expect(wheelZoomFactor(100)).toBeCloseTo(0.9048, 4)
  })

  it("the round trip is exact — zooming out undoes zooming in", () => {
    expect(wheelZoomFactor(-150) * wheelZoomFactor(150)).toBeCloseTo(1, 10)
  })

  it("is exponential, not additive — double the delta multiplies the factor by itself", () => {
    expect(wheelZoomFactor(-200)).toBeCloseTo(wheelZoomFactor(-100) ** 2, 6)
  })

  it("the sensitivity is the fixed constant", () => {
    expect(WHEEL_ZOOM_SENSITIVITY).toBe(0.001)
  })
})

/**
 * The StageCanvas zoom adapter (build spec §9): setZoomPercent drives the
 * viewport transform and the element layout — the Document element grows to
 * `document × zoom` CSS px (bitmaps at ×DPR), while the model dimensions
 * (canvas.width/height — the Document size) never change. The workspace
 * scroll is the pan: the layout derives from the workspace's client size and
 * scroll position. Driven with a jsdom workspace div.
 */
describe("StageCanvas zoom", () => {
  let canvas: ReturnType<typeof createStageCanvas>
  let workspace: HTMLElement

  /** A workspace div with the given client size (jsdom reports 0). */
  function createWorkspace(width = 1000, height = 700) {
    const el = document.createElement("div")
    Object.defineProperty(el, "clientWidth", {
      get: () => width,
      configurable: true,
    })
    Object.defineProperty(el, "clientHeight", {
      get: () => height,
      configurable: true,
    })
    return el
  }

  function resizeWorkspace(width: number, height: number) {
    Object.defineProperty(workspace, "clientWidth", {
      get: () => width,
      configurable: true,
    })
    Object.defineProperty(workspace, "clientHeight", {
      get: () => height,
      configurable: true,
    })
  }

  /** The canvas element's CSS size — the zoomed Document presentation. */
  function elementSize() {
    const el = canvas.getElement()
    return {
      width: Number.parseFloat(el.style.width),
      height: Number.parseFloat(el.style.height),
      bitmapWidth: el.width,
      bitmapHeight: el.height,
    }
  }

  beforeEach(() => {
    workspace = createWorkspace()
    canvas = createStageCanvas(
      document.createElement("canvas"),
      document.createElement("canvas"),
      workspace,
    )
  })

  afterEach(async () => {
    await canvas.dispose()
  })

  it("100% keeps the element at the Document size — 1 doc px = 1 CSS px", () => {
    expect(canvas.getZoomPercent()).toBe(100)
    expect(canvas.viewportTransform).toEqual([1, 0, 0, 1, 0, 0])
    expect(elementSize()).toEqual({
      width: 600,
      height: 600,
      bitmapWidth: 600,
      bitmapHeight: 600,
    })
    expect(canvas.width).toBe(600) // canvas.width stays the Document size
  })

  it("200% grows the element and bitmaps, scales the transform, keeps the model", () => {
    canvas.setZoomPercent(200)
    expect(canvas.getZoomPercent()).toBe(200)
    expect(canvas.viewportTransform).toEqual([2, 0, 0, 2, 0, 0])
    expect(elementSize()).toEqual({
      width: 1200,
      height: 1200,
      bitmapWidth: 1200,
      bitmapHeight: 1200,
    })
    expect(canvas.width).toBe(600)
  })

  it("retina renders at non-100% zoom — the bitmaps carry the DPR", () => {
    // Fabric's DPR is captured into its config at import — the window is only
    // a fallback, so the config is the knob the test drives.
    const previous = config.devicePixelRatio
    config.devicePixelRatio = 2
    canvas.setZoomPercent(150)
    expect(elementSize()).toEqual({
      width: 900,
      height: 900,
      bitmapWidth: 1800, // 600 × 1.5 × 2
      bitmapHeight: 1800,
    })
    config.devicePixelRatio = previous
  })

  it("clamps to the 10–800% range", () => {
    canvas.setZoomPercent(5)
    expect(canvas.getZoomPercent()).toBe(ZOOM_MIN_PERCENT)
    canvas.setZoomPercent(900)
    expect(canvas.getZoomPercent()).toBe(ZOOM_MAX_PERCENT)
  })

  it("notifies onZoomChanged after a change", () => {
    const listener = vi.fn()
    canvas.onZoomChanged = listener
    canvas.setZoomPercent(150)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("zooms about the workspace center — the scene point at the center stays", () => {
    // At 100% the center scene point is the Document center: the element is
    // centered in the 1000×700 workspace with (1000−600)/2 = 200px offsets.
    expect(canvas.getViewportCenterScenePoint().x).toBeCloseTo(300, 10)
    // Zooming to 200% about the center: the content grows to 1200 (the
    // zoomed Document — no extra gutter), the element offset drops to 0, and
    // the scroll re-anchors so the same scene point stays at x = 500.
    canvas.setZoomPercent(200, true)
    expect(workspace.scrollLeft).toBeCloseTo(100, 10)
    expect(canvas.getViewportCenterScenePoint().x).toBeCloseTo(300, 10)
    // The round trip returns to the centered scroll — the anchor is stable.
    canvas.setZoomPercent(100, true)
    expect(workspace.scrollLeft).toBeCloseTo(0, 10)
  })

  it("zooms about the scene point under the pointer — the anchor stays put", () => {
    // jsdom's getBoundingClientRect is all zeros, so the client point equals
    // the workspace point. At 100% the workspace point (500, 350) — the
    // center — maps to the Document center (300, 300): offset (200, 50),
    // scroll 0. Zooming to 200%: the content grows to 1200×1200, the offset
    // drops to 0, and the scroll re-anchors so the same scene point stays
    // under the pointer on both axes.
    canvas.setZoomPercentAboutClientPoint(200, 500, 350)
    expect(canvas.getZoomPercent()).toBe(200)
    expect(workspace.scrollLeft).toBeCloseTo(100, 10) // 300·2 − 500
    expect(workspace.scrollTop).toBeCloseTo(250, 10) // 300·2 − 350
    // The round trip returns to the centered scroll — the anchor is stable.
    canvas.setZoomPercentAboutClientPoint(100, 500, 350)
    expect(workspace.scrollLeft).toBeCloseTo(0, 10)
    expect(workspace.scrollTop).toBeCloseTo(0, 10)
  })

  it("a point-anchored zoom clamps to the range and notifies like any zoom", () => {
    const listener = vi.fn()
    canvas.onZoomChanged = listener
    canvas.setZoomPercentAboutClientPoint(5, 500, 350)
    expect(canvas.getZoomPercent()).toBe(ZOOM_MIN_PERCENT)
    canvas.setZoomPercentAboutClientPoint(900, 500, 350)
    expect(canvas.getZoomPercent()).toBe(ZOOM_MAX_PERCENT)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it("without a workspace, a point-anchored zoom falls back to the plain set", () => {
    const bare = createStageCanvas(
      document.createElement("canvas"),
      document.createElement("canvas"),
    )
    bare.setZoomPercentAboutClientPoint(150, 300, 300)
    expect(bare.getZoomPercent()).toBe(150)
    void bare.dispose()
  })

  it("fit on load — always-fit into the workspace minus the 48px margin, centered", () => {
    // 600×600 into 1000×700: y binds at (700−96)/600 = 100.67%.
    canvas.fitToWorkspace()
    expect(canvas.getZoomPercent()).toBeCloseTo(100.6667, 4)
    expect(workspace.scrollLeft).toBe(0)
    expect(workspace.scrollTop).toBe(0)
  })

  it("fit scales up when the workspace is larger than the Document", () => {
    resizeWorkspace(2000, 1600)
    canvas.fitToWorkspace()
    expect(canvas.getZoomPercent()).toBeCloseTo(250.6667, 4)
  })

  it("resize re-centers at the current zoom, clamps the scroll, never re-fits", () => {
    canvas.setZoomPercent(200, true)
    expect(workspace.scrollLeft).toBeCloseTo(100, 10)
    const zoomBefore = canvas.getZoomPercent()
    // A larger workspace: the content (1200 — the zoomed Document) no longer
    // overflows the width, so the scroll clamps to the centered position —
    // and the zoom is untouched (resize never re-fits).
    resizeWorkspace(1200, 900)
    canvas.recenter()
    expect(canvas.getZoomPercent()).toBe(zoomBefore)
    expect(workspace.scrollLeft).toBe(0)
    expect(workspace.scrollTop).toBe((1200 - 900) / 2)
  })

  it("a document resize re-applies the zoomed presentation", () => {
    canvas.setZoomPercent(200)
    canvas.setDimensions({ width: 800, height: 800 })
    expect(canvas.width).toBe(800) // the model is the new Document size
    expect(canvas.getZoomPercent()).toBe(200)
    expect(elementSize()).toEqual({
      width: 1600,
      height: 1600,
      bitmapWidth: 1600,
      bitmapHeight: 1600,
    })
  })

  it("new text lands at the workspace center at any zoom", () => {
    canvas.setZoomPercent(200, true)
    const shape = createShape("square")
    canvas.add(shape)
    canvas.viewportCenterObject(shape)
    // The scene point at the workspace center maps back to the center.
    const center = canvas.getViewportCenterScenePoint()
    expect(shape.getCenterPoint().x).toBeCloseTo(center.x, 10)
    expect(shape.getCenterPoint().y).toBeCloseTo(center.y, 10)
  })

  it("objects stay on screen at any zoom — the culling viewport is the Document, not a shrinking box", () => {
    // Off-screen culling (skipOffscreen default) tests objects against
    // `vptCoords`. Under the stage's zoom model the element grows to
    // `document × zoom` while canvas.width stays the Document size, so the
    // base's `calcViewportBoundaries` — canvas.width/zoom — shrinks with the
    // zoom and would cull a centered square once it left that box (the
    // disappear-at-300% bug). The visible scene region is the whole Document
    // at any zoom: the boundaries never move with the zoom, and a centered
    // object reads on-screen.
    const shape = createShape("square")
    shape.set({ left: 300, top: 300 })
    canvas.add(shape)
    canvas.centerObject(shape)

    for (const percent of [100, 200, 300, 400, 800]) {
      canvas.setZoomPercent(percent)
      canvas.calcViewportBoundaries() // re-derived at every render start
      const { tl, br } = canvas.vptCoords
      expect(tl.x).toBe(0)
      expect(tl.y).toBe(0)
      expect(br.x).toBe(600) // the Document, not 600 / (percent / 100)
      expect(br.y).toBe(600)
      expect(shape.isOnScreen()).toBe(true) // never culled off screen
    }
  })

  it("early-verify: the mirrored selection chrome stays glued at non-100% zoom", () => {
    // The oCoords are viewport-space (the vpt is folded in), so the mirrored
    // cursor path — the same findControl the in-document hover runs —
    // resolves the handles at any zoom without extra mapping.
    canvas.setZoomPercent(200)
    const shape = createShape("square")
    shape.set({ left: 300, top: 300 })
    canvas.add(shape)
    canvas.setActiveObject(shape)
    shape.setCoords()
    expect(shape.oCoords.tl.x).toBeCloseTo(408, 0) // scene −96 × 2
    expect(
      canvas.getWorkspaceCursor(shape.oCoords.tl.x + 1, shape.oCoords.tl.y + 1),
    ).toBe("nwse-resize")
    expect(
      canvas.getWorkspaceCursor(shape.oCoords.br.x + 1, shape.oCoords.br.y + 1),
    ).toBe("nwse-resize")
  })
})

/**
 * Zoom is view state (build spec §9, ADR 0002): never serialized, never an
 * undoable step — the Design file and the undo stack carry the Document only.
 */
describe("zoom is view state", () => {
  let canvas: ReturnType<typeof createStageCanvas>

  beforeEach(() => {
    canvas = createStageCanvas(
      document.createElement("canvas"),
      document.createElement("canvas"),
    )
  })

  afterEach(async () => {
    await canvas.dispose()
  })

  it("never appears in the serialized Document", () => {
    canvas.setZoomPercent(200)
    const payload = JSON.stringify(canvas.toJSON())
    expect(payload).not.toContain("zoom")
    expect(payload).not.toContain("viewportTransform")
  })

  it("never enters the undo stack", () => {
    canvas.setZoomPercent(200)
    canvas.history.commit()
    // The zoom is not a step: the stack still holds only the seed state.
    expect(canvas.history.canUndo).toBe(false)
  })

  it("survives undo/redo — the restore replays the Document, not the view", async () => {
    canvas.setZoomPercent(200)
    const shape = createShape("square")
    canvas.add(shape)
    canvas.history.commit()
    expect(canvas.history.canUndo).toBe(true)
    await canvas.history.undo()
    expect(canvas.getZoomPercent()).toBe(200)
    await canvas.history.redo()
    expect(canvas.getZoomPercent()).toBe(200)
  })
})
