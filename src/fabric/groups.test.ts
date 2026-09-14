import { ActiveSelection, Group, type Object as FabricObject } from "fabric"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { registerCustomProperties } from "@/fabric/custom-properties"
import {
  flattenGroups,
  groupObjects,
  isGroup,
  isGrouped,
  refitParentGroup,
  ungroupObjects,
} from "@/fabric/groups"
import { createShape } from "@/fabric/shapes"
import {
  TEXT_DEFAULT_FONT_SIZE,
  applyTextProps,
  createText,
  isTextObject,
} from "@/fabric/text"
import { createStageCanvas } from "@/fabric/stage-canvas"

/** The Document these fixtures sit on — 4×4 in, where a shape is 192 px. */
const DOC = { width: 384, height: 384 }

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
    const obj = createShape(kind, DOC)
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

  it("ungroup bakes a scaled text child's fold into its size — the toolbar reads true", () => {
    const text = createText()
    const shape = addShapeAt("square", 200, 0)
    canvas.add(text) // the text precedes the shape on the stack
    const group = groupObjects(canvas, [text, shape])!
    group.set({ scaleX: 2, scaleY: 2 }) // the group scaled as one unit (§7 Q8)
    const children = ungroupObjects(canvas, [group])
    const out = children.find(isTextObject)!
    // The exit folded the group's scale into the child — the bake folds it
    // onward into the size field, so the toolbar reads the effective size,
    // and the box keeps the drawn width (2.4 × 2 = 4.8 — the unmeasured
    // box's creation width), landing exactly where the gesture drew it.
    expect(out.fontSize).toBe(TEXT_DEFAULT_FONT_SIZE * 2)
    expect(out.width).toBe(4.8)
    expect(out.scaleX).toBe(1)
    expect(out.scaleY).toBe(1)
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

/**
 * refitParentGroup (the group-clip regression) — an edit that changes a
 * child's size (a text property commit, a border-width change, an auto-fit
 * re-hug) re-fits the parent group to its children's current bounds. Fabric
 * re-fits a group only on child *gesture* events (`changed`, `modified`, …);
 * a toolbar property commit fires none, so the group stays sized to the
 * pre-edit child and the grown child renders past the group's cached bounds
 * — clipped at the cache canvas edge. The re-fit hugs the group to the grown
 * child while every child keeps its world position.
 */
describe("refitParentGroup — a child edit re-fits the group, never clipping it", () => {
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

  it("a grown text child re-fits the group to hug it — children keep their world positions", () => {
    // Square 192 px at center 0 (−96..96); text "Text" (42 px at 24 px) at
    // center 250. The group hugs the union: −96..271-ish (the +1 is the
    // text's phantom Fabric stroke width in the fit math) → 367.5.
    // The measurer scales with the size — 10 px per char at 24 px — so a
    // size commit grows the box like a real font would.
    const measure = (s: string, style: { fontSize: number }) =>
      s.length * 10 * (style.fontSize / 24)
    const shape = createShape("square", DOC)
    shape.set({ left: 0, top: 0 })
    const text = createText(measure)
    text.set({ left: 250, top: 0 })
    canvas.add(shape, text)
    const group = groupObjects(canvas, [shape, text])!
    const widthBefore = group.width
    expect(widthBefore).toBeCloseTo(367.5, 6)

    // The commit grows the box (the auto-fit re-hug: 4 × 20 + 2 = 82) but
    // fires no gesture event — the group stays at the pre-edit size, which
    // is the clipping state.
    applyTextProps(text, { fontSize: 48 }, measure)
    expect(text.width).toBe(82)
    expect(group.width).toBeCloseTo(widthBefore, 6)

    // The refit's contract: the group grows *around* the children — capture
    // their positions at refit time (applyTextProps pinned the text's left
    // edge, so the grown box's center legitimately sits to its right) and
    // assert the re-fit moves nobody.
    const textCenter = text.getCenterPoint()
    const shapeCenter = shape.getCenterPoint()
    refitParentGroup(text)
    // The group grew by the box's full width delta (82 − 42) = 40 — the
    // commit pinned the text's left edge and the square pins the union's
    // left edge, so the growth extends the right.
    expect(group.width).toBeCloseTo(407.5, 6)
    expect(group.width - widthBefore).toBeCloseTo(40, 6)
    expect(text.getCenterPoint().x).toBeCloseTo(textCenter.x, 6)
    expect(text.getCenterPoint().y).toBeCloseTo(textCenter.y, 6)
    expect(shape.getCenterPoint().x).toBeCloseTo(shapeCenter.x, 6)
    expect(shape.getCenterPoint().y).toBeCloseTo(shapeCenter.y, 6)
  })

  it("a top-level object is its own bounds — a no-op", () => {
    const obj = createShape("square", DOC)
    obj.set({ left: 0, top: 0 })
    canvas.add(obj)
    expect(() => refitParentGroup(obj)).not.toThrow()
    expect(obj.left).toBe(0)
  })

  it("an ActiveSelection member is not a document-Group child — a no-op", () => {
    const a = createShape("square", DOC)
    a.set({ left: 0, top: 0 })
    const b = createShape("circle", DOC)
    b.set({ left: 200, top: 0 })
    canvas.add(a, b)
    const selection = new ActiveSelection([a, b], { canvas })
    const width = selection.width
    expect(() => refitParentGroup(a)).not.toThrow()
    expect(selection.width).toBe(width)
  })
})
