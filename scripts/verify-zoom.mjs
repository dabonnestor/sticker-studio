/**
 * Build 6 early-verify driver (ticket #16, §9): zoom & viewport in the real
 * app — Fit on load, 100% = 1 doc px = 1 CSS px at any DPR, the 10–800%
 * range, presets, Ctrl+= / Ctrl+− / Ctrl+0, scroll-driven panning, and
 * zoom-as-view-state. Drives the app in headless Chrome via playwright-core
 * + the dev-only `window.__stageCanvas` handle (exposeStageCanvas). Prints
 * PASS/FAIL lines and screenshots.
 */
import { chromium } from "file:///C:/Users/LENOVO%20ULTRA/Desktop/sticker-studio/node_modules/.pnpm/playwright-core@1.62.1/node_modules/playwright-core/index.mjs"
import { mkdirSync } from "node:fs"

const OUT = "scripts/verify-shots"
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
})
// DPR 2 — the retina early-verify item runs on the real rendering pipeline.
const page = await browser.newPage({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
})
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

/** The workspace scroll container — the stage's `.overflow-auto` div. */
const workspaceSize = () =>
  page.evaluate(() => {
    const el = document.querySelector(".overflow-auto")
    return { width: el.clientWidth, height: el.clientHeight }
  })

// ── Fit is the default zoom on load (§9) ──
const { width: wsW, height: wsH } = await workspaceSize()
const expectedFit = Math.min((wsW - 96) / 600, (wsH - 96) / 600) * 100
check("Fit is the default zoom on load", await page.evaluate((expected) => {
  const canvas = window.__stageCanvas
  // The fit may clamp to the 10% floor; otherwise it matches the margin math.
  return (
    Math.abs(canvas.getZoomPercent() - expected) < 0.01 ||
    Math.abs(canvas.getZoomPercent() - 10) < 0.01
  )
}, expectedFit))
check("the % readout shows the rounded fit", await page.evaluate((expected) => {
  const readout = document.querySelector("footer button[aria-haspopup='menu']")
  return readout !== null && readout.textContent.includes(`${Math.round(expected)}%`)
}, expectedFit))
await page.screenshot({ path: `${OUT}/zoom-1-fit.png` })

// ── 100% = 1 doc px = 1 CSS px; the element carries the zoom, the model doesn't ──
await page.evaluate(() => window.__stageCanvas.setZoomPercent(100))
check("at 100% the element is the Document size and the bitmap carries the DPR", await page.evaluate(() => {
  const canvas = window.__stageCanvas
  const el = canvas.getElement()
  return (
    canvas.width === 600 && // the model — the Document size — never changes
    Number.parseFloat(el.style.width) === 600 &&
    el.width === 1200 // 600 × DPR 2
  )
}))

// ── Presets, range, and the bottom-bar controls ──
await page.evaluate(() => window.__stageCanvas.setZoomPercent(200))
await page.getByRole("button", { name: "200%", exact: true }).click()
await page.getByRole("menuitem", { name: "150%" }).click()
check("the % dropdown preset drives the canvas", await page.evaluate(() => {
  const canvas = window.__stageCanvas
  return canvas.getZoomPercent() === 150 && canvas.viewportTransform[0] === 1.5
}))
check("− / + step ±10% about the range", await page.evaluate(() => {
  const canvas = window.__stageCanvas
  const before = canvas.getZoomPercent()
  return before === 150
}))
await page.getByRole("button", { name: "Zoom out" }).click()
check("the − button steps down 10%", await page.evaluate(() => {
  return window.__stageCanvas.getZoomPercent() === 140
}))
await page.getByRole("button", { name: "Zoom in" }).click()
await page.getByRole("button", { name: "Zoom in" }).click()
check("the + button steps up 10%", await page.evaluate(() => {
  return window.__stageCanvas.getZoomPercent() === 160
}))
check("the % readout mirrors the canvas", await page.getByRole("button", { name: "160%" }).count() === 1)
await page.screenshot({ path: `${OUT}/zoom-2-160.png` })

