import {
  ActiveSelection,
  Circle,
  Ellipse,
  FabricImage,
  Group,
  Point,
  Rect,
  Textbox,
  Triangle,
  type Object as FabricObject,
  type TMat2D,
} from "fabric"
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest"

import { createStubContext } from "@/fabric/canvas-stub"
import { setLocked } from "@/fabric/document-props"
import { groupObjects, ungroupObjects } from "@/fabric/groups"
import { createShape, setBorderWidth } from "@/fabric/shapes"
import {
  ROTATION_SNAP_DEGREES,
  ROTATE_HANDLE_SIZE,
  createStageCanvas,
  getMarqueeBox,
  getMarqueeQuad,
  getOverlayOffset,
  isPointInCutGeometry,
  renderRotateHandle,
  rotationWithSnap,
} from "@/fabric/stage-canvas"
import { TEXT_DEFAULT_FONT_SIZE, createText } from "@/fabric/text"
import { registerCustomProperties } from "@/fabric/custom-properties"

/** The Document these fixtures sit on — 4×4 in, where a shape is 192 px. */
const DOC = { width: 384, height: 384 }

// The document custom properties (ADR 0002) — the restore tests round-trip a
// locked object and must see its `locked` prop survive save/load.
registerCustomProperties()

/**
 * Marquee viewport mapping (§7 extension). The marquee mirror paints on the
 * workspace overlay in viewport space: the drag's scene-plane start and
 * extent (`_groupSelector`) mapped through the viewport transform, then
 * normalized to a top-left box — the same mapping Fabric's own
 * `_drawSelection` uses, shared with the tests.
 */
describe("getMarqueeBox", () => {
  const IDENTITY: TMat2D = [1, 0, 0, 1, 0, 0]

  it("maps a positive drag to the normalized box", () => {
    const box = getMarqueeBox(
      { x: 100, y: 100, deltaX: 200, deltaY: 150 },
      IDENTITY,
    )
    expect(box).toEqual({ left: 100, top: 100, width: 200, height: 150 })
  })

  it("normalizes a drag up-left (negative deltas)", () => {
    const box = getMarqueeBox(
      { x: 300, y: 250, deltaX: -200, deltaY: -150 },
      IDENTITY,
    )
    expect(box).toEqual({ left: 100, top: 100, width: 200, height: 150 })
  })

  it("transforms through the viewport (zoom 2, translate 50,30)", () => {
    const box = getMarqueeBox(
      { x: 100, y: 100, deltaX: 200, deltaY: 150 },
      [2, 0, 0, 2, 50, 30],
    )
    // start (100,100) → (250,230); extent (300,250) → (650,530)
    expect(box).toEqual({ left: 250, top: 230, width: 400, height: 300 })
  })

  it("returns a zero box for a plain press (no drag)", () => {
    const box = getMarqueeBox({ x: 150, y: 80, deltaX: 0, deltaY: 0 }, IDENTITY)
    expect(box).toEqual({ left: 150, top: 80, width: 0, height: 0 })
  })

  it("can start beyond the Document edge (negative scene coords)", () => {
    const box = getMarqueeBox(
      { x: -120, y: 40, deltaX: 240, deltaY: 160 },
      IDENTITY,
    )
    expect(box).toEqual({ left: -120, top: 40, width: 240, height: 160 })
  })
})

/**
 * The marquee under a rotated viewport (build spec §10): the drag's scene rect
 * is a rotated quad in viewport space, and the two-corner box mapping would
 * paint its axis-aligned bounding box — the wrong shape. The overlay paints
 * the quad corners instead; the selection itself is scene-plane math and is
 * unaffected.
 */
describe("getMarqueeQuad", () => {
  it("returns the four corners in order under the identity transform", () => {
    const quad = getMarqueeQuad(
      { x: 100, y: 100, deltaX: 200, deltaY: 150 },
      [1, 0, 0, 1, 0, 0],
    )
    expect(quad).toEqual([
      new Point(100, 100),
      new Point(300, 100),
      new Point(300, 250),
      new Point(100, 250),
    ])
  })

  it("rotates with a 90° viewport — a quad, not the bbox of its corners", () => {
    // A 600×400 Document at 90°: [0, 1, −1, 0, 400, 0] maps each scene corner
    // x' = −y + 400, y' = x. The axis-aligned bbox of the four images would
    // be 150×200 at (150,100) — the quad preserves the rotation.
    const quad = getMarqueeQuad(
      { x: 100, y: 100, deltaX: 200, deltaY: 150 },
      [0, 1, -1, 0, 400, 0],
    )
    expect(quad).toEqual([
      new Point(300, 100),
      new Point(300, 300),
      new Point(150, 300),
      new Point(150, 100),
    ])
  })

  it("degenerates to a point for a plain press (no drag)", () => {
    const quad = getMarqueeQuad(
      { x: 150, y: 80, deltaX: 0, deltaY: 0 },
      [1, 0, 0, 1, 0, 0],
    )
    expect(quad).toEqual([
      new Point(150, 80),
      new Point(150, 80),
      new Point(150, 80),
      new Point(150, 80),
    ])
  })
})

/**
 * Uniform scaling (build spec §5 shapes, §6 text) — the stage's
 * `object:scaling` handler freezes the aspect ratio at the gesture start, so
 * a corner drag never distorts the object. Driven with synthetic events, the
 * same way the interaction wiring is tested elsewhere.
 */
describe("uniform scaling", () => {
  let canvas: ReturnType<typeof createStageCanvas>

  beforeEach(() => {
    canvas = createStageCanvas(
      document.createElement("canvas"),
      document.createElement("canvas"),
    )
  })

  afterEach(async () => {
    await canvas.dispose()
  })

  /** A synthetic scaling tick — `corner` picks the handle (mt/mb vs corners). */
  function scale(obj: FabricObject, corner?: string) {
    canvas.fire("object:scaling", {
      target: obj,
      transform: corner ? { corner } : undefined,
    } as never)
  }

  it("freezes a shape's aspect ratio at the gesture start", () => {
    const shape = createShape("square", DOC)
    canvas.add(shape)
    shape.set({ scaleX: 2, scaleY: 1 }) // gesture tick 1 — the start ratio
    scale(shape)
    shape.set({ scaleX: 3 }) // later ticks derive scaleY from the frozen ratio
    scale(shape)
    expect(shape.scaleX / shape.scaleY).toBeCloseTo(2, 10)
    expect(shape.scaleY).toBeCloseTo(1.5, 10)
  })

  it("re-stamps the clip on every scale tick — the fixed-px border's clip extension divides by the scale", () => {
    const shape = createShape("square", DOC)
    canvas.add(shape)
    setBorderWidth(shape, 8)
    shape.set({ scaleX: 2, scaleY: 2 })
    scale(shape) // fires object:scaling — the handler re-stamps the clip
    // the extension is 8/2 = 4 local px at ×2, holding the stroke's outer
    // edge on screen (192·2 + 8)
    expect((shape.clipPath as Rect).width).toBe(196)
    expect((shape.clipPath as Rect).height).toBe(196)
    expect(shape.strokeWidth).toBe(8) // the border itself never thickened
  })

  it("scales text uniformly like a shape — a corner scale keeps auto-fit (a size change, not a width handoff)", () => {
    const text = createText()
    canvas.add(text)
    text.set({ scaleX: 1.5, scaleY: 0.5 }) // gesture start — the ratio
    scale(text)
    text.set({ scaleX: 3 }) // later tick — scaleY derives; auto-fit survives
    scale(text)
    expect(text.scaleX / text.scaleY).toBeCloseTo(3, 10)
    expect(text.scaleY).toBeCloseTo(1, 10)
    expect(text.autoFit).toBe(true)
  })

  it("a committed text scale bakes into the size — the toolbar readout follows the corner drag", () => {
    const text = createText()
    canvas.add(text)
    text.set({ scaleX: 2, scaleY: 2 }) // the corner drag's committed scale
    canvas.fire("object:modified", { target: text } as never)
    // The size field is the text's source of truth (§6): the gesture folds
    // into fontSize, the box keeps the drawn width (2.4 × 2 = 4.8 — the
    // unmeasured box's creation width), landing exactly where the drag left
    // it, and the transform resets — no stale scale is left on the object.
    expect(text.fontSize).toBe(TEXT_DEFAULT_FONT_SIZE * 2)
    expect(text.width).toBe(4.8)
    expect(text.scaleX).toBe(1)
    expect(text.scaleY).toBe(1)
  })

  it("the gesture-end bake leaves shapes carrying their scale — they have no size field", () => {
    const shape = createShape("square", DOC)
    canvas.add(shape)
    shape.set({ scaleX: 2, scaleY: 2 })
    canvas.fire("object:modified", { target: shape } as never)
    expect(shape.scaleX).toBe(2)
    expect(shape.scaleY).toBe(2)
  })

  it("a text member's folded scale bakes when a scaled multi-selection dissolves (§7)", () => {
    // Scaling a set scales the ActiveSelection; its members only receive the
    // scale when the selection dissolves (Fabric folds the transform on
    // deselect). Selecting the text after that fold must bake the folded
    // scale into the size, or the toolbar reads the pre-set size.
    const text = createText()
    const shape = createShape("square", DOC)
    canvas.add(text, shape)
    const selection = new ActiveSelection([text, shape], { canvas })
    selection.set({ scaleX: 2, scaleY: 2 })
    canvas.setActiveObject(selection)
    canvas.fire("object:modified", { target: selection } as never)
    canvas.discardActiveObject() // the deselect folds the set's scale into the members
    expect(text.scaleX).toBe(2) // the folded state — stale size before the bake
    canvas.setActiveObject(text) // selection:created — the bake runs
    expect(text.fontSize).toBe(TEXT_DEFAULT_FONT_SIZE * 2)
    expect(text.scaleX).toBe(1)
    expect(text.scaleY).toBe(1)
  })

  it("a committed transform clears the frozen ratio for the next gesture", () => {
    const shape = createShape("square", DOC)
    canvas.add(shape)
    shape.set({ scaleX: 2, scaleY: 1 })
    scale(shape)
    canvas.fire("object:modified", { target: shape } as never)
    // A fresh gesture re-records from the committed state.
    shape.set({ scaleX: 4, scaleY: 2 })
    scale(shape)
    shape.set({ scaleX: 6 })
    scale(shape)
    expect(shape.scaleY).toBeCloseTo(3, 10)
  })

  it("square/rectangle keep the side handles — corners and sides scale", () => {
    const shape = createShape("square", DOC)
    canvas.add(shape)
    // No `_controlsVisibility` overrides were ever set, so every handle is
    // visible by default: ml/mr scale the width, mt/mb the height, freely
    // (§5), and the corners scale uniformly.
    expect(shape._controlsVisibility).toBeUndefined()
    for (const key of ["ml", "mr", "mt", "mb", "tl", "tr", "br", "bl"] as const) {
      expect(shape.isControlVisible(key)).toBe(true)
    }
  })

  it("circle/oval/triangle stay corner-handles-only — every side hidden", () => {
    const circle = createShape("circle", DOC)
    canvas.add(circle)
    for (const handle of ["ml", "mt", "mr", "mb"] as const) {
      expect(circle._controlsVisibility[handle]).toBe(false)
    }
    expect(circle._controlsVisibility.tr).toBeUndefined() // corners scale
  })

  it("text hides the top/bottom handles — corners scale, the wrap handles stay", () => {
    const text = createText()
    canvas.add(text)
    // A Y-only top/bottom drag would distort the glyphs and the uniform lock
    // pins it dead — so mt/mb are hidden, like a shape's side handles.
    expect(text._controlsVisibility.mt).toBe(false)
    expect(text._controlsVisibility.mb).toBe(false)
    expect(text._controlsVisibility.tr).toBeUndefined() // corners scale uniformly
    expect(text._controlsVisibility.ml).toBeUndefined() // wrap width (§6)
    expect(text._controlsVisibility.mr).toBeUndefined()
  })

  it("an image hides the side handles — corner-handles-only, like a circle", () => {
    const img = new FabricImage({ width: 100, height: 100 } as HTMLImageElement)
    canvas.add(img)
    // A side-handle drag would stretch the pixels non-uniformly — the same
    // corner-handles-only surface as circle/oval/triangle.
    for (const handle of ["ml", "mt", "mr", "mb"] as const) {
      expect(img._controlsVisibility[handle]).toBe(false)
    }
    expect(img._controlsVisibility.tr).toBeUndefined() // corners scale
  })

  it("scales an image uniformly like a circle — the aspect ratio is frozen at the gesture start", () => {
    const img = new FabricImage({ width: 100, height: 100 } as HTMLImageElement)
    canvas.add(img)
    img.set({ scaleX: 2, scaleY: 1 }) // gesture tick 1 — the start ratio
    scale(img)
    img.set({ scaleX: 3 }) // later ticks derive scaleY from the frozen ratio
    scale(img)
    expect(img.scaleX / img.scaleY).toBeCloseTo(2, 10)
    expect(img.scaleY).toBeCloseTo(1.5, 10)
  })
})

