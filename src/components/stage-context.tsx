import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import type { Canvas, Object as FabricObject } from "fabric"

import { getTextMeasurer, preloadFonts } from "@/fabric/fonts"
import {
  alignObjects,
  type AlignCommand,
} from "@/fabric/align"
import {
  arrangeObjects,
  type ArrangeCommand,
} from "@/fabric/arrange"
import { flipObjects, type FlipCommand } from "@/fabric/flip"
import {
  DOCUMENT_BACKGROUND_COLOR,
  DOCUMENT_BORDER_COLOR,
  DOCUMENT_BORDER_WIDTH,
  DOCUMENT_HEIGHT,
  DOCUMENT_WIDTH,
} from "@/fabric/stage-canvas"
import {
  createShape,
  setBorderColor,
  setBorderWidth,
  setFillColor,
} from "@/fabric/shapes"
import { setLocked, setOpacity } from "@/fabric/document-props"
import type { ShapeKind } from "@/fabric/shapes"
import {
  applyTextProps,
  createText,
  isTextObject,
  type TextPropsPatch,
} from "@/fabric/text"
import type { Unit } from "@/lib/units"

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
  registerCanvas: (canvas: Canvas | null) => void
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
  /** Apply a property patch to the Document (§5). */
  commitCanvasProps: (patch: CanvasPropsPatch) => void
  /** Active display unit — a label swap over stored px (§5). */
  unit: Unit
  setUnit: (unit: Unit) => void
  /** Add a shape of the given kind, centered and selected (§5). */
  addShape: (kind: ShapeKind) => void
  /** Apply a property patch to the selected shape (§5). */
  commitShapeProps: (patch: ShapePropsPatch) => void
  /**
   * Add a Text object at the viewport center, selected and already in its
   * text session (§6). Fonts are awaited before the width is auto-fitted —
   * measuring an unloaded face would fit against the fallback font.
   */
  addText: () => void
  /** Apply a property patch to the selected Text object (§6). */
  commitTextProps: (patch: TextPropsPatch) => void
  /**
   * Rearrange the selection's z-order (§7 Q6) — one slot forward/backward,
   * or to the very front/back. Locked objects are inert (§7 Q3) and skipped,
   * so a fully locked selection is a no-op. One undoable step per command
   * when the undo build lands (ADR 0001).
   */
  arrangeSelection: (command: ArrangeCommand) => void
  /**
   * Align the selection (a requested addition beyond §7 Q6's control
   * surface) — top/middle/bottom vertically, left/center/right
   * horizontally. A lone object aligns to the Document; two or more align
   * relative to each other, against the selection's own bounds. Locked
   * objects are inert (§7 Q3) and skipped — neither moving nor anchoring —
   * so a fully locked selection is a no-op. One undoable step per command
   * when the undo build lands (ADR 0001), like arrange.
   */
  alignSelection: (command: AlignCommand) => void
  /**
   * Flip the selection (§7 Q6) — horizontally or vertically, each object
   * mirroring around its own center (a toggle: applying the same command
   * again un-flips). Locked objects are inert (§7 Q3, Q7 — no flip) and
   * skipped, so a fully locked selection is a no-op. One undoable step per
   * command when the undo build lands (ADR 0001), like arrange.
   */
  flipSelection: (command: FlipCommand) => void
  /**
   * Set the selection's opacity (§7 Q3) — one commit for the whole selection,
   * like arrange and align: locked objects are inert and skipped, so a fully
   * locked selection is a no-op. One undoable step per commit when the undo
   * build lands (ADR 0001), like arrange.
   */
  commitOpacity: (opacity: number) => void
  /**
   * Delete the selection (§13) — locked objects are skipped (§7 Q3): a mixed
   * selection keeps its locked members, a fully locked one is a no-op.
   */
  deleteSelection: () => void
  /**
   * Lock/unlock the selection (§7 Q3) — a whole-selection toggle: a fully
   * locked selection unlocks, otherwise everything locks. Locked objects
   * stay selectable but are inert.
   */
  toggleLock: () => void
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
  const [canvas, setCanvas] = useState<Canvas | null>(null)
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

  const registerCanvas = useCallback((next: Canvas | null) => {
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

  const setDocumentSize = useCallback(
    (width: number, height: number) => {
      if (!canvas) return
      canvas.setDimensions({ width, height })
      setDocumentSizeState({ width, height })
      canvas.requestRenderAll()
    },
    [canvas],
  )

  const addShape = useCallback(
    (kind: ShapeKind) => {
      if (!canvas) return
      const obj = createShape(kind)
      canvas.add(obj)
      canvas.centerObject(obj)
      canvas.setActiveObject(obj)
      canvas.requestRenderAll()
    },
    [canvas],
  )

  const addText = useCallback(() => {
    if (!canvas) return
    void (async () => {
      // Auto-fit measures glyphs — only meaningful once every family is
      // loaded (§12). The preload starts at startup, so this resolves fast.
      await preloadFonts()
      const obj = createText(getTextMeasurer())
      canvas.add(obj)
      canvas.viewportCenterObject(obj)
      canvas.setActiveObject(obj)
      // Enters edit pre-selected: the user types immediately. The placeholder
      // "Text" is pre-selected so typing replaces it instead of inserting
      // before it.
      obj.enterEditing()
      obj.selectAll()
      canvas.requestRenderAll()
    })()
  }, [canvas])

  const commitCanvasProps = useCallback(
    (patch: CanvasPropsPatch) => {
      if (!canvas) return
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
    },
    [canvas],
  )

  const commitShapeProps = useCallback(
    (patch: ShapePropsPatch) => {
      if (!canvas) return
      const obj = canvas.getActiveObjects()[0]
      if (!obj) return
      if (patch.fillColor !== undefined) setFillColor(obj, patch.fillColor)
      if (patch.borderWidth !== undefined) setBorderWidth(obj, patch.borderWidth)
      if (patch.borderColor !== undefined) setBorderColor(obj, patch.borderColor)
      canvas.requestRenderAll()
      setSelection(canvas.getActiveObjects())
    },
    [canvas],
  )

  const commitTextProps = useCallback(
    (patch: TextPropsPatch) => {
      if (!canvas) return
      const obj = canvas.getActiveObjects()[0]
      if (!isTextObject(obj)) return
      applyTextProps(obj, patch, getTextMeasurer())
      canvas.requestRenderAll()
      setSelection(canvas.getActiveObjects())
    },
    [canvas],
  )

  const arrangeSelection = useCallback(
    (command: ArrangeCommand) => {
      if (!canvas) return
      arrangeObjects(canvas, canvas.getActiveObjects(), command)
      canvas.requestRenderAll()
    },
    [canvas],
  )

  const alignSelection = useCallback(
    (command: AlignCommand) => {
      if (!canvas) return
      alignObjects(canvas, canvas.getActiveObjects(), command)
      canvas.requestRenderAll()
    },
    [canvas],
  )

  const flipSelection = useCallback(
    (command: FlipCommand) => {
      if (!canvas) return
      flipObjects(canvas.getActiveObjects(), command)
      canvas.requestRenderAll()
    },
    [canvas],
  )

  const commitOpacity = useCallback(
    (opacity: number) => {
      if (!canvas) return
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
    },
    [canvas],
  )

  const deleteSelection = useCallback(() => {
    if (!canvas) return
    // §7 Q3: locked objects are selectable but inert — Del skips them, so a
    // mixed selection keeps its locked members.
    const objects = canvas.getActiveObjects().filter((obj) => !obj.locked)
    if (objects.length === 0) return
    canvas.discardActiveObject()
    canvas.remove(...objects)
    canvas.requestRenderAll()
    setSelection([])
  }, [canvas])

  const toggleLock = useCallback(() => {
    if (!canvas) return
    const objects = canvas.getActiveObjects()
    if (objects.length === 0) return
    // Whole-selection toggle (§7 Q3): a fully locked selection unlocks,
    // otherwise everything locks.
    const locked = !objects.every((obj) => obj.locked)
    for (const obj of objects) setLocked(obj, locked)
    canvas.requestRenderAll()
    setSelection(canvas.getActiveObjects())
  }, [canvas])

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

  return (
    <StageContext.Provider
      value={{
        canvas,
        registerCanvas,
        selection,
        documentSize,
        setDocumentSize,
        canvasProps,
        commitCanvasProps,
        unit,
        setUnit,
        addShape,
        commitShapeProps,
        addText,
        commitTextProps,
        arrangeSelection,
        alignSelection,
        flipSelection,
        commitOpacity,
        deleteSelection,
        toggleLock,
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
