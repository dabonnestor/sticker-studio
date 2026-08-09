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
