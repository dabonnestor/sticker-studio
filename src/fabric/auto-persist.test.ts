import { type Canvas } from "fabric"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { registerCustomProperties } from "@/fabric/custom-properties"
import { serializeDesignFile } from "@/fabric/design-file"
import { createShape } from "@/fabric/shapes"
import {
  createStageCanvas,
  DOCUMENT_BACKGROUND_COLOR,
  DOCUMENT_BORDER_COLOR,
  DOCUMENT_BORDER_WIDTH,
  DOCUMENT_HEIGHT,
  DOCUMENT_ROTATION,
  DOCUMENT_WIDTH,
} from "@/fabric/stage-canvas"
import {
  clearWorkingDraft,
  DRAFT_CHAR_CEILING,
  isFactoryBlank,
  persistWorkingDraft,
  readWorkingDraft,
  resetAutoPersistTestState,
  restoreWorkingDraft,
  WORKING_DRAFT_KEY,
  writeWorkingDraft,
} from "@/fabric/auto-persist"

registerCustomProperties()

/**
 * Auto-persist (map #27, tickets #31–#33): the working Document rides the
 * History's interaction-boundary commits into `localStorage` as a Design-file
 * envelope, so the work survives refresh. The blank-guard (a factory-fresh
 * canvas never overwrites a stored draft) and the size ceiling (~3.5M chars
 * → skip + once-per-session notice) keep it honest; the restore re-seeds the
 * undo stack to the single restored state (undo dead until the first edit)
 * and soft-fails a corrupt draft by wiping the key.
 */
describe("auto-persist — working draft", () => {
  beforeEach(() => {
    // Start each case with a clean storage surface and a fresh session
    // (the once-per-session oversize notice is module state).
    window.localStorage.clear()
    resetAutoPersistTestState()
  })

  it("writes a Design-file envelope to the single documented key", () => {
    const canvas = createStageCanvas(
      document.createElement("canvas"),
      document.createElement("canvas"),
    )
    const obj = createShape("square")
    canvas.add(obj)
    canvas.history.commit()

    persistWorkingDraft(canvas)

    const raw = window.localStorage.getItem(WORKING_DRAFT_KEY)
    expect(raw).toBeTruthy()
    const stored = JSON.parse(raw!) as { format: string; version: number; canvas: { objects: unknown[] } }
    expect(stored.format).toBe("sticker-studio")
    expect(stored.version).toBe(1)
    expect(stored.canvas.objects).toHaveLength(1)
  })

  it("an unchanged document writes nothing — a blank fresh canvas is never stored", () => {
    const canvas = createStageCanvas(
      document.createElement("canvas"),
      document.createElement("canvas"),
    )
    // A truly fresh canvas (default size, zero objects) is factory-blank.
    expect(isFactoryBlank(canvas)).toBe(true)
    persistWorkingDraft(canvas)
    expect(window.localStorage.getItem(WORKING_DRAFT_KEY)).toBeNull()
  })

  it("the blank-guard: a default-size empty sheet never overwrites a stored draft", () => {
    // A real design is already stored.
    const maker = createStageCanvas(
      document.createElement("canvas"),
      document.createElement("canvas"),
    )
    const obj = createShape("circle")
    maker.add(obj)
    maker.history.commit()
    const stored = JSON.stringify(serializeDesignFile(maker))
    window.localStorage.setItem(WORKING_DRAFT_KEY, stored)
    void maker.dispose()

    // A fresh blank canvas must not clobber it.
    const blank = createStageCanvas(
      document.createElement("canvas"),
      document.createElement("canvas"),
    )
    persistWorkingDraft(blank)
    expect(window.localStorage.getItem(WORKING_DRAFT_KEY)).toBe(stored)
  })

  it("a resized-but-empty document is not blank and writes normally", () => {
    const canvas = createStageCanvas(
      document.createElement("canvas"),
      document.createElement("canvas"),
    )
    canvas.setDimensions({ width: 800, height: 400 })
    expect(isFactoryBlank(canvas)).toBe(false)
    persistWorkingDraft(canvas)
    const stored = JSON.parse(window.localStorage.getItem(WORKING_DRAFT_KEY)!)
    expect(stored.size).toEqual({ width: 800, height: 400 })
  })

  it("a styled-but-empty document (background/border/rotation) is not blank and writes normally", () => {
    const canvas = createStageCanvas(
      document.createElement("canvas"),
      document.createElement("canvas"),
    )
    // Only document styling changed — no objects — yet the sheet is a real
    // design and must persist across refresh (ticket #31's "styled" case).
    canvas.backgroundColor = "#fef2f2"
    canvas.borderWidth = 4
    canvas.borderColor = "#ff0000"
    canvas.rotation = 90
    expect(isFactoryBlank(canvas)).toBe(false)
    persistWorkingDraft(canvas)
    const stored = JSON.parse(window.localStorage.getItem(WORKING_DRAFT_KEY)!)
    expect(stored.canvas.background).toBe("#fef2f2")
    expect(stored.border).toEqual({ width: 4, color: "#ff0000" })
    expect(stored.rotation).toBe(90)
  })

  /**
   * A canvas stub whose serialized draft crosses the ~3.5M-char ceiling — the
   * size guard's target. Not a real canvas: only the fields serializeDesignFile
   * and isFactoryBlank touch are present. `seed` adds bulk so the total length
   * stays over the ceiling regardless of the envelope's own size.
   */
  function oversizedCanvas(seed: string): Canvas {
    return {
      width: DOCUMENT_WIDTH,
      height: DOCUMENT_HEIGHT,
      rotation: DOCUMENT_ROTATION,
      backgroundColor: DOCUMENT_BACKGROUND_COLOR,
      borderWidth: DOCUMENT_BORDER_WIDTH,
      borderColor: DOCUMENT_BORDER_COLOR,
      getObjects: () => [{}],
      toJSON: () => ({
        version: "7.4.0",
        objects: [{ type: "Rect", fill: seed.repeat(Math.ceil(DRAFT_CHAR_CEILING / seed.length)) }],
      }),
    } as unknown as Canvas
  }

  it("a draft over the character ceiling is skipped and never written", () => {
    const notice = vi.fn()
    persistWorkingDraft(oversizedCanvas("x"), notice)
    expect(window.localStorage.getItem(WORKING_DRAFT_KEY)).toBeNull()
    expect(notice).toHaveBeenCalledTimes(1)
  })

  it("the oversize notice shows once per session, not per boundary", () => {
    const oversized = oversizedCanvas("y")
    const notice = vi.fn()
    persistWorkingDraft(oversized, notice)
    persistWorkingDraft(oversized, notice)
    expect(notice).toHaveBeenCalledTimes(1)
  })

  it("writeWorkingDraft refuses over the ceiling; read/clear round-trip", () => {
    expect(writeWorkingDraft("x".repeat(DRAFT_CHAR_CEILING))).toBe(true)
    expect(readWorkingDraft()).toBe("x".repeat(DRAFT_CHAR_CEILING))
    clearWorkingDraft()
    expect(readWorkingDraft()).toBeNull()
    expect(writeWorkingDraft("x".repeat(DRAFT_CHAR_CEILING + 1))).toBe(false)
  })
})

