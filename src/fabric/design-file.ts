import { type Canvas } from "fabric"

import { OUTLINE_KINDS, type OutlineKind } from "@/fabric/outline"

/**
 * Design file (ADR 0002, build spec §10): a thin envelope around Fabric's
 * serialization — `{ format, version, size, rotation, outline, border,
 * canvas }`. Fabric is the document (§4); the envelope exists only for what
 * Fabric does not serialize — our format version (the canvas's own `version`
 * field is Fabric's), the document size (`loadFromJSON` never touches canvas
 * size), the document rotation (Fabric 7 has no canvas rotation), the
 * document border (Fabric has no border concept), and the document outline
 * (map #48 — the canvas `clipPath` that renders it is derived from this
 * state, so the state itself has no Fabric home). The `canvas` payload loads
 * verbatim via `loadFromJSON`.
 *
 * Import validates loudly (ADR 0002): Fabric's enlivening fails *silently*
 * on unknown object types, and a silent drop is data loss — so the file is
 * refused before `loadFromJSON` runs if any object type is unknown. Nothing
 * migrates: v1 is the only version the app has ever written, so there is no
 * older format to read forward from. A future change to the envelope bumps
 * the number and brings the migrator that reads this one (ADR 0002).
 */

/** The format marker — a file carrying anything else is not a Design file. */
export const DESIGN_FILE_FORMAT = "sticker-studio"

/**
 * The current file version (ADR 0002) — v1, the only version the app has
 * written. A file carrying anything else is refused loudly by `validate`
 * below rather than migrated: there is no older format in existence to read
 * forward from, and no version of the app ever wrote one.
 */
export const DESIGN_FILE_VERSION = 1

/**
 * The object type strings the app knows how to enliven — the whitelist for
 * import validation (§4, ADR 0002). Fabric serializes each class's own
 * `type` (the class name: `Rect`, `Circle`, …; a shape's cut-line clipPath is
 * the same shape class, not a Path), so the known set is the app's object
 * classes: the five shapes (Rect is drawn by shape-kind for square *and*
 * rectangle, Circle for circle, Ellipse for oval), the text Textbox, the
 * single-level Group, and the in-scope Image and Path (image placement,
 * §1). Anything else is refused loudly rather than silently dropped by
 * Fabric's enlivening.
 */
const KNOWN_OBJECT_TYPES = new Set([
  "Rect",
  "Circle",
  "Ellipse",
  "Triangle",
  "Textbox",
  "Group",
  "Path",
  "Image",
])

/** A structural validation failure — thrown before any loadFromJSON. */
export class DesignFileError extends Error {
  readonly cause?: unknown
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = "DesignFileError"
    if (cause !== undefined) this.cause = cause
  }
}

/**
 * The envelope-owned document fields — what the Design file and an undo/redo
 * snapshot both carry alongside the canvas payload (ADR 0002). `loadFromJSON`
 * never touches canvas size, rotation, or border, so a restore applies these
 * from the envelope in one place.
 */
export interface DocumentEnvelope {
  /** Document size in px (the canvas dimensions, §5). */
  width: number
  height: number
  /** Document rotation in degrees — envelope-owned (ADR 0002). */
  rotation: number
  /** Document border — envelope-owned (ADR 0002); width 0 = off. */
  borderWidth: number
  borderColor: string
  /**
   * The Document's outline (map #48) — envelope-owned (ADR 0002), flattened
   * from the file's `outline` record exactly as the border is.
   */
  outline: OutlineKind
  aspectLocked: boolean
}

/**
 * Load a serialized Document payload onto a canvas and apply its envelope —
 * the shared path for an undo/redo restore (the History) and a Design-file
 * import (ADR 0002 §6): the dimensions, rotation, and border first, then the
 * canvas payload verbatim. `loadFromJSON` is the whole model; the envelope
 * exists only for what it does not serialize.
 */
export async function loadEnvelope(
  canvas: Canvas,
  envelope: DocumentEnvelope,
  payload: ReturnType<Canvas["toJSON"]>,
): Promise<void> {
  canvas.discardActiveObject()
  // The StageCanvas `setDimensions` override re-runs the zoom layout, which
  // reads `canvas.rotation` — assign the envelope's rotation (and the other
  // layout-independent envelope fields) before it, so an import or restore
  // that changes a cardinal rotation lays out under the new one. The outline
  // goes with them: the size it is read against is the one being assigned.
  canvas.rotation = envelope.rotation
  canvas.borderWidth = envelope.borderWidth
  canvas.borderColor = envelope.borderColor
  canvas.outline = envelope.outline
  canvas.aspectLocked = envelope.aspectLocked
  canvas.setDimensions({
    width: envelope.width,
    height: envelope.height,
  })
  await canvas.loadFromJSON(payload)
}

