/**
 * Test environment shim. The suite runs in jsdom (Fabric's text classes
 * measure glyphs via a real DOM document); jsdom has no canvas 2D context, so
 * `getContext("2d")` returns null and Fabric's measuring crashes. Install a
 * deterministic fake context: `measureText` returns 10 px per character, so
 * text widths in tests are predictable (e.g. `"Text"` measures 40 px) without
 * pulling in the native `canvas` package.
 */
export {}

// jsdom ships no browser storage — auto-persist (map #27) writes the working
// draft to localStorage, so the test surface gets a same-signature in-memory
// substitute. Purely test-env chrome; the browser provides the real key.
if (
  typeof window !== "undefined" &&
  (window as { localStorage?: unknown }).localStorage === undefined
) {
  const store = new Map<string, string>()
  const storage: Storage = {
    get length() {
      return store.size
    },
    key(index: number) {
      return store.size > index ? [...store.keys()][index] : null
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null
    },
    setItem(key: string, value: string) {
      store.set(key, String(value))
    },
    removeItem(key: string) {
      store.delete(key)
    },
    clear() {
      store.clear()
    },
  }
  Object.defineProperty(window, "localStorage", {
    value: storage,
    writable: true,
  })
}

// A shared singleton for canvases the tests don't inspect. jsdom asserts
// paint routing (the workspace overlay mirrors) override `getContext` per
// canvas with their own `createStubContext()` (canvas-stub.ts).
import { createStubContext } from "@/fabric/canvas-stub"

const STUB_CONTEXT = createStubContext()

if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = function getContext(
    kind: string,
  ): CanvasRenderingContext2D | null {
    if (kind === "2d") return STUB_CONTEXT as CanvasRenderingContext2D
    return null
  }
}
