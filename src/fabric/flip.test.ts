import { Group, type Object as FabricObject } from "fabric"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { flipObjects, type FlipCommand } from "@/fabric/flip"
import { groupObjects } from "@/fabric/groups"
import { createShape } from "@/fabric/shapes"
import { createStageCanvas } from "@/fabric/stage-canvas"

/**
 * Object flipping (§7 Q6) — each object mirrors around its own center, a
 * toggle: applying the same command again un-flips. The mirror flags are read
 * at render time, so the box never changes — position, size, and rotation
 * are untouched. Locked objects are inert (§7 Q3, Q7) and skipped; a fully
 * locked or empty selection is a no-op. Tests use the 192×192 square (and
 * the triangle, whose asymmetric silhouette makes the flip observable in a
 * render); the center origin (v7 default) means `left`/`top` name the
 * object's center.
 */
describe("flipObjects", () => {
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

  function addShape(kind: "square" | "triangle" = "square"): FabricObject {
    const obj = createShape(kind)
    obj.set({ left: 250, top: 250 })
    canvas.add(obj)
    return obj
  }

  function rect(obj: FabricObject) {
    return obj.getBoundingRect()
  }

  function flip(selection: FabricObject[], command: FlipCommand) {
    flipObjects(selection, command)
  }

  it("horizontal flips flipX and leaves flipY alone", () => {
    const obj = addShape()
    flip([obj], "horizontal")
    expect(obj.flipX).toBe(true)
    expect(obj.flipY).toBe(false)
  })

  it("vertical flips flipY and leaves flipX alone", () => {
    const obj = addShape()
    flip([obj], "vertical")
    expect(obj.flipY).toBe(true)
    expect(obj.flipX).toBe(false)
  })

  it("applying the same command again un-flips — a toggle", () => {
    const obj = addShape()
    flip([obj], "horizontal")
    flip([obj], "horizontal")
    expect(obj.flipX).toBe(false)
  })

  it("the two commands are independent — horizontal then vertical flips both", () => {
    const obj = addShape()
    flip([obj], "horizontal")
    flip([obj], "vertical")
    expect(obj.flipX).toBe(true)
    expect(obj.flipY).toBe(true)
  })

  it("leaves the box in place — position, size, and rotation untouched", () => {
    const obj = addShape("triangle")
    obj.set({ angle: 45 })
    obj.setCoords()
    const before = rect(obj)
    flip([obj], "horizontal")
    expect(rect(obj)).toEqual(before)
    expect(obj.left).toBe(250)
    expect(obj.top).toBe(250)
  })

  it("flips each member of a multi-object selection around its own center", () => {
    const a = addShape()
    const b = addShape("triangle")
    flip([a, b], "vertical")
    expect(a.flipY).toBe(true)
    expect(b.flipY).toBe(true)
    expect(a.flipX).toBe(false)
    expect(b.flipX).toBe(false)
  })

  it("skips locked objects — the unlocked members still flip", () => {
    const a = addShape()
    const b = addShape()
    b.set("locked", true)
    flip([a, b], "horizontal")
    expect(a.flipX).toBe(true)
    expect(b.flipX).toBe(false)
  })

  it("a fully locked selection is a no-op", () => {
    const a = addShape()
    const b = addShape()
    for (const obj of [a, b]) obj.set("locked", true)
    flip([a, b], "vertical")
    expect(a.flipY).toBe(false)
    expect(b.flipY).toBe(false)
  })

  it("an empty selection is a no-op", () => {
    flip([], "horizontal")
  })

  it("skips group children — they are fixed in place (§7 Q5, no individual transforms)", () => {
    const [a, b] = [addShape(), addShape()]
    const group = groupObjects(canvas, [a, b]) as Group
    flip([a, b], "horizontal")
    expect(a.flipX).toBe(false)
    expect(b.flipX).toBe(false)
    // The group itself flips as one unit — children keep their own flip (§7 Q8).
    flip([group], "horizontal")
    expect(group.flipX).toBe(true)
    expect(a.flipX).toBe(false)
  })
})
