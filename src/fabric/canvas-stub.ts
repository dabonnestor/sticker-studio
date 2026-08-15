import { vi } from "vitest"

/**
 * Test-only 2D-context stub (jsdom ships no canvas — see vitest.setup.ts).
 * Each call returns a fresh context whose methods are spies, so a test can
 * give the stage canvas and the workspace overlay distinct contexts and
 * assert paint routing between them: which surface received the marquee or
 * the selection controls, and in what order within a render cycle.
 *
 * The behaviors match the shared stub in vitest.setup.ts: `measureText`
 * returns 10 px per character (so `"Text"` measures 40 px), and the context
 * reports `direction: "ltr"` with a canvas shim — Fabric's text renderer
 * compares the two and touches `ctx.canvas.setAttribute` when they differ.
 */
export function createStubContext(): CanvasRenderingContext2D {
  // `Omit` keeps the direction/canvas shims from intersecting with the DOM
  // types (canvas would demand a full HTMLCanvasElement).
  const context: Omit<Partial<CanvasRenderingContext2D>, "canvas" | "direction"> & {
    direction?: string
    canvas?: { setAttribute(): void }
  } = {
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    direction: "ltr",
    canvas: { setAttribute() {} },
  }
  // Style properties are prototype accessors on a real context — writes
  // through a Proxy receiver throw "Illegal invocation" there. Mirror that
  // with brand-checked accessors, so the context-shim tests catch receiver
  // bugs on property writes the way the browser would.
  const styleStore: Record<string, unknown> = {
    fillStyle: "#000",
    strokeStyle: "#000",
    lineWidth: 1,
    globalAlpha: 1,
    lineDashOffset: 0,
  }
  for (const property of Object.keys(styleStore)) {
    // Configurable so tests can spy on the setters (e.g. which strokeStyle
    // the smart-guides painter stroked with); a spy replaces the descriptor
    // for that test, which is the point.
    Object.defineProperty(context, property, {
      configurable: true,
      get(this: unknown) {
        if (this !== context) throw new TypeError("Illegal invocation")
        return styleStore[property]
      },
      set(this: unknown, value: unknown) {
        if (this !== context) throw new TypeError("Illegal invocation")
        styleStore[property] = value
      },
    })
  }
  /**
   * Real 2D-context methods brand-check their receiver — calling them with
   * a Proxy as `this` throws "Illegal invocation". The stub mirrors that,
   * so the context-shim tests catch receiver bugs the way the browser would.
   */
  function stubFn() {
    return vi.fn(function (this: unknown) {
      if (this !== context) throw new TypeError("Illegal invocation")
    })
  }

  const methods: Array<keyof CanvasRenderingContext2D> = [
    "save",
    "restore",
    "scale",
    "translate",
    "rotate",
    "transform",
    "resetTransform",
    "setTransform",
    "beginPath",
    "closePath",
    "moveTo",
    "lineTo",
    "quadraticCurveTo",
    "bezierCurveTo",
    "arc",
    "arcTo",
    "ellipse",
    "rect",
    "fill",
    "stroke",
    "fillRect",
    "strokeRect",
    "clearRect",
    "clip",
    "setLineDash",
    "drawImage",
    "fillText",
    "strokeText",
    "putImageData",
  ]
  for (const method of methods) {
    // One spy per method — routing tests distinguish strokeRect, fillRect,
    // and clearRect from each other, and compare their call orders.
    ;(context as Record<string, unknown>)[method] = stubFn()
  }
  context.measureText = vi.fn((text: string): TextMetrics => {
    return { width: text.length * 10 } as TextMetrics
  })
  context.getImageData = vi.fn((): ImageData => {
    return { data: new Uint8ClampedArray(4), width: 1, height: 1 } as ImageData
  })
  context.createImageData = vi.fn((): ImageData => {
    return { data: new Uint8ClampedArray(4), width: 1, height: 1 } as ImageData
  })
  context.createLinearGradient = vi.fn(() => {
    return { addColorStop() {} } as unknown as CanvasGradient
  })
  context.createRadialGradient = vi.fn(() => {
    return { addColorStop() {} } as unknown as CanvasGradient
  })
  context.createPattern = vi.fn(() => {
    return null
  })
  return context as unknown as CanvasRenderingContext2D
}
