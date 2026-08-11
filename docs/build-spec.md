# Sticker Studio — MVP Build Spec

Build-ready specification for the client-side sticker design editor MVP, assembled 2026-08-11 from the wayfinder map's ten resolved decision tickets (issues #2–#12) and ADRs 0001–0003. Each section cites its source decision. The app is **not** built yet; this document is the contract the build sessions implement. Where a decision leaves implementation freedom, the build session picks the concrete markup/UX details within the stated behavior — do not silently change behavior.

## 1. Overview & scope

A Sticker Mule Studio-like client-side editor: a Fabric.js canvas where each sticker is a shape object, edited in the browser and exported as print-ready files. Fully client-side, static-site target, no backend of any kind.

**In scope (MVP)**: stickers (Square, Circle, Rectangle, Oval, Rounded-rectangle), text, image placement, selection & single-level grouping, undo/redo, zoom/viewport, JSON save/import, export to PNG/JPEG/PDF/SVG at 300 DPI (raster), document rotation.

**Explicitly out of scope**: bleed/dieline/cut marks (the canvas shape is the cut line), layers panel, per-run rich text, preset size lists, vector PDF, wheel zoom/pan, multi-page layouts, text-on-curve, custom-shape drawing, collaboration, accounts, cross-session undo history, image editing (crop/filter), any backend/database. See the map's Out of scope list for the full record.

## 2. Stack & architecture

| Concern | Choice | Source |
|---|---|---|
| Framework | React + Vite + TypeScript | charting |
| UI components | shadcn/ui (Radix primitives + Tailwind CSS v4), React 19 | user decision 2026-08-11 |
| Canvas | Fabric.js **7.4.0**, SVG-in-DOM | charting, #2 |
| PDF | jsPDF **4.2.1** (raster embed) | #2, #8 |
| Backend | none — static site | charting |

**Core architectural commitments:**

