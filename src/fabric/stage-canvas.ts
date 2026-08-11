import { Canvas } from "fabric"

import { stampDocumentProps } from "@/fabric/document-props"

/**
 * Placeholder Document size until the document-model build makes it a real
 * Document property (build spec §5, ADR 0002) — 600×600 px at the 96 DPI
 * display basis.
 */
export const DOCUMENT_WIDTH = 600
export const DOCUMENT_HEIGHT = 600

/**
 * Create the stage Canvas on a fresh canvas element. The white Document
 * background is a document property (serialized, honored at export, build
 * spec §11) — set it here so the stage shows the Document, not CSS paint.
 */
export function createStageCanvas(element: HTMLCanvasElement): Canvas {
  const canvas = new Canvas(element, {
    width: DOCUMENT_WIDTH,
    height: DOCUMENT_HEIGHT,
    backgroundColor: "#ffffff",
  })

  // Document identity (ADR 0002): stamp the id/locked defaults at the
  // document boundary so every creation path — sidebar, console-added
  // objects, imports — carries a stable id. Objects restored from a Design
  // file already have their ids and are left untouched.
  canvas.on("object:added", (event) => {
    const obj = event.target
    if (obj && !obj.id) stampDocumentProps(obj)
  })

  return canvas
}
