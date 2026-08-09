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
