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

**Default size**:
The size a sticker is created at when added from the sidebar — specified in inches (Square 2×2, Circle Ø2, Rectangle/Oval/Rounded-rectangle 2×3), stored in pixels at the 96 DPI display basis, and editable in the toolbar afterwards.
_Avoid_: preset size

**Document size**:
The width and height of the Document in pixels — the basis of Export dimensions. Physical inches are a view-layer derivation (1 in = 96 screen px; 300 DPI at export), never stored.
_Avoid_: canvas size, print size

**Export**:
The rendered artifact produced from the Document — PNG, JPEG, PDF, or SVG — at Document size and 300 DPI (raster formats). Exports render the current committed Document with view state excluded; they are not the Design file — a Design file is editable and round-trips, an Export is final pixels or vectors. Exporting is not an undoable step.
_Avoid_: output file, downloaded file
