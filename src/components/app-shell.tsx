import { useState } from "react"
import { X } from "lucide-react"

import { BottomBar } from "@/components/bottom-bar"
import { Sidebar } from "@/components/sidebar"
import { Stage } from "@/components/stage"
import { useStage, StageProvider } from "@/components/stage-context"
import { StageToolbar } from "@/components/stage-toolbar"
import { TopBar } from "@/components/top-bar"

/**
 * The demo banner — a dismissible one-line strip above the top bar. The
 * editor is a free demo of a licensed product; the banner is the path back
 * to the offer (the landing page's contact section). Dismissal persists in
 * localStorage so it doesn't nag on every load.
 */
function DemoBanner() {
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem("demo-banner-dismissed") === "1",
  )

  if (dismissed) return null

  return (
    <div className="flex h-9 shrink-0 items-center justify-center gap-2 border-b bg-primary px-4 text-sm text-primary-foreground">
      <span>
        This is a demo —{" "}
        <a href="/#contact" className="underline underline-offset-4">
          get it in your shop
        </a>
      </span>
      <button
        type="button"
        onClick={() => {
          localStorage.setItem("demo-banner-dismissed", "1")
          setDismissed(true)
        }}
        className="ml-2 rounded p-1 hover:bg-primary-foreground/10"
        aria-label="Dismiss demo banner"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  )
}

/**
 * The shell's content — the child of the {@link StageProvider} so it can read
 * the `preview` flag: in preview the sidebar and stage toolbar unmount and the
 * main column fills the window (§3 <Eye> button). Top bar and bottom bar stay.
 */
function Shell() {
  const { preview } = useStage()

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <DemoBanner />
      <TopBar />
      <div className="flex min-h-0 flex-1">
        {!preview && <Sidebar />}
        <main className="flex min-w-0 flex-1 flex-col">
          {!preview && <StageToolbar />}
          <Stage />
          <BottomBar />
        </main>
      </div>
    </div>
  )
}

/**
 * App shell (build spec §3): top bar, left sidebar, and the main column —
 * stage toolbar on top, stage, bottom bar underneath — so the two bars share
 * the same horizontal bounds. All chrome is shadcn/ui — Fabric is confined to
 * the stage canvas. The StageProvider bridges the canvas to the chrome
 * (sidebar, stage toolbar).
 */
export function AppShell() {
  return (
    <StageProvider>
      <Shell />
    </StageProvider>
  )
}
