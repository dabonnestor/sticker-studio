# Snapshot-based undo/redo

Status: accepted

Fabric.js ships no undo/redo (its plugins are stale), and design documents are small — tens of objects, a few KB of JSON — so we back history with a document-state stack: one full `canvas.toJSON()` snapshot pushed per interaction boundary, restored via `loadFromJSON`. The stack's previous entry is the pre-interaction state, so nothing is captured mid-gesture and no debouncing is needed.

## Considered Options

- **Command stack with incremental patches** — each interaction records a bespoke undo/redo patch. Rejected: every interaction type needs its own recording logic, Fabric's event streams yield no clean diffs, and the memory savings don't matter at document sizes of a few KB.
- **Hybrid (commands for transforms, snapshots for structural ops)** — rejected for the same reasons; one uniform mechanism keeps the history correct by construction.

## Consequences

- Undo/redo are async full-document restores (`loadFromJSON`); history recording must be suppressed while a restore runs, since restores fire `object:added` storms.
- Memory is bounded by the fixed depth of 100 snapshots, oldest dropped.
- Selection is view state and never serialized — each history entry carries the object ids to reselect after a restore.
