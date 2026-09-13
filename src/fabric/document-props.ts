import { Textbox, type Object as FabricObject } from "fabric"

import { type OutlineKind } from "@/fabric/outline"
import { newId } from "@/lib/ids"

declare module "fabric" {
  interface Object {
    /** Stable identity (ADR 0002) — generated at creation, survives save/load. */
    id: string
    /** Optional user label (ADR 0002). */
    name?: string
    /**
     * Locked state (ADR 0002) — cannot be moved, resized, edited, or deleted
     * while set. Survives save/load.
     */
    locked: boolean
    /**
     * Inert provenance of an Inserted artwork (CONTEXT "Inserted", #40) — the
     * catalog source, title, URL, and license an Image's pixels came from.
     * Present only on Inserted artwork images; carries no behavior. Registers
     * as a custom property so the Design file round-trips it (ADR 0002).
     */
    artworkSource?: string
    /** The artwork's title at Insert — the Image's preset `name` source. */
    artworkTitle?: string
    /** The artwork's full-resolution source URL at Insert, for provenance. */
    artworkUrl?: string
    /** The artwork's license at Insert, matched against the commercial bar. */
    artworkLicense?: string
  }
  interface Canvas {
    /**
     * Document border width in px (0 = off) — envelope-owned (ADR 0002), like
     * size and rotation: Fabric never serializes it, the Design file envelope
     * does. The stage draws it as an inset stroke (§4).
     */
    borderWidth: number
    /** Document border color — envelope-owned (ADR 0002). */
    borderColor: string
    /**
     * Document rotation in degrees — envelope-owned (ADR 0002): Fabric 7's
     * canvas has no rotation prop, and `canvas.toJSON()` never serializes
     * one, so the Design file envelope carries it. Rendered by export (Build
     * 8 §11); the stage displays cardinal rotations (0/90/180/270) through a
     * rotated viewport transform, and a non-cardinal value displays
     * unrotated.
     */
    rotation: number
    /**
     * The Document's outline kind (map #48) — the shape of its Cut line,
     * envelope-owned (ADR 0002) alongside size, rotation, and border. Flattened
     * from the file's `outline` record exactly as the border is. The clip that
     * renders it is derived from this and the Document size, never serialized.
     */
    outline: OutlineKind
    /**
     * Whether resizing the Document holds its aspect ratio at 1:1 (map #48) —
     * envelope-owned (ADR 0002). Square and Circle set it; Rectangle, Rounded
     * corner, Oval and Custom clear it.
     */
    aspectLocked: boolean
  }
  interface Textbox {
    /**
     * Two-way uppercase flag (build spec §6) — the stored string is uppercased
     * while set; toggling off restores the mixed-case `uppercaseSource`.
     */
    uppercase: boolean
    /**
     * The mixed-case text the uppercase flag is forcing over (build spec §6) —
     * saved when the flag turns on / on each keystroke while on, restored when
     * the flag turns off. Undefined while the flag is off.
     */
    uppercaseSource?: string
    /**
     * Auto-fit flag (build spec §6) — the box width hugs its content until the
     * user first resizes it manually.
     */
    autoFit: boolean
  }
}

/**
 * Stamp the document-identity props (ADR 0002) onto a freshly created object:
 * a stable generated `id` and the `locked`/`name` defaults. Call right after
 * construction, before the object is added to the canvas.
 */
export function stampDocumentProps<T extends FabricObject>(obj: T): T {
  obj.id = newId()
  obj.locked = false
  return obj
}

/**
 * Set an object's locked state (build spec §7 Q3): while locked the object is
 * selectable but inert — no transform handles, no movement, scale, or
 * rotation, and a Text object cannot enter its text session. The transform
 * locks are belt-and-braces behind `hasControls` (which also hides the
 * rotation handle). Everything reverses on unlock; the `locked` prop itself
 * survives save/load, and Del's locked skip is the delete half of the
 * contract (§7 Q3).
 */
export function setLocked(obj: FabricObject, locked: boolean): void {
  obj.set("locked", locked)
  obj.set("hasControls", !locked)
  obj.set("lockMovementX", locked)
  obj.set("lockMovementY", locked)
  obj.set("lockScalingX", locked)
  obj.set("lockScalingY", locked)
  obj.set("lockRotation", locked)
  // Directly the Fabric class — importing `isTextObject` from text.ts would
  // cycle (text.ts imports this module for stampDocumentProps).
  if (obj instanceof Textbox) obj.set("editable", !locked)
}

/**
 * Set an object's opacity — the object-level transparency, 0 (transparent) to
 * 1 (opaque). A core Fabric property, so it serializes in the Design file and
 * renders at export without a customProperties registration (ADR 0002
 * registers only app-owned props). Clamped to the 0–1 range — the slider
 * can't leave it, but a saved file could hold any number.
 */
export function setOpacity(obj: FabricObject, opacity: number): void {
  obj.set("opacity", Math.min(1, Math.max(0, opacity)))
}
