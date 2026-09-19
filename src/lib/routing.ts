/**
 * The app's routes — a hand-rolled path switch (no router dependency): `/`
 * is the editor, which is now the whole app. Every other path redirects to
 * `/`, so the retired `/editor`, `/about`, `/privacy`, and `/terms` links
 * and bookmarks still land somewhere useful. Trailing slashes are
 * normalized so `/` still resolves (a static host's SPA fallback can serve
 * either).
 */
export type Route = "editor" | "redirect"

export function resolveRoute(pathname: string): Route {
  const path = pathname.replace(/\/+$/, "") || "/"
  return path === "/" ? "editor" : "redirect"
}
