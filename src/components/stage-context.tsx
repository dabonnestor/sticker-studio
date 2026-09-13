import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { ActiveSelection, type Canvas, type Object as FabricObject } from "fabric"

import {
  clearWorkingDraft,
  DRAFT_CHAR_CEILING,
  persistWorkingDraft,
} from "@/fabric/auto-persist"
import {
  createCatalog,
  type Artwork,
  type Catalog,
} from "@/fabric/catalog"
import { createPixabayCatalog } from "@/fabric/pixabay-catalog"
import { createUnsplashCatalog } from "@/fabric/unsplash-catalog"
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
import { BOOT_OUTLINE } from "@/fabric/outline"
import {
  DOCUMENT_BACKGROUND_COLOR,
  DOCUMENT_BORDER_COLOR,
  DOCUMENT_BORDER_WIDTH,
  DOCUMENT_HEIGHT,
  DOCUMENT_ROTATION,
  DOCUMENT_WIDTH,
  type StageCanvas,
} from "@/fabric/stage-canvas"
import {
  createShape,
  setBorderColor,
  setBorderWidth,
  setFillColor,
} from "@/fabric/shapes"
import { createArtworkImage, createImageFromDataURL } from "@/fabric/images"
import {
  createGalleryCopy,
  readRecentUploads,
  recordRecentUpload,
  removeStoredUpload,
  type RecentUpload,
} from "@/fabric/recent-uploads"
import { setOpacity } from "@/fabric/document-props"
import {
  SvgRasterizeError,
  isSvgFile,
  svgTypedFile,
} from "@/fabric/svg-import"
import type { ShapeKind } from "@/fabric/shapes"
import {
  applyTextProps,
  createText,
  isTextObject,
  type TextPropsPatch,
} from "@/fabric/text"
import {
  designFileBasename,
  loadEnvelope,
  parseDesignFile,
  serializeDesignFile,
} from "@/fabric/design-file"
import {
  loadPredesign,
  type Predesign,
} from "@/fabric/designs"
import {
  exportDocument,
  getExportHost,
  type ExportFormat,
} from "@/fabric/export"
import type { Unit } from "@/lib/units"
import { stepDocumentRotation, stepZoomPercent } from "@/fabric/zoom"

/**
 * The app's two Catalogs (map #34, ticket #39) — the Graphics panel's Pixabay
 * source and the Images panel's Unsplash source, each behind the thin facade.
 * The panels and Insert search and embed through these; a provider swap
 * touches only these lines (ticket #39's "the caller does not know the
 * shape").
 */
