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
 * refused before `loadFromJSON` runs if any object type is unknown. Future
 * file versions migrate via the documented `MIGRATORS` registry, run
 * sequentially on load; v2 ships the registry's first real migrator, the one
 * that classifies a v1 file's outline.
 */

/** The format marker — a file carrying anything else is not a Design file. */
export const DESIGN_FILE_FORMAT = "sticker-studio"

/** The current file version — v2 adds the Document's outline (map #48). */
export const DESIGN_FILE_VERSION = 2

/** A migrator upgrades one object-string version to the next (ADR 0002). */
export type DesignFileMigrator = (file: any) => any

/**
 * v1 → v2 (map #48): v1 had no Document outline — the sheet was the canvas,
 * and its shape was not a property at all. Classify from the size, mirroring
 * `getShapeKind` for a shape object: a square Document becomes a **Square**
 * sticker (rect, aspect locked), anything else a **Rectangle** (rect, free).
 * The three shipped 600×600 Predesigns therefore become Square, as intended.
 *
 * Runs before validation, so the size it reads may be malformed — that file
 * is refused loudly by `validate` a step later either way, and the fallback
 * below only has to avoid throwing here.
 */
function migrateV1(file: any): any {
  const size = file?.size
  const square =
    isRecord(size) &&
    typeof size.width === "number" &&
    typeof size.height === "number" &&
    size.width === size.height
  return {
    ...file,
    version: 2,
    outline: { outline: "rect", aspectLocked: square },
  }
}

/**
 * The documented migration registry (ADR 0002) — keyed by the version a file
 * is migrating *from*; each migrator returns the file one version newer. Run
 * sequentially on load, from the file's version up to the current one.
 */
export const MIGRATORS: Record<number, DesignFileMigrator> = {
  1: migrateV1,
}

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

/** The serializable Design file — the v2 envelope (ADR 0002, map #48). */
export interface DesignFileV2 {
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
 * Migrate a raw parsed file from its declared version to the current one —
 * `MIGRATORS[version]` steps the file one version forward, repeatedly until
 * current. A version the registry has no path from (an unknown old one, or a
 * future one an older app cannot read) is left alone and refused loudly by
 * the version check in `validate`.
 */
function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  let file = raw
  let version = file.version
  while (
    typeof version === "number" &&
    version !== DESIGN_FILE_VERSION &&
    version in MIGRATORS
  ) {
    file = MIGRATORS[version as number](file)
    version = file.version
  }
  return { ...file, version }
}

/**
 * Validate a raw parsed file's envelope — the format marker and the version
 * (after migration) — and its canvas object types, throwing loudly on any
 * failure. Returns the migrated, validated file.
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
  const file = migrate(raw)
  if (file.version !== DESIGN_FILE_VERSION) {
    throw new DesignFileError(
      `Unsupported design file version ${String(file.version)} — this build reads version ${DESIGN_FILE_VERSION}`,
    )
  }
  const size = file.size
  if (
    !isRecord(size) ||
    typeof size.width !== "number" ||
    typeof size.height !== "number"
  ) {
    throw new DesignFileError("The file's size is missing or malformed")
  }
  const border = file.border
  if (
    !isRecord(border) ||
    typeof border.width !== "number" ||
    typeof border.color !== "string"
  ) {
    throw new DesignFileError("The file's border is missing or malformed")
  }
  if (typeof file.rotation !== "number") {
    throw new DesignFileError("The file's rotation is missing or malformed")
  }
  const outline = file.outline
  if (
    !isRecord(outline) ||
    typeof outline.outline !== "string" ||
    !OUTLINE_KINDS.has(outline.outline) ||
    typeof outline.aspectLocked !== "boolean"
  ) {
    throw new DesignFileError("The file's outline is missing or malformed")
  }
  const canvas = file.canvas
  if (!isRecord(canvas) || !Array.isArray(canvas.objects)) {
    throw new DesignFileError("The file's canvas is missing or malformed")
  }
  canvas.objects.forEach((obj, i) => validateObjectType(obj, `objects[${i}]`))
  return file
}

/**
 * Parse a Design file's JSON text. Validates loudly — the format marker,
 * the version (after migration), and the canvas object types — and returns
 * the marked-up file. Throws DesignFileError with a clear message on any
 * structural failure; JSON parse errors keep their cause.
 */
export function parseDesignFile(text: string): DesignFileV2 {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new DesignFileError("This file is not valid JSON", error)
  }
  return validate(raw) as unknown as DesignFileV2
}

/** Serialize the current Document as a Design file envelope (ADR 0002). */
export function serializeDesignFile(canvas: Canvas): DesignFileV2 {
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