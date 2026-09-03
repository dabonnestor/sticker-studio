# Sticker Studio

A client-side sticker design editor: a Fabric.js canvas where the design is a set of shape objects, edited in the browser and exported as print-ready files.

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
A state of a shape: it cannot be moved, resized, edited, or deleted while locked. The flag survives save/load; it is a property of the shape, not of the session.
_Avoid_: pinned, fixed

**Cut line**:
The outline of a shape that defines where it is cut — the boundary of the shape. In the Document it is the shape's clipPath at the geometry edge; the border is centered on it — the clip extends half the border beyond the cut so the border renders at full width (at a fixed pixel width: scaling never thickens it), and the cutter halves it. There is no bleed or separate dieline: the shape is the cut line.
_Avoid_: dieline, cut path, bleed

**Group**:
A Document object that contains other Document objects and moves, scales, rotates, flips, and reorders as one. Groups are single-level — a Group contains only individual objects, never other Groups — and occupy one slot in the Document's z-order; children never appear at top level, and their order inside the Group is fixed at group time. While grouped, children are fixed in place: individually selectable only to inspect their properties or edit Text; repositioning, resizing, deleting, or reordering a child means ungrouping first. A Group has its own id, name, and locked state.
_Avoid_: layer, container, collection

**Selection**:
The set of objects (usually one) currently active in the editor: click selects and replaces, Shift-click toggles membership, the rubber-band marquee selects every object it intersects, clicking empty canvas deselects. The marquee is bounded by the workspace, not the Document: it can start on the workspace and extend past the Document edge, so objects hanging off the Document can be selected. A selected object's controls are bounded the same way: the selection box, corner handles, and rotation handle paint on the workspace overlay, so they stay visible — and draggable — past the Document edge. A Group is selected as a whole; locked objects can be selected but not changed. Selection is view state — it never enters the Design file, and interactions that change only the selection are not interaction boundaries.
_Avoid_: active objects, highlight, focus

**Default size**:
The size a shape is created at when added from the sidebar — specified in inches (Square 2×2, Circle Ø2, Rectangle/Oval/Triangle 3×2 landscape), stored in pixels at the 96 DPI display basis. Size is then edited on the canvas with the drag handles, not in the toolbar.
_Avoid_: preset size

**Document size**:
The width and height of the Document in pixels — the basis of Export dimensions. Physical inches are a view-layer derivation (1 in = 96 screen px; 300 DPI at export), never stored.
_Avoid_: canvas size, print size

**Export**:
The rendered artifact produced from the Document — PNG, JPEG, PDF, or SVG — at Document size and 300 DPI (raster formats). Exports render the current committed Document with view state excluded; they are not the Design file — a Design file is editable and round-trips, an Export is final pixels or vectors. Exporting is not an undoable step.
_Avoid_: output file, downloaded file

**Text**:
A Document object that displays styled text — the Fabric Textbox on the canvas, styled per-textbox (no per-run rich text). Text is content placed on a shape, not a shape itself: it has no shape of its own and no cut line.
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

**Smart guide**:
A vertical or horizontal guide line shown on the workspace while dragging, marking an alignment the moved object can Snap to — dashed while near, solid while snapped.
_Avoid_: alignment line, guide line

**Snap**:
The state of a moved object held to an alignment: a reference point of the object coincides with the Snap target's, resolved per axis independently — the nearest alignment per axis engages, both axes at once if both are within tolerance, and the engaged Smart guide turns solid.
_Avoid_: magnetic snap, stick, dock

**Snap target**:
Anything a moved object can align to: every other object — Locked, Text, and Group included — plus the Document's four edges and its center.
_Avoid_: anchor, alignment source

**Snap suppression**:
The state of a drag in which Snap is suspended but the Smart guides stay visible — entered by holding Alt/Option mid-drag, letting the object sit freely within an alignment's tolerance while the guide still marks it.
_Avoid_: snap toggle, snap override

## Graphics source

**Catalog**:
The third-party library the app sources artwork from — illustrated graphics (Pixabay) and photographs (Unsplash) — searched and browsed inside the app, not self-hosted. Artwork is licensed for commercial use (no attribution required), but the source provides no per-item guarantee it contains no third-party characters or brands — the user holds the responsibility to verify rights before selling; the app filters obvious franchise/character/brand matches heuristically.
_Avoid_: sticker pack, library, stash

**Artwork**:
A single item in the Catalog — a raster graphic (illustrated sticker art, typically transparent background, or a photograph) that can be Inserted as an Image object. Artwork is sourced and embedded at Insert time, never hotlinked from the Catalog afterwards; it is a picture placed in a design, not itself a shape with editable geometry.
_Avoid_: graphic, asset, sticker, clip art

**Insert**:
The interaction of bringing an Artwork from the Catalog into the Document as an Image object — one undoable step, the Image sized and centered on the Document. Insert is not a Text session; the resulting object is a normal Image.
_Avoid_: add graphic, place image, import artwork

**Inserted**:
Describes an Image whose pixels come from the Catalog — embedded in the Document at Insert (self-contained; the Design file needs no live connection to the Catalog to render or export later).
_Avoid_: hotlinked, pasted, fetched
