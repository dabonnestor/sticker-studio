# Sticker Studio

A client-side sticker design editor: a Fabric.js canvas where each sticker is a shape object, edited in the browser and exported as print-ready files.

## Language

**Document**:
The complete state of the stage — every object, its geometry and properties, and the canvas settings — as a single serializable unit. The canvas is the document; there is no model separate from it.
_Avoid_: canvas state, scene, drawing

**Interaction boundary**:
The point where a user interaction ends and the change it produced is committed — end of a transform gesture, exit from a text edit, completion of a structural command. Interactions that change only the view (zoom, pan, selection) are not boundaries.

**Undoable step**:
The unit of history: the document change committed at one interaction boundary.
_Avoid_: command, action

**Design file**:
The serialized Document — the JSON saved to disk and imported back. The file wraps the Document in a versioned envelope; importing one replaces the whole Document.
_Avoid_: save, project, scene file

**Locked**:
A state of a sticker: it cannot be moved, resized, edited, or deleted while locked. The flag survives save/load; it is a property of the sticker, not of the session.
_Avoid_: pinned, fixed

**Cut line**:
The outline of a sticker that defines where it is cut — the boundary of the sticker's shape. In the Document it is the shape's clipPath, at the original geometry edge; the inset border shrinks inside it. There is no bleed or separate dieline: the canvas shape is the cut line.
_Avoid_: dieline, cut path, bleed

**Group**:
A Document object that contains other Document objects and moves, scales, rotates, flips, and reorders as one. Groups are single-level — a Group contains only individual objects, never other Groups — and occupy one slot in the Document's z-order; children never appear at top level, and their order inside the Group is fixed at group time. While grouped, children are fixed in place: individually selectable only to inspect their properties or edit Text; repositioning, resizing, deleting, or reordering a child means ungrouping first. A Group has its own id, name, and locked state.
_Avoid_: layer, container, collection

**Selection**:
The set of objects (usually one) currently active in the editor: click selects and replaces, Shift-click toggles membership, the rubber-band marquee selects every object it intersects, clicking empty canvas deselects. A Group is selected as a whole; locked objects can be selected but not changed. Selection is view state — it never enters the Design file, and interactions that change only the selection are not interaction boundaries.
_Avoid_: active objects, highlight, focus

**Default size**:
The size a sticker is created at when added from the sidebar — specified in inches (Square 2×2, Circle Ø2, Rectangle/Oval/Rounded-rectangle 2×3), stored in pixels at the 96 DPI display basis, and editable in the toolbar afterwards.
_Avoid_: preset size

**Document size**:
The width and height of the Document in pixels — the basis of Export dimensions. Physical inches are a view-layer derivation (1 in = 96 screen px; 300 DPI at export), never stored.
_Avoid_: canvas size, print size

**Export**:
The rendered artifact produced from the Document — PNG, JPEG, PDF, or SVG — at Document size and 300 DPI (raster formats). Exports render the current committed Document with view state excluded; they are not the Design file — a Design file is editable and round-trips, an Export is final pixels or vectors. Exporting is not an undoable step.
_Avoid_: output file, downloaded file

**Text**:
A Document object that displays styled text — the Fabric Textbox on the canvas, styled per-textbox (no per-run rich text). Text is content placed on a sticker, not a sticker itself: it has no shape of its own and no cut line.
_Avoid_: textbox, label, caption, text run

**Text session**:
The interval between entering and exiting an edit of a Text object — one interaction boundary: everything typed in one session commits as a single undoable step at exit, and Escape reverts the session without committing.
_Avoid_: text edit, edit mode

**Auto-fit**:
The width behavior of a Text object — the box hugs its content at creation and re-fits at the end of each Text session while it has never been manually resized; the first manual resize hands the width to the user, and multi-line text wraps at that width.
_Avoid_: auto-grow, fit-to-content

**Zoom**:
The magnification of the stage, as a percentage where 100% renders one document pixel as one screen pixel. Zoom is view state — never part of the Document, never an undoable step, and interactions that change only the view (zoom, pan, selection) are not interaction boundaries.
_Avoid_: scale, magnification

**Fit**:
The zoom level at which the whole Document fits inside the workspace with a margin — the default zoom on load, whether the Document is smaller or larger than the workspace.
_Avoid_: fit-to-window, zoom to fit
