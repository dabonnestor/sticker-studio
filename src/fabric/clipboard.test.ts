import {
  ActiveSelection,
  Group,
  type Object as FabricObject,
  type Textbox,
} from "fabric"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  clearClipboard,
  copyObjects,
  pasteObjects,
  PASTE_NUDGE_PX,
} from "@/fabric/clipboard"
import { registerCustomProperties } from "@/fabric/custom-properties"
import { groupObjects } from "@/fabric/groups"
import { createShape, getShapeKind } from "@/fabric/shapes"
import { createStageCanvas } from "@/fabric/stage-canvas"
import { applyTextProps, createText, isTextObject } from "@/fabric/text"

/** The Document these fixtures sit on — 4×4 in, where a shape is 192 px. */
const DOC = { width: 384, height: 384 }

// The app registers the document custom properties at startup (main.tsx);
// the tests that exercise id round-trips register them too (ADR 0002).
registerCustomProperties()

/**
 * Copy/paste (§13) — the app's internal clipboard: copy serializes the
 * selection, paste enlivens fresh clones — new ids (ADR 0002), unlocked,
 * nudged down-right, above the source, selected — with the multi-selection
 * and entered-group-child cases resolved to top-level objects.
 */
describe("copy / paste", () => {
  let canvas: ReturnType<typeof createStageCanvas>

  beforeEach(() => {
    canvas = createStageCanvas(
      document.createElement("canvas"),
      document.createElement("canvas"),
    )
    clearClipboard()
  })

  afterEach(async () => {
    await canvas.dispose()
  })

  /** Add a shape at a position, like the sidebar's add. */
  function addShapeAt(kind: "square" | "circle" | "triangle", left: number, top: number): FabricObject {
    const obj = createShape(kind, DOC)
    obj.set({ left, top })
    canvas.add(obj)
    return obj
  }

  it("pastes a single shape as a fresh nudged clone, selected", async () => {
    const src = addShapeAt("square", 100, 50)
    canvas.setActiveObject(src)
    expect(copyObjects(canvas)).toBe(true)
    await pasteObjects(canvas)
    const objects = canvas.getObjects()
    expect(objects).toHaveLength(2)
    const clone = objects[1]
    expect(clone).not.toBe(src)
    // A fresh identity (ADR 0002) — never the source's id.
    expect(clone.id).not.toBe(src.id)
    expect(getShapeKind(clone)).toBe("square")
    // Same geometry, nudged down-right by the constant screen offset.
    expect(clone.left).toBe(100 + PASTE_NUDGE_PX)
    expect(clone.top).toBe(50 + PASTE_NUDGE_PX)
    expect(clone.scaleX).toBe(1)
    expect(clone.scaleY).toBe(1)
    // The paste becomes the selection.
    expect(canvas.getActiveObject()).toBe(clone)
  })

  it("repeat pastes cascade down-right from the source", async () => {
    const src = addShapeAt("square", 0, 0)
    canvas.setActiveObject(src)
    copyObjects(canvas)
    await pasteObjects(canvas)
    const first = canvas.getActiveObject()!
    await pasteObjects(canvas)
    const second = canvas.getActiveObject()!
    expect(first.left).toBe(PASTE_NUDGE_PX)
    expect(second.left).toBe(2 * PASTE_NUDGE_PX)
    expect(first.top).toBe(PASTE_NUDGE_PX)
    expect(second.top).toBe(2 * PASTE_NUDGE_PX)
  })

  it("the paste offset is constant screen px — it scales with the zoom", async () => {
    const src = addShapeAt("square", 0, 0)
    canvas.setActiveObject(src)
    copyObjects(canvas)
    canvas.setZoomPercent(200)
    await pasteObjects(canvas)
    const clone = canvas.getActiveObject()!
    expect(clone.left).toBeCloseTo(PASTE_NUDGE_PX / 2)
    expect(clone.top).toBeCloseTo(PASTE_NUDGE_PX / 2)
  })

  it("paste is one undoable step — undo restores the pre-paste document", async () => {
    const src = addShapeAt("square", 0, 0)
    // The add is its own step, like the sidebar's addShape (§8).
    canvas.history.commit()
    canvas.setActiveObject(src)
    copyObjects(canvas)
    await pasteObjects(canvas)
    canvas.history.commit()
    expect(canvas.getObjects()).toHaveLength(2)
    await canvas.history.undo()
    const restored = canvas.getObjects()
    expect(restored).toHaveLength(1)
    // Undo restores the source by id — the clone is gone.
    expect(restored[0].id).toBe(src.id)
  })

  it("paste lands directly above the copied object", async () => {
    const bottom = addShapeAt("square", 0, 0)
    const src = addShapeAt("circle", 200, 0)
    const top = addShapeAt("triangle", 400, 0)
    canvas.setActiveObject(src)
    copyObjects(canvas)
    await pasteObjects(canvas)
    const stack = canvas.getObjects()
    const clone = canvas.getActiveObject()!
    expect(stack.indexOf(clone)).toBe(stack.indexOf(src) + 1)
    expect(stack.indexOf(clone)).toBeGreaterThan(stack.indexOf(bottom))
    expect(stack.indexOf(clone)).toBeLessThan(stack.indexOf(top))
  })

  it("paste lands on top of the stack when the copied object is gone", async () => {
    const keeper = addShapeAt("square", 0, 0)
    const src = addShapeAt("circle", 200, 0)
    canvas.setActiveObject(src)
    copyObjects(canvas)
    canvas.remove(src)
    await pasteObjects(canvas)
    const stack = canvas.getObjects()
    expect(stack).toHaveLength(2)
    expect(stack[0]).toBe(keeper)
    expect(stack[1]).toBe(canvas.getActiveObject())
  })

  it("pasting a group clones its structure with fresh ids at every level", async () => {
    const a = addShapeAt("square", 0, 0)
    const b = addShapeAt("circle", 200, 0)
    const group = groupObjects(canvas, [a, b])!
    canvas.setActiveObject(group)
    copyObjects(canvas)
    await pasteObjects(canvas)
    const clone = canvas.getActiveObject()!
    expect(clone).not.toBe(group)
    expect(clone).toBeInstanceOf(Group)
    // Fresh identities for the group and every child (ADR 0002).
    expect(clone.id).not.toBe(group.id)
    const sourceChildIds = group.getObjects().map((child) => child.id)
    const cloneChildren = (clone as Group).getObjects()
    expect(cloneChildren).toHaveLength(2)
    for (const child of cloneChildren) {
      expect(sourceChildIds).not.toContain(child.id)
      expect(child.locked).toBe(false)
    }
    // The group is nudged as a unit — children keep their relative layout.
    expect(clone.left).toBe(group.left + PASTE_NUDGE_PX)
    expect(clone.top).toBe(group.top + PASTE_NUDGE_PX)
    expect(cloneChildren[0].left).toBe(a.left)
    expect(cloneChildren[1].left).toBe(b.left)
  })

  it("pasting a multi-selection restores separate objects at their world positions", async () => {
    const a = addShapeAt("square", 0, 0)
    const b = addShapeAt("circle", 200, 50)
    const selection = new ActiveSelection([a, b], { canvas })
    canvas.setActiveObject(selection)
    copyObjects(canvas)
    await pasteObjects(canvas)
    const objects = canvas.getObjects()
    expect(objects).toHaveLength(4)
    // Separate top-level objects — the paste does not group them.
    expect(objects.filter((obj) => obj instanceof Group)).toHaveLength(0)
    const clones = objects.slice(2)
    expect(clones.map((clone) => clone.id)).not.toEqual([a.id, b.id])
    // The clones become the selection, so their left/top read selection-local
    // while they are members — the world position is what must match: each
    // clone sits at its source's world center, nudged down-right.
    expect(canvas.getActiveObjects()).toHaveLength(2)
    expect(clones[0].getCenterPoint().x).toBeCloseTo(
      a.getCenterPoint().x + PASTE_NUDGE_PX,
    )
    expect(clones[0].getCenterPoint().y).toBeCloseTo(
      a.getCenterPoint().y + PASTE_NUDGE_PX,
    )
    expect(clones[1].getCenterPoint().x).toBeCloseTo(
      b.getCenterPoint().x + PASTE_NUDGE_PX,
    )
    expect(clones[1].getCenterPoint().y).toBeCloseTo(
      b.getCenterPoint().y + PASTE_NUDGE_PX,
    )
  })

  it("copying a child of an entered group pastes a top-level clone at its world position", async () => {
    const childA = addShapeAt("circle", 100, 100)
    const childB = addShapeAt("square", 400, 100)
    const group = groupObjects(canvas, [childA, childB])!
    // Move the group after grouping — the children's stored coordinates stay
    // in the group's plane, so a faithful clone must bake the group's
    // current world transform, not the stored local coordinates.
    group.set({ left: group.left + 300, top: group.top + 150 })
    canvas.enterGroup(group)
    canvas.setActiveObject(childB)
    expect(copyObjects(canvas)).toBe(true)
    await pasteObjects(canvas)
    const objects = canvas.getObjects()
    expect(objects).toHaveLength(2) // the group and the top-level clone
    const clone = canvas.getActiveObject()!
    expect(clone).toBe(objects[1])
    expect(clone.id).not.toBe(childB.id)
    const worldCenter = childB.getCenterPoint()
    expect(clone.left).toBeCloseTo(worldCenter.x + PASTE_NUDGE_PX)
    expect(clone.top).toBeCloseTo(worldCenter.y + PASTE_NUDGE_PX)
  })

  it("a locked object copies — the paste is unlocked", async () => {
    const src = addShapeAt("square", 0, 0)
    canvas.setLocked(src, true)
    canvas.setActiveObject(src)
    expect(copyObjects(canvas)).toBe(true)
    await pasteObjects(canvas)
    const clone = canvas.getActiveObject()!
    expect(clone).not.toBe(src)
    expect(clone.locked).toBe(false)
  })

  it("a locked child inside a group copies and pastes unlocked", async () => {
    const a = addShapeAt("square", 0, 0)
    const b = addShapeAt("circle", 200, 0)
    const group = groupObjects(canvas, [a, b])!
    canvas.setLocked(a, true)
    canvas.enterGroup(group)
    canvas.setActiveObject(a)
    copyObjects(canvas)
    await pasteObjects(canvas)
    const clone = canvas.getActiveObject()!
    expect(clone).not.toBe(a)
    expect(clone.locked).toBe(false)
  })

  it("pasting a text clone preserves its properties with a fresh id", async () => {
    const text = createText()
    text.set({ left: 100, top: 100 })
    applyTextProps(text, { uppercase: true, fontSize: 36, charSpacing: 50 })
    canvas.add(text)
    canvas.setActiveObject(text)
    copyObjects(canvas)
    await pasteObjects(canvas)
    const clone = canvas.getActiveObject()! as Textbox
    expect(clone).not.toBe(text)
    expect(isTextObject(clone)).toBe(true)
    expect(clone.id).not.toBe(text.id)
    // The two-way uppercase flag and its forced string survive the round-trip.
    expect(clone.text).toBe("TEXT")
    expect(clone.uppercase).toBe(true)
    expect(clone.uppercaseSource).toBe("Text")
    expect(clone.fontSize).toBe(36)
    expect(clone.charSpacing).toBe(50)
    // The clone lands a paste-nudge from the source's *left edge* — the
    // anchor a text keeps when a property commit re-measures it (the box
    // grows right from its alignment side, never around its center — the
    // unmeasured box's width re-measures on the size commit, so the center
    // coordinate drifts with it; the visual left edge does not).
    expect(clone.getPositionByOrigin("left", "top").x).toBeCloseTo(
      text.getPositionByOrigin("left", "top").x + PASTE_NUDGE_PX,
      6,
    )
  })

  it("paste with an empty clipboard is a no-op", async () => {
    await pasteObjects(canvas)
    expect(canvas.getObjects()).toHaveLength(0)
  })

  it("copy with no selection is a no-op and keeps the previous clipboard", async () => {
    const src = addShapeAt("square", 0, 0)
    canvas.setActiveObject(src)
    copyObjects(canvas)
    canvas.discardActiveObject()
    expect(copyObjects(canvas)).toBe(false)
    await pasteObjects(canvas)
    expect(canvas.getObjects()).toHaveLength(2)
  })
})
