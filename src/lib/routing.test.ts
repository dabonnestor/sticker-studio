import { describe, expect, it } from "vitest"

import { resolveRoute } from "@/lib/routing"

/**
 * The hand-rolled path switch: `/` is the landing page, `/editor` is the
 * editor, anything else redirects to `/`. Trailing slashes normalize so a
 * static host's SPA fallback can serve `/editor/` and `/` alike.
 */
describe("resolveRoute", () => {
  it("maps / to the landing page", () => {
    expect(resolveRoute("/")).toBe("landing")
  })

  it("maps /editor to the editor", () => {
    expect(resolveRoute("/editor")).toBe("editor")
  })

  it("normalizes a trailing slash", () => {
    expect(resolveRoute("/editor/")).toBe("editor")
  })

  it("redirects anything else to /", () => {
    expect(resolveRoute("/unknown")).toBe("redirect")
    expect(resolveRoute("/editor/extra")).toBe("redirect")
  })
})
