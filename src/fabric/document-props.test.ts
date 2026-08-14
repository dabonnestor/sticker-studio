import { Rect, Textbox } from "fabric"
import { describe, expect, it } from "vitest"

import { setLocked } from "@/fabric/document-props"

/**
 * Lock behavior (build spec §7 Q3): locked objects are selectable but inert —
 * no transform handles, no movement/scale/rotation, no text editing. The
 * `locked` prop itself survives save/load (ADR 0002 custom properties), and
 * Del's locked skip is the delete half of the contract (§7 Q3).
 */
describe("setLocked (§7 Q3)", () => {
  it("makes an object inert while locked", () => {
    const obj = new Rect()
    setLocked(obj, true)
    expect(obj.locked).toBe(true)
    expect(obj.hasControls).toBe(false)
    expect(obj.lockMovementX).toBe(true)
    expect(obj.lockMovementY).toBe(true)
    expect(obj.lockScalingX).toBe(true)
    expect(obj.lockScalingY).toBe(true)
    expect(obj.lockRotation).toBe(true)
  })

  it("restores controls and transforms on unlock", () => {
    const obj = new Rect()
    setLocked(obj, true)
    setLocked(obj, false)
    expect(obj.locked).toBe(false)
    expect(obj.hasControls).toBe(true)
    expect(obj.lockMovementX).toBe(false)
    expect(obj.lockMovementY).toBe(false)
    expect(obj.lockScalingX).toBe(false)
    expect(obj.lockScalingY).toBe(false)
    expect(obj.lockRotation).toBe(false)
  })

  it("blocks text editing while a Text object is locked", () => {
    const text = new Textbox("hi")
    setLocked(text, true)
    expect(text.editable).toBe(false)
    setLocked(text, false)
    expect(text.editable).toBe(true)
  })
})
