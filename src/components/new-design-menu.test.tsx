/**
 * The New dropdown (map #48, ticket #55) — the preset picker, Custom's fields,
 * and the discard confirmation, driven through the real component and the real
 * Radix menus.
 *
 * This is where the ticket's Radix constraint bites, so it is what most of
 * these lock down: DropdownMenu closes the menu on item select, and its
 * content typeaheads on *any* character key pressed inside it — focus in an
 * input included. Custom is therefore tested for staying open and holding
 * focus *while the fields are typed in*, which is the whole reason it swallows
 * its own select and stops its own keydowns.
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest"

import { NewDesignMenu } from "@/components/new-design-menu"
import type { DocumentSize, StickerPreset } from "@/fabric/outline"
import type { Unit } from "@/lib/units"

// React's act() gate — the flag the test environment sets by convention.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true

describe("the New dropdown", () => {
  let container: HTMLDivElement
  let root: Root
  let onStartNew: Mock<(preset: StickerPreset, customSize?: DocumentSize) => void>
  let isDocumentBlank: Mock<() => boolean>

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    onStartNew = vi.fn<(preset: StickerPreset, customSize?: DocumentSize) => void>()
    // A pristine session by default: most of what New does is only visible
    // once the confirmation is out of the way.
    isDocumentBlank = vi.fn<() => boolean>(() => true)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  /** Render the menu at the app's active unit, and open it the way the New
   * button does — every one of these starts with the menu on screen. */
  async function openMenu(unit: Unit = "in") {
    await act(async () => {
      root.render(
        <NewDesignMenu
          onStartNew={onStartNew}
          isDocumentBlank={isDocumentBlank}
          unit={unit}
        />,
      )
    })
    const trigger = container.querySelector("button")!
    await act(async () => {
      trigger.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
      )
      trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(menu()).not.toBeNull()
  }

  /** Choose a menu item — the pointer sequence a real click sends. */
  async function choose(label: string) {
    const target = item(label)
    await act(async () => {
      target.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
      )
      target.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, button: 0 }),
      )
      target.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
  }

  /** The open menu's content, or null while closed. */
  function menu(): HTMLElement | null {
    return document.body.querySelector('[data-slot="dropdown-menu-content"]')
  }

  /** The open confirmation, or null while closed. */
  function dialog(): HTMLElement | null {
    return document.body.querySelector('[data-slot="alert-dialog-content"]')
  }

  function item(label: string): HTMLElement {
    const found = [
      ...menu()!.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]'),
    ].find((element) => element.textContent?.trim() === label)
    if (!found) throw new Error(`No menu item named ${label}`)
    return found
  }

  /** A field of the Custom panel, by the accessible name it carries. */
  function field(name: "Width" | "Height"): HTMLInputElement {
    const found = menu()!.querySelector<HTMLInputElement>(
      `input[aria-label^="${name}"]`,
    )
    if (!found) throw new Error(`No Custom field named ${name}`)
    return found
  }

  function createButton(): HTMLButtonElement {
    const found = [...menu()!.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Create",
    )
    if (!found) throw new Error("No Create button")
    return found as HTMLButtonElement
  }

  /** Type a value into a field — React's onChange is the input event. */
  async function type(input: HTMLInputElement, text: string) {
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!
    await act(async () => {
      setValue.call(input, text)
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
  }

  /** Click one of the confirmation's own buttons. */
  async function clickDialogButton(slot: "action" | "cancel") {
    const button = document.body.querySelector<HTMLElement>(
      `[data-slot="alert-dialog-${slot}"]`,
    )!
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
  }

  /** Open the Custom panel. */
  async function openCustom(unit: Unit = "in") {
    await openMenu(unit)
    await choose("Custom…")
  }

  describe("the preset list", () => {
    it("offers the five shapes and Custom, in the vocabulary's order", async () => {
      await openMenu()
      const labels = [
        ...menu()!.querySelectorAll<HTMLElement>(
          '[data-slot="dropdown-menu-item"]',
        ),
      ].map((element) => element.textContent?.trim())
      expect(labels).toEqual([
        "Square",
        "Rectangle",
        "Rounded corner",
        "Oval",
        "Circle",
        "Custom…",
      ])
    })

    it("starts the chosen preset in silence on a factory-blank Document", async () => {
      await openMenu()
      await choose("Oval")

      expect(onStartNew).toHaveBeenCalledWith("oval", undefined)
      // Nothing to lose, so nothing was asked.
      expect(dialog()).toBeNull()
      expect(menu()).toBeNull()
    })

    it("passes each item's own preset, not the label it reads as", async () => {
      await openMenu()
      await choose("Rounded corner")
      expect(onStartNew).toHaveBeenCalledWith("rounded-corner", undefined)
    })
  })

  describe("the discard confirmation", () => {
    it("confirms before starting when the Document holds work", async () => {
      isDocumentBlank.mockReturnValue(false)
      await openMenu()
      await choose("Oval")

      // The choice is held, not acted on: nothing has been discarded yet.
      expect(onStartNew).not.toHaveBeenCalled()
      expect(dialog()).not.toBeNull()
    })

    it("confirms even for the preset the Document already is", async () => {
      // The gate is the blank predicate alone. A Square Document started
      // again is still a reset — the design is discarded either way — so
      // there is deliberately no "same preset, nothing to do" shortcut for a
      // later hand to add.
      isDocumentBlank.mockReturnValue(false)
      await openMenu()
      await choose("Square")

      expect(dialog()).not.toBeNull()
      expect(onStartNew).not.toHaveBeenCalled()
    })

    it("starts the held design on Discard", async () => {
      isDocumentBlank.mockReturnValue(false)
      await openMenu()
      await choose("Oval")
      await clickDialogButton("action")

      expect(onStartNew).toHaveBeenCalledWith("oval", undefined)
      expect(dialog()).toBeNull()
    })

    it("discards nothing on Cancel", async () => {
      isDocumentBlank.mockReturnValue(false)
      await openMenu()
      await choose("Oval")
      await clickDialogButton("cancel")

      expect(onStartNew).not.toHaveBeenCalled()
      expect(dialog()).toBeNull()
    })

    it("asks the predicate afresh for each request", async () => {
      // A pull, not a mirror: the canvas may have been emptied between two
      // openings of the menu, and the second must not be answered by the
      // first's reading.
      await openMenu()
      await choose("Oval")
      expect(dialog()).toBeNull()

      isDocumentBlank.mockReturnValue(false)
      await openMenu()
      await choose("Oval")
      expect(dialog()).not.toBeNull()
    })
  })

  describe("Custom", () => {
    it("opens on Rectangle's Default size, in the active unit", async () => {
      await openCustom()
      expect(field("Width").value).toBe("3")
      expect(field("Height").value).toBe("2")
    })

    it("re-labels those numbers in the unit the app is set to", async () => {
      await openCustom("px")
      expect(field("Width").value).toBe("288")
      expect(field("Height").value).toBe("192")
    })

    it("keeps the menu open while a field is typed in", async () => {
      // The constraint the ticket names: Radix closes the menu on item
      // select, and the select here only *opens* the fields. If it closed,
      // the fields would be unreachable the moment they were asked for.
      await openCustom()
      await type(field("Width"), "4")

      expect(menu()).not.toBeNull()
      expect(field("Width").value).toBe("4")
    })

    it("keeps the caret in the field through the menu's typeahead", async () => {
      // Radix's menu content runs typeahead on any character key pressed
      // anywhere inside it. "c" matches Circle and Custom… — without the
      // panel stopping its own keydowns, focus would leave the field the user
      // is typing in and land on a menu item.
      await openCustom()
      const width = field("Width")
      await act(async () => width.focus())

      await act(async () => {
        width.dispatchEvent(
          new KeyboardEvent("keydown", { key: "c", bubbles: true }),
        )
        // The typeahead focuses its match on a timer; give it the chance.
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(document.activeElement).toBe(width)
    })

    it("wraps Tab from Create back to the first field", async () => {
      // The menu around the panel has nothing focusable after Create, so the
      // browser's Tab would leave the caret sitting on Create. The panel is a
      // form, and closes the loop itself.
      await openCustom()
      const create = createButton()
      await act(async () => create.focus())
      expect(document.activeElement).toBe(create)

      await act(async () => {
        create.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
        )
      })
      expect(document.activeElement).toBe(field("Width"))
    })

    it("creates a sharp-cornered sheet from the typed width and height", async () => {
      await openCustom()
      await type(field("Width"), "4")
      await type(field("Height"), "3")
      await act(async () => createButton().click())

      expect(onStartNew).toHaveBeenCalledWith("custom", {
        width: 384,
        height: 288,
      })
      // The menu goes with it — the choice has been made.
      expect(menu()).toBeNull()
    })

    it("refuses a size under the floor, and says the floor in the active unit", async () => {
      await openCustom()
      expect(createButton().disabled).toBe(false)

      // 0.5 in is 48 px — under the toolbar's 60 px floor.
      await type(field("Width"), "0.5")
      expect(createButton().disabled).toBe(true)
      expect(menu()!.textContent).toContain("Minimum 0.63 in")

      await type(field("Width"), "1")
      expect(createButton().disabled).toBe(false)
    })

    it("holds the same 60 px floor when the app is set to px", async () => {
      await openCustom("px")

      await type(field("Height"), "59")
      expect(createButton().disabled).toBe(true)
      await type(field("Height"), "60")
      expect(createButton().disabled).toBe(false)
    })

    it("treats a cleared field as no size at all", async () => {
      await openCustom()
      await type(field("Width"), "")
      // Number("") is 0 — not a sheet, rather than a zero-width one.
      expect(createButton().disabled).toBe(true)
    })

    it("holds the typed size through the confirmation", async () => {
      isDocumentBlank.mockReturnValue(false)
      await openCustom()
      await type(field("Width"), "4")
      await type(field("Height"), "3")
      await act(async () => createButton().click())

      expect(dialog()).not.toBeNull()
      expect(onStartNew).not.toHaveBeenCalled()

      await clickDialogButton("action")
      expect(onStartNew).toHaveBeenCalledWith("custom", {
        width: 384,
        height: 288,
      })
    })

    it("offers the presets again, panel closed, on reopen", async () => {
      await openCustom()
      // Escape closes the menu from inside the fields, which is why the panel
      // lets that one key through.
      await act(async () => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        )
      })
      expect(menu()).toBeNull()

      await openMenu()
      expect(() => field("Width")).toThrow()
    })
  })
})
