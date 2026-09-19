# Sticker Studio

A client-side sticker design editor. Arrange shapes, text, and artwork on a canvas
that *is* the sticker's outline, then export print-ready files at 300 DPI — with the
cut line already drawn, because the shape you designed on is the cut.

Everything runs in the browser — no backend, no account. Your design lives in the tab,
and the only requests that leave it are artwork searches against Pixabay and Unsplash.

## Demo

[**▶ Watch the demo**](public/sticker-studio-demo.mp4) — 87 seconds, 1920×1080.

<video src="public/sticker-studio-demo.mp4" controls width="100%" title="Sticker Studio demo"></video>

<!-- GitHub strips <video> elements whose src is a repo-relative path, so on GitHub
     the link above is the way to reach the clip (the <video> renders on forges and
     Markdown previewers that permit it). For an inline player on GitHub itself,
     drag the file into a GitHub issue or comment box and put the resulting
     user-attachments URL in the src above, replacing the relative path. -->

## What it is

The document model is the canvas itself: a Fabric.js stage where every element is an
object with real geometry, and the whole thing serializes to a single JSON Design
file that round-trips.

The idea that shapes the rest of the app is the **Cut line**. There is no separate
dieline, no bleed layer, no offset path to maintain. A sticker's shape is its cut, and
that outline clips the stage and every export — content outside it is simply not on the
sticker. On a shape object, the border is centered on the cut and holds a fixed pixel
width as you scale, so a 4 px border stays 4 px whether the sticker is 1 inch or 4.

## Features

**Canvas & editing**
- Move, scale, and rotate; rotation snaps to 15° detents
- Marquee select, multi-select, Shift-click to add or remove
- Smart guides with snapping to other objects, the document edges, and the center —
  hold Alt mid-drag to suspend snapping while the guides stay visible
- Alt-drag to duplicate an object, a group, or a whole multi-selection in one undo step
- Group and ungroup; double-click to enter a group and edit a child in place
- Lock objects so they stay selectable but inert
- Align (a lone object aligns to the document, two or more to each other), arrange,
  flip, and an opacity slider
- Undo/redo, 100 steps deep, with selection restored
- Your working draft is persisted locally and comes back on refresh

**Shapes** — Square, Circle, Rectangle, Oval, and Triangle, each sized against the
document it lands on rather than a fixed sheet.

**Text** — ten bundled font families, self-hosted, with per-textbox styling: family,
size, weight, color, bold, italic, underline, alignment, line height, letter spacing,
and uppercase. Type is auto-fit to content until you resize the box yourself. Font
family and weight preview on hover without committing. Bold and italic disable
themselves with an explanation when a family ships no real bold or italic face — no
faux slanting. Styling is per-textbox; there is no per-character rich text.

**Artwork** — search Pixabay for illustrations and Unsplash for photographs from
inside the app. Artwork is embedded at insert time, so a design stays self-contained
and exports correctly with no live connection to either service. Uploads accept any
`image/*` plus SVG (rasterized on import), and recent uploads — including images
pasted from the system clipboard — are kept for reuse.

**Design file** — Save downloads a versioned JSON envelope and Import reads it back,
validating loudly instead of silently dropping anything it doesn't understand: unknown
object types, wrong format markers, and other versions are all refused with a message.
Three predesigned stickers ship with the app, and the Designs gallery shows a live
thumbnail of each. Because a design only makes sense on the shape it was drawn for, the
gallery is filtered to your document's current outline.

**Export** — PNG (alpha preserved), JPEG, PDF, and SVG. Raster formats render at a
fixed 300 DPI; SVG is vector-true with a real `clipPath` and each font's bytes embedded
so the file stands alone. Exports are drawn on a private offscreen canvas, so exporting
never touches the live document or records an undo step.

## Getting started

Requires Node and [pnpm](https://pnpm.io) — the repo is a pnpm workspace and a hook
rejects npm.

```bash
pnpm install
pnpm dev        # dev server with HMR
```

Then open the URL Vite prints. The editor is the whole app; `/` is the only route, and
any other path redirects there.

### Optional: enabling artwork search

The Graphics and Images panels are backed by third-party APIs and need free keys.
Without them those two panels report a missing-key error rather than showing an empty
grid — nothing else in the app depends on them.

```bash
cp .env.example .env.local
```

Fill in `VITE_PIXABAY_KEY` and `VITE_UNSPLASH_KEY`. Note that Vite inlines `VITE_*`
variables into the client bundle at build time, so **the key ships to end users** —
never put a secret there. Both providers' own client-side examples work the same way.

### Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Dev server with HMR |
| `pnpm build` | Type-check and build to `dist/` |
| `pnpm preview` | Serve the production build locally |
| `pnpm test` | Run the test suite (Vitest) |
| `pnpm test:watch` | Tests in watch mode |
| `pnpm lint` | Lint with Oxlint |

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl/Cmd + Y` | Redo |
| `Ctrl/Cmd + C` / `V` | Copy / paste objects (also pastes images from the clipboard) |
| `Delete` / `Backspace` | Delete selection |
| `Ctrl/Cmd + A` | Select all |
| `Ctrl/Cmd + G` / `Shift + G` | Group / ungroup |
| `Ctrl/Cmd + ]` / `[` | Arrange forward / backward |
| `Ctrl/Cmd + Shift + ]` / `[` | Bring to front / send to back |
| `Ctrl/Cmd + =` / `−` / `0` | Zoom in / out / fit |
| `Ctrl/Cmd + wheel` | Zoom anchored at the pointer |
| `T` | Add text |
| `Alt + drag` | Duplicate |
| `Alt` (mid-drag) | Suspend snapping |
| `Ctrl/Cmd + Enter` | Commit a text edit |
| `Escape` | Deselect, exit a group, or revert a text edit |

## Project layout

```
src/
  components/   UI shell, panels, and the contextual canvas toolbar
  fabric/       Canvas logic — one module per concern, each with its own tests
  lib/          Framework-free helpers (units, routing, ids, color)
public/
  designs/      Bundled predesigned stickers
  licenses/     SIL OFL texts for the bundled fonts
```

Canvas behavior lives in `src/fabric/`, deliberately split by concern — shapes, text,
groups, alignment, snapping, history, export, the catalog clients — so each can be
tested without a browser. `CONTEXT.md` is the domain glossary and is the best entry
point for the vocabulary the code uses: Document, Cut line, Group, Selection, Export,
Snap, Duplicate.

`pnpm test` runs 704 tests across 32 files.

## License

Sticker Studio's source code is released under the [MIT License](LICENSE).

**What you make is yours.** Designs you create with Sticker Studio — stickers,
labels, exports — belong to you, and you may use them for any purpose, including
commercially. The MIT License covers the code; it claims nothing over your output.

**Third-party assets are not covered by it.** The bundled fonts are licensed
under the SIL Open Font License, and their license texts ship in
`public/licenses/`. Artwork you find through the built-in catalog (illustrations
from Pixabay, photographs from Unsplash) stays under those providers' terms — the
MIT License does not extend to it, so if you sell a design containing such
artwork, their terms are the ones that apply.
