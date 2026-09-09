/**
 * The app's routes — a hand-rolled path switch (no router dependency):
 * `/` is the landing page, `/editor` is the editor, anything else
 * redirects to `/`. Trailing slashes are normalized so `/editor/` still
 * resolves (a static host's SPA fallback can serve either).
 */
export type Route = "landing" | "editor" | "redirect"

export function resolveRoute(pathname: string): Route {
  const path = pathname.replace(/\/+$/, "") || "/"
  if (path === "/") return "landing"
  if (path === "/editor") return "editor"
  return "redirect"
}