/** The serializable Design file — the envelope (ADR 0002, map #48). */
export interface DesignFile {
  format: typeof DESIGN_FILE_FORMAT
  version: typeof DESIGN_FILE_VERSION
  /** Document size in px — `loadFromJSON` never touches canvas size. */
  size: { width: number; height: number }
  /** Document rotation in degrees — Fabric 7 has no canvas rotation. */
  rotation: number
  /**
   * The Document's outline (map #48) — envelope-owned, because the canvas
   * `clipPath` that renders it is derived from this state rather than stored.
   */
  outline: { outline: OutlineKind; aspectLocked: boolean }
  /** Document border — envelope-owned (ADR 0002); width 0 = off. */
  border: { width: number; color: string }
  /** `canvas.toJSON()` — the canvas payload, loaded verbatim. */
  canvas: ReturnType<Canvas["toJSON"]>
}

/**
 * True while the value is a non-null object (`typeof null === "object"`):
 * the guards that walk the envelope and the canvas objects.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/**
 * Validate one object's `type` against the known set and recurse into its
 * serialized children — a Group's nested `objects` (groups are single-level,
 * §7, but validating recursively costs nothing and future-proofs the check)
 * and every object's `clipPath` (shapes carry their cut line, §4). Throws a
 * loud DesignFileError on the first unknown type — before loadFromJSON, so
 * nothing is silently dropped.
 */
function validateObjectType(obj: unknown, path: string): void {
  if (!isRecord(obj)) {
    throw new DesignFileError(`Invalid object at ${path}: expected an object`)
  }
  const type = obj.type
  if (typeof type !== "string" || !KNOWN_OBJECT_TYPES.has(type)) {
    const shown = typeof type === "string" ? `"${type}"` : String(type)
    throw new DesignFileError(`Unknown object type ${shown} at ${path}`)
  }
  if (Array.isArray(obj.objects)) {
    obj.objects.forEach((child, i) =>
      validateObjectType(child, `${path}.objects[${i}]`),
    )
  }
  if (isRecord(obj.clipPath)) validateObjectType(obj.clipPath, `${path}.clipPath`)
}

/**
 * Validate a raw parsed file's envelope — the format marker and the version —
 * and its canvas object types, throwing loudly on any failure. Returns the
 * validated file.
 */
function validate(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) {
    throw new DesignFileError("This file is not recognized as a Design file")
  }
  if (raw.format !== DESIGN_FILE_FORMAT) {
    throw new DesignFileError(
      `This file is not a Sticker Studio design (format "${String(raw.format)}")`,
    )
  }
  if (raw.version !== DESIGN_FILE_VERSION) {
    throw new DesignFileError(
      `Unsupported design file version ${String(raw.version)} — this build reads version ${DESIGN_FILE_VERSION}`,
    )
  }
  const size = raw.size
  if (
    !isRecord(size) ||
    typeof size.width !== "number" ||
    typeof size.height !== "number"
  ) {
    throw new DesignFileError("The file's size is missing or malformed")
  }
  const border = raw.border
  if (
    !isRecord(border) ||
    typeof border.width !== "number" ||
    typeof border.color !== "string"
  ) {
    throw new DesignFileError("The file's border is missing or malformed")
  }
  if (typeof raw.rotation !== "number") {
    throw new DesignFileError("The file's rotation is missing or malformed")
  }
  const outline = raw.outline
  if (
    !isRecord(outline) ||
    typeof outline.outline !== "string" ||
    !OUTLINE_KINDS.has(outline.outline) ||
    typeof outline.aspectLocked !== "boolean"
  ) {
    throw new DesignFileError("The file's outline is missing or malformed")
  }
  const canvas = raw.canvas
  if (!isRecord(canvas) || !Array.isArray(canvas.objects)) {
    throw new DesignFileError("The file's canvas is missing or malformed")
  }
  canvas.objects.forEach((obj, i) => validateObjectType(obj, `objects[${i}]`))
  return raw
}

/**
 * Parse a Design file's JSON text. Validates loudly — the format marker,
 * the version, and the canvas object types — and returns the marked-up file.
 * Throws DesignFileError with a clear message on any structural failure;
 * JSON parse errors keep their cause.
 */
export function parseDesignFile(text: string): DesignFile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new DesignFileError("This file is not valid JSON", error)
  }
  return validate(raw) as unknown as DesignFile
}

/** Serialize the current Document as a Design file envelope (ADR 0002). */
export function serializeDesignFile(canvas: Canvas): DesignFile {
  return {
    format: DESIGN_FILE_FORMAT,
    version: DESIGN_FILE_VERSION,
    size: { width: canvas.width, height: canvas.height },
    rotation: canvas.rotation,
    outline: { outline: canvas.outline, aspectLocked: canvas.aspectLocked },
    border: { width: canvas.borderWidth, color: canvas.borderColor },
    canvas: canvas.toJSON(),
  }
}

/**
 * The design file's basename — the imported file's name without its JSON
 * extension (the current working file's name, so Save round-trips to the
 * same file). The export and save paths share it.
 */
export function designFileBasename(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return "untitled"
  return trimmed.endsWith(".json") ? trimmed.slice(0, -5) : trimmed
}