/**
 * Free axis scaling (build spec §5): square and rectangle expose all four
 * side handles, so a drag on one scales that axis freely — mt/mb change the
 * height, ml/mr the width — and a square can grow into a taller or wider
 * rectangle. The `object:scaling` handler reads the dragged corner off the
 * transform and lets the side handles through without freezing the aspect
 * ratio; corner drags keep the uniform lock.
 */
describe("free axis scaling (square/rectangle)", () => {
  let canvas: ReturnType<typeof createStageCanvas>

  beforeEach(() => {
    canvas = createStageCanvas(
      document.createElement("canvas"),
      document.createElement("canvas"),
    )
  })

  afterEach(async () => {
    await canvas.dispose()
  })

  /** A synthetic scaling tick — `corner` picks the handle (mt/mb vs corners). */
  function scale(obj: FabricObject, corner?: string) {
    canvas.fire("object:scaling", {
      target: obj,
      transform: corner ? { corner } : undefined,
    } as never)
  }

  it("a top-handle drag scales the height freely — no ratio frozen", () => {
    const shape = createShape("square", DOC)
    canvas.add(shape)
    shape.set({ scaleX: 2, scaleY: 1 })
    scale(shape, "mt") // vertical drag — the ratio lock never engages
    shape.set({ scaleY: 1.75 })
    scale(shape, "mt")
    expect(shape.scaleY).toBeCloseTo(1.75, 10) // not derived from scaleX
    expect(shape.scaleX / shape.scaleY).not.toBeCloseTo(2, 10)
  })

  it("a bottom-handle drag works the same as the top handle", () => {
    const shape = createShape("rectangle", DOC)
    canvas.add(shape)
    shape.set({ scaleX: 1, scaleY: 1 })
    scale(shape, "mb")
    shape.set({ scaleY: 0.5 })
    scale(shape, "mb")
    expect(shape.scaleY).toBeCloseTo(0.5, 10)
  })

  it("a left-handle drag scales the width freely — no ratio frozen", () => {
    const shape = createShape("square", DOC)
    canvas.add(shape)
    shape.set({ scaleX: 1, scaleY: 2 })
    scale(shape, "ml") // horizontal drag — the ratio lock never engages
    shape.set({ scaleX: 1.5 })
    scale(shape, "ml")
    expect(shape.scaleX).toBeCloseTo(1.5, 10) // not derived from scaleY
    expect(shape.scaleX / shape.scaleY).not.toBeCloseTo(0.5, 10)
  })

  it("a right-handle drag scales the width freely on a rectangle", () => {
    const shape = createShape("rectangle", DOC)
    canvas.add(shape)
    shape.set({ scaleX: 1, scaleY: 1 })
    scale(shape, "mr")
    shape.set({ scaleX: 2.5 })
    scale(shape, "mr")
    expect(shape.scaleX).toBeCloseTo(2.5, 10)
  })

  it("a horizontal drag after a vertical drag keeps both axes free", () => {
    const shape = createShape("square", DOC)
    canvas.add(shape)
    shape.set({ scaleX: 1, scaleY: 2 }) // height already scaled via mt
    scale(shape, "mt")
    shape.set({ scaleX: 3 }) // now a width-only gesture
    scale(shape, "mr")
    shape.set({ scaleX: 4 })
    scale(shape, "mr")
    expect(shape.scaleX).toBeCloseTo(4, 10)
    expect(shape.scaleY).toBeCloseTo(2, 10) // untouched by the width drag
  })

  it("a corner drag after a vertical drag freezes the new aspect", () => {
    const shape = createShape("square", DOC)
    canvas.add(shape)
    shape.set({ scaleX: 2, scaleY: 1.5 }) // taller than wide from a mt drag
    scale(shape, "mt") // no ratio recorded
    shape.set({ scaleX: 4 }) // corner gesture tick 1 — records the ratio
    scale(shape, "br")
    shape.set({ scaleX: 5 }) // later tick — scaleY derives from the frozen ratio
    scale(shape, "br")
    expect(shape.scaleX / shape.scaleY).toBeCloseTo(4 / 1.5, 10)
  })

  it("a vertical drag on a circle stays ratio-locked like every corner drag", () => {
    const circle = createShape("circle", DOC)
    canvas.add(circle)
    circle.set({ scaleX: 2, scaleY: 2 })
    scale(circle, "mt")
    circle.set({ scaleX: 3 })
    scale(circle, "mt")
    // mt/mb are hidden on a circle — a tick with that corner still cannot
    // break the lock, so scaleY keeps deriving from the frozen ratio.
    expect(circle.scaleX / circle.scaleY).toBeCloseTo(1, 10)
    expect(circle.scaleY).toBeCloseTo(3, 10)
  })
})

/**
 * Scaling modifier keys (§5 shapes, §6 text, §7 groups and multi-selections):
 * Fabric reads two modifier keys during a scale gesture — `uniScaleKey`
 * (shift) flips the canvas's uniform corner scaling *off*, so the drag pulls
 * the two axes apart at their own rates, and `altActionKey` (shift) turns a
 * side-handle scale into a skew. Neither has a meaning here: a corner drag
 * always holds the aspect ratio (the ratio lock above) and a square/rectangle
 * side drag always scales its own axis. The canvas disables both (`null` —
 * Fabric's documented "feature disabled" value), which is what covers the
 * containers: the ratio lock reads a shape kind off the object, so an
 * ActiveSelection or a Group — the surfaces whose corners are their only
 * handles — kept the free path, and a shifted corner drag distorted them.
 * Driven through the controls' own action handlers — the path a real pointer
 * takes — with a transform built the way Fabric builds one at pointerdown.
 */
