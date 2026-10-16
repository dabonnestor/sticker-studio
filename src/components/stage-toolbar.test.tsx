/**
 * The Font family picker (map #71, ticket #64) — the grouped, own-face
 * presentation settled in #61, built into the toolbar field with the §7
 * browse wiring: five category sections in picker order, a one-line item per
 * family in its own 400-normal face once that face has arrived, the trigger
 * in the current family's face, and the skeleton reveal — the name hidden
 * behind a pulsing bar while the item's face load is in flight.
 *
 * jsdom ships no IntersectionObserver and no FontFaceSet: this suite installs
 * controllable stand-ins and drives both by hand — intersect an item, resolve
 * or fail its load. That is exactly the seam the criteria turn on: opening
 * requests nothing, only intersecting items request their face, a landed face
 * reveals the name in its own face, and a failure stays quiet (the name shows
 * in the fallback) and is retried on the next touch — no negative cache, §9.
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest"

import { FontFamilyField } from "@/components/stage-toolbar"
import { resetFontLoadTestState } from "@/fabric/fonts"
import { FONT_FAMILIES } from "@/fabric/text"

// React's act() gate — the flag the test environment sets by convention.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true

/** The five category labels, verbatim — the menu's user-facing copy (#61). */
const CATEGORY_LABELS = ["Sans", "Serif", "Display", "Handwriting", "Mono"]

/** What `document.fonts.load` resolves with for a face that loaded. */
const LOADED_FACE = { status: "loaded" } as FontFace

/** The FontFaceSet stand-in — `load` succeeds by default; tests swap it. */
const fontSet = {
  load: vi.fn<(descriptor: string) => Promise<FontFace[]>>(async () => [
    LOADED_FACE,
  ]),
  ready: Promise.resolve(),
}

Object.defineProperty(document, "fonts", { value: fontSet, configurable: true })

