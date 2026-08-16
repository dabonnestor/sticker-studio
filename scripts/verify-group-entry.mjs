/**
 * Build 5 early-verify driver (ticket #18, §7 Q5): double-click group entry
 * coexists with the second single-click text entry. Drives the real app in
 * headless Chrome via playwright-core + the dev-only `window.__stageCanvas`
 * handle (exposeStageCanvas). Prints PASS/FAIL lines and screenshots.
 */
import { chromium } from "file:///C:/Users/LENOVO%20ULTRA/Desktop/sticker-studio/node_modules/.pnpm/playwright-core@1.62.1/node_modules/playwright-core/index.mjs"
import { mkdirSync } from "node:fs"

const OUT = "scripts/verify-shots"
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
})
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text())
})
page.on("pageerror", (err) => errors.push(String(err)))

const results = []
function check(name, ok, detail = "") {
  results.push({ name, ok })
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`)
}

await page.goto("http://localhost:5173", { waitUntil: "networkidle" })
await page.waitForFunction(() => !!window.__stageCanvas)

/** Scene point → client coords through the canvas rect (zoom 1, no scroll). */
async function clientOf(canvasFn) {
  return page.evaluate((fnSrc) => {
    const canvas = window.__stageCanvas
    const point = eval(`(${fnSrc})`)()
    const rect = canvas.upperCanvasEl.getBoundingClientRect()
    return { x: point.x + rect.left, y: point.y + rect.top }
  }, canvasFn.toString())
}

/**
 * A real pointer sequence at client coords — Playwright's trusted mouse
 * events (synthetic dispatchEvent does not reach Fabric's pointer handlers).
 * `twice` sends a native double-click.
 */
async function clickAt(x, y, twice = false) {
  if (twice) await page.mouse.dblclick(x, y)
  else await page.mouse.click(x, y)
}

// ── Scenario A: group entry via double-click, fixed children, child select, Escape ──
await page.getByRole("button", { name: "Square" }).click()
await page.getByRole("button", { name: "Circle" }).click()
// Offset the circle so the two shapes don't overlap (canvas API for setup).
await page.evaluate(() => {
  const canvas = window.__stageCanvas
  const active = canvas.getActiveObject()
  active.set({ left: active.left + 300 })
  canvas.requestRenderAll()
})
await page.keyboard.press("Control+a")
await page.keyboard.press("Control+g")
check("Ctrl+A selects all, Ctrl+G groups", await page.evaluate(() => {
  const canvas = window.__stageCanvas
  const active = canvas.getActiveObjects()
  return active.length === 1 && active[0].type === "group" && active[0].getObjects().length === 2
}))

const groupCenter = await clientOf(() => window.__stageCanvas.getActiveObject().getCenterPoint())
await clickAt(groupCenter.x, groupCenter.y, true)
check("double-click enters the group", await page.evaluate(() => {
  const canvas = window.__stageCanvas
  return canvas.enteredGroup !== null && canvas.enteredGroup.getObjects().length === 2
}))
check("children are fixed while entered", await page.evaluate(() => {
  const canvas = window.__stageCanvas
  return canvas.enteredGroup.getObjects().every(
    (child) => child.hasControls === false && child.lockMovementX === true,
  )
}))
await page.screenshot({ path: `${OUT}/1-entered-group.png` })

// Click the circle child — it becomes the active object (property inspection).
const circleCenter = await clientOf(() => {
  const canvas = window.__stageCanvas
  return canvas.enteredGroup.getObjects().find((o) => o.type === "circle").getCenterPoint()
})
await clickAt(circleCenter.x, circleCenter.y)
check("single click on a child selects it for inspection", await page.evaluate(() => {
  const canvas = window.__stageCanvas
  const active = canvas.getActiveObject()
  return active !== null && active.type === "circle" && active.group === canvas.enteredGroup
}))
await page.screenshot({ path: `${OUT}/2-child-selected.png` })

// Escape exits the group and clears the selection.
await page.keyboard.press("Escape")
check("Escape exits the group and deselects", await page.evaluate(() => {
  const canvas = window.__stageCanvas
  return canvas.enteredGroup === null && !canvas.getActiveObject()
}))

// ── Scenario B: text inside a group — the second single-click opens the session ──
await page.getByRole("button", { name: "Add Text" }).click()
await page.waitForFunction(() => window.__stageCanvas.getActiveObject()?.isEditing === true)
// Commit the text session (Ctrl+Enter) so it can be grouped.
await page.keyboard.press("Control+Enter")
await page.waitForFunction(() => window.__stageCanvas.getActiveObject()?.isEditing !== true)
await page.keyboard.press("Control+a")
await page.keyboard.press("Control+g")
check("text + shape group", await page.evaluate(() => {
  const canvas = window.__stageCanvas
  const active = canvas.getActiveObjects()
  // The earlier group is in the selection too — Ctrl+A selects everything —
  // so it flattens first: square + circle + text all in one group.
  return active.length === 1 && active[0].type === "group" && active[0].getObjects().length === 3
}))

const textGroupCenter = await clientOf(() => window.__stageCanvas.getActiveObject().getCenterPoint())
await clickAt(textGroupCenter.x, textGroupCenter.y, true)
check("double-click enters the text group", await page.evaluate(() => {
  const canvas = window.__stageCanvas
  return canvas.enteredGroup !== null
}))

// Two single clicks on the text child: first selects, second opens the session.
const textCenter = await clientOf(() => {
  const canvas = window.__stageCanvas
  return canvas.enteredGroup.getObjects().find((o) => o.type === "textbox").getCenterPoint()
})
await clickAt(textCenter.x, textCenter.y)
await page.waitForFunction(() => window.__stageCanvas.getActiveObject()?.type === "textbox")
await page.screenshot({ path: `${OUT}/3-text-child-selected.png` })
await clickAt(textCenter.x, textCenter.y)
await page.waitForFunction(() => window.__stageCanvas.getActiveObject()?.isEditing === true)
check("second single-click opens the text session inside the group", await page.evaluate(() => {
  const canvas = window.__stageCanvas
  const active = canvas.getActiveObject()
  return active !== null && active.type === "textbox" && active.isEditing === true
}))
await page.screenshot({ path: `${OUT}/4-text-session-in-group.png` })

// Escape reverts the session; Escape again exits the group.
await page.keyboard.press("Escape")
await page.keyboard.press("Escape")
check("Escape exits the group after the session", await page.evaluate(() => {
  const canvas = window.__stageCanvas
  return canvas.enteredGroup === null
}))

// The toolbar shows the Group/Ungroup buttons for a selection.
await page.keyboard.press("Control+a")
const groupButtons = await page.locator("button[aria-label='Group'], button[aria-label='Ungroup']").count()
check("toolbar Group/Ungroup buttons render", groupButtons === 2, `${groupButtons} buttons`)
await page.screenshot({ path: `${OUT}/5-toolbar.png` })

check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "))

await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
