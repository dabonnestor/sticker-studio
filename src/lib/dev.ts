import type { Canvas } from "fabric"

declare global {
  interface Window {
    /** Dev-only handle to the live stage canvas (Build 1 style-bleed verification). */
    __stageCanvas?: Canvas
  }
}

/**
 * Dev-only: expose the stage canvas on `window` so the no-preflight-bleed
 * acceptance check can be driven from the browser console. No-op in
 * production builds.
 */
export function exposeStageCanvas(canvas: Canvas | null): void {
  if (import.meta.env.DEV) {
    window.__stageCanvas = canvas ?? undefined
  }
}
