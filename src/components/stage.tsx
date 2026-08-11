import { useEffect, useRef } from "react"
import type { Canvas } from "fabric"

import { createStageCanvas } from "@/fabric/stage-canvas"
import { exposeStageCanvas } from "@/lib/dev"

/** The previous canvas's async dispose, awaited before re-creating (§14). */
const pendingDispose: { current: Promise<void> | null } = { current: null }

/**
 * The stage (build spec §3): a gray scrollable workspace with the white
 * Document canvas centered in it. The canvas carries a subtle shadow and a
 * 1px #d0d0d0 edge border — view-only chrome on the mount wrapper, never
 * part of the Document, never exported. Fabric is confined to this component.
 */
export function Stage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

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
      exposeStageCanvas(canvas)
    }
    void mount()

    return () => {
      cancelled = true
      exposeStageCanvas(null)
      pendingDispose.current = canvas
        ? canvas.dispose().then(() => undefined)
        : pendingDispose.current
    }
  }, [])

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-zinc-200">
      <div className="flex min-h-full min-w-full items-center justify-center p-6">
        <div className="border border-[#d0d0d0] bg-white shadow-md">
          <canvas ref={canvasRef} aria-label="Design canvas" />
        </div>
      </div>
    </div>
  )
}
