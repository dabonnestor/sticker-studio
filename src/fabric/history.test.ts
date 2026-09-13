import { ActiveSelection, type Object as FabricObject } from "fabric"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { registerCustomProperties } from "@/fabric/custom-properties"
import { HISTORY_DEPTH } from "@/fabric/history"
import { loadEnvelope } from "@/fabric/design-file"
import { createShape, DEFAULT_FILL } from "@/fabric/shapes"
import {
  createStageCanvas,
  DOCUMENT_HEIGHT,
  DOCUMENT_WIDTH,
} from "@/fabric/stage-canvas"
import {
  applyTextProps,
  createText,
  TEXT_DEFAULT_FAMILY,
  TEXT_FILL,
  type TextMeasurer,
} from "@/fabric/text"

// The app registers the document custom properties at startup (main.tsx);
// the tests that exercise id round-trips (the history's selection restore
// lives on ids surviving loadFromJSON) register them too (ADR 0002).
registerCustomProperties()

/**
 * Snapshot undo/redo (ADR 0001, build spec §8) — one full `canvas.toJSON()`
 * snapshot per interaction boundary, restored via `loadFromJSON` with
 * recording suppressed. The stack's previous entry is the pre-interaction
 * state; the initial empty Document is seeded at creation so the first
 * edit's undo has something to restore to. Tests run on the real stage
 * canvas (createStageCanvas wires the History and the text interactions).
 */
