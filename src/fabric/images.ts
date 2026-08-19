import { FabricImage } from "fabric"

import { stampDocumentProps } from "@/fabric/document-props"

/**
 * Image placement (build spec §1 — the sidebar's Image section): a photo or
 * graphic placed on the Document as a FabricImage. Unlike a shape there is no
 * cut line — the image is content, not a cut shape (Text has the same
 * content-not-shape reading, CONTEXT) — so it carries no clipPath. The image
 * lands centered at a size fit to the Document, one undoable step, and is
 * otherwise a plain object: selectable, movable, scalable. Its `src` is the
 * embedded data URL, so it serializes into the Design file and round-trips
 * through undo/redo and export (the object-type whitelist already knows
 * `Image`, ADR 0002).
 */

/**
 * The fraction of the Document an imported image may span per side at
 * creation — 80% leaves a margin around the sticker so the image reads as a
 * placed element, not a full-bleed backdrop. The same "land at a usable,
 * document-relative size" convention as the shapes' default sizes (§5 Default
 * size).
 */
export const IMAGE_FIT_RATIO = 0.8

/**
 * The scale that fits a natural image size into the Document at creation
 * (build spec §1): the largest factor keeping the image within
 * `IMAGE_FIT_RATIO` of the Document per side, preserving the aspect ratio.
 * Downscale-only — a natural-size image smaller than the fit box is never
 * upscaled, so no blurry pixels are invented; the user grows it with the
 * drag handles if they want it bigger. Degenerate inputs (a zero-sized image
 * or document) answer 1, the identity placement.
 */
export function imageFitScale(
  naturalWidth: number,
  naturalHeight: number,
  documentWidth: number,
  documentHeight: number,
): number {
  if (naturalWidth <= 0 || naturalHeight <= 0) return 1
  if (documentWidth <= 0 || documentHeight <= 0) return 1
  const fitWidth = (IMAGE_FIT_RATIO * documentWidth) / naturalWidth
  const fitHeight = (IMAGE_FIT_RATIO * documentHeight) / naturalHeight
  return Math.min(1, fitWidth, fitHeight)
}

/**
 * Create the placed image for an uploaded file's data URL: load it (async —
 * the element decodes the URL), fit it to the Document (imageFitScale), and
 * stamp the document identity (id, locked=false, ADR 0002). The load is the
 * caller's await, so a corrupt or undecodable image surfaces there — nothing
 * is placed.
 */
export async function createImageFromDataURL(
  dataURL: string,
  documentWidth: number,
  documentHeight: number,
): Promise<FabricImage> {
  const img = await FabricImage.fromURL(dataURL)
  const scale = imageFitScale(img.width, img.height, documentWidth, documentHeight)
  img.set({ scaleX: scale, scaleY: scale })
  return stampDocumentProps(img)
}