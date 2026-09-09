/**
 * The app's routes — a hand-rolled path switch (no router dependency):
 * `/` is the landing page, `/editor` is the editor, `/about` is the About
 * page, and `/privacy` and `/terms` are the legal pages, anything else
 * redirects to `/`. Trailing slashes are normalized so `/editor/` still
 * resolves (a static host's SPA fallback can serve either).
 */
export type Route = "landing" | "editor" | "about" | "privacy" | "terms" | "redirect"

export function resolveRoute(pathname: string): Route {
  const path = pathname.replace(/\/+$/, "") || "/"
  if (path === "/") return "landing"
  if (path === "/editor") return "editor"
  if (path === "/about") return "about"
  if (path === "/privacy") return "privacy"
  if (path === "/terms") return "terms"
  return "redirect"
}