describe("scaling modifier keys", () => {
  let canvas: ReturnType<typeof createStageCanvas>

  beforeEach(() => {
    canvas = createStageCanvas(
      document.createElement("canvas"),
      document.createElement("canvas"),
    )
  })

  afterEach(async () => {
    await canvas.dispose()
  })

  /** The anchor origin Fabric picks at pointerdown: the opposite handle. */
  function originFor(corner: string) {
    return {
      x: corner.includes("l") ? "right" : corner.includes("r") ? "left" : "center",
      y: corner.includes("t") ? "bottom" : corner.includes("b") ? "top" : "center",
    }
  }

  /** The scene point of a handle — on an unrotated, unflipped object. */
  function handlePoint(obj: FabricObject, corner: string) {
    const box = obj.getBoundingRect()
    const x = corner.includes("l") ? 0 : corner.includes("r") ? box.width : box.width / 2
    const y = corner.includes("t") ? 0 : corner.includes("b") ? box.height : box.height / 2
    return { x: box.left + x, y: box.top + y }
  }

  /** A scale drag through the handle's own action handler, shift or not. */
  function dragHandle(
    obj: FabricObject,
    corner: string,
    to: { x: number; y: number },
    { shiftKey = false }: { shiftKey?: boolean } = {},
  ) {
    const from = handlePoint(obj, corner)
    const transform = {
      target: obj,
      corner,
      originX: originFor(corner).x,
      originY: originFor(corner).y,
      ex: from.x,
      ey: from.y,
      scaleX: obj.scaleX,
      scaleY: obj.scaleY,
      skewX: obj.skewX,
      skewY: obj.skewY,
      original: {
        scaleX: obj.scaleX,
        scaleY: obj.scaleY,
        skewX: obj.skewX,
        skewY: obj.skewY,
        angle: obj.angle,
        left: obj.left,
        top: obj.top,
        flipX: obj.flipX,
        flipY: obj.flipY,
      },
    }
    obj.controls[corner].actionHandler?.(
      { shiftKey } as never,
      transform as never,
      to.x,
      to.y,
    )
  }

  /** A br drag out to twice the width and half the height — the free path
   * would land on 2 × 0.5, the locked path on one factor for both axes. */
  function stretchTo(obj: FabricObject) {
    const box = obj.getBoundingRect()
    return { x: box.left + box.width * 2, y: box.top + box.height * 0.5 }
  }

  it("a multi-selection corner drag holds the set's ratio with shift held", () => {
    // A fresh set per run — the drag itself moves and scales the fixture.
    const drag = (shiftKey: boolean) => {
      const text = createText()
      const shape = createShape("square", DOC)
      canvas.add(text, shape)
      const selection = new ActiveSelection([text, shape], { canvas })
      canvas.setActiveObject(selection)
      dragHandle(selection, "br", stretchTo(selection), { shiftKey })
      return { x: selection.scaleX, y: selection.scaleY }
    }
    const shifted = drag(true)
    const plain = drag(false)
    expect(shifted.x).toBeCloseTo(plain.x, 10) // shift reaches the same scale…
    expect(shifted.y).toBeCloseTo(plain.y, 10)
    expect(shifted.x).toBeCloseTo(shifted.y, 10) // …a single factor: undistorted
    expect(shifted.x).toBeGreaterThan(1) // and the drag really did scale the set
  })

  it("a group corner drag holds its ratio with shift held", () => {
    const drag = (shiftKey: boolean) => {
      const shape = createShape("square", DOC)
      const text = createText()
      canvas.add(shape, text)
      const group = groupObjects(canvas, [shape, text])!
      canvas.setActiveObject(group)
      dragHandle(group, "br", stretchTo(group), { shiftKey })
      return { x: group.scaleX, y: group.scaleY }
    }
    const shifted = drag(true)
    const plain = drag(false)
    expect(shifted.x).toBeCloseTo(plain.x, 10)
    expect(shifted.y).toBeCloseTo(plain.y, 10)
    expect(shifted.x).toBeCloseTo(shifted.y, 10)
    expect(shifted.x).toBeGreaterThan(1)
  })

  it("a side-handle drag scales its own axis with shift held — it never skews", () => {
    const shape = createShape("square", DOC)
    canvas.add(shape)
    const box = shape.getBoundingRect()
    // The skew Fabric applies on shift reads the pointer's offset along the
    // *other* axis — this drag carries both, the motion that sheared it.
    dragHandle(
      shape,
      "mr",
      { x: box.left + box.width * 1.5, y: box.top + box.height },
      { shiftKey: true },
    )
    expect(shape.skewX).toBe(0)
    expect(shape.skewY).toBe(0)
    expect(shape.scaleX).toBeCloseTo(1.5, 10) // the width took the drag
    expect(shape.scaleY).toBe(1) // the height stayed put
  })
})

/**
 * Resize-handle cursors (build spec §5, rotation-aware): the aspect-ratio
 * lock makes every corner drag a diagonal gesture, so the corners show a
 * diagonal cursor instead of Fabric's quadrant-based one — which reports
 * `n`/`s`/`e`/`w` at the corners of narrow or wide boxes (auto-fitted
 * text!), so text corners never matched the diagonal a squarish shape
 * shows. The diagonal rotates with the object, snapped to the nearest of
 * the native axis/diagonal keywords — CSS has no rotated cursor arrows.
 */
describe("corner handle cursors", () => {
  let canvas: ReturnType<typeof createStageCanvas>

  beforeEach(() => {
    canvas = createStageCanvas(
      document.createElement("canvas"),
      document.createElement("canvas"),
    )
  })

  afterEach(async () => {
    await canvas.dispose()
  })

  /**
   * The cursor the canvas would show over the given control: the same path
   * `_setCursorFromEvent` takes — findControl at the control's own point,
   * then the control's cursorStyleHandler. Probes one pixel off the exact
   * center: Fabric's hit test casts a ray left from the probe, and a ray
   * from the exact center of a rotated handle passes through the hit box's
   * own vertex, double-counting the crossing (the handle reports a miss —
   * a pointer can't sit on that exact float point in practice).
   */
  function cursorAt(obj: FabricObject, key: string) {
    obj.setCoords()
    const corner = obj.findControl(
      new Point(obj.oCoords[key].x + 1, obj.oCoords[key].y + 1),
    )
    if (!corner) throw new Error(`no control at ${key}`)
    return corner.control.cursorStyleHandler?.(
      undefined as never,
      corner.control,
      obj,
      corner.coord,
    )
  }

  it("shape corners show the diagonal cursors", () => {
    const shape = createShape("square", DOC)
    canvas.add(shape)
    canvas.setActiveObject(shape)
    expect(cursorAt(shape, "tl")).toBe("nwse-resize")
    expect(cursorAt(shape, "br")).toBe("nwse-resize")
    expect(cursorAt(shape, "tr")).toBe("nesw-resize")
    expect(cursorAt(shape, "bl")).toBe("nesw-resize")
  })

  it("text corners match shapes — even on a wide auto-fitted box", () => {
    const text = createText()
    text.set({ width: 300, height: 28.8 })
    canvas.add(text)
    canvas.setActiveObject(text)
    // Fabric's quadrant cursor would report `w-resize` here — the corner of
    // a 300×29 box sits ~straight left of the center. The diagonal keeps the
    // same affordance shapes show.
    expect(cursorAt(text, "tl")).toBe("nwse-resize")
    expect(cursorAt(text, "br")).toBe("nwse-resize")
    expect(cursorAt(text, "tr")).toBe("nesw-resize")
    expect(cursorAt(text, "bl")).toBe("nesw-resize")
  })

  it("rotates the corner diagonals with the object", () => {
    const shape = createShape("square", DOC)
    canvas.add(shape)
    canvas.setActiveObject(shape)
    // A 90° turn puts tl at the top-right — its diagonal now runs 135°.
    shape.set({ angle: 90 })
    expect(cursorAt(shape, "tl")).toBe("nesw-resize")
    expect(cursorAt(shape, "br")).toBe("nesw-resize")
    expect(cursorAt(shape, "tr")).toBe("nwse-resize")
    expect(cursorAt(shape, "bl")).toBe("nwse-resize")
    // 45° puts every corner on an axis — the arrows snap to the natives.
    shape.set({ angle: 45 })
    expect(cursorAt(shape, "tl")).toBe("ns-resize")
    expect(cursorAt(shape, "tr")).toBe("ew-resize")
  })

  it("snaps between the 45° steps to the nearest native keyword", () => {
    const shape = createShape("square", DOC)
    canvas.add(shape)
    canvas.setActiveObject(shape)
    // 15° of rotation puts the tl diagonal at 60° — no native keyword can
    // express it, so the arrow lands on the closest one (45°).
    shape.set({ angle: 15 })
    expect(cursorAt(shape, "tl")).toBe("nwse-resize")
    expect(cursorAt(shape, "tr")).toBe("nesw-resize")
  })

  it("mirrors the corner diagonal under a flip", () => {
    const shape = createShape("square", DOC)
    canvas.add(shape)
    canvas.setActiveObject(shape)
    // A flipX puts the tl corner top-right — its drag line runs 135°, not
    // 45° — so the arrow mirrors with the box.
    shape.set({ flipX: true })
    expect(cursorAt(shape, "tl")).toBe("nesw-resize")
    shape.set({ flipX: false, flipY: true })
    expect(cursorAt(shape, "tl")).toBe("nesw-resize")
    // Both flips cancel — the corner returns to the 45° diagonal.
    shape.set({ flipX: true, flipY: true })
    expect(cursorAt(shape, "tl")).toBe("nwse-resize")
  })

  it("rotates the side-handle arrows with a square/rectangle", () => {
    const shape = createShape("square", DOC)
    canvas.add(shape)
    canvas.setActiveObject(shape)
    // 90° puts the width axis on the vertical — ml sits at the top, mt at
    // the right — and each arrow follows its own axis.
    shape.set({ angle: 90 })
    expect(cursorAt(shape, "ml")).toBe("n-resize")
    expect(cursorAt(shape, "mr")).toBe("s-resize")
    expect(cursorAt(shape, "mt")).toBe("e-resize")
    expect(cursorAt(shape, "mb")).toBe("w-resize")
    // Between the steps the axis arrow snaps to the nearest compass keyword.
    shape.set({ angle: 15 })
    expect(cursorAt(shape, "ml")).toBe("w-resize")
    expect(cursorAt(shape, "mt")).toBe("n-resize")
  })

  it("rotates text's wrap-handle arrows too", () => {
    // A wide text, so the wrap handles' hit boxes stay apart at 90° (the
    // auto-fitted default is a few pixels tall — the two handles overlap).
    const text = createText((s) => s.length * 10)
    canvas.add(text)
    canvas.setActiveObject(text)
    // The ml/mr wrap handles scale the width (§6) — at 90° the width axis
    // is vertical, so the arrows point north and south.
    text.set({ angle: 90 })
    expect(cursorAt(text, "ml")).toBe("n-resize")
    expect(cursorAt(text, "mr")).toBe("s-resize")
  })
})

