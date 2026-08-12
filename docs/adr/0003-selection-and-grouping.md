# Selection and grouping model

Status: accepted

Selection and grouping are the editor's primary interaction surface, so their behavior is a user-facing commitment, not an implementation detail. Selection is the Fabric-default interaction set with one addition: click selects and replaces, Shift-click toggles membership, the rubber-band marquee selects by intersection and starts only on empty canvas (a shape's clipped-out areas count as empty), clicking empty canvas deselects, and Ctrl+A selects all. Amendment: the marquee is bounded by the workspace, not the Document — presses on the workspace outside the Document re-enter Fabric's interaction pipeline (re-dispatched to its upper canvas), so a marquee can start on or extend past the Document edge and select objects hanging off it; the marquee paint mirrors onto a workspace overlay so the extension is visible. Locked objects stay selectable but inert — they must be selectable to be unlockable; in a mixed selection, delete skips locked objects.

Groups are single-level containers: a Group is a Document object holding individual objects, never other Groups, and occupies one slot in the top-level z-order (children never appear at top level; their order is fixed at group time). ADR 0002's serialization is unchanged — groups nested as one Group object with their own `id`/`name`/`locked`. Double-click enters a group, where children are individually selectable for property inspection and Text editing only: children are fixed in place while grouped, so repositioning, resizing, deleting, or reordering a child requires Ungroup first. A selection containing an existing group flattens that group before grouping. Locking applies at both levels: a locked group cannot be entered or transformed, and a locked child's edits are blocked inside its group.

Arrangement, flip, scale, and rotation operate on the group as one unit (children keep their own flip, rotation, and cut geometry). Each structural command — group, ungroup, arrange, flip, lock toggle, group delete — is one undoable step (ADR 0001), and undo restores the selection to the affected group by id. The commands live in a contextual section of the stage toolbar, visible only while a selection exists; hotkeys: Ctrl+G / Ctrl+Shift+G / Ctrl+] / Ctrl+[ / Ctrl+Shift+] / Ctrl+Shift+[.

## Considered Options

- **Nested groups** — rejected for the MVP: the flat layer list and top-level z-order semantics stay simple, and flatten-on-group keeps Group enabled for any ≥2-object selection without special-casing group-in-group.
- **Freely draggable children inside a group** (Fabric-native) — rejected: per-child transforms inside group space complicate undo, the flat-layer mental model, and the "group as one unit" arrange/flip semantics; ungroup-to-reposition is explicit and cheap at MVP document sizes.

## Consequences

- Text editing inside a group is native Fabric (second single-click) but was not exercised in the spike — flagged for early verification in the build sessions.
- The Group constructor does not detach its children from the canvas (spike, ticket #4): `canvas.remove(...children)` before `new Group(children)`; ungroup is the mirror (`group.removeAll()` + re-add); sort children by canvas index first, since ActiveSelection order is click order, not z-order.
- Selection is view state — never serialized (ADR 0002), never an interaction boundary (glossary).
