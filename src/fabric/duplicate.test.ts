import {
  ActiveSelection,
  type Object as FabricObject,
  type Textbox,
  type Transform,
  type TPointerEvent,
} from "fabric"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { registerCustomProperties } from "@/fabric/custom-properties"
import { setLocked } from "@/fabric/document-props"
import { groupObjects } from "@/fabric/groups"
import { createShape, getShapeKind } from "@/fabric/shapes"
import { createStageCanvas, type StageCanvas } from "@/fabric/stage-canvas"
import { applyTextProps, createText, isTextObject } from "@/fabric/text"

/** The Document these fixtures sit on — 4×4 in, where a shape is 192 px. */
const DOC = { width: 384, height: 384 }

// The app registers the document custom properties at startup (main.tsx);
// the tests that exercise id round-trips register them too (ADR 0002).
registerCustomProperties()

/**
 * Alt-drag duplication: pressing an object with Alt held
 * and dragging duplicates it — the clone takes over the drag exactly where
 * the source stood, and the source stays put. The gesture is driven with
 * synthetic events the way the interaction wiring is tested elsewhere: the
 * tests set up a real Fabric transform through `_setupCurrentTransform` (so
 * the offset and the pre-drag `original` snapshot are the engine's own),
 * fire `mouse:down`, flush the async enliven, and then drive `object:moving`
 * ticks — the same events a real pointer would produce.
 */

/** The transform `_setupCurrentTransform` builds for the press, and the
 * `mouse:down` carrying it (Fabric injects the live transform into the
 * event's options). */
function press(
  canvas: StageCanvas,
  target: FabricObject,
  altKey = true,
): Transform {
  const event = { altKey, clientX: 1, clientY: 1 } as unknown as TPointerEvent
  canvas._setupCurrentTransform(event, target, false)
  const transform = canvas._currentTransform!
  canvas.fire("mouse:down", { e: event, target, transform } as never)
  return transform
}

/** Let the async clone enliven land — shapes/text/groups resolve in
 * microtasks, before a real drag's first `mousemove`. */
function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** One drag tick: position the drag's current target and fire `object:moving`
 * the way Fabric's `_transformObject` does (the tick marks the gesture as
 * performed). */
function dragTick(
  canvas: StageCanvas,
  transform: Transform,
  left: number,
  top: number,
): void {
  const target = transform.target
  target.set({ left, top })
  target.setCoords()
  transform.actionPerformed = true
  canvas.fire("object:moving", { e: {}, target, transform } as never)
}

/** End a moved gesture the way Fabric's mouseup finalizes it: `object:modified`
 * first (the History's commit boundary), then the canvas `mouse:up`. */
function commitGesture(canvas: StageCanvas, transform: Transform): void {
  transform.actionPerformed = true
  canvas.fire("object:modified", {
    e: {},
    target: transform.target,
    transform,
    action: "drag",
  } as never)
  canvas.fire("mouse:up", { e: {}, transform } as never)
}

/** End a click (never moved) — fabric fires no `object:modified`. */
function releaseClick(canvas: StageCanvas, transform: Transform): void {
  canvas.fire("mouse:up", { e: {}, transform } as never)
}

/** A 192×192 square with stroke off, added at a position. */
function addShapeAt(
  canvas: StageCanvas,
  kind: "square" | "circle" | "triangle",
  left: number,
  top: number,
): FabricObject {
  const obj = createShape(kind, DOC)
  obj.set({ left, top })
  canvas.add(obj)
  return obj
}