/** A controllable IntersectionObserver — intersections are fired by hand. */
class IntersectionObserverStub {
  static live: IntersectionObserverStub[] = []
  readonly observed = new Set<Element>()
  private readonly callback: IntersectionObserverCallback

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    IntersectionObserverStub.live.push(this)
  }

  observe(target: Element) {
    this.observed.add(target)
  }

  unobserve(target: Element) {
    this.observed.delete(target)
  }

  disconnect() {
    this.observed.clear()
  }

  /** Deliver one target's intersection — what the browser would report. */
  intersect(target: Element) {
    this.callback(
      [{ target, isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    )
  }
}

/** The observer the open menu's visibility gate constructed. */
function menuObserver(): IntersectionObserverStub {
  const observer = IntersectionObserverStub.live.at(-1)
  if (!observer) throw new Error("the menu constructed no IntersectionObserver")
  return observer
}

describe("the Font family picker", () => {
  let container: HTMLDivElement
  let root: Root
  let onApply: Mock<(family: string) => void>
  let onCommit: Mock<(family: string) => void>

  beforeEach(() => {
    IntersectionObserverStub.live = []
    globalThis.IntersectionObserver =
      IntersectionObserverStub as unknown as typeof IntersectionObserver
    resetFontLoadTestState()
    fontSet.load.mockReset()
    fontSet.load.mockImplementation(async () => [LOADED_FACE])

    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    onApply = vi.fn<(family: string) => void>()
    onCommit = vi.fn<(family: string) => void>()
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  /** Mount the field and open its menu — the real Radix pointer sequence. */
  async function openMenu() {
    await act(async () => {
      root.render(
        <FontFamilyField family="Inter" onApply={onApply} onCommit={onCommit} />,
      )
    })
    const trigger = container.querySelector("button")!
    await act(async () => {
      trigger.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
      )
      trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
  }

  /** The open menu's items, in render order. */
  function items(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>("[data-font-family]")]
  }

  function item(family: string): HTMLElement {
    const found = items().find((el) => el.dataset.fontFamily === family)
    if (!found) throw new Error(`no menu item for ${family}`)
    return found
  }

  /** Let the kicked load promise chain settle and re-render. */
  async function flush() {
    await act(async () => {})
    await act(async () => {})
  }

  it("renders the five category sections in picker order, each family filed under its own", async () => {
    await openMenu()

    const groups = [
      ...document.querySelectorAll('[data-slot="dropdown-menu-group"]'),
    ]
    const grouped = groups.map((group) => ({
      label: group.querySelector('[data-slot="dropdown-menu-label"]')
        ?.textContent,
      families: [
        ...group.querySelectorAll<HTMLElement>("[data-font-family]"),
      ].map((el) => el.dataset.fontFamily),
    }))

    expect(grouped.map(({ label }) => label)).toEqual(CATEGORY_LABELS)
    expect(
      grouped.flatMap(({ families }) => families),
    ).toHaveLength(FONT_FAMILIES.length)
    // Every family sits under its own category — none misfiled, none
    // repeated across sections.
    for (const { label, families } of grouped) {
      expect(families.length).toBeGreaterThan(0)
      for (const family of families) {
        expect(
          FONT_FAMILIES.find((spec) => spec.family === family)?.category,
        ).toBe(label)
      }
    }

    // A separator between groups — five sections, four boundaries (#61).
    expect(
      document.querySelectorAll('[data-slot="dropdown-menu-separator"]').length,
    ).toBe(CATEGORY_LABELS.length - 1)
  })

  it("opens fixed-width, not trigger-width — ~300 px for ~30 names", async () => {
    await openMenu()

    const content = document.querySelector<HTMLElement>(
      '[data-slot="dropdown-menu-content"]',
    )!
    // The fixed width replaces the primitive's trigger-width default.
    expect(content.className).toContain("w-[19rem]")
    expect(content.className).not.toContain(
      "w-(--radix-dropdown-menu-trigger-width)",
    )
  })

  it("caps at three quarters of the viewport, never past the primitive's available height", async () => {
    await openMenu()

    const content = document.querySelector<HTMLElement>(
      '[data-slot="dropdown-menu-content"]',
    )!
    // Three quarters of the viewport replaces the primitive's full
    // available-height cap; the min() keeps a short window from pushing the
    // menu off screen.
    expect(content.className).toContain(
      "max-h-[min(75vh,var(--radix-dropdown-menu-content-available-height))]",
    )
    expect(content.className).not.toContain(
      "max-h-(--radix-dropdown-menu-content-available-height)",
    )
  })

  it("renders the trigger in the current family's own face", async () => {
    await openMenu()

    const trigger = container.querySelector("button")!
    expect(trigger.className).toContain("text-xs")
    const name = trigger.querySelector("span")!
    expect(name.textContent).toBe("Inter")
    expect(name.style.fontFamily).toBe("Inter")
  })

  it("requests nothing until an item is visible — then reveals that family's own face", async () => {
    await openMenu()

    // Opening alone requests nothing: the visibility gate has reported no
    // intersection yet (§11.3), so the items wait as skeletons.
    expect(fontSet.load).not.toHaveBeenCalled()
    expect(item("Anton").dataset.faceState).toBe("pending")
    expect(item("Anton").querySelector("[data-skeleton]")).not.toBeNull()

    const observer = menuObserver()
    expect(observer.observed.size).toBe(FONT_FAMILIES.length)

    await act(async () => {
      observer.intersect(item("Anton"))
    })
    await flush()

    // Only the intersecting item's family was requested — its one 400-normal
    // face, read the same way the reveal hears the answer.
    expect(fontSet.load).toHaveBeenCalledTimes(1)
    expect(fontSet.load).toHaveBeenCalledWith('400 24px "Anton"')
    expect(observer.observed.has(item("Anton"))).toBe(false)

    // The face landed: the name shows in its own face, the bar is gone.
    expect(item("Anton").dataset.faceState).toBe("arrived")
    expect(item("Anton").style.fontFamily).toBe("Anton")
    expect(item("Anton").textContent).toContain("Anton")
    expect(item("Anton").querySelector("[data-skeleton]")).toBeNull()

    // A family nobody scrolled to is untouched — no request, no own face.
    expect(item("Inter").dataset.faceState).toBe("pending")
    expect(item("Inter").style.fontFamily).toBe("")
    expect(item("Inter").querySelector("[data-skeleton]")).not.toBeNull()
  })

  it("kicks the pointed family's face on hover (deduped) and previews without committing", async () => {
    await openMenu()
    const anton = item("Anton")

    // The pointer beats the gate: entering the item requests its face — one
    // probe, deduped — and previews the family on the selection: applied
    // without awaiting, recorded nowhere.
    await act(async () => {
      anton.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
    })
    await flush()
    expect(fontSet.load).toHaveBeenCalledTimes(1)
    expect(fontSet.load).toHaveBeenCalledWith('400 24px "Anton"')
    expect(onApply).toHaveBeenCalledWith("Anton")
    expect(onCommit).not.toHaveBeenCalled()
    expect(anton.dataset.faceState).toBe("arrived")

    // The gate then reports the same item — the kick is deduped in flight:
    // a fast skim fires each family's fetch once (§6).
    await act(async () => {
      menuObserver().intersect(anton)
    })
    await flush()
    expect(fontSet.load).toHaveBeenCalledTimes(1)

    // Leaving restores the anchored family — still no undo step.
    await act(async () => {
      anton.dispatchEvent(
        new MouseEvent("mouseout", {
          bubbles: true,
          relatedTarget: document.body,
        }),
      )
    })
    expect(onApply).toHaveBeenLastCalledWith("Inter")
    expect(onCommit).not.toHaveBeenCalled()
  })

  it("picks a family with one click — the close's restore records nothing", async () => {
    await openMenu()

    await act(async () => {
      item("Anton").dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
      )
      item("Anton").dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, button: 0 }),
      )
      item("Anton").dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    // One recorded step, for the picked family — and the menu closed.
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith("Anton")
    expect(document.querySelector('[data-font-family="Anton"]')).toBeNull()
  })

  it("reveals the fallback name when the face never arrives — quiet, then retried", async () => {
    fontSet.load.mockResolvedValueOnce([])
    await openMenu()

    await act(async () => {
      menuObserver().intersect(item("Anton"))
    })
    await flush()

    // The face failed: the name shows in the fallback face — no own-face
    // styling here, and no warning on browse (the click is where it speaks).
    expect(item("Anton").dataset.faceState).toBe("failed")
    expect(item("Anton").style.fontFamily).toBe("")
    expect(item("Anton").textContent).toContain("Anton")
    expect(item("Anton").querySelector("[data-skeleton]")).toBeNull()

    // No negative cache: the next touch (a hover kick) retries and lands.
    await act(async () => {
      item("Anton").dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
    })
    await flush()
    expect(fontSet.load).toHaveBeenCalledTimes(2)
    expect(item("Anton").dataset.faceState).toBe("arrived")
    expect(item("Anton").style.fontFamily).toBe("Anton")
  })

  it("falls back to all-on-open where IntersectionObserver is unavailable", async () => {
    const saved = globalThis.IntersectionObserver
    Reflect.deleteProperty(globalThis, "IntersectionObserver")
    try {
      await openMenu()
      await flush()

      // The recorded fallback (§7): every family requested on open.
      expect(fontSet.load).toHaveBeenCalledTimes(FONT_FAMILIES.length)
      expect(item("Anton").dataset.faceState).toBe("arrived")
    } finally {
      globalThis.IntersectionObserver = saved
    }
  })
})
