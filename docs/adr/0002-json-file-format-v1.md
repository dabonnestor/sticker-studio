# Sticker JSON file format v1

Status: accepted

The design file is a thin envelope around Fabric's own serialization: `{ "format": "sticker-studio", "version": 1, "size": { "width", "height" }, "rotation": 0, "border": { "width": 0, "color": "#18181b" }, "canvas": <canvas.toJSON()> }`. The canvas is the document (ADR 0001's model), so the Fabric payload inside the envelope is loaded verbatim via `loadFromJSON(json.canvas)`; the envelope exists only for what Fabric does not serialize — our format version (Fabric's own `version` field is Fabric's), the document size (Fabric's `loadFromJSON` never touches canvas size), the document rotation, and the document border (Fabric has no border concept of its own; the stage and exports draw it as an inset stroke at the document edge, build-spec §4). Numbers are pixels, the literal Fabric values; the physical-inch basis is a view-layer derivation (1 in = 96 screen px; 300 DPI at export via the 3.125 multiplier), never stored.

## Considered Options

- **Normalized custom schema** — own object types mapped to/from Fabric both ways. Rejected: the spike ruled the canvas is the document with no app-side model; a parallel schema would duplicate it and drift.
- **Bare `canvas.toJSON()` with fields injected** — Rejected: no home for document size or rotation, our version would collide with Fabric's `version`, and Fabric would ignore (and potentially lose) the injected metadata on round-trip.
- **Envelope around `canvas.toJSON()`** — accepted: Fabric owns the document, the envelope owns format metadata. Verified lenient: `loadFromJSON` destructures only its known keys and ignores the rest, so the wrapper is transparent.

## Object identity

Every object carries three flat format fields, registered as Fabric custom properties so they round-trip: `id` (required — generated at creation, stable across save/load; the undo stack reselects by it), `name` (optional user label, Fabric-native), `locked` (boolean — the object cannot be moved, edited, or deleted while set). Text objects add three more registered properties (text-editing model, ticket #11): `uppercase` (boolean — the stored string is uppercased while set), `uppercaseSource` (string — the mixed-case original the flag forces over, kept so toggling off restores it) and `autoFit` (boolean — the box width hugs content until the user first resizes it).

## What survives import

Objects in z-order (groups nested as one Group object, per-object clipPath cut lines, the inset border model), background color (Fabric's `background`), document size, rotation, and the document border (envelope). Selection, viewport/zoom/pan, and undo history are view state and never enter the file.

## Validation and migration

Import validates structurally and rejects loudly: the `format` marker, `version` must equal 1, `canvas.objects` must be an array of known object types — Fabric's enlivening fails silently on unknown types, and a silent drop is data loss. Future versions migrate via a documented `migrators: Record<version, fn>` registry, run sequentially on load; v1 ships the pattern, not an implementation.

## Consequences

- `loadFromJSON` is the entire import path; a JSON import is an undoable step (ADR 0001), so the envelope is stripped and re-wrapped on the way in and out.
- Custom properties (`id`, `name`, `locked`, and the text-only `uppercase`, `uppercaseSource`, `autoFit`) need registration via Fabric's `customProperties` mechanism at app startup — build-spec note.
- The display-side of units (inch vs pixel mode in the toolbar) is the unit-model ticket's territory; this ADR fixes only what the file stores.
