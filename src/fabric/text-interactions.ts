import type { Canvas, Textbox } from "fabric"

import { refitParentGroup } from "@/fabric/groups"
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
 * - **Uniform scaling**: text scales like a shape (§5) — corner handles only
 *   keep the aspect ratio (the stage's uniform-scaling handler owns it, so
 *   a corner drag never distorts the glyphs); the first manual resize (scale
 *   or wrap-width drag) hands the width to the user — auto-fit stops.
 * - **Text session**: one interaction boundary. Entering captures the
 *   pre-session text; exiting commits — everything typed is one undoable
 *   step (the undo build snapshots on `text:editing:exited`) — unless the
 *   session was reverted: Escape restores the pre-session state. Blur /
 *   click-away / Ctrl+Enter commit; Escape reverts; in-session Ctrl+Z stays
 *   field-local (Fabric never forwards it); Enter inserts a newline
 *   (native). Empty-on-exit restores "Text".
 * - **Auto-fit / auto width**: the box hugs its content at creation, live
 *   on every keystroke while typing — no fixed-width wrap restriction — and
 *   again at the end of every committed session, while it has never been
 *   manually resized.
 * - **Uppercase**: two-way toggle — forced while set, on every keystroke, via
 *   a capture-phase input listener on the hidden textarea (before Fabric
 *   syncs the value into the object); the underlying mixed-case text is kept
 *   as `uppercaseSource` so turning the flag off restores it.
 *
 * The pure operations are exported for tests; the wiring attaches them to
 * canvas events.
 */

/** The pre-session state Escape restores. */
export interface TextSessionState {
  text: string
  /** Per-character styles — paste can import rich styles. */
  styles: Textbox["styles"]
  /** The box's auto-fit width at session start — typing re-fits it. */
  width: number
  /** The pre-session uppercase source — typing while the flag is set updates it. */
  uppercaseSource: Textbox["uppercaseSource"]
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
    width: obj.width,
    uppercaseSource: obj.uppercaseSource,
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
  if (obj.autoFit) {
    fitToContent(obj, measure)
    // The re-hug grew the box — a group sized to the pre-session text would
    // clip it (see refitParentGroup). A top-level text is its own bounds.
    refitParentGroup(obj)
  }
}

/**
 * The revert path of a session exit: restore the pre-session state — the
 * text, the per-character styles, the auto-fit width (typing re-fits it on
 * every keystroke, so the box is wider than it started) and the uppercase
 * source (typing while the flag is set overwrites it). The top edge is
 * pinned across the restore — the session's longer text grew the box, and
 * shrinking it back would pivot the center-anchored object and walk the
 * text vertically by Δh/2 (the same capture-restore as `applyTextProps`).
 */
export function revertTextSession(obj: Textbox, state: TextSessionState): void {
  const top = obj.getPositionByOrigin(obj.originX, "top")
  obj.set({
    text: state.text,
    styles: state.styles,
    width: state.width,
    uppercaseSource: state.uppercaseSource,
  })
  obj.setPositionByOrigin(top, obj.originX, "top")
  obj.setCoords()
}

/**
 * Wire the text behaviors to the canvas: the session lifecycle on
 * `text:editing:entered` / `text:editing:exited`, and the auto-fit handoff on
 * the width-wrap handles. (Scaling is the stage's uniform-scaling handler —
 * stage-canvas owns the gesture for shapes and text alike.)
 */
export function wireTextInteractions(
  canvas: Canvas,
  measure: TextMeasurer,
): void {
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
      // The textarea holds the user's actual (pre-force) input — Fabric
      // hasn't synced it into the object yet (capture phase). Keep it as the
      // toggle's restore source, before the forcing below destroys the case.
      // Synced even when the value needs no forcing, so keystrokes typed on
      // top of already-uppercase text stay accounted for.
      obj.uppercaseSource = ta.value
      const upper = ta.value.toUpperCase()
      if (ta.value === upper) return
      const start = ta.selectionStart
      const end = ta.selectionEnd
      ta.value = upper
      ta.setSelectionRange(Math.min(start, upper.length), Math.min(end, upper.length))
    }

    // Auto width while typing (§6): Fabric fires `text:changed` on the canvas
    // after every keystroke syncs into the object — re-fit the box there, so
    // it grows (and shrinks) with the content instead of wrapping at the
    // creation width. Once a manual resize has turned autoFit off the user
    // owns the width, and the re-fit stops.
    const onTextChanged = () => {
      if (obj.autoFit) {
        fitToContent(obj, measure)
        // Fabric's own `changed` (the group layout trigger) fires before the
        // re-hug, so the group hugs the pre-fit width — re-fit it to the
        // grown box, or the group clips the new text on this very frame (see
        // refitParentGroup). A top-level text is its own bounds.
        refitParentGroup(obj)
      }
    }
    canvas.on("text:changed", onTextChanged)

    textarea.addEventListener("keydown", onKeyDown, true)
    textarea.addEventListener("input", onInput, true)
    state.cleanup = () => {
      textarea.removeEventListener("keydown", onKeyDown, true)
      textarea.removeEventListener("input", onInput, true)
      canvas.off("text:changed", onTextChanged)
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
