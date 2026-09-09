import { useEffect } from "react"

import { AppShell } from "@/components/app-shell"
import { LandingPage } from "@/components/landing-page"
import { resolveRoute } from "@/lib/routing"

/**
 * The app's entry — a hand-rolled path switch (no router dependency):
 * `/` renders the landing page, `/editor` renders the editor, anything
 * else redirects to `/` (see src/lib/routing.ts). Links between the two
 * are plain anchors — a full page load, so no popstate handling is needed.
 */
function App() {
  const route = resolveRoute(window.location.pathname)

  useEffect(() => {
    if (route === "redirect") window.location.replace("/")
  }, [route])

  if (route === "editor") return <AppShell />
  if (route === "landing") return <LandingPage />
  return null
}

export default App
