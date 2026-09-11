/**
 * The color picker's commit boundary (ADR 0001, §8) — driven through the real
 * component and the real undo stack.
 *
 * The bug these lock down: the card commits its color on close, and an
 * untouched close is supposed to leave the stack alone. The picker held that
 * color uppercased, so an untouched close committed `#18181B` over a document
 * holding `#18181b` — a spelling difference the snapshot comparison reads as a
 * real change. The phantom step made the *next* undo look dead: setting the
 * document border to 16px and undoing needed two presses, the first restoring
 * a document identical but for hex case.
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest"

import { BorderPicker, ColorPicker } from "@/components/color-picker"
import type { CanvasPropsPatch, ShapePropsPatch } from "@/components/stage-context"
import { registerCustomProperties } from "@/fabric/custom-properties"
import { createShape, setFillColor } from "@/fabric/shapes"
import { createStageCanvas } from "@/fabric/stage-canvas"

// React's act() gate — the flag the test environment sets by convention.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true

// The app registers the document custom properties at startup (main.tsx); the
// stage canvas's History snapshots serialize ids through them (ADR 0002).
registerCustomProperties()

describe("color picker — the commit boundary", () => {
  let canvas: ReturnType<typeof createStageCanvas>
  let container: HTMLDivElement
  let root: Root
  let onApply: Mock<(color: string) => void>
  let onChange: Mock<(color: string) => void>

  beforeEach(() => {
    canvas = createStageCanvas(
      document.createElement("canvas"),
      document.createElement("canvas"),
    )
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    onApply = vi.fn<(color: string) => void>()
    onChange = vi.fn<(color: string) => void>()
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    await canvas.dispose()
  })

  /**
   * The StageProvider's commitCanvasProps, verbatim (§5) — the wiring the
   * toolbar's pickers call into. The preview path (recordHistory false)
   * applies live and records nothing; the commit path records one step.
   */
  function commitCanvasProps(patch: CanvasPropsPatch, recordHistory = true) {
    if (patch.backgroundColor !== undefined) {
      canvas.backgroundColor = patch.backgroundColor
    }
    if (patch.borderWidth !== undefined) canvas.borderWidth = patch.borderWidth
    if (patch.borderColor !== undefined) canvas.borderColor = patch.borderColor
    canvas.requestRenderAll()
    if (recordHistory) canvas.history.commit()
  }

  /** The StageProvider's commitShapeProps, verbatim (§5). */
  function commitShapeProps(patch: ShapePropsPatch, recordHistory = true) {
    const obj = canvas.getActiveObjects()[0]
    if (!obj) return
    if (patch.fillColor !== undefined) setFillColor(obj, patch.fillColor)
    canvas.requestRenderAll()
    if (recordHistory) canvas.history.commit()
  }

  /**
   * Draw the toolbar's document-border picker against the live canvas — the
   * canvas is the document's source of truth (§4), so the props are read from
   * it, exactly as the provider's mirror does. Call again to re-render the way
   * an undo's mirror does.
   */
  async function renderBorderPicker() {
    await act(async () => {
      root.render(
        <BorderPicker
          value={canvas.borderColor}
          width={canvas.borderWidth}
          ariaLabel="Border color"
          onApply={(color) => {
            onApply(color)
            commitCanvasProps({ borderColor: color }, false)
          }}
          onChange={(color) => {
            onChange(color)
            commitCanvasProps({ borderColor: color })
          }}
          onWidthChange={(width) => commitCanvasProps({ borderWidth: width }, false)}
          onWidthCommit={(width) => commitCanvasProps({ borderWidth: width })}
        />,
      )
    })
  }

  /** Draw the shape section's fill picker for the selected shape (ShapeProps). */
  async function renderShapeFillPicker() {
    const shape = canvas.getActiveObjects()[0]
    await act(async () => {
      root.render(
        <ColorPicker
          value={typeof shape.fill === "string" ? shape.fill : "#000000"}
          ariaLabel="Background color"
          onApply={(color) => {
            onApply(color)
            commitShapeProps({ fillColor: color }, false)
          }}
          onChange={(color) => {
            onChange(color)
            commitShapeProps({ fillColor: color })
          }}
        />,
      )
    })
  }

  /** Open the card, the way clicking its swatch does. */
  async function openCard() {
    const trigger = container.querySelector('[aria-label$="color"]')!
    await act(async () => {
      trigger.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
      )
      trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(card()).not.toBeNull()
  }

  /** Close the card by any gesture — Escape here; click-away is the same path. */
  async function closeCard() {
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      )
    })
  }

  /** The open card's popover content, or null while closed. */
  function card(): HTMLElement | null {
    return document.body.querySelector('[data-slot="popover-content"]')
  }

  /** Type a color into the card's hex field — React's onChange is the input event. */
  async function typeHex(hex: string) {
    const input = card()!.querySelector<HTMLInputElement>('input[placeholder="#FF0000"]')!
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!
    await act(async () => {
      setValue.call(input, hex)
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
  }

  it("undoes a border width change in one press — the reported bug", async () => {
    await renderBorderPicker()
    await openCard()

    // The slider drag: live preview without recording, then the release
    // commits the whole drag as ONE undoable step (§8).
    await act(async () => {
      canvas.borderWidth = 16
      canvas.history.commit()
    })

    // Closing the card is the gesture the report pairs with the undo.
    await closeCard()

    // One press must revert the border completely.
    await act(async () => {
      await canvas.history.undo()
    })
    expect(canvas.borderWidth).toBe(0)
  })

  it("records nothing when the card closes without a color change", async () => {
    await renderBorderPicker()
    await openCard()
    await closeCard()

    expect(onChange).not.toHaveBeenCalled()
    // Nothing was committed, so the stack still holds only its seed (§8).
    expect(canvas.history.canUndo).toBe(false)
  })

  it("writes nothing when the same color is re-entered", async () => {
    await renderBorderPicker()
    await openCard()

    // The hex field respells what it is given (uppercase); re-entering the
    // document's own color must not preview a respelled write.
    await typeHex("#18181b")
    await closeCard()

    expect(onApply).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
    expect(canvas.borderColor).toBe("#18181b")
    expect(canvas.history.canUndo).toBe(false)
  })

  it("records nothing when an undo moves the color with the card open", async () => {
    // A committed color change sits on the stack; the user opens the card on it.
    canvas.borderColor = "#ff0000"
    canvas.history.commit()
    await renderBorderPicker()
    await openCard()

    // Ctrl+Z with the card open restores the previous color onto the canvas —
    // the provider mirrors it back down as a new prop.
    await act(async () => {
      await canvas.history.undo()
    })
    await renderBorderPicker()
    await closeCard()

    // The close commits the value the document already holds — a no-op step,
    // and the document keeps its own spelling of it.
    expect(canvas.borderColor).toBe("#18181b")
    expect(canvas.history.canUndo).toBe(false)
  })

  it("records one step when the session does change the color", async () => {
    await renderBorderPicker()
    await openCard()
    await typeHex("#ff0000")
    await closeCard()

    expect(onChange).toHaveBeenCalledWith("#FF0000")
    // One undo reverts the color — and nothing else was stacked above it.
    await act(async () => {
      await canvas.history.undo()
    })
    expect(canvas.borderColor).toBe("#18181b")
  })

  it("records nothing when a shape's color card closes untouched", async () => {
    // A shape's color lives in the canvas payload (fill), not the envelope —
    // the same phantom step reaches the stack through the other comparison.
    const shape = createShape("square")
    canvas.add(shape)
    canvas.setActiveObject(shape)
    canvas.history.commit()
    await renderShapeFillPicker()

    await openCard()
    await closeCard()

    // The add is still the only step: one undo takes the shape away.
    await act(async () => {
      await canvas.history.undo()
    })
    expect(canvas.getObjects()).toHaveLength(0)
  })
})