/**
 * Overlay offset mapping (§7 extension). The marquee and the selection
 * controls mirror paint on the workspace overlay; the Document's position
 * inside the overlay — the canvas rect minus the overlay rect — is the
 * translate that glues the paint to the scene at any zoom or scroll. Pure,
 * so the overlay paints and the tests share one mapping.
 */
describe("getOverlayOffset", () => {
  it("maps identical origins to a zero offset", () => {
    expect(getOverlayOffset({ left: 0, top: 0 }, { left: 0, top: 0 })).toEqual({
      x: 0,
      y: 0,
    })
  })

  it("maps a Document right/down of the overlay origin positively", () => {
    expect(
      getOverlayOffset({ left: 200, top: 100 }, { left: 100, top: 40 }),
    ).toEqual({ x: 100, y: 60 })
  })

  it("maps an overlay larger than the Document rect negatively", () => {
    expect(
      getOverlayOffset({ left: 100, top: 40 }, { left: 200, top: 100 }),
    ).toEqual({ x: -100, y: -60 })
  })

  it("uses only the rects' left/top", () => {
    // DOMRects carry width/height too — a structurally wider rect works.
    const documentRect = { left: 120, top: 80, width: 600, height: 600 }
    const overlayRect = { left: 60, top: 20, width: 1200, height: 800 }
    expect(getOverlayOffset(documentRect, overlayRect)).toEqual({ x: 60, y: 60 })
  })
})

/**
 * Selection controls mirror (§7 extension): a selected object's selection
 * box, corner handles, and rotation handle paint on the workspace overlay
 * instead of the lower canvas — whose bitmap is the Document's size, so
 * anything past the Document edge was invisible there. The paint is
 * Fabric's own `_renderControls` (unmodified), so locked objects mirror
 * borders only and the handles stay draggable past the edge. Driven with
 * per-instance 2D-context stubs, so the paint routing is observable — the
 * shared stub in vitest.setup.ts cannot tell the surfaces apart.
 */
describe("selection controls mirror", () => {
  let canvas: ReturnType<typeof createStageCanvas>
  let lowerCtx: CanvasRenderingContext2D
  let overlayCtx: CanvasRenderingContext2D
  let overlayElement: HTMLCanvasElement

  /**
   * A stage canvas whose lower and overlay canvases carry distinct stubbed
   * contexts. The lower canvas's own context is swapped before creation, so
   * the render paints into it are observable; the overlay's context records
   * the mirrored paint.
   */
  function mountMirrorHarness() {
    const element = document.createElement("canvas")
    overlayElement = document.createElement("canvas")
    lowerCtx = createStubContext()
    overlayCtx = createStubContext()
    vi.spyOn(element, "getContext").mockReturnValue(lowerCtx)
    vi.spyOn(overlayElement, "getContext").mockReturnValue(overlayCtx)
    canvas = createStageCanvas(element, overlayElement)
  }

  /** The marquee internals the mirror tests drive directly. */
  function rawCanvas() {
    return canvas as unknown as {
      _groupSelector: {
        x: number
        y: number
        deltaX: number
        deltaY: number
      } | null
      _drawSelection(ctx: CanvasRenderingContext2D): void
    }
  }

  beforeEach(() => {
    mountMirrorHarness()
  })

  afterEach(async () => {
    await canvas.dispose()
  })

  it("paints a selected object's controls on the overlay, not the lower canvas", () => {
    const shape = createShape("square", DOC)
    canvas.add(shape)
    canvas.setActiveObject(shape)
    shape.setCoords()
    canvas.renderAll()
    // The selection border and the four transparent corners paint via
    // strokeRect — on the overlay, where they stay visible past the edge.
    expect(overlayCtx.strokeRect).toHaveBeenCalled()
    expect(overlayCtx.fillRect).not.toHaveBeenCalled() // no marquee this frame
    expect(lowerCtx.strokeRect).not.toHaveBeenCalled() // nothing clipped away
  })

  it("glues the mirrored controls to the Document's position in the overlay", () => {
    const shape = createShape("square", DOC)
    canvas.add(shape)
    canvas.setActiveObject(shape)
    shape.setCoords()
    // Document at (200,100) inside a workspace overlay starting at (100,40).
    vi.spyOn(canvas.upperCanvasEl, "getBoundingClientRect").mockReturnValue({
      left: 200,
      top: 100,
    } as DOMRect)
    vi.spyOn(overlayElement, "getBoundingClientRect").mockReturnValue({
      left: 100,
      top: 40,
    } as DOMRect)
    canvas.renderAll()
    // The selection box composes with relative calls on the base — the
    // offset rides the base translate. The handle renderer resets the
    // transform absolutely; the shim folds the offset into that reset —
    // dpr 1 in jsdom, so the offset is literal. Both must land at (100,60).
    expect(overlayCtx.translate).toHaveBeenCalledWith(100, 60)
    expect(overlayCtx.setTransform).toHaveBeenCalledWith(1, 0, 0, 1, 100, 60)
  })

  it("clears the overlay when nothing is selected", () => {
    canvas.renderAll()
    expect(overlayCtx.clearRect).toHaveBeenCalled()
    expect(overlayCtx.strokeRect).not.toHaveBeenCalled()
    expect(overlayCtx.fillRect).not.toHaveBeenCalled()
  })

  it("mirrors a locked object's border only — no handles", () => {
    const shape = createShape("square", DOC)
    canvas.add(shape)
    setLocked(shape, true)
    canvas.setActiveObject(shape)
    shape.setCoords()
    canvas.renderAll()
    expect(overlayCtx.strokeRect).toHaveBeenCalled()
    expect(overlayCtx.fillRect).not.toHaveBeenCalled()
  })

  it("paints the rotation badge on the overlay for a multi-selection", () => {
    const shape = createShape("square", DOC)
    shape.set({ left: 100, top: 100 })
    const text = createText((s) => s.length * 10)
    text.set({ left: 300, top: 300 })
    canvas.add(shape, text)
    const selection = new ActiveSelection([shape, text], { canvas })
    canvas.setActiveObject(selection)
    selection.setCoords()
    canvas.renderAll()
    // The badge's white circle is the only `fill` in the selection chrome —
    // the member boxes stroke and the transparent corners stroke — so a fill
    // on the overlay proves the badge painted with the controls.
    expect(overlayCtx.fill).toHaveBeenCalled()
  })

  it("a marquee commit wipes the stale rect before painting the new controls", () => {
    const shape = createShape("square", DOC)
    canvas.add(shape)
    canvas.selectionColor = "rgba(0, 0, 0, 0.3)"
    canvas.selectionBorderColor = "#000"
    canvas.selectionLineWidth = 1
    // A finished marquee leaves its rect on the overlay.
    const raw = rawCanvas()
    raw._groupSelector = { x: 100, y: 100, deltaX: 150, deltaY: 120 }
    raw._drawSelection(canvas.getContext())
    expect(overlayCtx.fillRect).toHaveBeenCalled() // the marquee fill
    // The commit render (mouseup) selects the object and repaints controls.
    raw._groupSelector = null
    canvas.setActiveObject(shape)
    shape.setCoords()
    canvas.renderAll()
    const [lastClear] = vi.mocked(overlayCtx.clearRect).mock.invocationCallOrder.slice(-1)
    const [lastMarqueeFill] = vi.mocked(overlayCtx.fillRect).mock.invocationCallOrder.slice(-1)
    const [lastStroke] = vi.mocked(overlayCtx.strokeRect).mock.invocationCallOrder.slice(-1)
    expect(lastClear).toBeGreaterThan(lastMarqueeFill) // stale marquee wiped
    expect(lastStroke).toBeGreaterThan(lastClear) // controls survive the wipe
  })

  it("a renderTop-only frame keeps the previous frame's selection chrome", () => {
    const shape = createShape("square", DOC)
    canvas.add(shape)
    canvas.setActiveObject(shape)
    shape.setCoords()
    canvas.renderAll()
    expect(overlayCtx.strokeRect).toHaveBeenCalled()
    vi.mocked(overlayCtx.clearRect).mockClear()
    // A zero-delta pointer jitter between down and up paints nothing, and
    // Fabric's mouseup falls back to `renderTop` — whose after:render must
    // not wipe the selection chrome from the previous frame.
    canvas.renderTop()
    expect(overlayCtx.clearRect).not.toHaveBeenCalled()
  })

  it("a deselect wipes the chrome before the armed-marquee commit render", () => {
    const shape = createShape("square", DOC)
    canvas.add(shape)
    canvas.setActiveObject(shape)
    shape.setCoords()
    canvas.renderAll()
    const strokesBefore = vi.mocked(overlayCtx.strokeRect).mock.calls.length
    expect(strokesBefore).toBeGreaterThan(0) // chrome painted
    // The deselect click's commit render paints nothing (drawControls
    // early-returns with no active object) and finalizeOverlayFrame keeps
    // the overlay while the marquee is armed by the same pointerdown — so
    // without the wipe, a no-move click (mouse:up renders nothing) would
    // leave the previous frame's handles on the workspace forever.
    canvas.discardActiveObject()
    const clearTimes = vi.mocked(overlayCtx.clearRect).mock.invocationCallOrder
    const strokeTimes = vi.mocked(overlayCtx.strokeRect).mock.invocationCallOrder
    expect(Math.max(...clearTimes)).toBeGreaterThan(Math.max(...strokeTimes))
    // The armed-marquee render that follows paints nothing new.
    const raw = rawCanvas()
    raw._groupSelector = { x: 100, y: 100, deltaX: 0, deltaY: 0 }
    canvas.renderAll()
    expect(vi.mocked(overlayCtx.strokeRect).mock.calls.length).toBe(strokesBefore)
  })

  it("a render during an active marquee does not clear the marquee", () => {
    const raw = rawCanvas()
    raw._groupSelector = { x: 100, y: 100, deltaX: 150, deltaY: 120 }
    raw._drawSelection(canvas.getContext())
    expect(overlayCtx.fillRect).toHaveBeenCalled() // the marquee fill
    // A render while the drag is still in progress — the first render runs
    // the hasLostContext path, which repaints the marquee; the end-of-frame
    // sweep must not erase it (the overlay holds no controls this frame).
    canvas.renderAll()
    const lastClear = Math.max(
      ...vi.mocked(overlayCtx.clearRect).mock.invocationCallOrder,
    )
    const lastFill = Math.max(
      ...vi.mocked(overlayCtx.fillRect).mock.invocationCallOrder,
    )
    expect(lastClear).toBeLessThan(lastFill) // no clear after the marquee
  })
})

