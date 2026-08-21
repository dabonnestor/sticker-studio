import { useEffect, useRef, type MouseEvent } from "react"

import { useStage } from "@/components/stage-context"
import { restoreWorkingDraft } from "@/fabric/auto-persist"
import { createStageCanvas, StageCanvas } from "@/fabric/stage-canvas"
import { wheelZoomFactor } from "@/fabric/zoom"
import { exposeStageCanvas } from "@/lib/dev"

/** The previous canvas's async dispose, awaited before re-creating (§14). */
const pendingDispose: { current: Promise<void> | null } = { current: null }

/**
 * The stage (build spec §3): a gray scrollable workspace with the white
 * Document canvas centered in it. The canvas carries a subtle shadow —
 * view-only chrome on the mount wrapper, never part of the Document, never
 * exported. Fabric is confined to this component.
 */
export function Stage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const workspaceRef = useRef<HTMLDivElement | null>(null)
  const marqueeOverlayRef = useRef<HTMLCanvasElement | null>(null)
  const { canvas, registerCanvas, reportStatus } = useStage()

  useEffect(() => {
    const element = canvasRef.current
    const marqueeOverlay = marqueeOverlayRef.current
    const workspace = workspaceRef.current
    if (!element || !marqueeOverlay || !workspace) return
    let cancelled = false
    let canvas: ReturnType<typeof createStageCanvas> | null = null

    let resizeObserver: ResizeObserver | null = null

    /**
     * Wheel zoom (§9 extension): a touchpad pinch and Ctrl+wheel both arrive
     * as wheel events with ctrlKey — the browser's page-zoom gesture. The
     * preventDefault stops the page zoom, and the zoom anchors at the pointer
     * (setZoomPercentAboutClientPoint). A plain wheel keeps the native
     * scroll-driven pan. The listener is native with `passive: false` — React's
     * synthetic onWheel is passive at the root, where preventDefault would not
     * stick. Chrome coalesces the pinch's fine-grained deltas; the event's own
     * delta is their sum, so the single-event fallback reads the same value.
     * Firefox reports wheel notches as lines — converted to px, so the notch
     * lands near the ±10% keyboard step on both.
     */
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return
      event.preventDefault()
      // The DOM lib's WheelEvent predates the method — the Chromium API is
      // the same event type, so the cast only widens the declaration.
      const coalesced =
        (
          event as WheelEvent & {
            getCoalescedEvents?: () => WheelEvent[]
          }
        ).getCoalescedEvents?.() ?? [event]
      let deltaY = 0
      for (const e of coalesced) {
        deltaY += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
      }
      if (!canvas) return
      const percent = canvas.getZoomPercent() * wheelZoomFactor(deltaY)
      canvas.setZoomPercentAboutClientPoint(
        percent,
        event.clientX,
        event.clientY,
      )
    }

    const mount = async () => {
      // `dispose` is async in Fabric 7 (build spec §14): when its destroy is
      // deferred behind a pending render, the next mount must wait for it
      // before re-creating on the same element — StrictMode's dev double-mount
      // otherwise races it.
      await pendingDispose.current
      if (cancelled) return
      canvas = createStageCanvas(element, marqueeOverlay, workspace)
      // Auto-persist restore (ticket #32): before registerCanvas sets the
      // mirrors and before the load-time Fit runs, so the reflected
      // size/border/rotation and the fit describe the restored sheet — or
      // boot blank with no draft, and soft-fail (wipe the key, report) on a
      // corrupt one. The cancelled guard covers StrictMode's double-mount.
      try {
        await restoreWorkingDraft(canvas, { onNotice: reportStatus })
      } catch {
        // A dispose raced the restore — nothing to mount.
      }
      if (cancelled) return
      registerCanvas(canvas)
      exposeStageCanvas(canvas)
      // Fit is the default zoom on load (§9) — the workspace is laid out by
      // now, so the client size is real. Resize re-centers at the current
      // zoom and never re-fits; the observer lives with the canvas.
      canvas.fitToWorkspace()
      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(() => canvas!.recenter())
        resizeObserver.observe(workspace)
      }
      workspace.addEventListener("wheel", onWheel, { passive: false })
    }
    void mount()

    return () => {
      cancelled = true
      resizeObserver?.disconnect()
      workspace.removeEventListener("wheel", onWheel)
      registerCanvas(null)
      exposeStageCanvas(null)
      pendingDispose.current = canvas
        ? canvas.dispose().then(() => undefined)
        : pendingDispose.current
    }
  }, [registerCanvas, reportStatus])

  /**
   * Pressing the workspace re-enters Fabric's interaction pipeline at that
   * scene point (§7 extension — the marquee is bounded by the workspace,
   * not the Document): a press on an object hanging off the Document
   * selects or drags it, a drag starts the marquee, and a plain press still
   * deselects. Presses inside the canvas wrapper — the white Document,
   * including Fabric's overlay canvases — are Fabric's own; presses on the
   * container itself are scrollbar presses, and non-left presses never
   * start a marquee, so both keep the plain deselect.
   */
  const handleMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    const wrapper = wrapperRef.current
    if (!canvas || !wrapper || wrapper.contains(event.target as Node)) return
    if (event.button !== 0 || event.target === event.currentTarget) {
      canvas.discardActiveObject()
      canvas.requestRenderAll()
      return
    }
    canvas.upperCanvasEl.dispatchEvent(
      new MouseEvent(canvas.enablePointerEvents ? "pointerdown" : "mousedown", {
        bubbles: true,
        cancelable: true,
        clientX: event.clientX,
        clientY: event.clientY,
        button: event.button,
      }),
    )
  }

  /**
   * The workspace's hover cursor over the mirrored selection chrome (§7
   * extension): Fabric's own cursor updates stop at the upper-canvas edge —
   * the pointer past the Document is not over it — so the mirrored corner
   * handles and selection box hanging off the Document would read `auto`.
   * The canvas hit-tests the pointer against the active selection and
   * returns the cursor to show; the workspace container carries it, since
   * the pointer is over the workspace, not the canvas. Over the Document
   * itself the upper canvas's own cursor (Fabric's) still wins, so the
   * style set here only ever shows past the edge. The "" reset keeps the
   * workspace's default cursor everywhere else.
   */
  const handleMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    // The context types the canvas as the base `Canvas`; the workspace
    // cursor is a StageCanvas-only affordance — the mirror's stage.
    if (!(canvas instanceof StageCanvas)) return
    event.currentTarget.style.cursor = canvas.getWorkspaceCursor(
      event.clientX,
      event.clientY,
    )
  }

  return (
    <div
      ref={workspaceRef}
      className="min-h-0 flex-1 overflow-auto bg-zinc-200"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
    >
      {/* The flex centering matches the canvas's zoom layout (§9): the
          element sits centered in the content, which is the workspace floored
          against the zoomed Document — so the scrollbars appear exactly when
          the Document no longer fits, and the fit margin is the centering
          remainder at rest. */}
      <div className="relative flex min-h-full min-w-full items-center justify-center">
        <div className="bg-white shadow-md" ref={wrapperRef}>
          <canvas ref={canvasRef} aria-label="Design canvas" />
        </div>
        {/* Marquee mirror (§7 extension): spans the workspace, never
            interactive. The marquee paints here so it can extend past the
            Document edge — and select objects that hang off it. The stretched
            wrapper sizes the canvas: `inset-0` alone doesn't stretch replaced
            elements (canvas keeps its intrinsic 300×150). */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <canvas ref={marqueeOverlayRef} className="h-full w-full" />
        </div>
      </div>
    </div>
  )
}
