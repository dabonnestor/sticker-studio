import { type Canvas } from "fabric"

/**
 * Design file (ADR 0002, build spec §10): a thin envelope around Fabric's
 * serialization — `{ format, version, size, rotation, border, canvas }`.
 * Fabric is the document (§4); the envelope exists only for what Fabric does
 * not serialize — our format version (the canvas's own `version` field is
 * Fabric's), the document size (`loadFromJSON` never touches canvas size),
 * the document rotation (Fabric 7 has no canvas rotation), and the document
 * border (Fabric has no border concept). The `canvas` payload loads verbatim
 * via `loadFromJSON`.
 *
 * Import validates loudly (ADR 0002): Fabric's enlivening fails *silently*
 * on unknown object types, and a silent drop is data loss — so the file is
 * refused before `loadFromJSON` runs if any object type is unknown. Future
 * file versions migrate via the documented `MIGRATORS` registry, run
 * sequentially on load; v1 ships the pattern, not an implementation.
 */

/** The format marker — a file carrying anything else is not a Design file. */
export const DESIGN_FILE_FORMAT = "sticker-studio"

/** The current file version — v1 ships the pattern, no migrators yet. */
export const DESIGN_FILE_VERSION = 1

/** A migrator upgrades one object-string version to the next (ADR 0002). */
export type DesignFileMigrator = (file: any) => any

/**
 * The documented migration registry (ADR 0002) — keyed by the version a file
 * is migrating *from*; each migrator returns the file one version newer. Run
 * sequentially on load, from the file's version up to the current one. Empty
 * at v1: the pattern, not an implementation.
 */
export const MIGRATORS: Record<number, DesignFileMigrator> = {}

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
  // reads `canvas.rotation` — assign the envelope's rotation (and border, the
  // other layout-independent envelope fields) before it, so an import or
  // restore that changes a cardinal rotation lays out under the new one.
  canvas.rotation = envelope.rotation
  canvas.borderWidth = envelope.borderWidth
  canvas.borderColor = envelope.borderColor
  canvas.setDimensions({
    width: envelope.width,
    height: envelope.height,
  })
  await canvas.loadFromJSON(payload)
}

/** The serializable Design file — the v1 envelope (ADR 0002). */
export interface DesignFileV1 {
  format: typeof DESIGN_FILE_FORMAT
  version: typeof DESIGN_FILE_VERSION
  /** Document size in px — `loadFromJSON` never touches canvas size. */
  size: { width: number; height: number }
  /** Document rotation in degrees — Fabric 7 has no canvas rotation. */
  rotation: number
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
 * current. v1 ships the pattern; the registry is empty, so a version other
 * than the current one has no path and is refused loudly (a future version
 * is unreadable by an older app).
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
export function parseDesignFile(text: string): DesignFileV1 {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new DesignFileError("This file is not valid JSON", error)
  }
  return validate(raw) as unknown as DesignFileV1
}

/** Serialize the current Document as a Design file envelope (ADR 0002). */
export function serializeDesignFile(canvas: Canvas): DesignFileV1 {
  return {
    format: DESIGN_FILE_FORMAT,
    version: DESIGN_FILE_VERSION,
    size: { width: canvas.width, height: canvas.height },
    rotation: canvas.rotation,
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