import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import { ActiveSelection, type Canvas, type Object as FabricObject } from "fabric"

import { getTextMeasurer, preloadFonts } from "@/fabric/fonts"
import {
  alignObjects,
  type AlignCommand,
} from "@/fabric/align"
import {
  arrangeObjects,
  type ArrangeCommand,
} from "@/fabric/arrange"
import { copyObjects, pasteObjects } from "@/fabric/clipboard"
import { flipObjects, type FlipCommand } from "@/fabric/flip"
import {
  groupObjects,
  isGrouped,
  refitParentGroup,
  ungroupObjects,
} from "@/fabric/groups"
import {
  DOCUMENT_BACKGROUND_COLOR,
  DOCUMENT_BORDER_COLOR,
  DOCUMENT_BORDER_WIDTH,
  DOCUMENT_HEIGHT,
  DOCUMENT_WIDTH,
  type StageCanvas,
} from "@/fabric/stage-canvas"
import {
  createShape,
  setBorderColor,
  setBorderWidth,
  setFillColor,
} from "@/fabric/shapes"
import { setOpacity } from "@/fabric/document-props"
import type { ShapeKind } from "@/fabric/shapes"
import {
  applyTextProps,
  createText,
  isTextObject,
  type TextPropsPatch,
} from "@/fabric/text"
import type { Unit } from "@/lib/units"
import { stepZoomPercent } from "@/fabric/zoom"

/** A shape-property commit against the selected shape (build spec §5). */
export interface ShapePropsPatch {
  /** Background (fill) color. */
  fillColor?: string
  /** Border width in px (0 = off). */
  borderWidth?: number
  /** Border color. */
  borderColor?: string
}

/**
 * A document-property commit against the canvas (build spec §5) — the canvas
 * background color and the document border (inset, §4). Border width 0 = off.
 */
export interface CanvasPropsPatch {
  /** Canvas (document) background color. */
  backgroundColor?: string
  /** Document border width in px (0 = off). */
  borderWidth?: number
  /** Document border color. */
  borderColor?: string
}

