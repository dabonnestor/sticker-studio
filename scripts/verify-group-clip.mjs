/**
 * Regression driver for the group-clip fix: editing an individual object
 * inside a group (toolbar text-property commit, or typing in its text
 * session) re-fits the parent group to the grown child. Fabric re-fits a
 * group only on child gesture events — a toolbar commit fires none — so
 * without the re-fit the group stays sized to the pre-edit child and the
 * grown text renders past the group's cached bounds: clipped at the cache
 * canvas edge.
 *
 * Drives the real app in headless Chrome via playwright-core + the dev-only
 * `window.__stageCanvas` handle (exposeStageCanvas). Prints PASS/FAIL lines
 * and screenshots.
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

/** The entered group hugs its text child: the child's right edge stays inside
 * (or exactly on) the group's bounds, and the group grew past the pre-edit
 * width. */
async function groupHugsText(beforeWidth) {
  return page.evaluate((w) => {
    const canvas = window.__stageCanvas
    const text = canvas.getActiveObject()
    const group = canvas.enteredGroup
    const textRect = text.getBoundingRect()
    const groupRect = group.getBoundingRect()
    const textRight = textRect.left + textRect.width
    const groupRight = groupRect.left + groupRect.width
    return {
      ok: group.width > w && textRight <= groupRight + 0.5,
      groupWidth: group.width,
      beforeWidth: w,
      textRight,
      groupRight,
    }
  }, beforeWidth)
}

// ── Setup: square + text side by side, grouped, entered ──
await page.getByRole("button", { name: "Square" }).click()
await page.getByRole("button", { name: "Add Text" }).click()
await page.waitForFunction(() => window.__stageCanvas.getActiveObject()?.isEditing === true)
// Park the text to the right of the square so it is the group's rightmost
// member — its right edge defines the group's right bound.
await page.evaluate(() => {
  const canvas = window.__stageCanvas
  const text = canvas.getActiveObject()
  text.set({ left: 300 + 96 + 10, top: 300 })
  canvas.requestRenderAll()
})
await page.keyboard.press("Control+Enter") // commit the text session
await page.waitForFunction(() => window.__stageCanvas.getActiveObject()?.isEditing !== true)
await page.keyboard.press("Control+a")
await page.keyboard.press("Control+g")

const groupCenter = await clientOf(() => window.__stageCanvas.getActiveObject().getCenterPoint())
await page.mouse.dblclick(groupCenter.x, groupCenter.y)
await page.waitForFunction(() => window.__stageCanvas.enteredGroup !== null)

const textCenter = await clientOf(() => {
  const canvas = window.__stageCanvas
  return canvas.enteredGroup.getObjects().find((o) => o.type === "textbox").getCenterPoint()
})
await page.mouse.click(textCenter.x, textCenter.y)
await page.waitForFunction(() => window.__stageCanvas.getActiveObject()?.type === "textbox")

const before = await page.evaluate(() => {
  const canvas = window.__stageCanvas
  return canvas.enteredGroup.width
})

// ── Scenario A: the toolbar font-size commit on the entered child ──
const sizeField = page.locator('input[aria-label="Font size (px)"]')
await sizeField.fill("48")
await sizeField.press("Enter")
await page.waitForTimeout(300)
const a = await groupHugsText(before)
check(
  "font-size commit on an entered child re-fits the group — nothing clipped",
  a.ok,
  `group ${a.beforeWidth} → ${a.groupWidth}, text right ${a.textRight} ≤ group right ${a.groupRight}`,
)
await page.screenshot({ path: `${OUT}/verify-group-clip-1-size-commit.png` })

// ── Scenario B: typing in the text session re-fits the group per keystroke ──
const groupWidthAfterSize = a.groupWidth
await page.mouse.dblclick(textCenter.x, textCenter.y) // second click opens the session
await page.waitForFunction(() => window.__stageCanvas.getActiveObject()?.isEditing === true)
await page.keyboard.type("hello world")
await page.waitForTimeout(300)
const b = await groupHugsText(groupWidthAfterSize)
check(
  "typing in the session re-fits the group per keystroke — nothing clipped",
  b.ok,
  `group ${b.beforeWidth} → ${b.groupWidth}, text right ${b.textRight} ≤ group right ${b.groupRight}`,
)
await page.screenshot({ path: `${OUT}/verify-group-clip-2-typing.png` })

check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "))

await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
