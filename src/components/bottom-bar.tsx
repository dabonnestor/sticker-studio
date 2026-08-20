import { type ReactNode, useEffect, useState } from "react"
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
import {
  ZOOM_MAX_PERCENT,
  ZOOM_MIN_PERCENT,
  ZOOM_PRESETS,
  ZOOM_STEP_PERCENT,
} from "@/fabric/zoom"

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
 * surface. Undo/redo (Build 4, ADR 0001) walks the document-state stack; the
 * zoom cluster (Build 6, §9) drives the stage — the % readout shows rounded
 * integers, the dropdown offers Fit plus the presets, the slider spans the
 * range. The status area is live from the export build on.
 */
export function BottomBar() {
  const {
    canUndo,
    canRedo,
    undo,
    redo,
    zoom,
    setZoom,
    zoomIn,
    zoomOut,
    fitZoom,
    status,
    preview,
    togglePreview,
  } = useStage()

  // Browser fullscreen — distinct from Preview: Preview hides the app's own
  // chrome (sidebar + stage toolbar) within the window (§3 <Eye>); Fullscreen
  // pushes the whole window edge-to-edge via requestFullscreen. Mirrored so
  // the button reads pressed and re-labels while the OS/esc fullscreen.
  const [isFullscreen, setFullscreen] = useState(false)
  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement !== null)
    document.addEventListener("fullscreenchange", sync)
    sync()
    return () => document.removeEventListener("fullscreenchange", sync)
  }, [])
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen()
  }

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

      <TooltipLabel label="Zoom out">
        <Button variant="ghost" size="icon" onClick={zoomOut} aria-label="Zoom out">
          <Minus aria-hidden />
        </Button>
      </TooltipLabel>
      <TooltipLabel label="Zoom">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="w-14 gap-1 font-medium">
              {Math.round(zoom)}%
              <ChevronDown aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Zoom</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={fitZoom}>Fit</DropdownMenuItem>
            {ZOOM_PRESETS.map((preset) => (
              <DropdownMenuItem key={preset} onClick={() => setZoom(preset)}>
                {preset}%
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </TooltipLabel>
      <TooltipLabel label="Zoom in">
        <Button variant="ghost" size="icon" onClick={zoomIn} aria-label="Zoom in">
          <Plus aria-hidden />
        </Button>
      </TooltipLabel>
      <Slider
        className="w-40"
        value={[zoom]}
        min={ZOOM_MIN_PERCENT}
        max={ZOOM_MAX_PERCENT}
        step={ZOOM_STEP_PERCENT}
        onValueChange={([value]) => setZoom(value)}
        aria-label="Zoom"
      />

      <div className="flex-1" />

      <TooltipLabel label={preview ? "Exit preview" : "Preview"}>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Preview"
          aria-pressed={preview}
          onClick={togglePreview}
          className={preview ? "bg-muted text-foreground" : undefined}
        >
          <Eye aria-hidden />
        </Button>
      </TooltipLabel>
      <TooltipLabel label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}>
        <Button
          variant="ghost"
          size="icon"
          aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          aria-pressed={isFullscreen}
          onClick={toggleFullscreen}
          className={isFullscreen ? "bg-muted text-foreground" : undefined}
        >
          <Maximize aria-hidden />
        </Button>
      </TooltipLabel>

      <Separator orientation="vertical" className="mx-1 h-5" />

        <span
          className="min-w-0 text-xs text-muted-foreground"
          data-testid="status-area"
        >
          {status}
        </span>
      </footer>
    </TooltipProvider>
  )
}
