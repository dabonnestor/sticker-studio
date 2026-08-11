import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import type { Canvas, Object as FabricObject } from "fabric"

import { DOCUMENT_HEIGHT, DOCUMENT_WIDTH } from "@/fabric/stage-canvas"
import {
  createStickerShape,
  setBorderColor,
  setBorderWidth,
  setFillColor,
} from "@/fabric/shapes"
import type { StickerShapeKind } from "@/fabric/shapes"
import type { Unit } from "@/lib/units"

/** A shape-property commit against the selected sticker (build spec §5). */
export interface ShapePropsPatch {
  /** Background (fill) color. */
  fillColor?: string
  /** Border width in px (0 = off). */
  borderWidth?: number
  /** Border color. */
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
  /** Active display unit — a label swap over stored px (§5). */
  unit: Unit
  setUnit: (unit: Unit) => void
  /** Add a sticker of the given kind, centered and selected (§5). */
  addShape: (kind: StickerShapeKind) => void
  /** Apply a property patch to the selected sticker (§5). */
  commitShapeProps: (patch: ShapePropsPatch) => void
}

const StageContext = createContext<StageContextValue | null>(null)

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
  const [unit, setUnit] = useState<Unit>("in")

  const registerCanvas = useCallback((next: Canvas | null) => {
    setCanvas(next)
    if (next) setDocumentSizeState({ width: next.width, height: next.height })
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
    (kind: StickerShapeKind) => {
      if (!canvas) return
      const obj = createStickerShape(kind)
      canvas.add(obj)
      canvas.centerObject(obj)
      canvas.setActiveObject(obj)
      canvas.requestRenderAll()
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

  return (
    <StageContext.Provider
      value={{
        canvas,
        registerCanvas,
        selection,
        documentSize,
        setDocumentSize,
        unit,
        setUnit,
        addShape,
        commitShapeProps,
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
