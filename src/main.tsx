import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { registerCustomProperties } from "@/fabric/custom-properties"
import { preloadFonts, registerFonts } from "@/fabric/fonts"

import "./index.css"

import App from "./App"

// Custom properties must be registered before any object is created
// (ADR 0002, build spec §4).
registerCustomProperties()

// All 10 families load at startup (§12): register the @font-face rules and
// start the downloads. Creating text awaits preloadFonts before measuring,
// so the downloads never block the shell — only measurement.
registerFonts()
void preloadFonts()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
