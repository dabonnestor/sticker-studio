import { FabricImage, type Object as FabricObject } from "fabric"

import { stampDocumentProps } from "@/fabric/document-props"

/**
 * The provenance of an Inserted artwork (CONTEXT "Inserted", ticket #40) —
 * the catalog facts carried on the Image so the Design file round-trips them.
 * Nothing here affects geometry or behavior; it is inert metadata.
 */
export interface ArtworkProvenance {
  /** The catalog source, e.g. "Pixabay". */
  source: string
  /** The artwork's title — becomes the Image's preset name. */
  title: string
  /** The artwork's full-resolution URL, for provenance. */
  url: string
  /** The artwork's license, matched against the commercial-sale bar. */
  license: string
}

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

/** Image objects are FabricImages; nothing else (shapes, text, groups) is an image. */
export function isImageObject(obj: FabricObject | null | undefined): obj is FabricImage {
  return obj instanceof FabricImage
}

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

/**
 * Stamp a newly constructed image with an artwork's provenance (ticket #40) —
 * the name preset to the artwork title and the four inert catalog facts.
 * Call on a {@link FabricImage} right after it is created for insertion; the
 * props register as custom properties (ADR 0002), so the Design file
 * round-trips them and export/render stay self-contained (CONTEXT "Inserted").
 */
export function stampArtworkProvenance(
  img: FabricImage,
  provenance: ArtworkProvenance,
): FabricImage {
  img.set({
    name: provenance.title,
    artworkSource: provenance.source,
    artworkTitle: provenance.title,
    artworkUrl: provenance.url,
    artworkLicense: provenance.license,
  })
  return img
}

/**
 * Create the Inserted artwork Image for an embedded data URL (ticket #40,
 * #42): load the URL, fit it to the Document (`imageFitScale` — the same
 * downscale-only placement as an uploaded image), stamp the document identity
 * and the artwork's provenance, and preset the name to the artwork title. The
 * result is an ordinary content Image — nothing about it differs from an
 * uploaded image except the inert provenance it carries. The caller centers
 * it (the placement's configurable half, like the upload path).
 */
export async function createArtworkImage(
  dataURL: string,
  documentWidth: number,
  documentHeight: number,
  provenance: ArtworkProvenance,
): Promise<FabricImage> {
  // The same placement as an uploaded image — load, fit, stamp the identity —
  // with the artwork's provenance stamped on top. The result is an ordinary
  // content Image; the provenance is the only difference from createImageFromDataURL.
  const img = await createImageFromDataURL(dataURL, documentWidth, documentHeight)
  return stampArtworkProvenance(img, provenance)
}