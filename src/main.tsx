import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { registerCustomProperties } from "@/fabric/custom-properties"

import "./index.css"

import App from "./App"

// Custom properties must be registered before any object is created
// (ADR 0002, build spec §4).
registerCustomProperties()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
