import type { Canvas, Textbox } from "fabric"

import {
  TEXT_DEFAULT_STRING,
  fitToContent,
  forceUppercase,
  isTextObject,
  type TextMeasurer,
} from "@/fabric/text"

/**
 * Text interaction wiring (build spec §6) — the canvas-level behaviors that
 * make a Textbox behave like the spec's Text object:
 *
 * - **Scale fold**: scaling a textbox folds scale into `fontSize` + `width`
 *   and resets scale to 1, so glyphs never raster-distort and the JSON
 *   document always carries scale 1. Verified against 7.4.0 in the spike
 *   (v7 removed `unscaledText`).
 * - **Text session**: one interaction boundary. Entering captures the
 *   pre-session text; exiting commits — everything typed is one undoable
 *   step (the undo build snapshots on `text:editing:exited`) — unless the
 *   session was reverted: Escape restores the pre-session state. Blur /
 *   click-away / Ctrl+Enter commit; Escape reverts; in-session Ctrl+Z stays
 *   field-local (Fabric never forwards it); Enter inserts a newline
 *   (native). Empty-on-exit restores "Text".
 * - **Auto-fit**: the box re-fits to its content at the end of every
 *   committed session while it has never been manually resized.
 * - **Uppercase**: one-way flag — forced while set, on every keystroke, via
 *   a capture-phase input listener on the hidden textarea (before Fabric
 *   syncs the value into the object).
 *
 * The pure operations are exported for tests; the wiring attaches them to
 * canvas events.
 */

/** The pre-session state Escape restores. */
export interface TextSessionState {
  text: string
  /** Per-character styles — paste can import rich styles. */
  styles: Textbox["styles"]
  /** Escape was pressed: the session must revert, not commit. */
  revert: boolean
  /** Removes the session's textarea listeners. */
  cleanup?: () => void
}

/** Capture the pre-session state, called on `text:editing:entered`. */
export function captureTextSession(obj: Textbox): TextSessionState {
  return {
    text: obj.text,
    styles: structuredClone(obj.styles) as Textbox["styles"],
    revert: false,
  }
}

/**
 * The commit path of a session exit (build spec §6): empty-on-exit restores
 * "Text"; the uppercase flag forces its case on the stored string; while
 * auto-fitted, the box re-hugs its content at the new width.
 */
export function commitTextSession(
  obj: Textbox,
  measure: TextMeasurer,
): void {
  if (obj.text === "") obj.set("text", TEXT_DEFAULT_STRING)
  forceUppercase(obj)
  if (obj.autoFit) fitToContent(obj, measure)
}

/** The revert path of a session exit: restore the pre-session text. */
export function revertTextSession(obj: Textbox, state: TextSessionState): void {
  obj.set({ text: state.text, styles: state.styles })
  obj.setCoords()
}

/**
 * The scale fold (spike, verified against 7.4.0): on `object:scaling`, scale
 * folds into `width` + `fontSize` and scale resets to 1 — height re-measures
 * from the new width's wrapping, so a corner drag grows the font, never
 * distorts the glyphs. The first manual resize hands the width to the user:
 * auto-fit stops (§6). (The width-wrap handles fire `object:resizing`
 * instead — the wiring clears autoFit there too.)
 */
export function foldTextScale(obj: Textbox): void {
  const sx = Math.abs(obj.scaleX)
  if (sx !== 1) {
    obj.set({
      width: obj.width * sx,
      fontSize: Math.max(1, obj.fontSize * sx),
    })
  }
  obj.set({ scaleX: 1, scaleY: 1 })
  obj.set("autoFit", false)
}

/**
 * Wire the text behaviors to the canvas: the scale fold on `object:scaling`
 * and the session lifecycle on `text:editing:entered` / `text:editing:exited`.
 */
export function wireTextInteractions(
  canvas: Canvas,
  measure: TextMeasurer,
): void {
  canvas.on("object:scaling", (event) => {
    if (isTextObject(event.target)) foldTextScale(event.target)
  })

  // The width-wrap handles (Fabric's `mr`/`ml`, the manual wrap width) fire
  // "resizing", not "scaling" — the width is applied by Fabric directly, so
  // only the auto-fit handoff is needed: from here on the user owns the
  // width (§6 "first manual resize hands the width to the user").
  canvas.on("object:resizing", (event) => {
    if (isTextObject(event.target)) event.target.set("autoFit", false)
  })

  const sessions = new WeakMap<Textbox, TextSessionState>()

  canvas.on("text:editing:entered", (event) => {
    const obj = event.target
    if (!isTextObject(obj) || !obj.hiddenTextarea) return
    const state = captureTextSession(obj)
    sessions.set(obj, state)

    // Listeners on the hidden textarea, capture phase — before Fabric's own
    // handlers — so they win on conflict. `keydown`: Escape marks the
    // session for revert (Fabric's handler then exits editing normally),
    // Ctrl+Enter commits. `input`: the uppercase flag forces the typed case
    // on the textarea value, so Fabric syncs the forced string into the
    // object and everything downstream (auto-fit width, undo snapshots) sees
    // it. Uppercasing never changes length for BMP text, so the caret stays
    // valid; positions are clamped defensively.
    const textarea = obj.hiddenTextarea

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        state.revert = true
        return
      }
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault()
        obj.exitEditing()
      }
    }

    const onInput = (event: Event) => {
      if (!obj.uppercase) return
      const ta = event.target as HTMLTextAreaElement
      const upper = ta.value.toUpperCase()
      if (ta.value === upper) return
      const start = ta.selectionStart
      const end = ta.selectionEnd
      ta.value = upper
      ta.setSelectionRange(Math.min(start, upper.length), Math.min(end, upper.length))
    }

    textarea.addEventListener("keydown", onKeyDown, true)
    textarea.addEventListener("input", onInput, true)
    state.cleanup = () => {
      textarea.removeEventListener("keydown", onKeyDown, true)
      textarea.removeEventListener("input", onInput, true)
    }
  })

  canvas.on("text:editing:exited", (event) => {
    const obj = event.target
    if (!isTextObject(obj)) return
    const state = sessions.get(obj)
    sessions.delete(obj)
    state?.cleanup?.()
    if (state?.revert) {
      // Escape — the session is not an interaction boundary. Note for the
      // undo build: Fabric already fired `object:modified` inside
      // `exitEditing`; the revert flag above is what distinguishes a
      // reverted exit from a committed one, so the stack skips it.
      revertTextSession(obj, state)
    } else {
      commitTextSession(obj, measure)
    }
    canvas.requestRenderAll()
  })
}
