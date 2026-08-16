import type { CanvasEvents, FabricObject } from "fabric"

import type { StageCanvas } from "@/fabric/stage-canvas"

/**
 * Hover border: the object under the pointer shows its selection-style
 * border — 1 px, the object's own `borderColor`, rendered by Fabric's own
 * `_renderControls` with the controls off — before any click. The pointer
 * target is Fabric's own `findTarget` answer, so the border tracks exactly
 * what a press would pick (clip-aware shape cutouts, entered-group
 * children, everything else), and the paint reuses the selection renderer,
 * so the hover reads pixel-for-pixel like the object's selected look at any
 * zoom, rotation, or flip.
 *
 * The border paints on the workspace overlay through the stage's public
 * paint seam, the same as the smart guides: `mouse:over` / `mouse:out`
 * (which fire only on target change, during plain mousemove) update the
 * tracked target and request a render — plain hover moves render nothing by
 * themselves — and an `after:render` painter clears and repaints per frame,
 * skip-clearing while a marquee is live or the selection controls painted
 * this frame (the chrome mirror's own per-frame clear already wipes stale
 * hover paint, so a clear there would only ever hurt it). The target is
 * skipped while it is the active object — its selection chrome already
 * shows, and a member of an active selection (which resolves as its own
 * hover target) already shows its member box — so the hover never
 * double-strokes a selection. Removing the hovered object clears the target
 * immediately; the next mousemove would self-heal it, but the removal's
 * own render must not paint a border at the ghost's old position.
 *
 * The paint lives in the `hovered` state of a view surface: never
 * serialized, never an undoable step. `dispose()` releases the listeners,
 * pinned for the canvas-rebuild lifecycle.
 */
export class HoverBorder {
  /** The object under the pointer — the hover-border target — or null. */
  private hoveredObject: FabricObject | null = null

  private readonly canvas: StageCanvas
  private readonly overHandler: (event: CanvasEvents["mouse:over"]) => void
  private readonly outHandler: () => void
  private readonly removedHandler: (event: { target?: FabricObject }) => void
  private readonly paintHandler: () => void

  constructor(canvas: StageCanvas) {
    this.canvas = canvas
    this.overHandler = this.handleOver.bind(this)
    this.outHandler = this.handleOut.bind(this)
    this.removedHandler = this.handleRemoved.bind(this)
    this.paintHandler = this.paint.bind(this)
    canvas.on("mouse:over", this.overHandler)
    canvas.on("mouse:out", this.outHandler)
    canvas.on("object:removed", this.removedHandler)
    canvas.on("after:render", this.paintHandler)
  }

  /** Release the listeners — the canvas-rebuild lifecycle disposes first. */
  dispose(): void {
    this.canvas.off("mouse:over", this.overHandler)
    this.canvas.off("mouse:out", this.outHandler)
    this.canvas.off("object:removed", this.removedHandler)
    this.canvas.off("after:render", this.paintHandler)
  }

  /** The object under the pointer — null over empty canvas. */
  getHoveredObject(): FabricObject | null {
    return this.hoveredObject
  }

  /**
   * `mouse:over` fires only when the hover target changed — during plain
   * mousemove, which renders nothing — so the change requests a frame for
   * the painter. A target-less entry (the pointer entered the canvas over
   * empty space) clears, like an exit.
   */
  private handleOver(event: CanvasEvents["mouse:over"]): void {
    this.hoveredObject = event.target ?? null
    this.canvas.requestRenderAll()
  }

  /** `mouse:out` fires with the old target when the pointer left it — or
   * left the canvas — so the border clears unconditionally. */
  private handleOut(): void {
    this.hoveredObject = null
    this.canvas.requestRenderAll()
  }

  /** A deletion must not leave the border pointing at the ghost. */
  private handleRemoved(event: { target?: FabricObject }): void {
    if (event.target === this.hoveredObject) this.hoveredObject = null
  }

  /**
   * The overlay painter — a repo `after:render` handler. Paints the
   * hovered object's selection border (no controls) via Fabric's own
   * `_renderControls`, so the hover look is the object's selected look —
   * its borderColor, its borderScaleFactor, its padding, rotation, and
   * flips included. Skips the active object and members of an active
   * selection (both already show selection chrome), and a live marquee
   * (whose own paint owns the overlay — the tracked target is stale
   * during a marquee drag, since over/out events pause while one is
   * armed).
   */
  private paint(): void {
    const obj = this.hoveredObject
    if (!obj) return
    const active = this.canvas.getActiveObject()
    // The active object's own group field is null, so the member test must
    // not run against a null active — `null === null` would skip every
    // hover over an unselected canvas.
    if (active && (obj === active || obj.group === active)) return
    const prepared = this.canvas.prepareOverlay(
      this.canvas.isMarqueeActive() || this.canvas.didPaintControlsThisFrame(),
    )
    if (!prepared) return
    const { ctx, offset } = prepared
    this.canvas.markHoverPainted()
    // The border composes with relative calls on the base — the offset
    // rides the base translate, exactly like the selection box mirror.
    ctx.translate(offset.x, offset.y)
    obj._renderControls(ctx, { hasBorders: true, hasControls: false })
  }
}
