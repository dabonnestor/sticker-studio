import { Group, type Object as FabricObject } from "fabric"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { arrangeObjects, type ArrangeCommand } from "@/fabric/arrange"
import { groupObjects } from "@/fabric/groups"
import { createShape } from "@/fabric/shapes"
import { createStageCanvas } from "@/fabric/stage-canvas"

/** The Document these fixtures sit on — 4×4 in, where a shape is 192 px. */
const DOC = { width: 384, height: 384 }

/**
 * Z-order arrange (§7 Q6) — the selection moves as one block: forward /
 * backward step one slot, to-front / to-back jump to the stack ends, the
 * selection's internal order always preserved. Locked objects are inert
 * (§7 Q3, Q7 — no arrange) and skipped. `canvas.getObjects()` lists
 * bottom-to-top; the tests name objects A–E in that order.
 */
describe("arrangeObjects", () => {
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

  function addShape(): FabricObject {
    const obj = createShape("square", DOC)
    canvas.add(obj)
    return obj
  }

  function stack(): FabricObject[] {
    return canvas.getObjects()
  }

  /** Arrange with the selection passed as given — click order, not z-order. */
  function arrange(selection: FabricObject[], command: ArrangeCommand) {
    arrangeObjects(canvas, selection, command)
  }

  it("forward steps a single object up one slot", () => {
    const [a, b, c] = [addShape(), addShape(), addShape()]
    arrange([b], "forward")
    expect(stack()).toEqual([a, c, b])
  })

  it("forward is a no-op for the topmost object", () => {
    const [a, b, c] = [addShape(), addShape(), addShape()]
    arrange([c], "forward")
    expect(stack()).toEqual([a, b, c])
  })

  it("backward steps a single object down one slot", () => {
    const [a, b, c] = [addShape(), addShape(), addShape()]
    arrange([b], "backward")
    expect(stack()).toEqual([b, a, c])
  })

  it("backward is a no-op for the bottommost object", () => {
    const [a, b, c] = [addShape(), addShape(), addShape()]
    arrange([a], "backward")
    expect(stack()).toEqual([a, b, c])
  })

  it("to-front jumps over everything to the top", () => {
    const [a, b, c, d] = [addShape(), addShape(), addShape(), addShape()]
    arrange([b], "to-front")
    expect(stack()).toEqual([a, c, d, b])
  })

  it("to-back jumps over everything to the bottom", () => {
    const [a, b, c, d] = [addShape(), addShape(), addShape(), addShape()]
    arrange([c], "to-back")
    expect(stack()).toEqual([c, a, b, d])
  })

  it("forward moves a contiguous selection up one slot as a block", () => {
    const [a, b, c, d, e] = [addShape(), addShape(), addShape(), addShape(), addShape()]
    arrange([b, c], "forward")
    expect(stack()).toEqual([a, d, b, c, e])
  })

  it("backward moves a contiguous selection down one slot as a block", () => {
    const [a, b, c, d, e] = [addShape(), addShape(), addShape(), addShape(), addShape()]
    arrange([b, c], "backward")
    expect(stack()).toEqual([b, c, a, d, e])
  })

  it("forward on a non-contiguous selection steps each member past one object", () => {
    const [a, b, c, d, e] = [addShape(), addShape(), addShape(), addShape(), addShape()]
    arrange([a, c], "forward")
    expect(stack()).toEqual([b, a, d, c, e])
  })

  it("to-front lands the selection on top with its order preserved", () => {
    const [a, b, c, d, e] = [addShape(), addShape(), addShape(), addShape(), addShape()]
    arrange([b, d], "to-front")
    expect(stack()).toEqual([a, c, e, b, d])
  })

  it("to-back lands the selection at the bottom with its order preserved", () => {
    const [a, b, c, d, e] = [addShape(), addShape(), addShape(), addShape(), addShape()]
    arrange([b, d], "to-back")
    expect(stack()).toEqual([b, d, a, c, e])
  })

  it("result does not depend on selection order (click order, not z-order)", () => {
    const [a, b, c, d, e] = [addShape(), addShape(), addShape(), addShape(), addShape()]
    arrange([e, d, b], "to-front")
    expect(stack()).toEqual([a, c, b, d, e])
  })

  it("skips locked objects — the unlocked members still move", () => {
    const [a, b, c, d] = [addShape(), addShape(), addShape(), addShape()]
    b.set("locked", true)
    arrange([a, b, c], "forward")
    expect(stack()).toEqual([b, a, d, c])
  })

  it("a fully locked selection is a no-op", () => {
    const [a, b, c] = [addShape(), addShape(), addShape()]
    for (const obj of [a, b, c]) obj.set("locked", true)
    arrange([a, b, c], "to-front")
    expect(stack()).toEqual([a, b, c])
  })

  it("an empty selection is a no-op", () => {
    const [a, b, c] = [addShape(), addShape(), addShape()]
    arrange([], "to-back")
    expect(stack()).toEqual([a, b, c])
  })

  it("skips group children — they are fixed in place (§7 Q5, no reorder)", () => {
    const [a, b, c, d] = [addShape(), addShape(), addShape(), addShape()]
    const group = groupObjects(canvas, [a, b]) as Group
    // The children are inside the group; a group moves as one unit.
    arrange([a, b], "forward")
    expect(stack()).toEqual([c, group, d])
    // The group itself arranges like any top-level object.
    arrange([group], "to-front")
    expect(stack()).toEqual([c, d, group])
  })
})