- **The canvas is the document** — no app-side model. Save/Import/Export/Undo all operate on `canvas.toJSON()` / async `loadFromJSON()`. (#4, ADR 0002)
- **Selection, zoom/pan, and undo history are view state** — never serialized, never undoable steps, never interaction boundaries. (#4, #6, #12, glossary)
- **Pixels are the stored unit** — inches are a view-layer derivation (1 in = 96 screen px; 300 DPI at export). (#9, ADR 0002)
- **One interaction boundary = one undoable step** — end of a transform gesture, exit from a text session, one commit per structural command. (ADR 0001)
- **UI chrome is shadcn/ui** — the entire app shell (§3) is built from shadcn/ui components (Radix primitives + Tailwind CSS v4 via the `@tailwindcss/vite` plugin — CSS-first, no `tailwind.config.js`). This implies React 19. shadcn's Tailwind preflight is a global reset, but Fabric's canvas is inline-styled — no conflict expected; verify no style bleed on the canvas mount element during scaffold. (user decision 2026-08-11)

## 3. App shell & layout

```
┌─────────────────────────────────────────────────────────────┐
│ Top bar:  Logo │ Import File │ Save File │ Export ▾        │
├──────────┬──────────────────────────────────────────────────┤
│ Sidebar  │  Stage: gray workspace (scrollable)             │
│  Text    │    ┌────────────────────────────────────────┐    │
│  Shapes  │    │  Canvas: white, subtle shadow, centered │    │
│  Image   │    │  1px #d0d0d0 edge border (view-only)    │    │
│  Upload  │    └────────────────────────────────────────┘    │
│          │  Stage toolbar (canvas props + selection ctx)    │
├──────────┴──────────────────────────────────────────────────┤
│ Bottom bar:  ↶ ↷ │ − [% ▾] ────slider──── + │ Preview │ ⛶  │
└─────────────────────────────────────────────────────────────┘
```

All chrome — buttons, the Export dropdown, sidebar sections, toolbar inputs, the bottom-bar slider, dialogs — is built from shadcn/ui components; only the stage canvas is Fabric. (user decision 2026-08-11)

- **Top bar**: logo; Import File (opens JSON, §10); Save File (downloads JSON, §10); Export dropdown (PNG/JPEG/PDF/SVG, §11). (#7, #8)
- **Left sidebar**: Text (adds a Text object), Shapes (five shapes), Image Upload (place/scale/rotate only — no crop/filter). (charting)
- **Stage**: gray workspace that scrolls; white canvas with subtle shadow, centered; 1px `#d0d0d0` canvas-edge border on by default, view-only (never exported), toggled in the stage toolbar. (#9)
- **Stage toolbar**: canvas properties (document W×H with unit display, §5; edge-border toggle) plus a **contextual selection section** (§7) visible only while a selection exists. (#9, #10)
- **Bottom bar**: undo/redo buttons (↶ ↷), zoom controls `− [% ▾] + [slider]`, preview, fullscreen, and the status area (export progress/errors). (#8, #12)

## 4. Document model

- One Fabric object per sticker: **fill = background, stroke = border, clipPath = cut line**. (#4)
- **Inset border model**: the sticker's geometry is the area *inside* the border — turning the border on shrinks geometry by half the stroke per side (`width − border`, `rx/radius − border/2`), so the stroke's outer edge sits exactly on the cut path (a cutter never halves the border). The clipPath always sits at the original edge; the **cut geometry is derived** (`width + borderWidth` when the border is on), so it survives JSON restore. (#4)
- Every object carries flat registered Fabric custom props: `id` (required, generated at creation, stable across save/load — undo reselects by it), `name` (optional user label), `locked` (boolean — cannot be moved, resized, edited, or deleted; survives save/load). Text adds `uppercase` and `autoFit`. Groups carry their own `id`/`name`/`locked` like any object. (ADR 0002)
- Custom properties must be registered via Fabric's `customProperties` mechanism at app startup. (ADR 0002)
- Object identity/type list for import validation: known Fabric types only (see §10).

## 5. Sticker shapes, default sizes, units

- **Shapes**: Square, Circle, Rectangle, Oval, Rounded-rectangle. One **default size** per shape, inches-specified / px-stored at the 96 DPI display basis: Square 2×2 → 192×192 px; Circle Ø2 → radius 96 px; Rectangle / Oval / Rounded-rectangle 2×3 → 192×288 px. (#9)
- **Rounded-rectangle corner radius**: 20% of the shorter side at creation, then an independent px property — editable in the toolbar, resize does not re-derive it. (#9)
- **Unit switch (in / mm / px)** is a label swap over stored px: 1 in = 96 px, mm = px ÷ 96 × 25.4. No DPI setting — 300 DPI is export-only. Toolbar W×H converts to px at commit; switching units re-labels without rescaling; decimals in in/mm, integer px display (display-only rounding). Square = one linked value (both sides), Circle = diameter, others W×H. No min/max clamps (the export ceiling governs, §11). (#9)
- **Document size** (stage toolbar): width/height in px — the basis of export dimensions; part of the Design file envelope (§10). (ADR 0002, glossary)

## 6. Text

- Text is a Document object (Fabric **Textbox**), **not a sticker** — no shape of its own, no cut line. (charting, #11)
- **Auto-fit**: the box hugs its content (width auto-fit) at creation and re-fits at the end of each text session, while it has never been manually resized; the first manual resize hands the width to the user and multi-line text wraps at that width. Unset width would collapse to ~2px in Fabric v7 — auto-fit once at add time by measuring the longest line via `ctx.measureText`. (#4, #11)
- **Entering edit**: Fabric v7 — a **second single-click** opens the text session (not double-click). Scale folds into `fontSize` + `width` on `object:scaling`, scale resets to 1 (v7 removed `unscaledText`); glyphs never distort. (#4, #11)
- **Text session** = one interaction boundary: everything typed commits as **one undoable step** at exit; commit on blur / click-away / Ctrl+Enter; **Escape reverts the session** (restores pre-session state) — in-session Ctrl+Z stays field-local. Enter = newline; empty-on-exit restores the string `"Text"`. (#11)
- **Nine properties** in the contextual stage toolbar: family, size (px), weight/italic (**real faces only** — static 400-only families get no faux styling), underline, alignment, line-height (**1.2** default), letter-spacing, uppercase (**one-way** registered flag: stored string is uppercased while set; toggling off stops forcing case but doesn't restore it). (#11)
- **New text box**: at the viewport center, Inter 24 px, enters edit pre-selected. (#11)
- All 10 fonts load at startup via `@font-face`; await `document.fonts.ready` before rasterizing exports; `config.fontPaths` for SVG export (§11, §12). (#3, #11)

## 7. Selection & grouping

Sourced from ticket #10; recorded in ADR 0003; glossary terms **Group** and **Selection**.

- **Selection interactions**: click selects and replaces; Shift-click toggles membership; rubber-band (marquee) selects a set; clicking empty canvas deselects; **Ctrl+A selects all**. (Q1)
- **Rubber-band mechanics**: press-drag on an object is a move gesture; the marquee starts only on empty canvas — a sticker's clipped-out areas count as empty, so a marquee can start inside a shape's bounding box wherever the shape has no pixels. The marquee selects any object whose bounding box **intersects** it (not fully-contained-only). (Q2)
- **Locked objects**: selectable but inert — appear in the selection, show properties read-only in the toolbar (unlock lives there), no transform handles, no transforms, no delete. Marquee includes locked objects; Del deletes only unlocked objects in a mixed selection. (Q3)
- **Grouping — single level**: groups are flat containers of individual objects; **groups never contain groups** (MVP). Group is disabled unless ≥2 objects are selected. If the selection contains an existing group, Group **flattens** it first (children rise to top level, keeping their ids, transforms, and cut lines), then groups everything together. (Q4)
- **Entering a group**: double-click enters — children become individually selectable for (a) inspecting/editing their properties in the toolbar and (b) editing Text (second single-click opens the text session, same as top level). Children inside a group are **fixed**: no free dragging, no individual resize, no delete, no reorder — Ungroup first. Exit: click empty canvas or Escape (outside a text session). (Q5)
- **Control surface**: contextual stage-toolbar section, visible only while a selection exists — Group (Ctrl+G) / Ungroup (Ctrl+Shift+G), Arrange (forward/backward: Ctrl+] / Ctrl+[; to front/back: Ctrl+Shift+] / Ctrl+Shift+[), Flip H/V, Lock toggle. (Q6)
- **Lock levels**: locking a group locks the set as one object — no enter-group, no move/scale/flip/arrange/delete; stays selectable for unlocking. Children can be locked individually: inside a group, a locked child's text session and property edits are blocked, but the group still moves as a whole. (Q7)
- **Group semantics**: one slot in the top-level z-order (children never appear at top level; internal order fixed at group time); arrange/flip/scale/rotate operate on the group as one unit; flip H/V flips the whole group while children keep their own flip, rotation, and cut geometry; deleting a group deletes its children as one undoable step. (Q8, ADR 0003)
- **Undo**: each structural command (group, ungroup, arrange, flip, lock toggle, group delete) is one undoable step; undo restores the selection to the affected group by id. (ADR 0001, ADR 0003)
- **Implementation gotchas** (spike #4): the Group constructor does **not** detach children from the canvas — `canvas.remove(...children)` before `new Group(children)` then `canvas.add(group)`, or JSON duplicates objects; ungroup is the mirror (`canvas.remove(group)` → `group.removeAll()` → `canvas.add(...items)`); sort children by canvas index first — ActiveSelection order is click order, not z-order; `Group.toActiveSelection()` no longer exists in v7.

## 8. Undo/redo

Snapshot-based document-state stack (ADR 0001, #6):

- One full `canvas.toJSON()` snapshot pushed **per interaction boundary**: `object:modified` (end of a move/scale/rotate/flip gesture), `text:editing:exited` (text session exit), and once per structural command (add object, delete, group, ungroup, arrange, lock toggle, property commit, JSON import). The stack's previous entry is the pre-interaction state — nothing is captured mid-gesture, no debouncing.
- **Restore**: async `loadFromJSON`; history recording **suppressed** while a restore runs (restores fire `object:added` storms).
- **Selection restore**: each history entry carries the object ids to reselect after restore (selection is never serialized).
- **Redo**: linear — cleared by any new edit.
- **Depth**: fixed 100 snapshots, oldest dropped (documents are a few KB of JSON — memory is a non-issue).
- **JSON import is an undoable step** (envelope stripped/re-wrapped on the way in/out).
- In-session Ctrl+Z inside a text edit stays **field-local** (never touches the stack).

## 9. Zoom & viewport

Sourced from ticket #12; glossary terms **Zoom** and **Fit**.

- **Mechanism**: Fabric `viewportTransform` — `canvas.setZoom()` / `zoomToPoint()`. Pointer mapping, control rendering, text-edit textarea positioning, and retina (`enableRetinaScaling`) are native Fabric. Scrollbars are the only adapter: the workspace wrapper scrolls, and the viewport translate is derived from scroll offsets — `setViewportTransform([z, 0, 0, z, -scrollX, -scrollY])`. **100% = 1 doc px = 1 CSS px at any DPR.**
- **Fit**: always-fit — scales the whole Document (rotated bounds) up or down into the workspace minus a fixed 48 px margin; **Fit is the default zoom on load**.
- **Range / step / anchor**: 10%–800%; Ctrl+= / Ctrl+− step ±10% about the viewport center; the % readout shows rounded integers.
- **Presets**: Fit, 100%, 150%, 200%.
- **Resize**: workspace resize re-centers at the current zoom; when the canvas no longer fits, scrollbars appear with the scroll position clamped; resize never re-fits.
- **Control surface (bottom bar)**: `− [% ▾] + [slider]` — −/+ step 10%, the % readout opens the preset dropdown, the slider spans the range. **Ctrl+0 = Fit**.
- **View state**: zoom/pan are view state — excluded from the Design file, never undoable steps; export renders an offscreen StaticCanvas at document scale, so zoom never affects output.

## 10. Design file (JSON v1)

ADR 0002, #7:

```json
{ "format": "sticker-studio", "version": 1, "size": { "width": 192, "height": 192 }, "rotation": 0, "canvas": <canvas.toJSON()> }
```

- Thin envelope around Fabric's serialization; the `canvas` payload is loaded verbatim via `loadFromJSON` (Fabric destructures only its known keys — the wrapper is transparent). Pixels are the literal Fabric values; `rotation` is the document rotation (exports render rotated).
- **Save File** = download the envelope JSON (`<design-file-basename>.json`, `untitled` fallback). **Import File** = open → validate → strip envelope → `loadFromJSON` → one undoable step.
- **Validation (reject loudly)**: `format` marker present, `version === 1`, `canvas.objects` is an array of **known object types only** — Fabric's enlivening fails *silently* on unknown types and a silent drop is data loss. Future versions migrate via a documented `migrators: Record<version, fn>` registry run sequentially on load; v1 ships the pattern, not an implementation.
- **Survives import**: objects in z-order (groups nested as one Group object, per-object clipPath cut lines, inset border), background, document size, rotation. **Never in the file**: selection, viewport/zoom/pan, undo history.

## 11. Export pipeline

Sourced from ticket #8. **Export = render the current committed Document** — one shared pipeline for all four formats:

1. **Commit first**: flush any pending text edit (exit editing) before serializing — the same step runs before Save File. The export serializes the live canvas via `canvas.toJSON()`, the same bytes a Design file would carry.
2. **Offscreen render**: `StaticCanvas` via `loadFromJSON` (envelope stripped — render the `canvas` payload). No DOM element, no viewport/zoom/pan, no selection chrome, no workspace background — only the Document. Document rotation applies.
3. **Fonts**: await `document.fonts.ready` before rasterizing; if a family used in the document failed to load → warn in the status area and export with fallback rendering.
4. **Ceiling**: refuse when the 300 DPI raster would exceed **8192 px per side** (browser canvas limits) — clear error in the bottom-bar status area.
5. **Not an undoable step**; never mutates the Document or history.

Per-format:

| Format | Mechanics |
|---|---|
| **PNG** | offscreen render → `toBlob({ format: 'png', multiplier: 3.125 })` (300 DPI; 3.125 = 300/96) → object URL → download. Document background honored, transparent elsewhere (alpha preserved). |
| **JPEG** | same raster composited onto **white** (no alpha), quality **0.95**; document background, when set, renders above the white fill. |
| **SVG** | Fabric `canvas.toSVG()`; per-object clip paths serialize, so the cut line survives as a vector path; **base64-embed the TTF** of each family actually used in the document via `config.fontPaths` (self-contained SVG — Fabric does not auto-collect fonts from the DOM); sanitization stays on (Fabric 7.4 default). |
| **PDF** | jsPDF 4.2.1, single page sized exactly to the Document in points (inches = px/96; 1 in = 72 pt), zero margins, 300 DPI PNG embedded via `addImage` (lossless; transparency preserved when the Document has no background). |

**Interaction**: `<design-file-basename>.<ext>` (fallback `untitled`). Top-bar Export → dropdown (PNG / JPEG / PDF / SVG) → immediate download with a transient "Preparing export…" indicator. Errors surface in the bottom-bar status area.

## 12. Fonts

Sourced from ticket #3. Ten SIL OFL 1.1 fonts (all TrueType — predictable SVG rasterization), ~400–470 KB bundle:

Inter, Work Sans, Barlow, Lora, Playfair Display, Bebas Neue, Anton, Pacifico, Dancing Script, JetBrains Mono.

- OFL permits bundling and exempts documents created with the fonts (sticker exports) from attribution; ship each font's OFL.txt alongside the app.
- Load all 10 at startup via `@font-face`; await `document.fonts.ready` (§11); `config.fontPaths` for SVG export. Weight/italic are real faces only — static 400-only families get no faux styling (§6).

## 13. Hotkeys (consolidated)

| Keys | Action |
|---|---|
| Ctrl+Z / Ctrl+Y | undo / redo (in a text session: field-local) |
| Ctrl+= / Ctrl+− | zoom ±10% about the viewport center |
| Ctrl+0 | Fit |
| Ctrl+A | select all |
| Ctrl+G / Ctrl+Shift+G | group / ungroup |
| Ctrl+] / Ctrl+[ | arrange forward / backward |
| Ctrl+Shift+] / Ctrl+Shift+[ | arrange to front / to back |
| Del | delete selection (skips locked objects) |
| (text session) Ctrl+Enter | commit text session |
| (text session) Escape | revert text session |
| (stage, no text session) Escape | deselect / exit group |

## 14. Spike notes & early-verify items

From the spike (#4) and subsequent decisions — implement in this order of risk:

1. **Grouping plumbing**: constructor doesn't detach children; sort by canvas index; `removeAll` to ungroup (§7).
2. **Scale fold**: fold scale into `fontSize` + `width` on `object:scaling`, reset scale to 1 — glyphs never distort (§6).
3. **Auto-fit at add time**: `ctx.measureText` on the longest line; unset width collapses to ~2px in v7 (§6).
4. **Async everything**: `loadFromJSON` and `dispose()` are async — await them.
5. **v7 origin defaults**: `originX`/`originY` default to center — account for it in geometry math.
6. **Early-verify** (not exercised in the spike): text editing *inside* a group (second single-click within group-edit mode); Enter-group Escape vs text-session Escape interplay; double-click (group entry) coexisting with second-single-click (text entry); marquee over clipped shapes; retina rendering at non-100% zoom.
7. **Reference artifacts** (on branches, not in this tree): spike walkthrough `prototypes/fabric-doc-model.html` (branch `spike/fabric-doc-model`); research `docs/research/fabric-ecosystem.md` (branch `research/fabric-ecosystem`), `docs/research/font-pack.md` (branch `research/font-pack`).

## 15. Build session slicing

Suggested session boundaries (each session builds against this spec, one module per session, verifying its acceptance items):

1. **Scaffold + shell**: Vite + React 19 + TS app; Tailwind CSS v4 (`@tailwindcss/vite` plugin) + shadcn/ui init (`npx shadcn@latest init`); layout (§3), Fabric canvas mount (verify no preflight style bleed), custom-property registration.
2. **Document + shapes + toolbar**: shape model, default sizes, inset border/cut line, unit conversion, stage toolbar (§4, §5).
3. **Text + fonts**: Textbox, auto-fit, scale fold, text session, nine properties, font loading (§6, §12).
4. **Undo/redo**: snapshot stack, boundaries, restore, selection restore, depth 100 (§8).
5. **Selection & grouping**: §7 interactions, contextual toolbar, enter-group, lock levels.
6. **Zoom & viewport**: viewportTransform adapter, Fit, presets, bottom-bar controls, resize behavior (§9).
7. **Design file**: envelope, validation, migrators pattern, Import/Save (§10).
8. **Export pipeline**: shared pipeline, four formats, naming, ceiling, font readiness (§11).

## 16. Acceptance checklist

- [ ] Add each of the five shapes → default sizes land at 96 DPI basis; rounded-rect radius = 20% of shorter side.
- [ ] Border on → geometry shrinks by half the stroke per side; cut geometry derives correctly; round-trips.
- [ ] Text: second single-click edits; session commits as one undoable step; Escape reverts; empty-on-exit restores "Text"; auto-fit until first manual resize.
- [ ] Undo/redo walks every boundary type; redo clears on new edit; selection restored by id; depth capped at 100.
- [ ] Selection: click/shift/marquee (intersect, empty-canvas start incl. clipped areas)/click-empty/Ctrl+A; locked objects selectable but inert; Del skips them.
- [ ] Group: ≥2 required; single level; flatten-on-group; enter via double-click; children fixed; exit click-empty/Escape; arrange/flip/lock per §7; one z-order slot; serialization round-trips (ADR 0002).
- [ ] Zoom: Fit on load; 10–800%; presets; Ctrl+=/−/0; scrollbars drive translate; resize clamps, never re-fits.
- [ ] Save → JSON envelope v1; Import validates loudly (unknown types rejected); import is undoable.
- [ ] Export: all four formats at 300 DPI (3.125 multiplier), document rotation applied, text flushed first, fonts ready awaited, 8192 px ceiling enforced, naming per spec.
- [ ] Every hotkey in §13 works; text-session keys never leak to the document stack.