interface StageContextValue {
  /** The live stage canvas, or null before/after the Stage's mount. */
  canvas: Canvas | null
  /** Called by the Stage on mount/unmount to register the live canvas. */
  registerCanvas: (canvas: StageCanvas | null) => void
  /** Undo is available — the stack has a state before the current one (§8). */
  canUndo: boolean
  /** Redo is available — a linear redo stack is pending (§8). */
  canRedo: boolean
  /**
   * Restore the previous document state — one interaction boundary back
   * (ADR 0001). Async: the restore is a full loadFromJSON.
   */
  undo: () => Promise<void>
  /** Restore the next document state — cleared by any new edit (§8). */
  redo: () => Promise<void>
  /**
   * Mirror of the current selection (view state — never serialized, never
   * undoable; §4). Kept in sync from the canvas's selection events.
   */
  selection: FabricObject[]
  /** Mirror of the Document size — the canvas dimensions (§5). */
  documentSize: { width: number; height: number }
  /** Resize the Document; the canvas dimensions are the source of truth. */
  setDocumentSize: (width: number, height: number) => void
  /**
   * Mirror of the Document's look — background color and the border
   * (envelope-owned, §5): the border lives on the canvas (the canvas is the
   * document); this is what the toolbar edits.
   */
  canvasProps: { backgroundColor: string; borderWidth: number; borderColor: string }
  /**
   * Apply a property patch to the Document (§5). One undoable step (ADR
   * 0001) unless recordHistory is false — the color-picker drag preview
   * applies without recording, so skimming the picker never pollutes the
   * undo stack (§8).
   */
  commitCanvasProps: (patch: CanvasPropsPatch, recordHistory?: boolean) => void
  /** Active display unit — a label swap over stored px (§5). */
  unit: Unit
  setUnit: (unit: Unit) => void
  /**
   * The current zoom as a percentage (build spec §9) — 100% = 1 doc px = 1
   * CSS px. View state: never serialized, never an undoable step; mirrored
   * from the canvas's `onZoomChanged`.
   */
  zoom: number
  /**
   * Set the zoom (§9) — the slider and the presets; the workspace center
   * stays put.
   */
  setZoom: (percent: number) => void
  /** Zoom in one step (§9) — Ctrl+= / the + button, about the center. */
  zoomIn: () => void
  /** Zoom out one step (§9) — Ctrl+− / the − button, about the center. */
  zoomOut: () => void
  /**
   * Fit (§9) — Ctrl+0 / the Fit preset: the whole Document into the
   * workspace minus the margin, centered.
   */
  fitZoom: () => void
  /** Add a shape of the given kind, centered and selected (§5). */
  addShape: (kind: ShapeKind) => void
  /**
   * Apply a property patch to the selected shape (§5). One undoable step
   * (ADR 0001) unless recordHistory is false — the color-picker drag preview
   * applies without recording, so skimming the picker never pollutes the
   * undo stack (§8).
   */
  commitShapeProps: (patch: ShapePropsPatch, recordHistory?: boolean) => void
  /**
   * Add a Text object at the viewport center, selected and already in its
   * text session (§6). Fonts are awaited before the width is auto-fitted —
   * measuring an unloaded face would fit against the fallback font.
   */
  addText: () => void
  /**
   * Apply a property patch to the selected Text object (§6). One undoable
   * step (ADR 0001) unless recordHistory is false — the family/weight
   * dropdown hover previews apply without recording, so skimming a face or
   * weight never pollutes the undo stack (§8).
   */
  commitTextProps: (patch: TextPropsPatch, recordHistory?: boolean) => void
  /**
   * Rearrange the selection's z-order (§7 Q6) — one slot forward/backward,
   * or to the very front/back. Locked objects are inert (§7 Q3) and skipped,
   * so a fully locked selection is a no-op. One undoable step per command
   * (ADR 0001).
   */
  arrangeSelection: (command: ArrangeCommand) => void
  /**
   * Align the selection (a requested addition beyond §7 Q6's control
   * surface) — top/middle/bottom vertically, left/center/right
   * horizontally. A lone object aligns to the Document; two or more align
   * relative to each other, against the selection's own bounds. Locked
   * objects are inert (§7 Q3) and skipped — neither moving nor anchoring —
   * so a fully locked selection is a no-op. One undoable step per command
   * (ADR 0001), like arrange.
   */
  alignSelection: (command: AlignCommand) => void
  /**
   * Flip the selection (§7 Q6) — horizontally or vertically, each object
   * mirroring around its own center (a toggle: applying the same command
   * again un-flips). Locked objects are inert (§7 Q3, Q7 — no flip) and
   * skipped, so a fully locked selection is a no-op. One undoable step per
   * command (ADR 0001), like arrange.
   */
  flipSelection: (command: FlipCommand) => void
  /**
   * Set the selection's opacity (§7 Q3) — one commit for the whole selection,
   * like arrange and align: locked objects are inert and skipped, so a fully
   * locked selection is a no-op. One undoable step (ADR 0001) unless
   * recordHistory is false — the slider drag preview applies without
   * recording, so dragging never pollutes the undo stack (§8).
   */
  commitOpacity: (opacity: number, recordHistory?: boolean) => void
  /**
   * Delete the selection (§13) — locked objects are skipped (§7 Q3): a mixed
   * selection keeps its locked members, a fully locked one is a no-op. One
   * undoable step (ADR 0001).
   */
  deleteSelection: () => void
  /**
   * Copy the selection to the app's internal clipboard (Ctrl+C, §13) — a
   * snapshot; nothing enters the OS clipboard. Selection is view state and
   * copy changes nothing, so it is never undoable and never serialized.
   */
  copySelection: () => void
  /**
   * Paste the clipboard (Ctrl+V, §13) — clones of the copied selection,
   * nudged down-right, landing above the source and selected. Clones are
   * fresh creations: new ids, unlocked. One undoable step (ADR 0001); a
   * no-op with an empty clipboard.
   */
  pasteSelection: () => Promise<void>
  /**
   * Lock/unlock the selection (§7 Q3) — a whole-selection toggle: a fully
   * locked selection unlocks, otherwise everything locks. Locked objects
   * stay selectable but are inert. One undoable step (ADR 0001).
   */
  toggleLock: () => void
  /**
   * Group the selection (§7 Q4) — single-level: a selection containing a
   * group flattens it first; requires ≥2 objects. The group takes the z-slot
   * of its topmost member and becomes the selection. One undoable step
   * (ADR 0001); undo restores the selection to the group by id (ADR 0003).
   */
  groupSelection: () => void
  /**
   * Ungroup the selection (§7 Q4) — every selected unlocked Group dissolves
   * in place, its children rising to the group's z-slot and becoming the
   * selection. Locked groups are inert and skipped. One undoable step
   * (ADR 0001); undo restores the selection to the group by id (ADR 0003).
   */
  ungroupSelection: () => void
  /**
   * Select every top-level object — Ctrl+A (§13). Selection is view state:
   * never undoable, never serialized.
   */
  selectAll: () => void
  /**
   * Exit the entered group — Escape outside a text session (§7 Q5, §13):
   * children stop being individually targetable and the selection clears
   * (a plain deselect when no group is entered).
   */
  exitGroup: () => void
}

