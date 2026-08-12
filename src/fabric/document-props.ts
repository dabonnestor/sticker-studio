import type { Object as FabricObject } from "fabric"

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
