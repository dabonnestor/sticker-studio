import type { Object as FabricObject } from "fabric"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { alignObjects, type AlignCommand } from "@/fabric/align"
import { groupObjects } from "@/fabric/groups"
import { createShape } from "@/fabric/shapes"
import { createStageCanvas } from "@/fabric/stage-canvas"

/**
 * Object alignment — a lone object's edge or center meets the Document's
 * (600×600); two or more align to each other, each object's edge or center
 * meeting the selection bounds' extreme (the outermost object stays put).
 * The delta is computed on the rotated bounding box and applied to the
 * origin, so a transformed object lands exactly where its box says. Locked
 * objects are inert (§7 Q3, Q7) and skipped — and excluded from the
 * selection bounds; a fully locked or empty selection is a no-op. Tests use
 * the 192×192 square; its center origin (v7 default) means `left`/`top`
 * name the object's center.
 */
describe("alignObjects", () => {
  let canvas: ReturnType<typeof createStageCanvas>

  beforeEach(() => {
    canvas = createStageCanvas(
      document.createElement("canvas"),
      document.createElement("canvas"),
    )
    // This suite's geometry is written against a 600×600 Document (its edges
    // 0/600, its center 300/300). The Document boots at its Square preset's
    // 192×192 (map #48) — where a 192-px square would already be flush to the
    // edges — so the size the suite aligns within is set, not assumed.
    canvas.setDimensions({ width: 600, height: 600 })
  })

  afterEach(async () => {
    await canvas.dispose()
  })

  /** A square positioned by its center (`left`/`top`, v7 center origin). */
  function addSquare(left: number, top: number): FabricObject {
    const obj = createShape("square")
    obj.set({ left, top })
    canvas.add(obj)
    return obj
  }

  function rect(obj: FabricObject) {
    return obj.getBoundingRect()
  }

  /** Align with the selection passed as given — order never matters. */
  function align(selection: FabricObject[], command: AlignCommand) {
    alignObjects(canvas, selection, command)
  }

  it("top aligns the box's top edge to the document's top", () => {
    const obj = addSquare(250, 250)
    align([obj], "top")
    expect(rect(obj).top).toBe(0)
    expect(rect(obj).left).toBe(154) // horizontal position untouched
  })

  it("middle aligns the box's vertical center to the document's", () => {
    const obj = addSquare(250, 250)
    align([obj], "middle")
    expect(rect(obj).top + rect(obj).height / 2).toBe(300)
    expect(rect(obj).top).toBe(204)
  })

  it("bottom aligns the box's bottom edge to the document's bottom", () => {
    const obj = addSquare(250, 250)
    align([obj], "bottom")
    expect(rect(obj).top + rect(obj).height).toBe(600)
    expect(rect(obj).top).toBe(408)
  })

  it("left aligns the box's left edge to the document's left", () => {
    const obj = addSquare(250, 250)
    align([obj], "left")
    expect(rect(obj).left).toBe(0)
    expect(rect(obj).top).toBe(154) // vertical position untouched
  })

  it("center aligns the box's horizontal center to the document's", () => {
    const obj = addSquare(250, 250)
    align([obj], "center")
    expect(rect(obj).left + rect(obj).width / 2).toBe(300)
    expect(rect(obj).left).toBe(204)
  })

  it("right aligns the box's right edge to the document's right", () => {
    const obj = addSquare(250, 250)
    align([obj], "right")
    expect(rect(obj).left + rect(obj).width).toBe(600)
    expect(rect(obj).left).toBe(408)
  })

  it("two or more objects align to each other — top meets the topmost top", () => {
    const a = addSquare(100, 100) // top edge at 4
    const b = addSquare(400, 500) // top edge at 404
    align([a, b], "top")
    expect(rect(a).top).toBe(4) // already the topmost — stays put
    expect(rect(b).top).toBe(4) // comes up to it
  })

  it("two or more objects align to each other — middle meets the union center", () => {
    const a = addSquare(100, 100)
    const b = addSquare(400, 500)
    align([a, b], "middle")
    const center = (4 + 596) / 2 // union: top edge 4, bottom edge 596
    expect(rect(a).top + rect(a).height / 2).toBe(center)
    expect(rect(b).top + rect(b).height / 2).toBe(center)
  })

  it("two or more objects align to each other — right meets the rightmost right", () => {
    const a = addSquare(100, 100) // right edge at 196
    const b = addSquare(400, 500) // right edge at 496
    align([a, b], "right")
    expect(rect(a).left + rect(a).width).toBe(496)
    expect(rect(b).left + rect(b).width).toBe(496) // already the rightmost — stays put
    expect(rect(a).left).toBe(304)
  })

  it("locked objects neither move nor anchor the others' alignment", () => {
    const a = addSquare(100, 100)
    const b = addSquare(400, 500)
    const c = addSquare(200, 300)
    c.set("locked", true)
    align([a, b, c], "top")
    expect(rect(a).top).toBe(4) // union of the unlocked two, not c's 204
    expect(rect(b).top).toBe(4)
    expect(rect(c).top).toBe(204)
  })

  it("a rotated object aligns by its rotated bounding box", () => {
    const obj = addSquare(300, 200)
    obj.set({ angle: 45 })
    obj.setCoords() // a programmatic transform never ran the gesture's setCoords
    const beforeLeft = rect(obj).left
    align([obj], "top")
    expect(rect(obj).top).toBeCloseTo(0)
    expect(rect(obj).left).toBeCloseTo(beforeLeft)
  })

  it("an object larger than the document still aligns its chosen edge", () => {
    const obj = addSquare(250, 250)
    obj.set({ scaleX: 4, scaleY: 4 })
    align([obj], "top")
    expect(rect(obj).top).toBe(0)
    expect(rect(obj).height).toBe(768) // no clamp
  })

  it("skips locked objects — the unlocked members still move", () => {
    const a = addSquare(100, 100)
    const b = addSquare(400, 500)
    b.set("locked", true)
    align([a, b], "top")
    expect(rect(a).top).toBe(0)
    expect(rect(b).top).toBe(404)
  })

  it("a fully locked selection is a no-op", () => {
    const a = addSquare(100, 100)
    const b = addSquare(400, 500)
    for (const obj of [a, b]) obj.set("locked", true)
    align([a, b], "center")
    expect(rect(a).left).toBe(4)
    expect(rect(b).left).toBe(304)
  })

  it("an empty selection is a no-op", () => {
    const obj = addSquare(250, 250)
    align([], "right")
    expect(rect(obj).left).toBe(154)
  })

  it("skips group children — they are fixed in place (§7 Q5, no free movement)", () => {
    const a = addSquare(100, 100)
    const b = addSquare(400, 500)
    const group = groupObjects(canvas, [a, b])!
    align([a], "top") // a lone child aligning to the Document would move it
    expect(rect(a).top).toBe(4)
    // The group itself aligns like any top-level object.
    align([group], "top")
    expect(rect(group).top).toBe(0)
  })
})