const StageContext = createContext<StageContextValue | null>(null)

/**
 * True while keyboard focus is inside an editable field — the Del key is
 * native there (build spec §13): the toolbar's size/font inputs and the text
 * session's hidden textarea all keep their own Del behavior.
 */
function isEditableTarget(el: Element | null): boolean {
  if (!el) return false
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    (el as HTMLElement).isContentEditable
  )
}

/**
 * Bridge between the Fabric canvas (confined to the Stage) and the React
 * chrome (sidebar, stage toolbar). The canvas is the document's source of
 * truth; this provider only mirrors what the chrome needs and re-renders on
 * canvas events. Mounted above the Stage in the app shell.
 */
export function StageProvider({ children }: { children: ReactNode }) {
  // The stage always creates a StageCanvas; the narrower type is what the
  // provider needs (the History lives on it), and the context still exposes
  // the base Canvas to the chrome.
  const [canvas, setCanvas] = useState<StageCanvas | null>(null)
  const [selection, setSelection] = useState<FabricObject[]>([])
  const [documentSize, setDocumentSizeState] = useState({
    width: DOCUMENT_WIDTH,
    height: DOCUMENT_HEIGHT,
  })
  const [canvasProps, setCanvasPropsState] = useState({
    backgroundColor: DOCUMENT_BACKGROUND_COLOR,
    borderWidth: DOCUMENT_BORDER_WIDTH,
    borderColor: DOCUMENT_BORDER_COLOR,
  })
  const [unit, setUnit] = useState<Unit>("in")
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false })
  const [zoom, setZoomState] = useState(100)

  const registerCanvas = useCallback((next: StageCanvas | null) => {
    setCanvas(next)
    if (next) {
      setDocumentSizeState({ width: next.width, height: next.height })
      setCanvasPropsState({
        backgroundColor: (next.backgroundColor as string) || DOCUMENT_BACKGROUND_COLOR,
        borderWidth: next.borderWidth,
        borderColor: next.borderColor,
      })
    }
  }, [])

  useEffect(() => {
    if (!canvas) return
    const refresh = () => setSelection(canvas.getActiveObjects())
    canvas.on("selection:created", refresh)
    canvas.on("selection:updated", refresh)
    canvas.on("selection:cleared", refresh)
    // End of a move/resize/rotate gesture can change the shown properties.
    canvas.on("object:modified", refresh)
    refresh()
    return () => {
      canvas.off("selection:created", refresh)
      canvas.off("selection:updated", refresh)
      canvas.off("selection:cleared", refresh)
      canvas.off("object:modified", refresh)
    }
  }, [canvas])

  // The undo/redo stack's state mirrors into React for the bottom bar's ↶ ↷
  // buttons: every commit, undo, and redo fires the History's onChange.
  useEffect(() => {
    if (!canvas?.history) return
    const sync = (state: { canUndo: boolean; canRedo: boolean }) =>
      setHistoryState(state)
    const history = canvas.history
    history.onChange = sync
    sync({ canUndo: history.canUndo, canRedo: history.canRedo })
    return () => {
      history.onChange = undefined
    }
  }, [canvas])

  // The zoom mirrors into React for the bottom bar's controls (build spec
  // §9): every change notifies the canvas's `onZoomChanged` — the same
  // pattern as the History's onChange. The initial sync picks up the
  // load-time Fit, which runs before this subscription exists (the Stage's
  // mount effect runs before this one).
  useEffect(() => {
    if (!canvas) return
    const sync = () => setZoomState(canvas.getZoomPercent())
    canvas.onZoomChanged = sync
    sync()
    return () => {
      canvas.onZoomChanged = undefined
    }
  }, [canvas])

  const setZoom = useCallback(
    (percent: number) => {
      if (!canvas) return
      // Zoomed about the workspace center — the slider and presets anchor.
      canvas.setZoomPercent(percent, true)
    },
    [canvas],
  )

  const zoomIn = useCallback(() => {
    if (!canvas) return
    canvas.setZoomPercent(stepZoomPercent(canvas.getZoomPercent(), 1), true)
  }, [canvas])

  const zoomOut = useCallback(() => {
    if (!canvas) return
    canvas.setZoomPercent(stepZoomPercent(canvas.getZoomPercent(), -1), true)
  }, [canvas])

  const fitZoom = useCallback(() => {
    if (!canvas) return
    canvas.fitToWorkspace()
  }, [canvas])

  /** Re-mirror the document size and border — both are document state (§8). */
  const refreshDocumentMirrors = useCallback(
    (canvas: Canvas) => {
      setDocumentSizeState({ width: canvas.width, height: canvas.height })
      setCanvasPropsState({
        backgroundColor: (canvas.backgroundColor as string) || DOCUMENT_BACKGROUND_COLOR,
        borderWidth: canvas.borderWidth,
        borderColor: canvas.borderColor,
      })
    },
    [],
  )

  const undo = useCallback(async () => {
    if (!canvas?.history) return
    await canvas.history.undo()
    // The restore may have changed the document size or border (§8) — the
    // selection mirror updates itself through the restore's selection events.
    refreshDocumentMirrors(canvas)
  }, [canvas, refreshDocumentMirrors])

  const redo = useCallback(async () => {
    if (!canvas?.history) return
    await canvas.history.redo()
    refreshDocumentMirrors(canvas)
  }, [canvas, refreshDocumentMirrors])

  const setDocumentSize = useCallback(
    (width: number, height: number) => {
      if (!canvas?.history) return
      canvas.setDimensions({ width, height })
      setDocumentSizeState({ width, height })
      canvas.requestRenderAll()
      canvas.history.commit()
    },
    [canvas],
  )

  const addShape = useCallback(
    (kind: ShapeKind) => {
      if (!canvas?.history) return
      const obj = createShape(kind)
      canvas.add(obj)
      canvas.centerObject(obj)
      canvas.setActiveObject(obj)
      canvas.requestRenderAll()
      canvas.history.commit()
    },
    [canvas],
  )

  const addText = useCallback(() => {
    if (!canvas?.history) return
    void (async () => {
      // Auto-fit measures glyphs — only meaningful once every family is
      // loaded (§12). The preload starts at startup, so this resolves fast.
      await preloadFonts()
      const obj = createText(getTextMeasurer())
      canvas.add(obj)
      canvas.viewportCenterObject(obj)
      canvas.setActiveObject(obj)
      // The add is one undoable step (ADR 0001); the text session commits
      // its own step on exit (§8).
      canvas.history.commit()
      // Enters edit pre-selected: the user types immediately. The placeholder
      // "Text" is pre-selected so typing replaces it instead of inserting
      // before it.
      obj.enterEditing()
      obj.selectAll()
      canvas.requestRenderAll()
    })()
  }, [canvas])

  const commitCanvasProps = useCallback(
    (patch: CanvasPropsPatch, recordHistory = true) => {
      if (!canvas?.history) return
      if (patch.backgroundColor !== undefined) {
        canvas.backgroundColor = patch.backgroundColor
      }
      if (patch.borderWidth !== undefined) canvas.borderWidth = patch.borderWidth
      if (patch.borderColor !== undefined) canvas.borderColor = patch.borderColor
      canvas.requestRenderAll()
      setCanvasPropsState({
        backgroundColor: (canvas.backgroundColor as string) || DOCUMENT_BACKGROUND_COLOR,
        borderWidth: canvas.borderWidth,
        borderColor: canvas.borderColor,
      })
      // The color-picker drag preview applies without recording — only the
      // dialog close commits (ADR 0001, §8).
      if (recordHistory) canvas.history.commit()
    },
    [canvas],
  )

  const commitShapeProps = useCallback(
    (patch: ShapePropsPatch, recordHistory = true) => {
      if (!canvas?.history) return
      const obj = canvas.getActiveObjects()[0]
      if (!obj) return
      if (patch.fillColor !== undefined) setFillColor(obj, patch.fillColor)
      if (patch.borderWidth !== undefined) setBorderWidth(obj, patch.borderWidth)
      if (patch.borderColor !== undefined) setBorderColor(obj, patch.borderColor)
      canvas.requestRenderAll()
      setSelection(canvas.getActiveObjects())
      // The color-picker drag preview applies without recording — only the
      // dialog close commits (ADR 0001, §8).
      if (recordHistory) canvas.history.commit()
    },
    [canvas],
  )

  const commitTextProps = useCallback(
    (patch: TextPropsPatch, recordHistory = true) => {
      if (!canvas?.history) return
      const obj = canvas.getActiveObjects()[0]
      if (!isTextObject(obj)) return
      applyTextProps(obj, patch, getTextMeasurer())
      // A size-affecting commit (family/size/spacing) re-hugged the box — a
      // group sized to the pre-edit child would clip it (see refitParentGroup).
      refitParentGroup(obj)
      canvas.requestRenderAll()
      setSelection(canvas.getActiveObjects())
      // The family/weight dropdown hover previews apply without recording —
      // only a click is one undoable step (ADR 0001, §8).
      if (recordHistory) canvas.history.commit()
    },
    [canvas],
  )

  const arrangeSelection = useCallback(
    (command: ArrangeCommand) => {
      if (!canvas?.history) return
      arrangeObjects(canvas, canvas.getActiveObjects(), command)
      canvas.requestRenderAll()
      canvas.history.commit()
    },
    [canvas],
  )

  const alignSelection = useCallback(
    (command: AlignCommand) => {
      if (!canvas?.history) return
      alignObjects(canvas, canvas.getActiveObjects(), command)
      canvas.requestRenderAll()
      canvas.history.commit()
    },
    [canvas],
  )

  const flipSelection = useCallback(
    (command: FlipCommand) => {
      if (!canvas?.history) return
      flipObjects(canvas.getActiveObjects(), command)
      canvas.requestRenderAll()
      canvas.history.commit()
    },
    [canvas],
  )

  const commitOpacity = useCallback(
    (opacity: number, recordHistory = true) => {
      if (!canvas?.history) return
      const objects = canvas.getActiveObjects()
      if (objects.length === 0) return
      for (const obj of objects) {
        // §7 Q3: locked objects are inert — property edits skip them, like
        // arrange and delete skip them.
        if (obj.locked) continue
        setOpacity(obj, opacity)
      }
      canvas.requestRenderAll()
      setSelection(canvas.getActiveObjects())
      // The slider drag preview applies without recording — only the release
      // commits one undoable step (ADR 0001, §8).
      if (recordHistory) canvas.history.commit()
    },
    [canvas],
  )

  const deleteSelection = useCallback(() => {
    if (!canvas?.history) return
    // §7 Q3: locked objects are selectable but inert — Del skips them, so a
    // mixed selection keeps its locked members. Group children are fixed in
    // place (§7 Q5) — no delete — Ungroup first.
    const objects = canvas
      .getActiveObjects()
      .filter((obj) => !obj.locked && !isGrouped(obj))
    if (objects.length === 0) return
    canvas.discardActiveObject()
    canvas.remove(...objects)
    canvas.requestRenderAll()
    setSelection([])
    canvas.history.commit()
  }, [canvas])

  const copySelection = useCallback(() => {
    if (!canvas) return
    copyObjects(canvas)
  }, [canvas])

  const pasteSelection = useCallback(async () => {
    if (!canvas?.history) return
    // The enliven is async — the paste commits when the clones land. A
    // no-op paste (empty clipboard) commits nothing: the History's dedup
    // skips the unchanged snapshot.
    await pasteObjects(canvas, getTextMeasurer())
    canvas.history.commit()
  }, [canvas])

  const toggleLock = useCallback(() => {
    if (!canvas?.history) return
    const objects = canvas.getActiveObjects()
    if (objects.length === 0) return
    // Whole-selection toggle (§7 Q3): a fully locked selection unlocks,
    // otherwise everything locks. The canvas's setLocked re-applies the
    // entered-fixed surface to a child unlocked inside its group (§7 Q5).
    const locked = !objects.every((obj) => obj.locked)
    for (const obj of objects) canvas.setLocked(obj, locked)
    canvas.requestRenderAll()
    setSelection(canvas.getActiveObjects())
    canvas.history.commit()
  }, [canvas])

  const groupSelection = useCallback(() => {
    if (!canvas?.history) return
    const objects = canvas.getActiveObjects()
    // Grouping the entered group itself (Ctrl+A selects it along with
    // everything else) dissolves it mid-command — exit first so the
    // children's fixed surface is restored before the regroup (§7 Q5).
    if (canvas.enteredGroup && objects.includes(canvas.enteredGroup)) {
      canvas.exitEnteredGroup()
    }
    const group = groupObjects(canvas, objects, getTextMeasurer())
    if (!group) return
    canvas.setActiveObject(group)
    canvas.requestRenderAll()
    canvas.history.commit()
  }, [canvas])

  const ungroupSelection = useCallback(() => {
    if (!canvas?.history) return
    const children = ungroupObjects(canvas, canvas.getActiveObjects(), getTextMeasurer())
    if (children.length === 0) return
    // Ungrouping the entered group exits it — the group reference dies with
    // the command, and the fixed child state must not linger (§7 Q5). Runs
    // after the extraction so the exit's re-fix finds the children.
    if (canvas.enteredGroup) canvas.exitEnteredGroup()
    // The extracted children are the result of the command — the selection
    // lands on them (§7 Q4); a single child selects alone.
    if (children.length === 1) canvas.setActiveObject(children[0])
    else canvas.setActiveObject(new ActiveSelection(children, { canvas }))
    canvas.requestRenderAll()
    canvas.history.commit()
  }, [canvas])

  const selectAll = useCallback(() => {
    if (!canvas) return
    const objects = canvas.getObjects()
    if (objects.length === 0) return
    // Selection is view state (§4) — the whole top level, groups counting as
    // one object; locked objects are selectable and included.
    if (objects.length === 1) canvas.setActiveObject(objects[0])
    else canvas.setActiveObject(new ActiveSelection(objects, { canvas }))
    canvas.requestRenderAll()
  }, [canvas])

  const exitGroup = useCallback(() => {
    if (!canvas) return
    canvas.exitEnteredGroup()
  }, [canvas])

  // Undo/redo hotkeys (§13): Ctrl+Z / Ctrl+Y walk the document-state stack.
  // The editable gate keeps Ctrl+Z field-local inside a text session — the
  // hidden textarea's native undo handles it, and the session commits only
  // on exit (§6), so the stack is never touched mid-session.
  useEffect(() => {
    if (!canvas) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "z" && event.key !== "y") return
      if (!event.ctrlKey && !event.metaKey) return
      if (event.altKey) return
      if (isEditableTarget(document.activeElement)) return
      event.preventDefault()
      if (event.key === "z") void undo()
      else void redo()
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [canvas, undo, redo])

  // Zoom hotkeys (§9, §13): Ctrl+= / Ctrl+− step ±10% about the workspace
  // center, Ctrl+0 fits. Deliberately not gated on editable fields — the
  // browser's page zoom (Ctrl+= / Ctrl+−) must not reach the app layout, and
  // no field has a zoom meaning for the keys.
  useEffect(() => {
    if (!canvas) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      if (event.key === "=" || event.key === "+") {
        event.preventDefault()
        zoomIn()
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault()
        zoomOut()
      } else if (event.key === "0") {
        event.preventDefault()
        fitZoom()
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [canvas, zoomIn, zoomOut, fitZoom])

  // Del / Backspace deletes the selection (§13), skipping locked objects
  // (§7 Q3). Keyed on the document so it fires from anywhere on the stage;
  // the editable gate keeps the keys native in the toolbar's fields and the
  // text session's hidden textarea.
  useEffect(() => {
    if (!canvas) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (isEditableTarget(document.activeElement)) return
      deleteSelection()
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [canvas, deleteSelection])

  // Copy/paste hotkeys (§13): Ctrl+C copies the selection to the app's
  // internal clipboard, Ctrl+V pastes clones of it — nudged down-right,
  // above the source, selected, one undoable step. The editable gate keeps
  // the keys native in the toolbar's fields and the text session's hidden
  // textarea (text copy/paste inside a session).
  useEffect(() => {
    if (!canvas) return
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      if (key !== "c" && key !== "v") return
      if (!event.ctrlKey && !event.metaKey) return
      if (event.altKey) return
      if (isEditableTarget(document.activeElement)) return
      event.preventDefault()
      if (key === "c") copySelection()
      else void pasteSelection()
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [canvas, copySelection, pasteSelection])

  // Arrange hotkeys (§13): Ctrl+] / Ctrl+[ step the selection forward /
  // backward, Ctrl+Shift+] / Ctrl+Shift+[ move it to the very front / back.
  // Keyed on `code` (BracketLeft/Right), not `key` — Shift rewrites the key
  // to "{" / "}" on US layouts, and other layouts shift the bracket
  // entirely; the code is the physical bracket either way. The editable gate
  // keeps the keys native in the toolbar's fields, like Del.
  useEffect(() => {
    if (!canvas) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "BracketRight" && event.code !== "BracketLeft") return
      if (!event.ctrlKey && !event.metaKey) return
      if (event.altKey) return
      if (isEditableTarget(document.activeElement)) return
      const command: ArrangeCommand =
        event.code === "BracketRight"
          ? event.shiftKey
            ? "to-front"
            : "forward"
          : event.shiftKey
            ? "to-back"
            : "backward"
      arrangeSelection(command)
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [canvas, arrangeSelection])

  // Group / ungroup hotkeys (§13): Ctrl+G / Ctrl+Shift+G. The editable gate
  // keeps the keys native in the toolbar's fields and the text session, like
  // Del; the shift key distinguishes the pair.
  useEffect(() => {
    if (!canvas) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "g") return
      if (!event.ctrlKey && !event.metaKey) return
      if (event.altKey) return
      if (isEditableTarget(document.activeElement)) return
      event.preventDefault()
      if (event.shiftKey) ungroupSelection()
      else groupSelection()
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [canvas, groupSelection, ungroupSelection])

  // Select all hotkey (§13): Ctrl+A — the whole top level, groups counting
  // as one. Selection is view state — never an undoable step. The editable
  // gate keeps Ctrl+A field-local in the toolbar's inputs and the text
  // session's textarea (native select-all).
  useEffect(() => {
    if (!canvas) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "a") return
      if (!event.ctrlKey && !event.metaKey) return
      if (event.altKey) return
      if (isEditableTarget(document.activeElement)) return
      event.preventDefault()
      selectAll()
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [canvas, selectAll])

  // Escape deselects — and exits the entered group (§13) — outside a text
  // session. The editable gate covers the session's hidden textarea, where
  // Escape reverts the session natively (§6) and must not reach the stage.
  useEffect(() => {
    if (!canvas) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      if (isEditableTarget(document.activeElement)) return
      exitGroup()
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [canvas, exitGroup])

  return (
    <StageContext.Provider
      value={{
        canvas,
        registerCanvas,
        canUndo: historyState.canUndo,
        canRedo: historyState.canRedo,
        undo,
        redo,
        selection,
        documentSize,
        setDocumentSize,
        canvasProps,
        commitCanvasProps,
        unit,
        setUnit,
        zoom,
        setZoom,
        zoomIn,
        zoomOut,
        fitZoom,
        addShape,
        commitShapeProps,
        addText,
        commitTextProps,
        arrangeSelection,
        alignSelection,
        flipSelection,
        commitOpacity,
        deleteSelection,
        copySelection,
        pasteSelection,
        toggleLock,
        groupSelection,
        ungroupSelection,
        selectAll,
        exitGroup,
      }}
    >
      {children}
    </StageContext.Provider>
  )
}

export function useStage(): StageContextValue {
  const ctx = useContext(StageContext)
  if (!ctx) throw new Error("useStage must be used within a StageProvider")
  return ctx
}