describe("history — snapshot stack", () => {
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

  /**
   * Add a square and record the add as one undoable step, selected first —
   * the same order the app's addShape commits in (selection is view state,
   * but the app selects before the commit, like a real interaction).
   */
  function addSquare(left = 100, top = 100): FabricObject {
    const obj = createShape("square")
    obj.set({ left, top })
    canvas.add(obj)
    canvas.setActiveObject(obj)
    canvas.history.commit()
    return obj
  }

  it("seeds the initial state — canUndo starts false", () => {
    expect(canvas.history.canUndo).toBe(false)
    expect(canvas.history.canRedo).toBe(false)
  })

  it("a boundary that changed nothing pushes nothing", () => {
    canvas.history.commit()
    canvas.history.commit()
    expect(canvas.history.canUndo).toBe(false)
    expect(canvas.history.canRedo).toBe(false)
  })

  it("undo walks back one boundary; redo walks forward", async () => {
    addSquare(100, 100)
    expect(canvas.history.canUndo).toBe(true)
    addSquare(300, 300)
    expect(canvas.getObjects().length).toBe(2)

    await canvas.history.undo()
    expect(canvas.getObjects().length).toBe(1)
    await canvas.history.undo()
    expect(canvas.getObjects().length).toBe(0)
    expect(canvas.history.canUndo).toBe(false)
    await canvas.history.redo()
    expect(canvas.getObjects().length).toBe(1)
    await canvas.history.redo()
    expect(canvas.getObjects().length).toBe(2)
    expect(canvas.history.canRedo).toBe(false)
  })

  it("a transform gesture boundary — object:modified pushes one snapshot", async () => {
    const obj = addSquare(100, 100)
    const id = obj.id
    obj.set({ left: 400, top: 400 })
    // End of the move gesture — the same event Fabric fires at gesture end.
    canvas.fire("object:modified", { target: obj })

    await canvas.history.undo()
    // The add boundary restores — the object is back at its pre-gesture
    // position (a restore recreates objects, so re-find by id).
    const restored = canvas.getObjects().find((o) => o.id === id)
    expect(restored?.get("left")).toBe(100)
    expect(canvas.getObjects().length).toBe(1)
    await canvas.history.redo()
    expect(canvas.getObjects().find((o) => o.id === id)?.get("left")).toBe(400)
  })

  it("redo is cleared by any new edit", async () => {
    const id = addSquare(100, 100).id
    addSquare(300, 300)
    await canvas.history.undo()
    expect(canvas.history.canRedo).toBe(true)

    // A new edit (a property commit) clears the redo stack. The undo restored
    // a fresh object — re-find it by id before mutating.
    canvas.getObjects().find((o) => o.id === id)?.set({ left: 500 })
    canvas.history.commit()
    expect(canvas.history.canRedo).toBe(false)
  })

  it("selection is restored by id after undo and redo", async () => {
    const a = addSquare(100, 100)
    const b = addSquare(300, 300)
    expect(canvas.getActiveObject()?.id).toBe(b.id)

    await canvas.history.undo()
    expect(canvas.getActiveObject()?.id).toBe(a.id)
    await canvas.history.redo()
    expect(canvas.getActiveObject()?.id).toBe(b.id)
  })

  it("a multi-selection is restored by its members' ids", async () => {
    const a = addSquare(100, 100)
    const b = addSquare(300, 300)
    // Fabric 7 multi-select: wrap the members in an ActiveSelection.
    const selection = new ActiveSelection([a, b], { canvas })
    canvas.setActiveObject(selection)
    b.set({ left: 500 })
    canvas.fire("object:modified", { target: selection })

    await canvas.history.undo()
    // Back at the add-b boundary — its selection (the single object) holds.
    expect(canvas.getActiveObjects().map((o) => o.id)).toEqual([b.id])
    await canvas.history.redo()
    const ids = canvas.getActiveObjects().map((o) => o.id).sort()
    expect(ids).toEqual([a.id, b.id].sort())
  })

  // 200+ full-canvas snapshots and restores in this one case — comfortably
  // past the shell's 5s default under parallel-suite load.
  it("depth caps at 100 — the oldest entries are dropped", async () => {
    // 105 commits on top of the seeded initial state — the cap keeps the
    // newest 100, dropping the seed and the first five commits.
    for (let i = 0; i < HISTORY_DEPTH + 5; i++) {
      canvas.add(createShape("square"))
      canvas.history.commit()
    }
    // 100 entries after the cap → 99 undoable steps, landing on the 6th
    // commit's state (6 objects: the five dropped commits plus the seed).
    for (let i = 0; i < HISTORY_DEPTH - 1; i++) {
      await canvas.history.undo()
    }
    expect(canvas.history.canUndo).toBe(false)
    expect(canvas.getObjects().length).toBe(6)

    for (let i = 0; i < HISTORY_DEPTH - 1; i++) {
      await canvas.history.redo()
    }
    expect(canvas.history.canRedo).toBe(false)
    expect(canvas.getObjects().length).toBe(HISTORY_DEPTH + 5)
  }, 20000)

  it("restores never create new history entries", async () => {
    addSquare(100, 100)
    await canvas.history.undo()
    expect(canvas.history.canUndo).toBe(false)
    expect(canvas.history.canRedo).toBe(true)
    // Undo with nothing to undo is a no-op.
    await canvas.history.undo()
    expect(canvas.getObjects().length).toBe(0)
    expect(canvas.history.canRedo).toBe(true)
  })

  it("recording is suppressed from the moment undo is called, not when the restore starts", async () => {
    addSquare(100, 100)
    // The undo pops synchronously but the restore runs on a later microtask —
    // a commit in the gap must be suppressed, or it would clear redo and
    // leave the stack pointing at a state the restore is about to overwrite.
    const undoing = canvas.history.undo()
    canvas.history.commit()
    await undoing
    expect(canvas.history.canRedo).toBe(true) // the mid-gap commit never landed
    expect(canvas.getObjects().length).toBe(0)
    // And the redo still walks forward to the pre-undo state.
    await canvas.history.redo()
    expect(canvas.getObjects().length).toBe(1)
  })

  it("a deselect flushes a pending preview — and a plain deselect is no step", async () => {
    // The color pickers apply live without recording and commit on their
    // popover's close; the click-away that closes them is a deselect, which
    // unmounts the picker before its popover's deferred dismissal can commit.
    // The deselect is where the orphaned preview lands.
    const obj = addSquare(100, 100)
    const id = obj.id
    obj.set({ fill: "#ff0000" }) // the picker's live preview
    canvas.discardActiveObject()
    canvas.fire("selection:cleared", { deselected: [obj] })

    await canvas.history.undo()
    expect(canvas.getObjects().find((o) => o.id === id)?.get("fill")).toBe(
      DEFAULT_FILL,
    )

    // Selection is view state: a deselect with nothing pending pushes nothing
    // (the commit's dedup), so it never becomes a step of its own.
    const square = canvas.getObjects()[0]
    canvas.setActiveObject(square)
    canvas.history.commit()
    canvas.discardActiveObject()
    canvas.fire("selection:cleared", { deselected: [square] })
    await canvas.history.undo()
    expect(canvas.getObjects().length).toBe(0)
    expect(canvas.history.canUndo).toBe(false)
  })

  it("a delete boundary is one undoable step", async () => {
    addSquare(100, 100)
    const obj = addSquare(300, 300)
    canvas.remove(obj)
    canvas.setActiveObject(canvas.getObjects()[0])
    canvas.history.commit()

    await canvas.history.undo()
    expect(canvas.getObjects().length).toBe(2)
    await canvas.history.redo()
    expect(canvas.getObjects().length).toBe(1)
  })

  it("a property commit boundary is one undoable step", async () => {
    const obj = addSquare(100, 100)
    const id = obj.id
    obj.set({ fill: "#ff0000" })
    canvas.history.commit()

    await canvas.history.undo()
    expect(canvas.getObjects().find((o) => o.id === id)?.get("fill")).toBe(
      DEFAULT_FILL,
    )
  })

  it("document size is document state — undo restores it", async () => {
    addSquare(100, 100)
    canvas.setDimensions({ width: 800, height: 400 })
    canvas.history.commit()

    await canvas.history.undo()
    expect(canvas.width).toBe(DOCUMENT_WIDTH)
    expect(canvas.height).toBe(DOCUMENT_HEIGHT)
  })

  it("the document border is document state — undo restores it", async () => {
    addSquare(100, 100)
    canvas.borderWidth = 12
    canvas.borderColor = "#ff0000"
    canvas.history.commit()

    await canvas.history.undo()
    expect(canvas.borderWidth).toBe(0)
    expect(canvas.borderColor).toBe("#18181b")
  })

  it("the document rotation is document state — undo restores it", async () => {
    addSquare(100, 100)
    canvas.rotation = 90
    canvas.history.commit()

    await canvas.history.undo()
    expect(canvas.rotation).toBe(0)
  })

  it("the document outline is document state — undo restores it", async () => {
    // The sheet boots as a Square (rect, locked — map #48); an edit that
    // reshapes it is a document step like any other.
    addSquare(100, 100)
    canvas.outline = "oval"
    canvas.aspectLocked = false
    canvas.history.commit()

    await canvas.history.undo()
    expect(canvas.outline).toBe("rect")
    expect(canvas.aspectLocked).toBe(true)
  })

  it("suspended recording + one commit is a single undoable step — the import path", async () => {
    // A Design-file import (build spec §10) wraps its flush + load in
    // suspendRecording and commits once: undo restores the pre-import state
    // in a single step, even though the load spawned object:added storms and
    // the flush (were a text session open) would fire object:modified.
    const id = addSquare(100, 100).id
    canvas.history.suspendRecording()
    try {
      // Emulate the import's load — an envelope apply + a fresh payload.
      const payload = {
        version: "7.4.0",
        objects: [
          {
            ...createShape("triangle").toObject(),
            type: "Triangle",
          },
        ],
        background: canvas.backgroundColor,
      }
      await loadEnvelope(
        canvas,
        {
          width: 800,
          height: 400,
          rotation: 45,
          borderWidth: 2,
          borderColor: "#00ff00",
          outline: "oval",
          aspectLocked: true,
        },
        payload as never,
      )
    } finally {
      canvas.history.resumeRecording()
    }
    canvas.history.commit()

    expect(canvas.history.canUndo).toBe(true)
    await canvas.history.undo()
    // Back to the pre-import state in one step — the sealed snapshot.
    expect(canvas.width).toBe(DOCUMENT_WIDTH)
    expect(canvas.rotation).toBe(0)
    expect(canvas.borderWidth).toBe(0)
    // The outline is document state like size and rotation — the undo takes
    // it back to the boot preset's Square (map #48).
    expect(canvas.outline).toBe("rect")
    expect(canvas.aspectLocked).toBe(true)
    expect(canvas.getObjects().length).toBe(1)
    expect(canvas.getObjects().find((o) => o.id === id)).toBeDefined()
    // And the import restored to the loaded document in its own redo.
    await canvas.history.redo()
    expect(canvas.width).toBe(800)
    expect(canvas.rotation).toBe(45)
    expect(canvas.borderWidth).toBe(2)
    expect(canvas.outline).toBe("oval")
    expect(canvas.aspectLocked).toBe(true)
    expect(canvas.getObjects().length).toBe(1)
    expect(canvas.getObjects()[0]).toHaveProperty("id")
  })

  it("reset re-seeds the stack to the current state — undo dead until an edit", async () => {
    // A resumed/restarted design carries the current Document as its only
    // history entry: undo can never reveal a blank sheet (ticket #32, #33).
    addSquare(100, 100)
    addSquare(300, 300)
    expect(canvas.history.canUndo).toBe(true)

    canvas.history.reset()
    expect(canvas.history.canUndo).toBe(false)
    expect(canvas.history.canRedo).toBe(false)
    // The current Document is the single entry — one undo is a no-op that
    // cannot reveal a blank sheet.
    await canvas.history.undo()
    expect(canvas.getObjects().length).toBe(2)
    // A new edit restores undo above the reseeded state.
    canvas.add(createShape("circle"))
    canvas.history.commit()
    expect(canvas.history.canUndo).toBe(true)
  })

  it("reset fires onCommit for the reseeded current state", async () => {
    // The auto-persist write rides onCommit (map #27) — the reset that
    // restores a design must notify the same boundary.
    let committed = 0
    canvas.history.onCommit = () => {
      committed++
    }
    canvas.history.reset()
    expect(committed).toBe(1)
  })

  it("dispose detaches the boundary listener", async () => {
    const obj = addSquare(100, 100)
    canvas.history.dispose()
    obj.set({ left: 400 })
    canvas.fire("object:modified", { target: obj })
    await canvas.history.undo()
    // Only the seed and the add remain — the disposed listener pushed
    // nothing, so undo lands on the empty seed state.
    expect(canvas.getObjects().length).toBe(0)
  })
})

