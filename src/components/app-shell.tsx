import { BottomBar } from "@/components/bottom-bar"
import { Sidebar } from "@/components/sidebar"
import { Stage } from "@/components/stage"
import { useStage, StageProvider } from "@/components/stage-context"
import { StageToolbar } from "@/components/stage-toolbar"
import { TopBar } from "@/components/top-bar"

/**
 * The shell's content — the child of the {@link StageProvider} so it can read
 * the `preview` flag: in preview the sidebar and stage toolbar unmount and the
 * main column fills the window (§3 <Eye> button). Top bar and bottom bar stay.
 */
function Shell() {
  const { preview } = useStage()

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
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
