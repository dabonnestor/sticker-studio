# Changelog

All notable changes to Sticker Studio are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-09-19

The first release. Sticker Studio is a client-side sticker design editor: arrange
shapes, text, and artwork on a canvas that *is* the sticker's outline, then export
print-ready files at 300 DPI with the cut line already drawn. Everything runs in the
browser — no backend, no account.

### Added

**Canvas and editing**

- A Fabric.js stage where the Document *is* the canvas; the Cut line clips the stage
  and every export, so content outside the outline is simply not on the sticker.
- Move, scale, and rotate, with rotation snapping to 15° detents and
  rotation-aware resize cursors.
- Marquee select, multi-select, and Shift-click to add or remove from the selection.
  The marquee may drag beyond the Document edge.
- Smart guides with 6 px snapping to other objects, the Document edges, and the
  center. Holding Alt mid-drag suspends snapping while the guides stay visible.
- Alt-drag to duplicate an object, a group, or a whole multi-selection in one undo step.
- Single-level grouping with an entered-group mode and clip-aware targeting; editing a
  child in place re-fits the group rather than clipping it.
- Lock objects so they stay selectable but inert, with read-only properties.
- Align (a lone object to the Document, two or more to each other), arrange, flip, and
  an object-level opacity slider. Locked objects are skipped by all of them.
- Snapshot undo/redo, 100 steps deep, with selection restored on every step. Slider
  drags and color-picker previews record one step at commit rather than per event.
- The working draft is persisted locally and comes back on refresh.
- Zoom and viewport: Fit on load, a 10–800% range with presets, scroll-driven pan,
  pointer-anchored zoom on Ctrl/Cmd + wheel and touchpad pinch, and a fullscreen
  preview toggle that hides the sidebar and stage toolbar.
- Cardinal document rotation.

**Shapes**

- Square, Circle, Rectangle, Oval, and Triangle, each sized against the Document it
  lands on rather than a fixed sheet.
- Borders of a fixed pixel width centered on the cut edge — a 4 px border stays 4 px
  whether the sticker is 1 inch or 4 — including in vector exports.
- Fill and border colors through a dedicated picker popover, opened from the swatch.

**Text**

- Ten bundled font families, self-hosted, with per-textbox styling: family, size,
  weight, color, bold, italic, underline, alignment, line height, letter spacing, and
  uppercase.
- Type is auto-fit to content until you resize the box yourself.
- Font family and weight preview on hover without committing; moving off reverts.
- Bold and italic disable themselves with an explanation when a family ships no real
  bold or italic face — no faux slanting.

**Artwork**

- Graphics search against Pixabay and image search against Unsplash, with infinite
  scroll, a loading spinner on the embedding card, and search state that survives
  navigation.
- Gallery cards attribute the original author and link to their profile.
- Artwork is embedded at insert time, so a design stays self-contained and exports
  correctly with no live connection to either service.
- Uploads accept any `image/*` plus SVG, with SVG rasterized on import so vectors place
  as visible images. Images scale uniformly with locked aspect ratio.
- An Uploads panel keeps recent uploads for reuse, including images pasted from the
  system clipboard.

**Design file**

- Save downloads a versioned JSON envelope and Import reads it back, validating loudly:
  unknown object types, wrong format markers, and other versions are refused with a
  message rather than silently dropped.
- Three predesigned stickers ship with the app — No Smoking, Heavy Equipment, and
  Awesome Work — and the Designs gallery shows a live thumbnail of each.
- Because a design only makes sense on the shape it was drawn for, the gallery is
  filtered to the Document's current outline.

**Export**

- PNG (alpha preserved), JPEG, PDF, and SVG.
- Raster formats render at a fixed 300 DPI; SVG is vector-true with a real `clipPath`
  and each font's bytes embedded so the file stands alone.
- Every export clips to the Document's Cut line, and rotated documents frame the scene
  at the right offset and size.
- Exports are drawn on a private offscreen canvas, so exporting never touches the live
  document or records an undo step.

**Keyboard**

- Undo/redo, copy/paste, delete, select all, group/ungroup, arrange, zoom, `T` for text,
  Alt-drag to duplicate, and Escape to deselect, exit a group, or revert a text edit.
  Paste also accepts images from the system clipboard.

### Documentation

- `CONTEXT.md` carries the domain glossary — Document, Cut line, Group, Selection,
  Export, Snap, Duplicate, and the catalog terms — and is the entry point for the
  vocabulary the code uses.
- Architectural decisions are recorded under `docs/adr/`.
- The bundled fonts ship their SIL Open Font License texts in `public/licenses/`.

### Known limitations

- Styling is per-textbox; there is no per-character rich text.
- Artwork search needs free Pixabay and Unsplash API keys. Without them those two
  panels report a missing-key error; nothing else in the app depends on them.
- Vite inlines `VITE_*` variables into the client bundle at build time, so those search
  keys ship to end users. Both providers' own client-side examples work the same way.

[1.0.0]: https://github.com/dabonnestor/sticker-studio/releases/tag/v1.0.0
