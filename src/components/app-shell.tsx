import { BottomBar } from "@/components/bottom-bar"
import { Sidebar } from "@/components/sidebar"
import { Stage } from "@/components/stage"
import { StageToolbar } from "@/components/stage-toolbar"
import { TopBar } from "@/components/top-bar"

/**
 * App shell (build spec §3): top bar, left sidebar, stage with the stage
 * toolbar underneath, bottom bar. All chrome is shadcn/ui — Fabric is
 * confined to the stage canvas.
 */
export function AppShell() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          <Stage />
          <StageToolbar />
        </main>
      </div>
      <BottomBar />
    </div>
  )
}