describe("auto-persist — restore", () => {
  let canvas: ReturnType<typeof createStageCanvas>

  beforeEach(() => {
    window.localStorage.clear()
    resetAutoPersistTestState()
  })

  afterEach(async () => {
    await canvas?.dispose()
  })

  it("no draft restores nothing and leaves the canvas blank", async () => {
    canvas = createStageCanvas(
      document.createElement("canvas"),
      document.createElement("canvas"),
    )
    const restored = await restoreWorkingDraft(canvas)
    expect(restored).toBe(false)
    expect(canvas.getObjects()).toHaveLength(0)
    expect(canvas.width).toBe(DOCUMENT_WIDTH)
  })

  it("restoring re-seeds undo to a single entry — undo is dead until an edit", async () => {
    // Build a real design in one session and store it.
    const source = createStageCanvas(
      document.createElement("canvas"),
      document.createElement("canvas"),
    )
    source.add(createShape("triangle"))
    source.setDimensions({ width: 800, height: 400 })
    source.rotation = 90
    window.localStorage.setItem(WORKING_DRAFT_KEY, JSON.stringify(serializeDesignFile(source)))
    void source.dispose()

    // A fresh canvas restores it.
    canvas = createStageCanvas(
      document.createElement("canvas"),
      document.createElement("canvas"),
    )
    const restored = await restoreWorkingDraft(canvas)
    expect(restored).toBe(true)
    expect(canvas.getObjects()).toHaveLength(1)
    expect(canvas.width).toBe(800)
    expect(canvas.height).toBe(400)
    expect(canvas.rotation).toBe(90)
    // The restored Document is the only entry — the first Undo must not
    // reveal a blank sheet.
    expect(canvas.history.canUndo).toBe(false)
    expect(canvas.history.canRedo).toBe(false)
    await canvas.history.undo()
    expect(canvas.getObjects()).toHaveLength(1)
  })

  it("a corrupt stored value soft-fails: the key is wiped and nothing throws", async () => {
    window.localStorage.setItem(WORKING_DRAFT_KEY, "NOT A DESIGN FILE")
    canvas = createStageCanvas(
      document.createElement("canvas"),
      document.createElement("canvas"),
    )
    const notice = vi.fn()
    const restored = await restoreWorkingDraft(canvas, { onNotice: notice })
    expect(restored).toBe(false)
    expect(window.localStorage.getItem(WORKING_DRAFT_KEY)).toBeNull()
    expect(notice).toHaveBeenCalledWith("Couldn't resume the saved design — started fresh")
    expect(canvas.getObjects()).toHaveLength(0)
  })

  it("restores object ids so the History's selection restore can reselect", async () => {
    const source = createStageCanvas(
      document.createElement("canvas"),
      document.createElement("canvas"),
    )
    const obj = createShape("square")
    source.add(obj)
    const id = obj["id"] as string
    window.localStorage.setItem(WORKING_DRAFT_KEY, JSON.stringify(serializeDesignFile(source)))
    void source.dispose()

    canvas = createStageCanvas(
      document.createElement("canvas"),
      document.createElement("canvas"),
    )
    await restoreWorkingDraft(canvas)
    expect(canvas.getObjects()[0]!.id).toBe(id)
  })

  it("restore adds the document background from the stored envelope", async () => {
    const source = createStageCanvas(
      document.createElement("canvas"),
      document.createElement("canvas"),
    )
    source.backgroundColor = "#fef2f2"
    window.localStorage.setItem(WORKING_DRAFT_KEY, JSON.stringify(serializeDesignFile(source)))
    void source.dispose()

    canvas = createStageCanvas(
      document.createElement("canvas"),
      document.createElement("canvas"),
    )
    await restoreWorkingDraft(canvas)
    expect(canvas.backgroundColor).toBe("#fef2f2")
  })
})