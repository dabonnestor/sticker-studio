import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { registerCustomProperties } from "@/fabric/custom-properties"
import { registerFonts } from "@/fabric/fonts"

import "./index.css"

import App from "./App"

// Custom properties must be registered before any object is created
// (ADR 0002, build spec §4).
registerCustomProperties()

// Every bundled family's @font-face rules register at startup — rule text
// only. Nothing font-related downloads until a surface uses or shows a face
// (the loading policy, #59 §1): a cold start on an empty design requests
// zero font bytes.
registerFonts()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