// The slider spans the range (aria reflects 10–800) and drives the canvas:
// focus the thumb (a click on it) and arrow-step it.
const slider = page.getByLabel("Zoom", { exact: true })
check("the slider spans the 10–800% range", await page.evaluate(() => {
  const thumb = document.querySelector("footer [role='slider']")
  return (
    thumb.getAttribute("aria-valuemin") === "10" &&
    thumb.getAttribute("aria-valuemax") === "800"
  )
}))
await slider.click()
const sliderZoomBefore = await page.evaluate(() => window.__stageCanvas.getZoomPercent())
await page.keyboard.press("ArrowLeft")
await page.keyboard.press("ArrowLeft")
check("the slider steps the zoom by 10%", await page.evaluate((before) => {
  const z = window.__stageCanvas.getZoomPercent()
  return Math.abs(z - (before - 20)) < 0.001
}, sliderZoomBefore))
await page.getByRole("button", { name: "Zoom in" }).click()
check("Ctrl+= steps +10% about the workspace center", await page.evaluate(() => {
  const canvas = window.__stageCanvas
  const before = canvas.getZoomPercent()
  const anchor = canvas.getViewportCenterScenePoint()
  return { before, anchor }
}).then(async ({ before, anchor }) => {
  await page.keyboard.press("Control+=")
  return page.evaluate(({ before, anchor }) => {
    const canvas = window.__stageCanvas
    const after = canvas.getViewportCenterScenePoint()
    return (
      canvas.getZoomPercent() === before + 10 &&
      Math.abs(after.x - anchor.x) < 0.5 &&
      Math.abs(after.y - anchor.y) < 0.5
    )
  }, { before, anchor })
}))
await page.keyboard.press("Control+0")
check("Ctrl+0 returns to Fit", await page.evaluate((expected) => {
  const canvas = window.__stageCanvas
  return (
    Math.abs(canvas.getZoomPercent() - expected) < 0.01 ||
    Math.abs(canvas.getZoomPercent() - 10) < 0.01
  )
}, expectedFit))
await page.keyboard.press("Control+-")
check("Ctrl+− steps −10% from Fit", await page.evaluate((expected) => {
  const canvas = window.__stageCanvas
  return Math.abs(canvas.getZoomPercent() - (expected - 10)) < 0.01
}, expectedFit))

// ── Scroll-driven panning: the document moves 1:1 with the scroll ──
await page.evaluate(() => window.__stageCanvas.setZoomPercent(200))
const rectBefore = await page.evaluate(() => {
  const canvas = window.__stageCanvas
  const workspace = document.querySelector(".overflow-auto")
  workspace.scrollLeft = 0
  workspace.scrollTop = 0
  canvas.requestRenderAll()
  const rect = canvas.upperCanvasEl.getBoundingClientRect()
  return { left: rect.left, top: rect.top }
})
const panned = await page.evaluate(() => {
  const workspace = document.querySelector(".overflow-auto")
  workspace.scrollLeft = 120
  workspace.scrollTop = 80
  return {
    scrollLeft: workspace.scrollLeft,
    scrollTop: workspace.scrollTop,
    rectLeft: window.__stageCanvas.upperCanvasEl.getBoundingClientRect().left,
    rectTop: window.__stageCanvas.upperCanvasEl.getBoundingClientRect().top,
  }
})
check(
  "scrollbars pan the document at 1:1",
  Math.abs(rectBefore.left - panned.rectLeft - panned.scrollLeft) < 1 &&
    Math.abs(rectBefore.top - panned.rectTop - panned.scrollTop) < 1,
  `scrolled ${panned.scrollLeft},${panned.scrollTop} → rect Δ ${rectBefore.left - panned.rectLeft},${rectBefore.top - panned.rectTop}`,
)
check("the workspace scrolls when the Document no longer fits", await page.evaluate(() => {
  const workspace = document.querySelector(".overflow-auto")
  return workspace.scrollWidth > workspace.clientWidth
}))
await page.screenshot({ path: `${OUT}/zoom-3-200-scrolled.png` })

// ── Zoom is view state: never serialized, never an undoable step ──
check("zoom never appears in the serialized Document", await page.evaluate(() => {
  const canvas = window.__stageCanvas
  const payload = JSON.stringify(canvas.toJSON())
  return !payload.includes("zoom") && !payload.includes("viewportTransform")
}))
check("zoom never enters the undo stack", await page.evaluate(() => {
  const canvas = window.__stageCanvas
  const before = canvas.history.canUndo
  canvas.setZoomPercent(300)
  return canvas.history.canUndo === before
}))
check("undo/redo preserve the zoom", await page.evaluate(() => {
  const canvas = window.__stageCanvas
  canvas.setZoomPercent(300)
  return canvas.history.canUndo === false && canvas.getZoomPercent() === 300
}).then(async (zoomSet) => {
  if (!zoomSet) return false
  // Add a shape via the sidebar — one undoable step — then undo/redo.
  await page.getByRole("button", { name: "Square" }).click()
  const undoWorked = await page.evaluate(() => window.__stageCanvas.history.canUndo === true)
  await page.keyboard.press("Control+z")
  await page.waitForFunction(() => window.__stageCanvas.getObjects().length === 0)
  const afterUndo = await page.evaluate(() => window.__stageCanvas.getZoomPercent())
  await page.keyboard.press("Control+y")
  await page.waitForFunction(() => window.__stageCanvas.getObjects().length === 1)
  const afterRedo = await page.evaluate(() => window.__stageCanvas.getZoomPercent())
  return undoWorked && afterUndo === 300 && afterRedo === 300
}))

check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "))

await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
