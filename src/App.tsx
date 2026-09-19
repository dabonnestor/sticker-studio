import { useEffect } from "react"

import { AppShell } from "@/components/app-shell"
import { resolveRoute } from "@/lib/routing"

/**
 * The app's entry — a hand-rolled path switch (no router dependency): `/`
 * renders the editor, and anything else redirects to `/` (see
 * src/lib/routing.ts), so the retired landing, About, and legal page links
 * still land on the editor. The redirect is a full page load rather than a
 * history push, so no popstate handling is needed.
 */
function App() {
  const route = resolveRoute(window.location.pathname)

  useEffect(() => {
    if (route === "redirect") window.location.replace("/")
  }, [route])

  if (route === "editor") return <AppShell />
  return null
}

export default App
