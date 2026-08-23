import { Object as FabricObject, Textbox } from "fabric"

/**
 * Register the document custom properties (ADR 0002, build spec §4) with
 * Fabric's `customProperties` serialization mechanism, so they survive
 * save/load. Must run once at app startup, before any object is created.
 *
 * Fabric 7.4 mechanics: the base `Object.customProperties` array is always
 * serialized; each class's own `constructor.customProperties` array is
 * appended on top. Textbox has no own array — it inherits (and would mutate)
 * the shared base array on push — so we assign a Textbox-own array to keep
 * `uppercase`/`uppercaseSource`/`autoFit` serializing only on text objects.
 */
export function registerCustomProperties(): void {
  FabricObject.customProperties.push(
    "id",
    "name",
    "locked",
    // Inserted-artwork provenance (CONTEXT "Inserted", ticket #40): inert
    // metadata carried so the Design file round-trips it. Registered on the
    // base object so any Image can own it; undefined elsewhere is skipped by
    // Fabric's serializer, so plain shapes never serialize it.
    "artworkSource",
    "artworkTitle",
    "artworkUrl",
    "artworkLicense",
  )
  Textbox.customProperties = [
    ...FabricObject.customProperties,
    "uppercase",
    "uppercaseSource",
    "autoFit",
  ]
}
