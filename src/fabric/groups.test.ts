import { ActiveSelection, Group, type Object as FabricObject } from "fabric"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { registerCustomProperties } from "@/fabric/custom-properties"
import {
  flattenGroups,
  groupObjects,
  isGroup,
  isGrouped,
  ungroupObjects,
} from "@/fabric/groups"
import { createShape } from "@/fabric/shapes"
import { createText } from "@/fabric/text"
import { createStageCanvas } from "@/fabric/stage-canvas"

// The app registers the document custom properties at startup (main.tsx);
// the tests that exercise id round-trips register them too (ADR 0002).
registerCustomProperties()

/**
 * Single-level grouping (build spec §7 Q4, ADR 0003) — the structural
 * commands behind Group / Ungroup: flatten-on-group, canvas-index ordering
 * (ActiveSelection order is click order, not z-order), the group taking the
 * z-slot of its topmost member, and ungroup dissolving the group in place
 * with children keeping their world transforms.
 */
describe("grouping — group / ungroup", () => {
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

  /** Add a shape at a position — unselected, like a restored document. */
  function addShapeAt(kind: "square" | "circle", left: number, top: number): FabricObject {
    const obj = createShape(kind)
    obj.set({ left, top })
    canvas.add(obj)
    return obj
  }

  it("isGroup / isGrouped classify the container and its children", () => {
    const a = addShapeAt("square", 0, 0)
    const b = addShapeAt("square", 200, 0)
    const group = groupObjects(canvas, [a, b])!
    expect(isGroup(group)).toBe(true)
    expect(isGroup(a)).toBe(false)
    expect(isGrouped(a)).toBe(true)
    expect(isGrouped(b)).toBe(true)
    expect(isGrouped(group)).toBe(false)
  })

  it("requires at least two objects — a smaller selection is a no-op", () => {
    const a = addShapeAt("square", 0, 0)
    expect(groupObjects(canvas, [a])).toBeNull()
    expect(canvas.getObjects()).toHaveLength(1)
    expect(groupObjects(canvas, [])).toBeNull()
    expect(canvas.getObjects()).toHaveLength(1)
  })

  it("a lone group selection is a no-op — no flatten+regroup into a fresh identity", () => {
    const a = addShapeAt("square", 0, 0)
    const b = addShapeAt("circle", 200, 0)
    const group = groupObjects(canvas, [a, b])!
    const id = group.id
    // Ctrl+G with only the group selected must not churn its stable id
    // (ADR 0002) for zero document change.
    expect(groupObjects(canvas, [group])).toBeNull()
    expect(canvas.getObjects()).toHaveLength(1)
    expect(canvas.getObjects()[0]).toBe(group)
    expect(group.id).toBe(id)
  })

  it("grouped children are not groupable — a fixed-selection no-op, no corrupt state", () => {
    const a = addShapeAt("square", 0, 0)
    const b = addShapeAt("circle", 200, 0)
    const group = groupObjects(canvas, [a, b])!
    // Children aren't in the canvas collection — grouping them must not
    // re-parent them out of their group (§7 Q5).
    expect(groupObjects(canvas, [a, b])).toBeNull()
    expect(canvas.getObjects()).toHaveLength(1)
    expect(canvas.getObjects()[0]).toBe(group)
    expect(group.getObjects()).toHaveLength(2)
  })

  it("a multi-selection's members are not 'grouped' — the ActiveSelection is a transient wrapper", () => {
    const a = addShapeAt("square", 0, 0)
    const b = addShapeAt("circle", 200, 0)
    const selection = new ActiveSelection([a, b], { canvas })
    expect(isGrouped(a)).toBe(false)
    expect(isGrouped(b)).toBe(false)
    // And a Ctrl+A + Ctrl+G selection still groups normally.
    const group = groupObjects(canvas, [a, b])!
    expect(group.getObjects()).toHaveLength(2)
    expect(selection).toBeInstanceOf(Group) // the trap: ActiveSelection IS a Group
  })

  it("sorts the members by canvas index — the group's order is the Document's, not the click order", () => {
    // Selection order deliberately inverted: a marquee collects top-down.
    const bottom = addShapeAt("square", 0, 0)
    const middle = addShapeAt("circle", 150, 0)
    const top = addShapeAt("square", 300, 0)
    groupObjects(canvas, [top, bottom, middle])
    const group = canvas.getObjects()[0] as Group
    const children = group.getObjects()
    expect(children.map((obj) => obj.id)).toEqual([bottom.id, middle.id, top.id])
  })

  it("lands in the z-slot of the topmost member — the Document's order around the selection is untouched", () => {
    const keeper = addShapeAt("square", 0, 0)
    const a = addShapeAt("square", 200, 0)
    const b = addShapeAt("circle", 400, 0)
    const other = addShapeAt("square", 0, 300)
    const group = groupObjects(canvas, [a, b])!
    // keeper and other stay at their slots; the group takes the topmost
    // member's slot — a and b were on top, so the group lands topmost.
    expect(canvas.getObjects().map((obj) => obj.id)).toEqual([
      keeper.id,
      other.id,
      group.id,
    ])
    expect(canvas.getObjects()[2]).toBe(group)
    expect(canvas.getObjects().length).toBe(3)
  })

  it("children keep their ids, transforms, and cut lines inside the group", () => {
    const a = addShapeAt("circle", 100, 50)
    a.set({ angle: 30, scaleX: 1.5, scaleY: 0.5 })
    const aClip = a.clipPath
    const b = addShapeAt("square", 300, 100)
    const group = groupObjects(canvas, [a, b])!
    const [childA, childB] = group.getObjects()
    expect(childA.id).toBe(a.id)
    expect(childB.id).toBe(b.id)
    expect(childA.clipPath).toBe(aClip)
    expect(childA.angle).toBeCloseTo(30, 10)
    expect(childA.scaleX).toBeCloseTo(1.5, 10)
    expect(childA.scaleY).toBeCloseTo(0.5, 10)
  })

  it("the group carries the document identity — a stable id, stamped at construction", () => {
    const a = addShapeAt("square", 0, 0)
    const b = addShapeAt("square", 200, 0)
    const group = groupObjects(canvas, [a, b])!
    expect(group.id).toBeTruthy()
    expect(group.locked).toBe(false)
  })

  it("flattens a selection containing a group first (flatten-on-group)", () => {
    const a = addShapeAt("square", 0, 0)
    const b = addShapeAt("circle", 200, 0)
    const c = addShapeAt("square", 400, 0)
    const inner = groupObjects(canvas, [b, c])!
    const combined = groupObjects(canvas, [a, inner])!
    // The inner group's children rose to the top level, then all three
    // grouped together — children keep their ids, cut lines, and world
    // positions through the flatten+regroup.
    const children = combined.getObjects()
    expect(children).toHaveLength(3)
    expect(children.map((obj) => obj.id)).toEqual([a.id, b.id, c.id])
    const positions: Record<string, { x: number; y: number }> = {}
    for (const child of children) {
      expect(child.clipPath).toBeTruthy()
      expect(isGrouped(child)).toBe(true)
      expect(isGrouped(child.group!)).toBe(false) // single level — no group in a group
      positions[child.id] = child.getCenterPoint()
    }
    expect(positions[a.id].x).toBeCloseTo(0, 6)
    expect(positions[a.id].y).toBeCloseTo(0, 6)
    expect(positions[b.id].x).toBeCloseTo(200, 6)
    expect(positions[c.id].x).toBeCloseTo(400, 6)
    // The children's cached coords must not carry the pre-group scene space
    // into the group transform (the double-translate hit-test regression):
    // getCoords reads the fresh group-local coords after the regroup.
    expect(children[1].getCoords()[0].x).toBeCloseTo(104, 6) // b's tl — 200 − 96
    expect(children[1].getCoords()[0].y).toBeCloseTo(-96, 6) // b's tl — 0 − 96
    expect(canvas.getObjects()).toHaveLength(1)
  })

  it("ungroup dissolves the group in place — children land at the group's z-slot with world transforms", () => {
    const keeper = addShapeAt("square", 0, 0)
    const a = addShapeAt("circle", 100, 50)
    a.set({ angle: 30 })
    const b = addShapeAt("square", 300, 100)
    const group = groupObjects(canvas, [a, b])!
    const before = canvas.getObjects().map((obj) => obj.id)
    expect(before).toEqual([keeper.id, group.id])

    const children = ungroupObjects(canvas, [group])
    expect(children.map((obj) => obj.id)).toEqual([a.id, b.id])
    expect(canvas.getObjects().map((obj) => obj.id)).toEqual([keeper.id, a.id, b.id])
    // World position survived the group's transform.
    expect(canvas.getObjects()[1].left).toBeCloseTo(a.left, 6)
    expect(canvas.getObjects()[1].angle).toBeCloseTo(30, 6)
    expect(isGrouped(canvas.getObjects()[1])).toBe(false)
  })

  it("locked groups are inert — ungroup skips them", () => {
    const a = addShapeAt("square", 0, 0)
    const b = addShapeAt("square", 200, 0)
    const group = groupObjects(canvas, [a, b])!
    group.set("locked", true)
    expect(ungroupObjects(canvas, [group])).toEqual([])
    expect(canvas.getObjects()).toHaveLength(1)
  })

  it("round-trips through serialization — the group nests its children, ids and cut lines intact", async () => {
    const a = addShapeAt("circle", 100, 50)
    a.set({ angle: 30 })
    const b = addShapeAt("square", 300, 100)
    const group = groupObjects(canvas, [a, b])!
    const payload = canvas.toJSON()

    canvas.discardActiveObject()
    await canvas.loadFromJSON(payload)
    expect(canvas.getObjects()).toHaveLength(1)
    const restored = canvas.getObjects()[0] as Group
    expect(restored).toBeInstanceOf(Group)
    expect(restored.id).toBe(group.id)
    const [childA, childB] = restored.getObjects()
    expect(childA.id).toBe(a.id)
    expect(childB.id).toBe(b.id)
    expect(childA.clipPath).toBeTruthy()
    expect(childA.angle).toBeCloseTo(30, 6)
    // Still single-level after the round-trip.
    expect(restored.getObjects().every((obj) => !isGroup(obj))).toBe(true)
  })

  it("flatten+regroup preserves positions when a text joins the selection", () => {
    const a = addShapeAt("square", 300, 300)
    const b = addShapeAt("circle", 600, 300)
    const inner = groupObjects(canvas, [a, b])!
    const text = createText()
    text.set({ left: 300, top: 300 })
    canvas.add(text)
    const combined = groupObjects(canvas, [inner, text])!
    const [childA, childB, childT] = combined.getObjects()
    expect(childA.getCenterPoint().x).toBeCloseTo(300, 6)
    expect(childA.getCenterPoint().y).toBeCloseTo(300, 6)
    expect(childB.getCenterPoint().x).toBeCloseTo(600, 6)
    expect(childT.getCenterPoint().x).toBeCloseTo(300, 6)
    expect(childT.getCenterPoint().y).toBeCloseTo(300, 6)
  })

  it("flattenGroups dissolves the groups of a selection in place", () => {
    const a = addShapeAt("square", 0, 0)
    const b = addShapeAt("circle", 200, 0)
    const c = addShapeAt("square", 400, 0)
    const group = groupObjects(canvas, [b, c])!
    const flat = flattenGroups(canvas, [a, group])
    expect(flat.map((obj) => obj.id)).toEqual([a.id, b.id, c.id])
    expect(canvas.getObjects()).toHaveLength(3)
  })
})