/**
 * Mirrored-selection cursor (§7 extension): Fabric's cursor updates stop at
 * the upper-canvas edge — the pointer past the Document is not over it — so
 * the mirrored chrome would read `auto`. The canvas answers the cursor the
 * workspace should show with the same path Fabric's `_setCursorFromEvent`
 * runs in-document: `findControl` at the pointer's viewport point, then the
 * control's own `cursorStyleHandler`. jsdom's disconnected canvases report
 * a zero rect, so client coordinates here are viewport coordinates.
 */
describe("mirrored selection cursor", () => {
  let canvas: ReturnType<typeof createStageCanvas>

  beforeEach(() => {
    canvas = createStageCanvas(
      document.createElement("canvas"),
      document.createElement("canvas"),
    )
  })

  afterEach(async () => {
    await canvas.dispose()
  })

  /** The cursor the workspace shows for the client point. */
  function cursorAt(clientX: number, clientY: number) {
    return canvas.getWorkspaceCursor(clientX, clientY)
  }

  it("shows the diagonal cursors on corner handles past the Document edge", () => {
    const shape = createShape("square", DOC)
    shape.set({ left: -60, top: -60 }) // hangs off the top-left corner
    canvas.add(shape)
    canvas.setActiveObject(shape)
    shape.setCoords()
    // The controls sit at negative viewport coords — past the Document edge,
    // where Fabric's own cursor updates can no longer reach the pointer.
    expect(shape.oCoords.tl.x).toBeLessThan(0)
    expect(cursorAt(shape.oCoords.tl.x, shape.oCoords.tl.y)).toBe("nwse-resize")
    expect(cursorAt(shape.oCoords.br.x, shape.oCoords.br.y)).toBe("nwse-resize")
    expect(cursorAt(shape.oCoords.tr.x, shape.oCoords.tr.y)).toBe("nesw-resize")
    expect(cursorAt(shape.oCoords.bl.x, shape.oCoords.bl.y)).toBe("nesw-resize")
  })

  it("rotates the corner cursors on the mirrored chrome", () => {
    const shape = createShape("square", DOC)
    shape.set({ left: -60, top: -60, angle: 90 }) // rotated, off the corner
    canvas.add(shape)
    canvas.setActiveObject(shape)
    shape.setCoords()
    // The rotation-aware handler answers on the mirrored surface too — the
    // same path the in-document hover takes.
    expect(cursorAt(shape.oCoords.tl.x, shape.oCoords.tl.y)).toBe("nesw-resize")
  })

  it("shows the wrap arrows on a text's mirrored wrap handles past the edge", () => {
    // The text's ml/mr wrap handles carry the rotation-aware side cursor,
    // not the corner diagonal override — it must not crash on the synthetic
    // event `getWorkspaceCursor` passes (it never reads it), or the
    // workspace would keep its default `auto` cursor.
    const text = createText((s) => s.length * 10)
    text.set({ left: -60, top: -60 }) // hangs off the top-left corner
    canvas.add(text)
    canvas.setActiveObject(text)
    text.setCoords()
    expect(cursorAt(text.oCoords.ml.x, text.oCoords.ml.y)).toBe("w-resize")
    expect(cursorAt(text.oCoords.mr.x, text.oCoords.mr.y)).toBe("e-resize")
  })

  it("shows the diagonal cursors on a mirrored multi-selection's corners", () => {
    // The ActiveSelection wrapper never fires `object:added`, so its corners
    // only get the rotation-aware corner cursors from the selection hooks —
    // and without them the stock quadrant handler would crash the workspace
    // mousemove on the synthetic event, leaving the cursor `auto`.
    const text = createText((s) => s.length * 10)
    text.set({ left: -60, top: -60 })
    const shape = createShape("square", DOC)
    shape.set({ left: -140, top: -140 })
    canvas.add(text, shape)
    const selection = new ActiveSelection([text, shape], { canvas })
    canvas.setActiveObject(selection)
    selection.setCoords()
    expect(selection.oCoords.tl.x).toBeLessThan(0) // past the Document edge
    expect(cursorAt(selection.oCoords.tl.x, selection.oCoords.tl.y)).toBe(
      "nwse-resize",
    )
    expect(cursorAt(selection.oCoords.br.x, selection.oCoords.br.y)).toBe(
      "nwse-resize",
    )
    expect(cursorAt(selection.oCoords.tr.x, selection.oCoords.tr.y)).toBe(
      "nesw-resize",
    )
    expect(cursorAt(selection.oCoords.bl.x, selection.oCoords.bl.y)).toBe(
      "nesw-resize",
    )
  })

  it("shows the rotation cursor on the mirrored rotation handle", () => {
    const shape = createShape("square", DOC)
    shape.set({ left: -60, top: -60 })
    canvas.add(shape)
    canvas.setActiveObject(shape)
    shape.setCoords()
    expect(cursorAt(shape.oCoords.mtr.x, shape.oCoords.mtr.y)).toBe("crosshair")
  })

  it("shows the object's hover cursor over the mirrored selection box", () => {
    const shape = createShape("square", DOC)
    shape.set({ left: 100, top: 100 })
    canvas.add(shape)
    canvas.setActiveObject(shape)
    shape.setCoords()
    // The box interior — off every corner's hit area — is the object's own
    // hover affordance, the "move" an in-document hover would show.
    const { tl, br } = shape.oCoords
    expect(cursorAt((tl.x + br.x) / 2, (tl.y + br.y) / 2)).toBe("move")
  })

  it("keeps the workspace default cursor past no mirrored chrome", () => {
    const shape = createShape("square", DOC)
    // left/top are the center (Fabric 7's default origin) — a 192px square
    // centered at (100,100) spans (4,4)-(196,196) plus the handle pads.
    shape.set({ left: 100, top: 100 })
    canvas.add(shape)
    canvas.setActiveObject(shape)
    shape.setCoords()
    expect(cursorAt(400, 400)).toBe("") // in-document, clear of the chrome
    expect(cursorAt(700, 700)).toBe("") // past the edge, empty workspace
  })

  it("keeps the default cursor with no selection", () => {
    expect(cursorAt(30, 30)).toBe("")
  })

  it("keeps the default cursor while a marquee drag is in progress", () => {
    const shape = createShape("square", DOC)
    shape.set({ left: -60, top: -60 })
    canvas.add(shape)
    canvas.setActiveObject(shape)
    shape.setCoords()
    // The marquee fills the overlay — no selection chrome to hover, so even
    // a point on a control must not offer its cursor mid-drag.
    const raw = canvas as unknown as {
      _groupSelector: { x: number; y: number; deltaX: number; deltaY: number }
    }
    raw._groupSelector = { x: 100, y: 100, deltaX: 150, deltaY: 120 }
    expect(cursorAt(shape.oCoords.tl.x, shape.oCoords.tl.y)).toBe("")
    expect(cursorAt(shape.oCoords.br.x, shape.oCoords.br.y)).toBe("")
  })
})

/**
 * Multi-selection chrome — the ActiveSelection wrapper never fires
 * `object:added`, so the add-time chrome (the rotation badge, the fixed
 * diagonal corner cursors, corners-only visibility) would skip it and it
 * would keep Fabric's stock controls: a plain square rotation handle, the
 * quadrant corner cursor, and the side handles that stretch the set
 * non-uniformly. The selection hooks apply the same chrome the members got.
 */
