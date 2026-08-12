/**
 * Test environment shim. The suite runs in jsdom (Fabric's text classes
 * measure glyphs via a real DOM document); jsdom has no canvas 2D context, so
 * `getContext("2d")` returns null and Fabric's measuring crashes. Install a
 * deterministic fake context: `measureText` returns 10 px per character, so
 * text widths in tests are predictable (e.g. `"Text"` measures 40 px) without
 * pulling in the native `canvas` package.
 */
export {}

const STUB_CONTEXT: Partial<CanvasRenderingContext2D> & {
  direction?: string
  canvas?: { setAttribute(): void }
} = {
  font: "",
  textAlign: "left",
  textBaseline: "alphabetic",
  fillStyle: "#000",
  strokeStyle: "#000",
  lineWidth: 1,
  // Fabric's text renderer compares `ctx.direction` to the text's direction
  // and touches `ctx.canvas.setAttribute` when they differ — match "ltr".
  direction: "ltr",
  canvas: { setAttribute() {} },
  measureText(text: string): TextMetrics {
    return { width: text.length * 10 } as TextMetrics
  },
  // Rendering no-ops — the suite measures and serializes, it never paints.
  // The canvas interaction tests drive a real interactive canvas, whose
  // render path (cursor blink animations) walks the full context API, so the
  // common methods are present rather than throwing.
  save() {},
  restore() {},
  scale() {},
  translate() {},
  rotate() {},
  transform() {},
  resetTransform() {},
  setTransform() {},
  beginPath() {},
  closePath() {},
  moveTo() {},
  lineTo() {},
  quadraticCurveTo() {},
  bezierCurveTo() {},
  arc() {},
  arcTo() {},
  ellipse() {},
  rect() {},
  fill() {},
  stroke() {},
  fillRect() {},
  strokeRect() {},
  clearRect() {},
  clip() {},
  setLineDash() {},
  drawImage() {},
  fillText() {},
  strokeText() {},
  getImageData() {
    return { data: new Uint8ClampedArray(4), width: 1, height: 1 }
  },
  createImageData() {
    return { data: new Uint8ClampedArray(4), width: 1, height: 1 }
  },
  putImageData() {},
  createLinearGradient() {
    return { addColorStop() {} } as unknown as CanvasGradient
  },
  createRadialGradient() {
    return { addColorStop() {} } as unknown as CanvasGradient
  },
  createPattern() {
    return null
  },
}

if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = function getContext(
    kind: string,
  ): CanvasRenderingContext2D | null {
    if (kind === "2d") return STUB_CONTEXT as CanvasRenderingContext2D
    return null
  }
}
