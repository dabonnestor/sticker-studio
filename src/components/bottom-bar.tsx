import { useState } from "react"
import {
  ChevronDown,
  Eye,
  Maximize,
  Minus,
  Plus,
  Redo2,
  Undo2,
} from "lucide-react"

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

/** Zoom presets (build spec §9); Fit arrives with the zoom build. */
const ZOOM_PRESETS = [
  { label: "100%", value: 100 },
  { label: "150%", value: 150 },
  { label: "200%", value: 200 },
] as const

/** Zoom range and step (build spec §9). */
const ZOOM_RANGE = { min: 10, max: 800, step: 10 } as const

/**
 * Bottom bar (build spec §3): undo/redo, zoom controls (− / % ▾ / + / slider),
 * Preview, fullscreen, and the status area where export progress and errors
 * surface. Undo/redo is wired by the undo build, zoom by the zoom build; the
 * zoom cluster keeps local state so the widget is alive, without touching
 * the canvas yet. The status area is live from the export build on.
 */
export function BottomBar() {
  const [zoom, setZoom] = useState(100)

  const zoomOut = () => setZoom((z) => Math.max(ZOOM_RANGE.min, z - ZOOM_RANGE.step))
  const zoomIn = () => setZoom((z) => Math.min(ZOOM_RANGE.max, z + ZOOM_RANGE.step))

  return (
    <footer className="flex h-10 shrink-0 items-center gap-1 border-t bg-background px-3">
      <Button variant="ghost" size="icon" disabled aria-label="Undo">
        <Undo2 aria-hidden />
      </Button>
      <Button variant="ghost" size="icon" disabled aria-label="Redo">
        <Redo2 aria-hidden />
      </Button>

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
  )
}