describe("multi-selection chrome", () => {
  let canvas: ReturnType<typeof createStageCanvas>

  beforeEach(() => {
    canvas = createStageCanvas(
      document.createElement("canvas"),
      document.createElement("canvas"),
    )
  })

  afterEach(async () => {
    await canvas.dispose()
  })

  /** A two-object ActiveSelection, as a Shift-click multi-select builds it. */
  function buildSelection() {
    const shape = createShape("square", DOC)
    shape.set({ left: 100, top: 100 })
    const text = createText((s) => s.length * 10)
    text.set({ left: 300, top: 300 })
    canvas.add(shape, text)
    const selection = new ActiveSelection([shape, text], { canvas })
    canvas.setActiveObject(selection) // fires selection:created
    selection.setCoords()
    return selection
  }

  it("shows the rotation badge on the multi-selection handle", () => {
    const selection = buildSelection()
    const rotate = selection.controls.mtr
    expect(rotate.render).toBe(renderRotateHandle)
    expect(rotate.sizeX).toBe(ROTATE_HANDLE_SIZE)
    expect(rotate.sizeY).toBe(ROTATE_HANDLE_SIZE)
  })

  it("keeps the chrome when the selection changes", () => {
    const selection = buildSelection()
    canvas.fire("selection:updated", {} as never) // re-applied — a no-op, not a reset
    expect(selection.controls.mtr.render).toBe(renderRotateHandle)
    expect(selection.isControlVisible("tl")).toBe(true)
  })

  it("hides the side handles — the set scales uniformly from corners only", () => {
    const selection = buildSelection()
    for (const key of ["ml", "mt", "mr", "mb"]) {
      expect(selection.isControlVisible(key)).toBe(false)
    }
    expect(selection.isControlVisible("tl")).toBe(true)
    expect(selection.isControlVisible("br")).toBe(true)
    expect(selection.isControlVisible("mtr")).toBe(true)
  })

  it("scales a multi-selection up from its corner handle", () => {
    const selection = buildSelection()
    const raw = canvas as unknown as {
      calcOffset(): void
      _offset: { left: number; top: number }
      __onMouseDown(e: MouseEvent): void
      __onMouseMove(e: MouseEvent): void
      __onMouseUp(e: MouseEvent): void
    }
    // jsdom's disconnected canvases report a zero wrapper rect, so
    // `calcOffset` lands on the wrapper's default-margin offsets — client
    // coordinates are viewport coordinates plus that offset, exactly the
    // browser's mapping of a press on the canvas.
    raw.calcOffset()
    const { left, top } = raw._offset
    const br = selection.oCoords.br
    const at = (x: number, y: number) =>
      ({ clientX: x + left, clientY: y + top, shiftKey: false }) as MouseEvent
    raw.__onMouseDown(at(br.x + 1, br.y + 1))
    raw.__onMouseMove(at(br.x + 61, br.y + 61))
    raw.__onMouseMove(at(br.x + 121, br.y + 121))
    raw.__onMouseUp(at(br.x + 121, br.y + 121))
    expect(selection.scaleX).toBeGreaterThan(1)
    expect(selection.scaleX).toBeCloseTo(selection.scaleY, 10)
  })
})

/**
 * Fixed-border cache policy — shapes, groups, and the multi-selection set
 * `noScaleCache` off, so their cache re-renders every frame of a live scale
 * gesture and the strokeUniform border holds its fixed px while dragging
 * (a stale gesture-start cache would stretch the baked stroke and the border
 * would grow with the shape until the gesture commits). The flag is not
 * serialized, so the add boundary re-stamps it on shapes and groups — a JSON
 * restore (undo/redo) would otherwise revive them with the stock
 * artifact-prone default — and the selection hooks stamp the ActiveSelection
 * (never serialized; built fresh per selection).
 */
describe("fixed-border cache policy", () => {
  let canvas: ReturnType<typeof createStageCanvas>

  beforeEach(() => {
    canvas = createStageCanvas(
      document.createElement("canvas"),
      document.createElement("canvas"),
    )
  })

  afterEach(async () => {
    await canvas.dispose()
  })

  it("shapes re-render live while scaling — restored shapes re-stamp on add", () => {
    // A bare Rect stands in for a JSON-restored shape: the policy is not
    // serialized, so it arrives with the stock artifact-prone default.
    const shape = new Rect({ width: 100, height: 100, strokeWidth: 8 })
    expect(shape.noScaleCache).toBe(true)
    canvas.add(shape) // fires object:added — the add boundary re-stamps
    expect(shape.noScaleCache).toBe(false)
  })

  it("groups re-render live while scaling — children keep fixed borders", () => {
    const group = new Group([createShape("square", DOC), createShape("circle", DOC)])
    expect(group.noScaleCache).toBe(true)
    canvas.add(group)
    expect(group.noScaleCache).toBe(false)
  })

  it("the multi-selection re-renders live while scaling", () => {
    const a = createShape("square", DOC)
    const b = createShape("square", DOC)
    canvas.add(a, b)
    const selection = new ActiveSelection([a, b], { canvas })
    expect(selection.noScaleCache).toBe(true)
    canvas.setActiveObject(selection) // fires selection:created
    expect(selection.noScaleCache).toBe(false)
  })
})

/**
 * Rotation snapping (build spec §5) — the rotation handle's action handler
 * rounds every gesture to the nearest 15° multiple, so rotation clicks
 * through detents in both directions. Driven with synthetic events, the same
 * way the interaction wiring is tested elsewhere.
 */
describe("rotation snapping", () => {
  let canvas: ReturnType<typeof createStageCanvas>

  beforeEach(() => {
    canvas = createStageCanvas(
      document.createElement("canvas"),
      document.createElement("canvas"),
    )
  })

  afterEach(async () => {
    await canvas.dispose()
  })

  /** One rotation tick — a drag from 12 o'clock to the given angle. */
  function rotateTo(obj: FabricObject, angleDeg: number) {
    const rad = (deg: number) => (deg * Math.PI) / 180
    const handler = obj.controls.mtr.actionHandler!
    handler(
      {} as PointerEvent,
      {
        target: obj,
        ex: 300,
        ey: 250, // straight above the center
        theta: 0,
        originX: "center",
        originY: "center",
      } as never,
      300 + 100 * Math.sin(rad(angleDeg)),
      300 - 100 * Math.cos(rad(angleDeg)),
    )
  }

  it("a rotation gesture lands on the nearest 15° multiple", () => {
    const shape = createShape("square", DOC)
    shape.set({ left: 300, top: 300 })
    canvas.add(shape)
    rotateTo(shape, 12) // without snapping this would land on 12°
    expect(shape.angle).toBe(ROTATION_SNAP_DEGREES)
  })

  it("snaps symmetrically — a hair of counter-clockwise motion keeps the multiple", () => {
    const shape = createShape("square", DOC)
    shape.set({ left: 300, top: 300 })
    canvas.add(shape)
    // The stock floor-biased handler would throw this to 345°; the nearest
    // multiple keeps 0° — the object never leaps a full step ahead of the
    // pointer.
    rotateTo(shape, -2)
    expect(shape.angle).toBe(0)
  })

  it("keeps an exact multiple untouched", () => {
    const shape = createShape("square", DOC)
    shape.set({ left: 300, top: 300 })
    canvas.add(shape)
    rotateTo(shape, 30)
    expect(shape.angle).toBe(30)
  })

  it("rounds each step at its midpoint", () => {
    const shape = createShape("square", DOC)
    shape.set({ left: 300, top: 300 })
    canvas.add(shape)
    rotateTo(shape, 7) // below 7.5° — down to 0°
    expect(shape.angle).toBe(0)
    rotateTo(shape, 8) // above 7.5° — up to 15°
    expect(shape.angle).toBe(15)
  })

  it("normalizes a counter-clockwise gesture to 0–360", () => {
    const shape = createShape("square", DOC)
    shape.set({ left: 300, top: 300 })
    canvas.add(shape)
    // The nearest multiple of −8° is −15°, shown as 345°.
    rotateTo(shape, -8)
    expect(shape.angle).toBe(345)
  })

  it("wires the snap handler on every object and the multi-selection", () => {
    const shape = createShape("square", DOC)
    shape.set({ left: 100, top: 100 })
    const text = createText((s) => s.length * 10)
    text.set({ left: 300, top: 300 })
    canvas.add(shape, text)
    const selection = new ActiveSelection([shape, text], { canvas })
    canvas.setActiveObject(selection)
    for (const obj of [shape, text, selection]) {
      expect(obj.controls.mtr.actionHandler).toBe(rotationWithSnap)
    }
  })
})

/**
 * Point-in-cut-geometry (build spec §7 Q2) — the pure shape-geometry test
 * behind the clip-aware target finding: a sticker's clipped-out areas count
 * as empty canvas, so the test must match the cut geometry exactly, not the
 * bounding box. Shapes' local geometry is centered at the origin.
 */
describe("isPointInCutGeometry", () => {
  it("circle: the bbox corners are outside the cut", () => {
    const clip = new Circle({ radius: 96 })
    expect(isPointInCutGeometry(clip, new Point(0, 0))).toBe(true)
    expect(isPointInCutGeometry(clip, new Point(90, 90))).toBe(false)
    expect(isPointInCutGeometry(clip, new Point(96, 0))).toBe(true) // on the cut edge
  })

  it("oval: the ellipse equation", () => {
    const clip = new Ellipse({ rx: 144, ry: 96 })
    expect(isPointInCutGeometry(clip, new Point(0, 0))).toBe(true)
    expect(isPointInCutGeometry(clip, new Point(140, 0))).toBe(true)
    expect(isPointInCutGeometry(clip, new Point(0, 95))).toBe(true)
    expect(isPointInCutGeometry(clip, new Point(140, 95))).toBe(false) // bbox corner
  })

  it("rectangle: the full extent", () => {
    const clip = new Rect({ width: 192, height: 192 })
    expect(isPointInCutGeometry(clip, new Point(0, 0))).toBe(true)
    expect(isPointInCutGeometry(clip, new Point(95, 95))).toBe(true)
    expect(isPointInCutGeometry(clip, new Point(97, 0))).toBe(false)
  })

  it("triangle: the base-apex wedge, not its bbox", () => {
    const clip = new Triangle({ width: 288, height: 192 })
    expect(isPointInCutGeometry(clip, new Point(0, -90))).toBe(true) // under the apex
    expect(isPointInCutGeometry(clip, new Point(140, -90))).toBe(false) // bbox corner, outside the wedge
    expect(isPointInCutGeometry(clip, new Point(0, 90))).toBe(true) // base center
  })
})

/**
 * Clip-aware target finding (build spec §7 Q2) — a press inside a shape's
 * bounding box but outside its cut reads as empty canvas: the marquee can
 * start there, and a plain press deselects instead of selecting.
 */
