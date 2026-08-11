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
  interface Textbox {
    /**
     * One-way uppercase flag (build spec §6) — the stored string is uppercased
     * while set; toggling off stops forcing case but does not restore it.
     */
    uppercase: boolean
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
