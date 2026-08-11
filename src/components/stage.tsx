import { useEffect, useRef, type MouseEvent } from "react"
import type { Canvas } from "fabric"

import { useStage } from "@/components/stage-context"
import { createStageCanvas } from "@/fabric/stage-canvas"
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
  const { canvas, registerCanvas } = useStage()

  useEffect(() => {
    const element = canvasRef.current
    if (!element) return
    let cancelled = false
    let canvas: Canvas | null = null

    const mount = async () => {
      // `dispose` is async in Fabric 7 (build spec §14): when its destroy is
      // deferred behind a pending render, the next mount must wait for it
      // before re-creating on the same element — StrictMode's dev double-mount
      // otherwise races it.
      await pendingDispose.current
      if (cancelled) return
      canvas = createStageCanvas(element)
      registerCanvas(canvas)
      exposeStageCanvas(canvas)
    }
    void mount()

    return () => {
      cancelled = true
      registerCanvas(null)
      exposeStageCanvas(null)
      pendingDispose.current = canvas
        ? canvas.dispose().then(() => undefined)
        : pendingDispose.current
    }
  }, [registerCanvas])

  /**
   * Clicking the workspace outside the canvas deselects (§7: clicking empty
   * canvas deselects). Clicks inside the canvas wrapper — the white Document,
   * including Fabric's overlay canvases — are Fabric's: its own empty-canvas
   * click already clears the selection there.
   */
  const handleMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    const wrapper = wrapperRef.current
    if (!canvas || !wrapper || wrapper.contains(event.target as Node)) return
    canvas.discardActiveObject()
    canvas.requestRenderAll()
  }

  return (
    <div
      className="min-h-0 flex-1 overflow-auto bg-zinc-200"
      onMouseDown={handleMouseDown}
    >
      <div className="flex min-h-full min-w-full items-center justify-center p-6">
        <div className="bg-white shadow-md" ref={wrapperRef}>
          <canvas ref={canvasRef} aria-label="Design canvas" />
        </div>
      </div>
    </div>
  )
}
