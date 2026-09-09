import { useEffect } from "react"

import { AboutPage } from "@/components/about-page"
import { AppShell } from "@/components/app-shell"
import { LandingPage } from "@/components/landing-page"
import { PrivacyPage, TermsPage } from "@/components/legal-page"
import { resolveRoute } from "@/lib/routing"

/**
 * The app's entry — a hand-rolled path switch (no router dependency):
 * `/` renders the landing page, `/editor` renders the editor, `/about`
 * renders the About page, and `/privacy` and `/terms` render the legal
 * pages, anything else redirects to `/` (see src/lib/routing.ts). Links
 * between pages are plain anchors — a full page load, so no popstate
 * handling is needed.
 */
function App() {
  const route = resolveRoute(window.location.pathname)

  useEffect(() => {
    if (route === "redirect") window.location.replace("/")
  }, [route])

  if (route === "editor") return <AppShell />
  if (route === "landing") return <LandingPage />
  if (route === "about") return <AboutPage />
  if (route === "privacy") return <PrivacyPage />
  if (route === "terms") return <TermsPage />
  return null
}

export default App