describe("clip-aware target finding", () => {
  let canvas: ReturnType<typeof createStageCanvas>

  beforeEach(() => {
    canvas = createStageCanvas(
      document.createElement("canvas"),
      document.createElement("canvas"),
    )
  })

  afterEach(async () => {
    await canvas.dispose()
  })

  /** Client-coordinate event at a scene point — the offset mapping mirrors
   * the browser's (jsdom's zero wrapper rect, like the pointer tests above). */
  function at(scene: { x: number; y: number }) {
    const raw = canvas as unknown as {
      calcOffset(): void
      _offset: { left: number; top: number }
    }
    raw.calcOffset()
    const { left, top } = raw._offset
    return { clientX: scene.x + left, clientY: scene.y + top } as PointerEvent
  }

  it("a press in a circle's clipped-out corner reads as empty canvas", () => {
    const circle = createShape("circle", DOC)
    circle.set({ left: 300, top: 300 })
    canvas.add(circle)
    circle.setCoords()
    // The bbox corner is transparent — inside the box, outside the cut.
    expect(canvas.findTarget(at(circle.oCoords.tl)).target).toBeUndefined()
    // The center is inside the cut — a press there targets the circle.
    expect(canvas.findTarget(at(circle.getCenterPoint())).target).toBe(circle)
  })

  it("a press on the border hits the shape — the clip extends past the cut", () => {
    const square = createShape("square", DOC)
    square.set({ left: 300, top: 300 })
    setBorderWidth(square, 20) // the border is centered on the cut — the clip extends 10 past it
    canvas.add(square)
    square.setCoords()
    const center = square.getCenterPoint()
    // On the border's outer half — beyond the cut (half 96) but inside the
    // clip (half 106) — the visible border must hit.
    expect(canvas.findTarget(at({ x: center.x + 100, y: center.y })).target).toBe(square)
    // Outside the design entirely — beyond the border's outer edge.
    expect(canvas.findTarget(at({ x: center.x + 110, y: center.y })).target).toBeUndefined()
  })
})

/**
 * Entered group mode (build spec §7 Q5) — double-click enters a group:
 * children become individually targetable for property inspection and Text
 * editing, but are fixed in place; empty presses and Escape exit. The
 * interactions are wired in createStageCanvas, driven here with synthetic
 * events the same way the other wiring tests drive theirs.
 */
describe("entered group mode", () => {
  let canvas: ReturnType<typeof createStageCanvas>
  let group: Group
  let childA: FabricObject
  let childB: FabricObject

  beforeEach(() => {
    canvas = createStageCanvas(
      document.createElement("canvas"),
      document.createElement("canvas"),
    )
    childA = createShape("circle", DOC)
    childA.set({ left: 100, top: 100 })
    childB = createShape("square", DOC)
    childB.set({ left: 400, top: 100 })
    canvas.add(childA, childB)
    group = groupObjects(canvas, [childA, childB])!
    canvas.discardActiveObject()
  })

  afterEach(async () => {
    await canvas.dispose()
  })

  function dblClick(target?: unknown) {
    canvas.fire("mouse:dblclick", { target } as never)
  }

  function press(target?: unknown) {
    canvas.fire("mouse:down", { target } as never)
  }

  /** Client-coordinate event at a scene point (see the target-finding tests). */
  function at(scene: { x: number; y: number }) {
    const raw = canvas as unknown as {
      calcOffset(): void
      _offset: { left: number; top: number }
    }
    raw.calcOffset()
    const { left, top } = raw._offset
    return { clientX: scene.x + left, clientY: scene.y + top } as PointerEvent
  }

  it("double-click enters an unlocked group — children fixed, selection cleared", () => {
    dblClick(group)
    expect(canvas.enteredGroup).toBe(group)
    expect(canvas.getActiveObject()).toBeUndefined()
    // The interactive surface — Fabric's child targeting and the text
    // session gate (§7 Q5 early-verify) — is view state, set while entered.
    expect(group.subTargetCheck).toBe(true)
    expect(group.interactive).toBe(true)
    for (const child of group.getObjects()) {
      expect(child.hasControls).toBe(false)
      expect(child.lockMovementX).toBe(true)
      expect(child.lockMovementY).toBe(true)
      expect(child.lockScalingX).toBe(true)
      expect(child.lockScalingY).toBe(true)
      expect(child.lockRotation).toBe(true)
    }
  })

  it("text children stay editable — only the fixed surface is applied", () => {
    const a = createShape("square", DOC)
    a.set({ left: 100, top: 100 })
    const text = createText((s) => s.length * 10)
    text.set({ left: 700, top: 100 })
    canvas.add(a, text)
    const g = groupObjects(canvas, [a, text])!
    dblClick(g)
    expect(text.editable).toBe(true)
    expect(text.hasControls).toBe(false)
  })

  it("does not enter a locked group", () => {
    group.set("locked", true)
    dblClick(group)
    expect(canvas.enteredGroup).toBeNull()
  })

  it("double-click on a top-level text enters nothing", () => {
    const text = createText((s) => s.length * 10)
    text.set({ left: 700, top: 100 })
    canvas.add(text)
    dblClick(text)
    expect(canvas.enteredGroup).toBeNull()
  })

  it("a double-click on a child while entered stays in the group — no re-entry", () => {
    // The dblclick's target is the child (the findTarget override resolves
    // it); the handler only enters on a Group target, so nothing changes.
    canvas.enterGroup(group)
    dblClick(childA)
    expect(canvas.enteredGroup).toBe(group)
  })

  it("resolves a child under the pointer while entered", () => {
    canvas.enterGroup(group)
    const child = group.getObjects()[1]
    const info = canvas.findTarget(at(child.getCenterPoint()))
    expect(info.target).toBe(child)
  })

  it("the group's empty interior reads as empty canvas", () => {
    canvas.enterGroup(group)
    // Between the two children — inside the group's bbox, on no pixels.
    const info = canvas.findTarget(at({ x: 250, y: 200 }))
    expect(info.target).toBeUndefined()
  })

  it("other top-level objects resolve normally while entered", () => {
    const other = createShape("square", DOC)
    other.set({ left: 600, top: 400 })
    canvas.add(other)
    canvas.enterGroup(group)
    expect(canvas.findTarget(at(other.getCenterPoint())).target).toBe(other)
  })

  it("a press with no target exits the group", () => {
    canvas.enterGroup(group)
    press(undefined)
    expect(canvas.enteredGroup).toBeNull()
  })

  it("a press on a child stays in the group", () => {
    canvas.enterGroup(group)
    press(childA)
    expect(canvas.enteredGroup).toBe(group)
  })

  it("a press on an object outside the group exits it", () => {
    const other = createShape("square", DOC)
    other.set({ left: 600, top: 400 })
    canvas.add(other)
    canvas.enterGroup(group)
    press(other)
    expect(canvas.enteredGroup).toBeNull()
  })

  it("exit restores the pre-enter surface of the children", () => {
    canvas.enterGroup(group)
    canvas.exitEnteredGroup()
    expect(canvas.enteredGroup).toBeNull()
    expect(group.subTargetCheck).toBe(false)
    expect(group.interactive).toBe(false)
    for (const child of group.getObjects()) {
      expect(child.hasControls).toBe(true)
      expect(child.lockMovementX).toBe(false)
      expect(child.lockScalingX).toBe(false)
      expect(child.lockRotation).toBe(false)
    }
  })

  it("a locked child stays inert after the group exits", () => {
    setLocked(childA, true)
    canvas.enterGroup(group)
    canvas.exitEnteredGroup()
    expect(childA.hasControls).toBe(false) // the locked surface remains
    expect(childB.hasControls).toBe(true)
  })

  it("a child unlocked inside its group lands on the entered-fixed surface", () => {
    canvas.enterGroup(group)
    canvas.setLocked(childA, true)
    canvas.setLocked(childA, false)
    expect(childA.lockMovementX).toBe(true) // still fixed — the group is entered
    expect(childA.hasControls).toBe(false)
    canvas.exitEnteredGroup()
    expect(childA.hasControls).toBe(true) // the unlock sticks after the exit
  })

  it("a document restore exits the entered state with no fixed-state leak", async () => {
    canvas.enterGroup(group)
    await canvas.loadFromJSON(canvas.toJSON())
    expect(canvas.enteredGroup).toBeNull()
    const restored = canvas.getObjects()[0] as Group
    for (const child of restored.getObjects()) {
      expect(child.lockMovementX).toBe(false)
      expect(child.hasControls).toBe(true)
    }
  })

  it("a restore re-derives the transform locks of locked objects from the `locked` prop", async () => {
    // Fabric serializes only `stateProperties`; of a locked object's surface
    // only the `locked` prop is among them — `hasControls`, the `lock*`
    // flags, and a text's `editable` are not. A refresh would restore the
    // flag alone and leave the object reporting locked yet fully editable, so
    // the restore must rebuild the inert surface from the flag (§7 Q3).
    setLocked(childA, true) // an individually-locked child inside the group
    const text = createText()
    text.set({ left: 0, top: 0 })
    setLocked(text, true) // a locked top-level text
    canvas.add(text)

    await canvas.loadFromJSON(canvas.toJSON())

    const restoredGroup = canvas.getObjects()[0] as Group
    const [lockedChild] = restoredGroup.getObjects()
    expect(lockedChild.locked).toBe(true)
    expect(lockedChild.hasControls).toBe(false)
    expect(lockedChild.lockMovementX).toBe(true)
    expect(lockedChild.lockScalingY).toBe(true)
    expect(lockedChild.lockRotation).toBe(true)

    const restoredText = canvas.getObjects()[1] as Textbox
    expect(restoredText.locked).toBe(true)
    expect(restoredText.hasControls).toBe(false)
    expect(restoredText.lockMovementX).toBe(true)
    expect(restoredText.editable).toBe(false)
  })

  it("the entered flags never survive a restore — view state, not document state", async () => {
    canvas.enterGroup(group)
    // A snapshot taken mid-entry serializes the flags (Fabric bakes them
    // into the group's JSON); the restore must reset them — children must
    // not come back individually targetable without entering (ADR 0003).
    const payload = canvas.toJSON()
    const groupJson = JSON.stringify(
      (payload as { objects: unknown[] }).objects[0],
    )
    expect(groupJson).toContain("subTargetCheck")
    expect(groupJson).toContain("interactive")
    await canvas.loadFromJSON(payload)
    const restored = canvas.getObjects()[0] as Group
    expect(restored.subTargetCheck).toBe(false)
    expect(restored.interactive).toBe(false)
  })

  it("an ungroup of the entered group dissolves it — the exit still re-fixes the extracted children", () => {
    canvas.enterGroup(group)
    const children = ungroupObjects(canvas, [group])
    expect(children).toHaveLength(2)
    canvas.exitEnteredGroup()
    for (const child of children) {
      expect(child.hasControls).toBe(true)
      expect(child.lockMovementX).toBe(false)
    }
  })
})