describe("Alt-drag duplication", () => {
  let canvas: StageCanvas

  beforeEach(() => {
    canvas = createStageCanvas(
      document.createElement("canvas"),
      document.createElement("canvas"),
    )
  })

  afterEach(async () => {
    await canvas.dispose()
  })

  it("duplicates the object and hands the drag to the clone", async () => {
    const src = addShapeAt(canvas, "square", 100, 50)
    const transform = press(canvas, src)
    await flushAsync()
    // The clone landed exactly on the source, and the in-flight drag's target
    // is now the clone — the next tick moves it, not the source.
    expect(transform.target).not.toBe(src)
    expect(transform.target.id).not.toBe(src.id)
    const objects = canvas.getObjects()
    expect(objects).toHaveLength(2)
    const clone = transform.target as FabricObject
    expect(getShapeKind(clone)).toBe("square")
    expect(clone.locked).toBe(false) // a fresh creation, editable
    expect(clone.left).toBe(100) // lands exactly where the source stood
    expect(clone.top).toBe(50)
    expect(src.left).toBe(100) // the source never moved
    expect(src.top).toBe(50)
    // The clone takes over the drag — position it, and it moves. (The tick
    // drives the smart guides, so the position stays clear of every
    // alignment — the Document's edges/center and the source's.)
    dragTick(canvas, transform, 350, 330)
    expect(clone.left).toBe(350)
    expect(clone.top).toBe(330)
    expect(src.left).toBe(100)
    // Directly above the source in z — the Document's order is preserved.
    const stack = canvas.getObjects()
    expect(stack.indexOf(clone)).toBe(stack.indexOf(src) + 1)
    // And it is the selection, like a pasted clone.
    expect(canvas.getActiveObject()).toBe(clone)
  })

  it("a plain drag does not duplicate", async () => {
    const src = addShapeAt(canvas, "square", 100, 50)
    const transform = press(canvas, src, false)
    await flushAsync()
    expect(transform.target).toBe(src)
    expect(canvas.getObjects()).toHaveLength(1)
  })

  it("an Alt+click rolls the clone back — nothing committed", async () => {
    const src = addShapeAt(canvas, "square", 100, 50)
    const transform = press(canvas, src)
    await flushAsync()
    expect(canvas.getObjects()).toHaveLength(2)
    // Released without moving: fabric commits nothing (`actionPerformed`
    // false), so the duplicate is retracted and the source re-selected.
    releaseClick(canvas, transform)
    expect(canvas.getObjects()).toHaveLength(1)
    expect(canvas.getObjects()[0]).toBe(src)
    expect(canvas.getActiveObject()).toBe(src)
  })

  it("the duplicate-drag is one undoable step — undo restores the source and discards the clone", async () => {
    const src = addShapeAt(canvas, "square", 100, 50)
    canvas.history.commit() // the add is its own step, like the sidebar's addShape
    const transform = press(canvas, src)
    await flushAsync()
    dragTick(canvas, transform, 220, 180)
    commitGesture(canvas, transform)
    expect(canvas.getObjects()).toHaveLength(2)
    await canvas.history.undo()
    const restored = canvas.getObjects()
    expect(restored).toHaveLength(1)
    expect(restored[0].id).toBe(src.id)
    expect(restored[0].left).toBe(100) // the source's pre-drag position
    expect(restored[0].top).toBe(50)
  })

  it("duplicates a multi-selection as the same set, world positions intact", async () => {
    const a = addShapeAt(canvas, "square", 100, 50)
    const b = addShapeAt(canvas, "circle", 300, 20)
    canvas.history.commit() // the adds are their own step, like the sidebar's
    const selection = new ActiveSelection([a, b], { canvas })
    canvas.setActiveObject(selection)
    // Pressing the selection body targets the ActiveSelection as a whole.
    const transform = press(canvas, selection)
    await flushAsync()
    const active = canvas.getActiveObject()!
    expect(active).not.toBe(selection)
    expect(active).toBeInstanceOf(ActiveSelection)
    expect(transform.target).toBe(active)
    const members = (active as ActiveSelection).getObjects()
    expect(members).toHaveLength(2)
    expect(members.map((member) => member.id)).not.toEqual([a.id, b.id])
    const sources = [a, b]
    members.forEach((member, i) => {
      expect(member.getCenterPoint().x).toBeCloseTo(
        sources[i].getCenterPoint().x,
      )
      expect(member.getCenterPoint().y).toBeCloseTo(
        sources[i].getCenterPoint().y,
      )
    })
    // The sources stay put; a tick moves the clones together, by the same
    // amount (positioned clear of every alignment so the drag does not snap).
    const beforeX = members.map((member) => member.getCenterPoint().x)
    dragTick(canvas, transform, 470, 210)
    expect(
      members[0].getCenterPoint().x - beforeX[0],
    ).toBeCloseTo(members[1].getCenterPoint().x - beforeX[1])
    expect(members[0].getCenterPoint().x).not.toBeCloseTo(beforeX[0]) // moved!
    // The clones sit directly above the topmost source member, in order.
    const stack = canvas.getObjects()
    expect(stack.slice(stack.indexOf(b) + 1)).toEqual([...members])
    // The set is one undoable step.
    commitGesture(canvas, transform)
    await canvas.history.undo()
    const restored = canvas.getObjects()
    expect(restored).toHaveLength(2)
    expect(restored.map((obj) => obj.id).sort()).toEqual(
      [a.id, b.id].sort(),
    )
  })

  it("duplicates a group as a fresh group with fresh child ids", async () => {
    const a = addShapeAt(canvas, "circle", 100, 50)
    const b = addShapeAt(canvas, "triangle", 200, 80)
    const group = groupObjects(canvas, [a, b])!
    canvas.setActiveObject(group)
    const transform = press(canvas, group)
    await flushAsync()
    const clone = transform.target as FabricObject
    expect(clone).not.toBe(group)
    expect(canvas.getObjects()).toHaveLength(2)
    const childIds = (clone as unknown as { getObjects(): FabricObject[] })
      .getObjects()
      .map((child) => child.id)
    const sourceChildIds = (group as unknown as { getObjects(): FabricObject[] })
      .getObjects()
      .map((child) => child.id)
    expect(childIds.map((id) => sourceChildIds.includes(id))).toEqual([
      false,
      false,
    ])
  })

  it("does not duplicate a locked object", async () => {
    const src = addShapeAt(canvas, "square", 100, 50)
    setLocked(src, true)
    const transform = press(canvas, src)
    await flushAsync()
    expect(transform.target).toBe(src)
    expect(canvas.getObjects()).toHaveLength(1)
    // The armed state clears with the gesture.
    releaseClick(canvas, transform)
    expect(canvas.altDragDuplicating).toBe(false)
  })

  it("does not duplicate a group child", async () => {
    const a = addShapeAt(canvas, "square", 100, 50)
    const b = addShapeAt(canvas, "circle", 200, 80)
    groupObjects(canvas, [a, b])
    const transform = press(canvas, a) // the child is fixed in place (§7 Q5)
    await flushAsync()
    expect(transform.target).toBe(a)
    expect(canvas.getObjects()).toHaveLength(1)
  })

  it("a source moved before the clone lands is restored to its pre-drag position", async () => {
    const src = addShapeAt(canvas, "square", 100, 50)
    const transform = press(canvas, src)
    // No flush yet: a first tick hits the source while the clone is pending
    // (the enliven's real-IO window for images).
    dragTick(canvas, transform, 160, 120)
    expect(src.left).toBe(160)
    await flushAsync()
    // The landing restored the source; the clone took over at its spot.
    expect(src.left).toBe(100)
    expect(src.top).toBe(50)
    expect(transform.target).not.toBe(src)
    expect(transform.target.left).toBe(100)
    dragTick(canvas, transform, 350, 330)
    expect(transform.target.left).toBe(350)
    expect(src.left).toBe(100)
  })

  it("the gesture survives the landing through the real DOM event flow", async () => {
    // The true browser path: fabric binds mousedown to the upper canvas,
    // then moves tracking onto the document while the button is down. The
    // landing's setActiveObject must NOT kill the in-flight transform
    // (fabric ends the gesture when a deselection touches its target — the
    // swap happens before the selection, so the deselect check misses) —
    // otherwise the duplicate would sit frozen on the source and never
    // follow the drag.
    const lower = document.createElement("canvas")
    const overlay = document.createElement("canvas")
    const domCanvas = createStageCanvas(lower, overlay)
    const src = addShapeAt(domCanvas, "square", 100, 50) // center-origin
    domCanvas.requestRenderAll()
    domCanvas.setActiveObject(src)
    const upper = domCanvas.upperCanvasEl
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
    upper.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        button: 0,
        altKey: true,
        clientX: 196,
        clientY: 146,
      }),
    )
    await flush()
    // The live transform now targets the clone — the drag continues on it.
    expect(domCanvas._currentTransform!.target).not.toBe(src)
    const move = (x: number, y: number) =>
      document.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          button: 0,
          altKey: true,
          clientX: x,
          clientY: y,
        }),
      )
    move(216, 166)
    // Land the clone clear of every alignment so the drag does not snap.
    move(250, 350)
    document.dispatchEvent(
      new MouseEvent("mouseup", {
        bubbles: true,
        button: 0,
        altKey: true,
        clientX: 250,
        clientY: 350,
      }),
    )
    await flush()
    const objects = domCanvas.getObjects()
    expect(objects).toHaveLength(2)
    const clone = objects.find((obj) => obj !== src)!
    // The clone followed the drag from the source: offset (54, 204).
    expect(clone.left).toBe(154)
    expect(clone.top).toBe(254)
    expect(src.left).toBe(100)
    expect(src.top).toBe(50)
    expect(domCanvas.altDragDuplicating).toBe(false)
    await domCanvas.dispose()
  })

  it("a duplicated text keeps its content with a fresh identity", async () => {
    const text = createText()
    text.set({ left: 100, top: 100 })
    applyTextProps(text, { uppercase: true, fontSize: 36, charSpacing: 50 })
    canvas.add(text)
    canvas.setActiveObject(text)
    const transform = press(canvas, text)
    await flushAsync()
    const clone = transform.target as Textbox
    expect(isTextObject(clone)).toBe(true)
    expect(clone).not.toBe(text)
    expect(clone.id).not.toBe(text.id)
    // The two-way uppercase flag and its forced string survive the round-trip.
    expect(clone.text).toBe("TEXT")
    expect(clone.uppercase).toBe(true)
    expect(clone.uppercaseSource).toBe("Text")
    expect(clone.fontSize).toBe(36)
    expect(clone.charSpacing).toBe(50)
    // The auto-fit width survives the clone round-trip untouched.
    expect(clone.width).toBe(text.width)
  })
})