describe("history — text sessions", () => {
  let canvas: ReturnType<typeof createStageCanvas>
  let textbox: ReturnType<typeof createText>
  const measure: TextMeasurer = (text) => text.length * 10

  beforeEach(() => {
    canvas = createStageCanvas(
      document.createElement("canvas"),
      document.createElement("canvas"),
    )
    textbox = createText(measure)
    canvas.add(textbox)
    canvas.setActiveObject(textbox)
    canvas.history.commit()
  })

  afterEach(async () => {
    await canvas.dispose()
  })

  /** Type into the hidden textarea as Fabric's own input path would. */
  function type(value: string): void {
    const ta = textbox.hiddenTextarea
    if (!ta) throw new Error("no textarea — not editing")
    ta.value = value
    ta.selectionStart = ta.selectionEnd = value.length
    ta.dispatchEvent(new Event("input", { bubbles: true }))
  }

  function pressKey(key: string, keyCode: number, extra: KeyboardEventInit = {}): void {
    const ta = textbox.hiddenTextarea
    if (!ta) throw new Error("no textarea — not editing")
    ta.dispatchEvent(
      new KeyboardEvent("keydown", { key, keyCode, bubbles: true, ...extra }),
    )
  }

  it("a committed session is exactly one step", async () => {
    const id = textbox.id
    textbox.enterEditing()
    textbox.selectAll()
    type("longer content")
    pressKey("Enter", 13, { ctrlKey: true })

    // One undo lands on the add boundary — the box is still there, with the
    // pre-session text back. A restore recreates objects, so re-find by id.
    await canvas.history.undo()
    const restored = canvas
      .getObjects()
      .find((o) => o.id === id) as ReturnType<typeof createText>
    expect(restored.text).toBe("Text")
    await canvas.history.redo()
    const redone = canvas
      .getObjects()
      .find((o) => o.id === id) as ReturnType<typeof createText>
    expect(redone.text).toBe("longer content")
  })

  it("a toolbar press ends the session first — the typing keeps its own step", async () => {
    const id = textbox.id
    textbox.enterEditing()
    textbox.selectAll()
    type("hello")

    // The user clicks the toolbar's color swatch — a press on the app chrome,
    // outside the canvas. Fabric ends a session only for presses on its own
    // canvas, so the click-away rule (wireTextInteractions) must end it here,
    // committing the typing as its own step before the color commit lands.
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
    expect(textbox.isEditing).toBe(false)

    // The picker's close — the toolbar's own commit (§8).
    applyTextProps(textbox, { fillColor: "#ff0000" }, measure)
    canvas.history.commit()

    // Undo undoes the color, not the typing.
    await canvas.history.undo()
    const restored = canvas
      .getObjects()
      .find((o) => o.id === id) as ReturnType<typeof createText>
    expect(restored.text).toBe("hello")
    expect(restored.fill).toBe(TEXT_FILL)
    // The typing is still one step below — undo walks back to the placeholder.
    expect(canvas.history.canUndo).toBe(true)
    await canvas.history.undo()
    expect(
      (canvas.getObjects().find((o) => o.id === id) as ReturnType<typeof createText>)
        .text,
    ).toBe("Text")
  })

  it("a color preview orphaned by the closing deselect is its own step", async () => {
    const id = textbox.id
    textbox.enterEditing()
    textbox.selectAll()
    type("hello")
    // The toolbar press ends the session — the typing becomes its own step.
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))

    // The picker applies live without recording (ADR 0001, §8)…
    applyTextProps(textbox, { fillColor: "#ff0000" }, measure)
    // …and the click-away that closes it is a deselect — the picker is
    // unmounted with the toolbar's section before its popover's deferred
    // dismissal can commit, so the deselect is where the preview lands.
    canvas.discardActiveObject()
    canvas.fire("selection:cleared", { deselected: [textbox] })

    // Undo undoes the color — the typing survives below it.
    await canvas.history.undo()
    const restored = canvas
      .getObjects()
      .find((o) => o.id === id) as ReturnType<typeof createText>
    expect(restored.text).toBe("hello")
    expect(restored.fill).toBe(TEXT_FILL)
  })

  it("a session exit mid-skim records nothing — only the click does", async () => {
    const id = textbox.id
    textbox.enterEditing()
    textbox.selectAll()

    // The toolbar's hover preview: a face applies immediately without
    // recording history (§8 — only a click is a step).
    applyTextProps(textbox, { fontFamily: "Work Sans" }, measure)

    // The dropdown interaction blurs the hidden textarea mid-skim — the
    // session exits and Fabric fires object:modified inside exitEditing. The
    // boundary commit must not capture the hovered, never-clicked face.
    textbox.exitEditing()

    // The click commits the picked face.
    applyTextProps(textbox, { fontFamily: "Bebas Neue" }, measure)
    canvas.history.commit()

    // One undo lands on the pre-click state — the add boundary (the default
    // family), not the hovered "Work Sans".
    await canvas.history.undo()
    const restored = canvas
      .getObjects()
      .find((o) => o.id === id) as ReturnType<typeof createText>
    expect(restored.fontFamily).toBe(TEXT_DEFAULT_FAMILY)
  })

  it("a reverted session pushes nothing", async () => {
    textbox.enterEditing()
    textbox.selectAll()
    type("longer content")
    pressKey("Escape", 27)
    expect(textbox.text).toBe("Text")

    // The session pushed nothing — one undo lands on the empty seed state
    // (the box disappears), not on a session snapshot.
    await canvas.history.undo()
    expect(canvas.getObjects().length).toBe(0)
    expect(canvas.history.canUndo).toBe(false)
  })
})
