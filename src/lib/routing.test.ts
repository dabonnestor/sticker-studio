import { describe, expect, it } from "vitest"

import { resolveRoute } from "@/lib/routing"

/**
 * The hand-rolled path switch: `/` is the editor — the whole app — and
 * anything else redirects to `/`, including the retired `/editor`, `/about`,
 * `/privacy`, and `/terms` paths. Trailing slashes normalize so a static
 * host's SPA fallback can serve `/` either way.
 */
describe("resolveRoute", () => {
  it("maps / to the editor", () => {
    expect(resolveRoute("/")).toBe("editor")
  })

  it("normalizes trailing slashes before matching", () => {
    expect(resolveRoute("//")).toBe("editor")
  })

  it("redirects the retired page paths to /", () => {
    expect(resolveRoute("/editor")).toBe("redirect")
    expect(resolveRoute("/about")).toBe("redirect")
    expect(resolveRoute("/privacy")).toBe("redirect")
    expect(resolveRoute("/terms")).toBe("redirect")
  })

  it("redirects anything else to /", () => {
    expect(resolveRoute("/unknown")).toBe("redirect")
    expect(resolveRoute("/editor/extra")).toBe("redirect")
  })
})