/**
 * The stage's Cut line (map #48, ticket #52): the Document's outline is the
 * sticker's boundary, so it clips what the stage paints — the background and
 * the objects through Fabric's canvas `clipPath`, and the document border
 * through a painter that traces the outline itself, because `after:render`
 * runs *after* the clip has been applied.
 *
 * The clip is derived, never stored: it is rebuilt whenever the outline kind
 * or the Document size moves, and it stays out of the payload entirely.
 */
describe("the Cut line clips the stage", () => {
  let canvas: ReturnType<typeof createStageCanvas>
  let lowerCtx: CanvasRenderingContext2D

  /** A stage canvas whose lower context is stubbed, so the paint is observable. */
  function mount() {
    const element = document.createElement("canvas")
    lowerCtx = createStubContext()
    vi.spyOn(element, "getContext").mockReturnValue(lowerCtx)
    canvas = createStageCanvas(element, document.createElement("canvas"))
  }

  /** The last call to a stubbed context method — the frame's final paint of that kind. */
  function lastCallOrder(method: unknown): number {
    return Math.max(...(method as Mock).mock.invocationCallOrder)
  }

  beforeEach(mount)

  afterEach(async () => {
    await canvas.dispose()
  })

  it("boots as a Square sticker — clipped to a 192×192 rect", () => {
    canvas.renderAll()
    expect([canvas.width, canvas.height]).toEqual([192, 192])
    expect(canvas.outline).toBe("rect")
    expect(canvas.aspectLocked).toBe(true)
    const clip = canvas.clipPath as Rect
    expect(clip).toBeInstanceOf(Rect)
    expect([clip.width, clip.height]).toEqual([192, 192])
    // Centered on the Document in scene coordinates, so Fabric's viewport
    // transform carries it through zoom and pan.
    expect([clip.left, clip.top]).toEqual([96, 96])
  })

  it("re-derives the clip when the Document is resized", () => {
    canvas.renderAll()
    canvas.setDimensions({ width: 288, height: 192 })
    canvas.renderAll()
    const clip = canvas.clipPath as Rect
    expect([clip.width, clip.height]).toEqual([288, 192])
    expect([clip.left, clip.top]).toEqual([144, 96])
  })

  it("re-derives the clip when the outline changes shape", () => {
    canvas.renderAll()
    canvas.outline = "oval"
    canvas.aspectLocked = true
    canvas.renderAll()
    const clip = canvas.clipPath as Ellipse
    expect(clip).toBeInstanceOf(Ellipse)
    expect([clip.rx, clip.ry]).toEqual([96, 96])
  })

  it("keeps the derived clip while nothing moves — a render is not a rebuild", () => {
    canvas.renderAll()
    const derived = canvas.clipPath
    canvas.renderAll()
    expect(canvas.clipPath).toBe(derived)
  })

  it("derives over a clipPath a restore installed", async () => {
    canvas.renderAll()
    // A payload from an older build — or a hand-edited one — can carry a clip.
    // The envelope, not the payload, is the source of truth for the outline.
    await canvas.loadFromJSON({
      version: "7.4.0",
      objects: [],
      clipPath: { type: "Rect", width: 10, height: 10, left: 0, top: 0 },
    })
    expect((canvas.clipPath as Rect).width).toBe(10)
    canvas.renderAll()
    expect((canvas.clipPath as Rect).width).toBe(192)
  })

  it("keeps the derived clip out of the payload", () => {
    canvas.renderAll()
    expect(canvas.clipPath).toBeDefined()
    // The History snapshots the canvas with toJSON, and the seed entry is
    // taken before the first render — a clip in the payload would make two
    // otherwise identical Documents compare as changed, which stacks a
    // phantom undo step.
    expect("clipPath" in canvas.toJSON()).toBe(false)
  })

  it("strokes the document border along the outline, not the document rect", () => {
    canvas.borderWidth = 4
    canvas.borderColor = "#18181b"
    canvas.renderAll()
    // The path is the cut, stroked at twice the border's width so the clip
    // can trim the outer half — the visible border is `borderWidth` wide with
    // its outer edge on the cut, flush for every shape.
    expect(vi.mocked(lowerCtx.rect)).toHaveBeenCalledWith(0, 0, 192, 192)
    expect(lowerCtx.lineWidth).toBe(8)
    expect(vi.mocked(lowerCtx.stroke)).toHaveBeenCalled()
    // The rectangle is gone: it was the one thing that escaped the clip, and
    // it would wrap a circle sticker in a rect.
    expect(vi.mocked(lowerCtx.strokeRect)).not.toHaveBeenCalled()
  })

  it("clips the border to the cut, so only its inner half shows", () => {
    canvas.borderWidth = 4
    canvas.renderAll()
    expect(vi.mocked(lowerCtx.clip)).toHaveBeenCalled()
    expect(lastCallOrder(lowerCtx.clip)).toBeLessThan(
      lastCallOrder(lowerCtx.stroke),
    )
  })

  it("follows a circle outline — the border is a ring, not a rectangle", () => {
    canvas.outline = "oval"
    canvas.aspectLocked = true
    canvas.borderWidth = 4
    canvas.renderAll()
    expect(vi.mocked(lowerCtx.ellipse)).toHaveBeenCalledWith(
      96,
      96,
      96,
      96,
      0,
      0,
      Math.PI * 2,
    )
    expect(vi.mocked(lowerCtx.strokeRect)).not.toHaveBeenCalled()
  })

  it("follows a rounded-corner outline at the preset radius", () => {
    canvas.outline = "rounded-rect"
    canvas.borderWidth = 4
    canvas.renderAll()
    expect(vi.mocked(lowerCtx.roundRect)).toHaveBeenCalledWith(
      0,
      0,
      192,
      192,
      23.04,
    )
  })

  it("paints no border at all when the border is off", () => {
    expect(canvas.borderWidth).toBe(0)
    canvas.renderAll()
    expect(vi.mocked(lowerCtx.stroke)).not.toHaveBeenCalled()
    expect(vi.mocked(lowerCtx.clip)).not.toHaveBeenCalled()
  })
})

/**
 * The Document size's aspect lock (map #48, ticket #52) — what the stage
 * toolbar's W and H fields commit through. Square and Circle lock 1:1: the
 * axis the user typed wins and the other mirrors it, never a disabled field.
 * Rectangle, Rounded corner, Oval and Custom resize freely.
 */
describe("setDocumentSize honours the aspect lock", () => {
  let canvas: ReturnType<typeof createStageCanvas>

  beforeEach(() => {
    canvas = createStageCanvas(
      document.createElement("canvas"),
      document.createElement("canvas"),
    )
  })

  afterEach(async () => {
    await canvas.dispose()
  })

  it("boots locked — a Square sticker", () => {
    expect(canvas.aspectLocked).toBe(true)
    expect([canvas.width, canvas.height]).toEqual([192, 192])
  })

  it("mirrors a typed width onto the height on the boot Square", () => {
    canvas.setDocumentSize(300, 192)
    expect([canvas.width, canvas.height]).toEqual([300, 300])
  })

  it("mirrors a typed height onto the width", () => {
    canvas.setDocumentSize(192, 300)
    expect([canvas.width, canvas.height]).toEqual([300, 300])
  })

  it("mirrors on a Circle, which locks 1:1 like Square", () => {
    canvas.outline = "oval"
    canvas.aspectLocked = true
    canvas.setDocumentSize(240, 192)
    expect([canvas.width, canvas.height]).toEqual([240, 240])
  })

  it("resizes freely on the shapes that carry no lock", () => {
    // Rounded corner: the same size pair that mirrors on a Square stays put.
    canvas.outline = "rounded-rect"
    canvas.aspectLocked = false
    canvas.setDocumentSize(300, 192)
    expect([canvas.width, canvas.height]).toEqual([300, 192])
  })

  it("resizes freely as a Rectangle and as a Custom sheet", () => {
    canvas.aspectLocked = false
    canvas.setDocumentSize(288, 192)
    expect([canvas.width, canvas.height]).toEqual([288, 192])
    canvas.setDocumentSize(400, 100)
    expect([canvas.width, canvas.height]).toEqual([400, 100])
  })

  it("honours the 60 px floor the field already enforced", () => {
    // The floor lives in the toolbar (MIN_DOCUMENT_SIZE_PX) — a commit that
    // reached here is at or above it, and the mirror keeps it there.
    canvas.setDocumentSize(60, 60)
    expect([canvas.width, canvas.height]).toEqual([60, 60])
  })

  it("mirrors from the Document's own size, whatever the fields were showing", () => {
    // A locked sheet resized to 300×300, then the width typed back down: the
    // comparison is the Document, so the height follows it down.
    canvas.setDocumentSize(300, 192)
    canvas.setDocumentSize(150, 300)
    expect([canvas.width, canvas.height]).toEqual([150, 150])
  })
})
