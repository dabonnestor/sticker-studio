import { useState, type ReactNode } from "react"
import {
  ChevronDown,
  Eye,
  Maximize,
  Minus,
  Plus,
  Redo2,
  Undo2,
} from "lucide-react"

import { useStage } from "@/components/stage-context"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/** Zoom presets (build spec §9); Fit arrives with the zoom build. */
const ZOOM_PRESETS = [
  { label: "100%", value: 100 },
  { label: "150%", value: 150 },
  { label: "200%", value: 200 },
] as const

/** Zoom range and step (build spec §9). */
const ZOOM_RANGE = { min: 10, max: 800, step: 10 } as const

/**
 * A tooltip over a bottom-bar control, opening above the trigger — the bar
 * hugs the bottom of the stage, so the tooltip must not float off-screen
 * below it. The trigger sits inside a wrapper span so the tooltip also fires
 * over disabled controls: a disabled button swallows its own pointer events,
 * which would silence the hint that explains the state (undo/redo are
 * disabled while the stack has nothing to walk).
 */
function TooltipLabel({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>{children}</span>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Bottom bar (build spec §3): undo/redo, zoom controls (− / % ▾ / + / slider),
 * Preview, fullscreen, and the status area where export progress and errors
 * surface. Undo/redo (Build 4, ADR 0001) walks the document-state stack;
 * zoom is wired by the zoom build, so the zoom cluster keeps local state
 * without touching the canvas yet. The status area is live from the export
 * build on.
 */
export function BottomBar() {
  const { canUndo, canRedo, undo, redo } = useStage()
  const [zoom, setZoom] = useState(100)

  const zoomOut = () => setZoom((z) => Math.max(ZOOM_RANGE.min, z - ZOOM_RANGE.step))
  const zoomIn = () => setZoom((z) => Math.min(ZOOM_RANGE.max, z + ZOOM_RANGE.step))

  return (
    <TooltipProvider>
      <footer className="flex h-10 shrink-0 items-center gap-1 border-t bg-background px-3">
        <TooltipLabel label="Undo">
          <Button
            variant="ghost"
            size="icon"
            disabled={!canUndo}
            onClick={() => void undo()}
            aria-label="Undo"
          >
            <Undo2 aria-hidden />
          </Button>
        </TooltipLabel>
        <TooltipLabel label="Redo">
          <Button
            variant="ghost"
            size="icon"
            disabled={!canRedo}
            onClick={() => void redo()}
            aria-label="Redo"
          >
            <Redo2 aria-hidden />
          </Button>
        </TooltipLabel>

      <Separator orientation="vertical" className="mx-1 h-5" />

      <Button variant="ghost" size="icon" onClick={zoomOut} aria-label="Zoom out">
        <Minus aria-hidden />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="w-14 gap-1 font-medium">
            {zoom}%
            <ChevronDown aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Zoom</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled>Fit</DropdownMenuItem>
          {ZOOM_PRESETS.map((preset) => (
            <DropdownMenuItem
              key={preset.label}
              onClick={() => setZoom(preset.value)}
            >
              {preset.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="ghost" size="icon" onClick={zoomIn} aria-label="Zoom in">
        <Plus aria-hidden />
      </Button>
      <Slider
        className="w-40"
        value={[zoom]}
        min={ZOOM_RANGE.min}
        max={ZOOM_RANGE.max}
        step={ZOOM_RANGE.step}
        onValueChange={([value]) => setZoom(value)}
        aria-label="Zoom"
      />

      <div className="flex-1" />

      <Button variant="ghost" size="icon" aria-label="Preview">
        <Eye aria-hidden />
      </Button>
      <Button variant="ghost" size="icon" aria-label="Fullscreen">
        <Maximize aria-hidden />
      </Button>

      <Separator orientation="vertical" className="mx-1 h-5" />

        <span
          className="min-w-0 text-xs text-muted-foreground"
          data-testid="status-area"
        >
          Ready
        </span>
      </footer>
    </TooltipProvider>
  )
}