const graphicsCatalog = createCatalog(createPixabayCatalog())
const imageCatalog = createCatalog(createUnsplashCatalog())

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
  /**
   * The Document rotation in degrees (§10) — document state: one undoable
   * step per rotate, envelope-owned, honored by export; the stage displays
   * cardinal rotations.
   */
  rotation: number
  /**
   * Rotate the Document ±90° (§10) — the rotate-canvas control. Document
   * state: the rotate is ONE undoable step (ADR 0001), like a size or border
   * commit.
   */
  rotateDocument: (direction: 1 | -1) => void
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
   * Add an uploaded image at the document center, fit to the Document and
   * selected (§1 — the sidebar's Uploads). The data URL decodes
   * asynchronously before the add lands; the placement is still ONE undoable
   * step (ADR 0001), like a shape add. A corrupt or undecodable image
   * reports loud in the status area and changes nothing.
   */
  addImage: (dataURL: string) => Promise<void>
  /**
   * The recent-uploads gallery (the sidebar's Uploads panel): the persisted,
   * deduped list of images uploaded or pasted this session and before,
   * newest first. Shared by both intake paths — the panel's file picker and
   * a pasted clipboard image — so either way into the Document lands in the
   * same gallery.
   */
  recentUploads: RecentUpload[]
  /**
   * Record an image into the recent-uploads gallery — the gallery side of an
   * upload or paste: make the downscaled copy, merge it into the shared
   * list, and persist. The placement itself (addImage) is the caller's job;
   * a copy refused as over the size guard is reported through the status
   * area, since the image itself was already placed.
   */
  addRecentUpload: (dataURL: string, name: string) => Promise<void>
  /**
   * Remove an image from the recent-uploads gallery — the inverse of
   * {@link addRecentUpload}: drops the tile (and its stored copy) from the
   * shared list and persists. Silent — the tile vanishing from the grid is
   * feedback enough. The Document is untouched — the placed image stays on
   * the canvas; only the gallery entry goes.
   */
  removeRecentUpload: (dataURL: string) => void
  /**
   * The app's Catalogs (map #34, ticket #39) — the Graphics panel's Pixabay
   * source and the Images panel's Unsplash source. The provider seam is
   * internal: the panels never know a provider's shape.
   */
  graphicsCatalog: Catalog
  /** The Images panel's catalog — photographs from Unsplash. */
  imageCatalog: Catalog
  /**
   * Insert an Artwork as an ordinary Image, fitted and centered (ticket #40,
   * #42) — embed its full-resolution bytes self-containedly, stamp its
   * provenance and preset name, one undoable step. An image that would push
   * the Document past the self-containment ceiling is refused with a clear
   * message and nothing is inserted (#42). Resolves true on a successful
   * insert, false when refused or failed — the panel decides its Inserted
   * line from it. The embed goes through the catalog the artwork was searched
   * with — the panel passes the catalog it holds.
   */
  insertArtwork: (artwork: Artwork, catalog: Catalog) => Promise<boolean>
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
  /**
   * Save the current Document as a Design file (§10) — flushes any pending
   * text edit first (the same step as export), serializes the envelope, and
   * downloads `<basename>.json` (untitled fallback). Never an undoable step.
   */
  saveDesignFile: () => void
  /**
   * Export the current Document as the given format (build spec §11) —
   * flushes any pending text edit first (the same step as save), serializes
   * the committed Document, and runs the shared export pipeline (offscreen
   * render, font wait, 8192-px ceiling, per-format download). Reports
   * "Preparing export…" while working and the finished filename (or a clear
   * error) in the status area. Export never records an undoable step and
   * never mutates the Document or history.
   */
  exportCurrent: (format: ExportFormat) => Promise<void>
  /**
   * Import a Design file (§10) — reads the text, validates loudly (unknown
   * types / bad envelope rejected with a clear error in the status area,
   * nothing changed), strips the envelope, and `loadFromJSON` the payload as
   * one undoable step. Undo restores the pre-import Document. Sets the
   * design-file basename from the imported file's name (round-trips Save).
   */
  importDesignFile: (file: { name: string; text: () => Promise<string> }) => Promise<void>
  /**
   * Apply a predesign (the sidebar's Designs panel) — the import path with
   * the file picker replaced by a fetch: the design is fetched and validated
   * loudly (ADR 0002), then loaded as ONE undoable step, exactly like an
   * import. The working file's basename follows the design, so Save
   * round-trips to the same name. A fetch or validation failure reports
   * clearly and changes nothing.
   */
  insertPredesign: (predesign: Predesign) => Promise<void>
  /** The current working file's basename — Save round-trips it (untitled default). */
  designFileName: string
  /**
   * The current bottom-bar status message — save/import progress and errors
   * (ADR 0002's "validates loudly"). Survives until the next report.
   */
  status: string
  /**
   * Surface a transient message in the bottom-bar status area — save/import
   * progress and errors (ADR 0002's "validates loudly"). The next report (or
   * the caller) replaces it.
   */
  reportStatus: (message: string) => void
  /**
   * Preview mode (§3 <Eye> button) — true when the sidebar and stage toolbar
   * are hidden so the canvas fills the width. View state, not document state:
   * never serialized, never an undoable step.
   */
  preview: boolean
  /** Toggle {@link preview} on the Eye button (state flips, chrome reflows). */
  togglePreview: () => void
  /**
   * Start a new design (ticket #33) — the auto-persist escape hatch, in the
   * top-bar File area. Clears the stored working draft (so a refresh boots
   * blank, not the resumed design), resets the canvas to a fresh factory-
   * default sheet (default size, no objects, border off, rotation 0, white
   * background), resets the design-file name to untitled, and clears the
   * undo stack. Scoped to the draft and the canvas — manual Save/Import/
   * Export are unaffected.
   */
  startNewDesign: () => void
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
  // The Document rotation in degrees (§10) — document state like size and the
  // border: undoable, envelope-owned, exported; mirrored so the toolbar's
  // rotate control reads and steps it.
  const [rotation, setRotationState] = useState(DOCUMENT_ROTATION)
  // The current working file's basename (§10) — defaults to untitled; an
  // import sets it from the file's name so Save round-trips the same file.
  const [designFileName, setDesignFileName] = useState("untitled")
  // The transient bottom-bar status message — save/import progress and errors.
  const [status, setStatus] = useState("Ready")
  // The recent-uploads gallery (map: the Uploads panel) — the persisted,
  // deduped list of images uploaded or pasted, seeded from storage so it
  // survives refresh like the working draft.
  const [recentUploads, setRecentUploads] = useState<RecentUpload[]>(() =>
    readRecentUploads(),
  )
  // The gallery's truth for the merge path: a ref mirror (the CatalogPanel's
  // queryRef pattern). Two intake paths (an upload and a paste) can complete
  // their copies out of order; merging against this ref instead of the async
  // state value keeps each merge up to date.
  const recentUploadsRef = useRef(recentUploads)
  // Preview mode (§3 <Eye> button) — hidden sidebar/toolbar, full-width
  // canvas. View state, never serialized, never an undoable step.
  const [preview, setPreview] = useState(false)

  const registerCanvas = useCallback((next: StageCanvas | null) => {
    setCanvas(next)
    if (next) {
      setDocumentSizeState({ width: next.width, height: next.height })
      setCanvasPropsState({
        backgroundColor: (next.backgroundColor as string) || DOCUMENT_BACKGROUND_COLOR,
        borderWidth: next.borderWidth,
        borderColor: next.borderColor,
      })
      setRotationState(next.getRotation())
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

  // The Document rotation mirrors into React for the toolbar's rotate control
  // (build spec §10) — the same `onZoomChanged` pattern. The rotate control
  // calls `setRotation`, which fires this; undo/redo and import refresh it
  // through `refreshDocumentMirrors` (the restore paths set `canvas.rotation`
  // directly).
  useEffect(() => {
    if (!canvas) return
    const sync = () => setRotationState(canvas.getRotation())
    canvas.onRotationChanged = sync
    sync()
    return () => {
      canvas.onRotationChanged = undefined
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

  const rotateDocument = useCallback(
    (direction: 1 | -1) => {
      if (!canvas?.history) return
      // Step ±90° through the four cardinals; setRotation re-lays-out the
      // rotated viewport and fires the mirror. One undoable step per click
      // (ADR 0001) — the History's dedup makes a no-op wrap a no-op.
      canvas.setRotation(stepDocumentRotation(canvas.getRotation(), direction))
      canvas.history.commit()
    },
    [canvas],
  )

  /** Re-mirror the document size, border, and rotation — document state (§8). */
  const refreshDocumentMirrors = useCallback(
    (canvas: Canvas) => {
      setDocumentSizeState({ width: canvas.width, height: canvas.height })
      setCanvasPropsState({
        backgroundColor: (canvas.backgroundColor as string) || DOCUMENT_BACKGROUND_COLOR,
        borderWidth: canvas.borderWidth,
        borderColor: canvas.borderColor,
      })
      setRotationState(canvas.rotation)
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
      // The canvas owns the aspect lock (map #48) and resolves the size — on a
      // Square or Circle the typed axis moves the other with it. The mirrors
      // re-read what the canvas settled on, so the fields show the locked
      // size rather than the one that was typed into them.
      canvas.setDocumentSize(width, height)
      setDocumentSizeState({ width: canvas.width, height: canvas.height })
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

  const reportStatus = useCallback((message: string) => {
    setStatus(message)
  }, [])

  // Auto-persist (map #27, tickets #31–#33): every real document commit — the
  // same interaction boundaries the History records — writes the working
  // draft to browser storage. Undo/redo restores and suppressed recording are
  // not user commits, so they never write; zoom/pan/selection never reach a
  // commit. The blank-guard and the size ceiling live in persistWorkingDraft.
  useEffect(() => {
    if (!canvas?.history) return
    canvas.history.onCommit = () => persistWorkingDraft(canvas, reportStatus)
    return () => {
      canvas.history.onCommit = undefined
    }
  }, [canvas, reportStatus])

  /** Toggle preview mode on the <Eye> button — see {@link preview}. */
  const togglePreview = useCallback(() => {
    setPreview((current) => !current)
  }, [])

  const startNewDesign = useCallback(() => {
    if (!canvas?.history) return
    // Ticket #33: the escape hatch. Clearing the draft first means a refresh
    // boots blank — not the resumed design — and the reset's own History
    // commit below is blank-guarded (a factory-fresh sheet is never written).
    clearWorkingDraft()
    canvas.discardActiveObject()
    canvas.remove(...canvas.getObjects())
    canvas.setDimensions({ width: DOCUMENT_WIDTH, height: DOCUMENT_HEIGHT })
    canvas.rotation = DOCUMENT_ROTATION
    canvas.borderWidth = DOCUMENT_BORDER_WIDTH
    canvas.borderColor = DOCUMENT_BORDER_COLOR
    canvas.backgroundColor = DOCUMENT_BACKGROUND_COLOR
    // The outline resets with the other document properties (map #48) — a
    // fresh sheet is the boot sticker preset, not whatever shape the design
    // being cleared was.
    canvas.outline = BOOT_OUTLINE.outline
    canvas.aspectLocked = BOOT_OUTLINE.aspectLocked
    canvas.requestRenderAll()
    // Fit is the default zoom on load (§9) — a fresh design shows the whole
    // default sheet, whatever zoom the previous design left behind (a fit
    // zoom for a smaller sheet would otherwise carry over). View state: never
    // an undoable step, like every zoom.
    canvas.fitToWorkspace()
    // The undo stack clears with the design — a fresh sheet has no history,
    // so undo stays dead until the first new edit (ticket #33).
    canvas.history.reset()
    // A fresh design is untitled — the imported name must not round-trip
    // through Save (§10).
    setDesignFileName("untitled")
    refreshDocumentMirrors(canvas)
    reportStatus("Started a new design")
  }, [canvas, refreshDocumentMirrors, reportStatus, setDesignFileName])

  const addImage = useCallback(
    async (dataURL: string) => {
      if (!canvas?.history) return
      try {
        // The load decodes the data URL asynchronously — the add lands when
        // the pixels exist, so the placement is one atomic undoable step. An
        // SVG data URL is rasterized here (svg-import.ts), so the vector's
        // own placement failure carries its specific, actionable message.
        const obj = await createImageFromDataURL(dataURL, canvas.width, canvas.height)
        canvas.add(obj)
        canvas.centerObject(obj)
        canvas.setActiveObject(obj)
        canvas.requestRenderAll()
        // The add is one undoable step (ADR 0001), like a shape add (§5).
        canvas.history.commit()
      } catch (error) {
        // Validates loudly (ADR 0002) — a corrupt or undecodable image
        // changes nothing and explains itself in the status area. An SVG
        // failure (decode, blank raster) says what went wrong instead of the
        // generic refusal.
        reportStatus(
          error instanceof SvgRasterizeError
            ? error.message
            : "That image couldn't be loaded",
        )
      }
    },
    [canvas, reportStatus],
  )

  // The gallery side of an upload or paste — the placement (addImage) is the
  // caller's. Makes the downscaled storage copy (falling back to the original
  // bytes when the copy can't be made), merges it into the shared list via the
  // ref mirror, and persists. A copy over the size guard is refused with the
  // status area explaining — the image itself was already placed, so only the
  // gallery entry (which the caller cannot see yet) needs the notice.
  const addRecentUpload = useCallback(
    async (dataURL: string, name: string) => {
      const copy = (await createGalleryCopy(dataURL)) ?? dataURL
      const recorded = recordRecentUpload(copy, name, recentUploadsRef.current)
      if (!recorded) {
        reportStatus("That image was added but it's too large for the recent-uploads gallery")
        return
      }
      recentUploadsRef.current = recorded
      setRecentUploads(recorded)
    },
    [reportStatus],
  )

  // The gallery-side inverse of addRecentUpload: drop the entry from the
  // shared list (via the ref mirror, like the add path) and persist. The
  // removal is silent — no status note, unlike the add path's loud refusal —
  // because the tile vanishing from the grid is feedback enough.
  const removeRecentUpload = useCallback(
    (dataURL: string) => {
      const next = removeStoredUpload(dataURL, recentUploadsRef.current)
      recentUploadsRef.current = next
      setRecentUploads(next)
    },
    [],
  )

  // Paste an external clipboard image (a screenshot or a picture copied from
  // another app) into the canvas. The clicked/stuck path is the same as an
  // uploaded file (§1): read the Blob to a data URL and hand it to addImage,
  // which loads, fits to the Document, centers, selects, and commits one
  // undoable step — and record it into the recent-uploads gallery, exactly
  // like a manually uploaded file, so a pasted image can be re-placed from
  // the Uploads panel later.
  const pasteImageFile = useCallback(
    (file: File | null) => {
      if (!file || (!file.type.startsWith("image/") && !isSvgFile(file))) return
      const imgFile = svgTypedFile(file)
      const reader = new FileReader()
      reader.onerror = () => reportStatus("Couldn't read that pasted image")
      reader.onload = () => {
        const dataURL = reader.result
        if (typeof dataURL !== "string") return
        void addImage(dataURL)
        void addRecentUpload(dataURL, imgFile.name || "Pasted image")
      }
      // An SVG pasted with an empty MIME re-types first, so its data URL
      // carries the recognizable `image/svg+xml` prefix (svg-import.ts).
      reader.readAsDataURL(imgFile)
    },
    [addImage, addRecentUpload, reportStatus],
  )

  const insertArtwork = useCallback(
    async (artwork: Artwork, catalog: Catalog): Promise<boolean> => {
      if (!canvas?.history) return false
      try {
        // The embed fetches the artwork's full-resolution bytes and returns
        // them self-contained — the Insert lands only when the pixels exist,
        // so the placement is one atomic undoable step (#42). The embed goes
        // through the catalog the artwork was searched with.
        const dataURL = await catalog.embed(artwork)
        const obj = await createArtworkImage(dataURL, canvas.width, canvas.height, {
          source: artwork.source,
          title: artwork.title,
          url: artwork.sourceUrl,
          license: artwork.license,
        })
        canvas.add(obj)
        canvas.centerObject(obj)
        // Self-containment ceiling (#42): the whole design must persist within
        // the ~3.5M-char ceiling. A placement that would break that deadline is
        // refused here — nothing is inserted — with a clear notice, instead of
        // a Document the app then couldn't save.
        if (
          JSON.stringify(serializeDesignFile(canvas)).length > DRAFT_CHAR_CEILING
        ) {
          canvas.remove(obj)
          canvas.requestRenderAll()
          reportStatus(
            "That artwork is too large to save into this design — nothing was inserted",
          )
          return false
        }
        canvas.setActiveObject(obj)
        canvas.requestRenderAll()
        // One undoable step (ADR 0001), like an uploaded image (§1, #40).
        canvas.history.commit()
        return true
      } catch {
        // Provider-down or an undecodable embed — loud, nothing changed.
        reportStatus("That artwork couldn't be inserted")
        return false
      }
    },
    [canvas, reportStatus],
  )

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
    await pasteObjects(canvas)
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
    const group = groupObjects(canvas, objects)
    if (!group) return
    canvas.setActiveObject(group)
    canvas.requestRenderAll()
    canvas.history.commit()
  }, [canvas])

  const ungroupSelection = useCallback(() => {
    if (!canvas?.history) return
    const children = ungroupObjects(canvas, canvas.getActiveObjects())
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

  /**
   * Flush any pending text edit before serializing the Document (§11 "commit
   * first" — the same step export runs): a textbox mid-edit hasn't committed
   * its session, so `canvas.toJSON()` would capture a half-typed string.
   * `exitEditing()` fires the text-session commit (and, through it,
   * `text:editing:exited` → the History's `object:modified` boundary). The
   * flush is itself an undoable step (§6) — the session commits on exit.
   */
  const flushPendingTextEdit = useCallback(
    (targetCanvas: Canvas) => {
      const active = targetCanvas.getActiveObject()
      if (isTextObject(active) && active.isEditing) active.exitEditing()
    },
    [],
  )

  const saveDesignFile = useCallback(() => {
    if (!canvas) return
    // Commit any pending text edit before serializing (§11 commit-first).
    flushPendingTextEdit(canvas)
    const file = serializeDesignFile(canvas)
    const blob = new Blob([JSON.stringify(file, null, 2)], {
      type: "application/json",
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${designFileName}.json`
    a.click()
    URL.revokeObjectURL(url)
    // Save is not an undoable step and never mutates the Document (§10) —
    // although the text flush above is its own step (§6).
    reportStatus(`Saved ${designFileName}.json`)
  }, [canvas, designFileName, flushPendingTextEdit, reportStatus])

  const exportCurrent = useCallback(
    async (format: ExportFormat) => {
      if (!canvas) return
      // Commit any pending text edit before serializing (§11 "commit first" —
      // the same step as Save): a textbox mid-edit hasn't committed its
      // session, so the serialization would capture a half-typed string.
      flushPendingTextEdit(canvas)
      // Serialize the committed Document — the same envelope a Design file
      // carries; only the canvas payload and the envelope fields feed the
      // offscreen render (view state is excluded by construction).
      const file = serializeDesignFile(canvas)
      reportStatus("Preparing export…")
      try {
        const { filename, warning } = await exportDocument(
          {
            format,
            baseName: designFileName,
            width: file.size.width,
            height: file.size.height,
            rotation: file.rotation,
            borderWidth: file.border.width,
            borderColor: file.border.color,
            outline: file.outline.outline,
            aspectLocked: file.outline.aspectLocked,
            payload: file.canvas,
          },
          getExportHost(),
        )
        // Export is not an undoable step (§11) — the pipeline only ever
        // renders a private offscreen copy, never the live canvas or history.
        reportStatus(
          warning ? `Exported ${filename} — ${warning}` : `Exported ${filename}`,
        )
      } catch (error) {
        // Refusal (too large for the raster ceiling) and render failures
        // surface clearly in the status area (§11).
        reportStatus(error instanceof Error ? error.message : "Export failed")
      }
    },
    [canvas, designFileName, flushPendingTextEdit, reportStatus],
  )

  /**
   * Load a parsed Design file onto the canvas as ONE undoable step — the
   * shared tail of an import and a predesign apply (ADR 0002 §6): suspend
   * recording, flush any pending text edit, `loadEnvelope`, resume, and
   * commit. Also sets the working file's basename and refreshes the document
   * mirrors. The caller reports its own status line.
   */
  const applyDesignFile = useCallback(
    async (design: ReturnType<typeof parseDesignFile>, name: string) => {
      if (!canvas?.history) return
      // The apply is ONE undoable step (§8, §10) — undo restores the
      // pre-apply Document. The flush of a pending text edit fires
      // `object:modified` (a commit boundary), so recording is suspended
      // across the flush and the load, then the whole apply commits as the
      // single step below.
      canvas.history.suspendRecording()
      try {
        // Flush any pending text edit so the pre-apply state captures a
        // committed Document — the apply replaces the whole Document, and the
        // session's hidden textarea would otherwise leak into it.
        flushPendingTextEdit(canvas)
        // loadEnvelope applies the envelope fields and `loadFromJSON` — the
        // whole import path (§10), shared with the History's restore.
        await loadEnvelope(
          canvas,
          {
            width: design.size.width,
            height: design.size.height,
            rotation: design.rotation,
            borderWidth: design.border.width,
            borderColor: design.border.color,
            outline: design.outline.outline,
            aspectLocked: design.outline.aspectLocked,
          },
          design.canvas,
        )
        canvas.requestRenderAll()
      } finally {
        canvas.history.resumeRecording()
      }
      // The apply as ONE undoable step (ADR 0001) — undo restores the
      // pre-apply Document. The commit dedup skips a no-op.
      canvas.history.commit()
      setDesignFileName(name)
      setDocumentSizeState({ width: canvas.width, height: canvas.height })
      setCanvasPropsState({
        backgroundColor: (canvas.backgroundColor as string) || DOCUMENT_BACKGROUND_COLOR,
        borderWidth: canvas.borderWidth,
        borderColor: canvas.borderColor,
      })
      setRotationState(canvas.rotation)
    },
    [
      canvas,
      flushPendingTextEdit,
      setDesignFileName,
      setDocumentSizeState,
      setCanvasPropsState,
    ],
  )

  const importDesignFile = useCallback(
    async (file: { name: string; text: () => Promise<string> }) => {
      if (!canvas?.history) return
      let text: string
      try {
        text = await file.text()
      } catch {
        reportStatus("Couldn't read that file")
        return
      }
      let design: ReturnType<typeof parseDesignFile>
      try {
        design = parseDesignFile(text)
      } catch (error) {
        // Validates loudly (ADR 0002) — unknown types, bad envelope, any
        // structural break surface here; nothing in the Document changed.
        reportStatus(error instanceof Error ? error.message : "Invalid design file")
        return
      }
      const name = designFileBasename(file.name)
      await applyDesignFile(design, name)
      reportStatus(`Imported ${name}.json`)
    },
    [canvas, applyDesignFile, reportStatus],
  )

  const insertPredesign = useCallback(
    async (predesign: Predesign) => {
      if (!canvas?.history) return
      let design: ReturnType<typeof parseDesignFile>
      try {
        // The fetch + loud validation (ADR 0002) — a network failure or a
        // malformed file explains itself and nothing is applied.
        design = await loadPredesign(predesign)
      } catch (error) {
        reportStatus(error instanceof Error ? error.message : "That design couldn't be loaded")
        return
      }
      const name = designFileBasename(predesign.id)
      await applyDesignFile(design, name)
      reportStatus(`Applied ${name}`)
    },
    [canvas, applyDesignFile, reportStatus],
  )

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

  // Copy hotkey (§13): Ctrl+C copies the selection to the app's internal
  // clipboard. Pasting — both the internal object paste and an external
  // clipboard image — happens on the native paste event below, which is the
  // only place the OS clipboard's contents (clipboardData) are readable. The
  // editable gate keeps the key native in the toolbar's fields and the text
  // session's hidden textarea.
  useEffect(() => {
    if (!canvas) return
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      if (key !== "c" && key !== "v") return
      if (!event.ctrlKey && !event.metaKey) return
      if (event.altKey) return
      if (isEditableTarget(document.activeElement)) return
      if (key === "c") {
        event.preventDefault()
        copySelection()
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [canvas, copySelection])

  // Paste — image + object (§13). Ctrl+V fires a native paste event whose
  // clipboardData holds the OS clipboard. An image (screenshot, copied from
  // another app) becomes a placed FabricImage via pasteImageFile — the same
  // §1 pipeline as an uploaded file. A paste with no image on the clipboard
  // falls through to the internal object paste, so copying in-app keeps
  // working. Reading the event (not the key) is what makes an external image
  // reachable, and prevents a Ctrl+V double-paste. The editable gate keeps
  // native text paste in the toolbar's fields and the text session.
  useEffect(() => {
    if (!canvas) return
    const onPaste = (event: ClipboardEvent) => {
      if (isEditableTarget(document.activeElement)) return
      const items = event.clipboardData?.items
        ? Array.from(event.clipboardData.items)
        : []
      // A file item whose type is an image — e.g. a screenshot or a picture
      // copied from another app — is the external-image paste contract.
      const image = items.find(
        (item) => item.kind === "file" && item.type.startsWith("image/"),
      )
      event.preventDefault()
      if (image) void pasteImageFile(image.getAsFile())
      else void pasteSelection()
    }
    document.addEventListener("paste", onPaste)
    return () => document.removeEventListener("paste", onPaste)
  }, [canvas, pasteSelection, pasteImageFile])

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

  // Add Text hotkey (§13): T drops a new Text at the viewport center, already
  // in its text session — the same as the sidebar's Add Text button. Modifier
  // keys are gated so Ctrl+T stays the browser's native new-tab; the editable
  // gate keeps T native in the toolbar's fields and the text session's hidden
  // textarea, where typing a "t" must never spawn a text box.
  useEffect(() => {
    if (!canvas) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "t") return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (isEditableTarget(document.activeElement)) return
      event.preventDefault()
      addText()
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [canvas, addText])

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
        rotation,
        rotateDocument,
        addShape,
        commitShapeProps,
        addText,
        commitTextProps,
        addImage,
        recentUploads,
        addRecentUpload,
        removeRecentUpload,
        graphicsCatalog,
        imageCatalog,
        insertArtwork,
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
        saveDesignFile,
        importDesignFile,
        insertPredesign,
        exportCurrent,
        designFileName,
        status,
        reportStatus,
        preview,
        togglePreview,
        startNewDesign,
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
