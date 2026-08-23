import {
  Circle,
  Ellipse,
  RectangleHorizontal,
  Square,
  Triangle,
  ArrowLeft,
  type LucideIcon,
} from "lucide-react"

import { useStage } from "@/components/stage-context"
import { Button } from "@/components/ui/button"
import type { ShapeKind } from "@/fabric/shapes"

/** The shape kinds (build spec §5) — labels here, kinds in the model. */
const SHAPES: { kind: ShapeKind; label: string; icon: LucideIcon }[] = [
  { kind: "square", label: "Square", icon: Square },
  { kind: "circle", label: "Circle", icon: Circle },
  { kind: "rectangle", label: "Rectangle", icon: RectangleHorizontal },
  { kind: "oval", label: "Oval", icon: Ellipse },
  { kind: "triangle", label: "Triangle", icon: Triangle },
]

/**
 * The Shapes panel — the sidebar given over to the shape gallery, mirroring
 * the Graphics panel's pattern: a back affordance in the header restores the
 * default sidebar, and the shapes render as a two-column grid of square tiles
 * (icon over label). Choosing a tile adds the shape centered on the canvas,
 * border off (build spec §5). Browsing only changes view state — the Document
 * is untouched until a tile is picked.
 */
export function ShapesPanel({ onBack }: { onBack: () => void }) {
  const { addShape } = useStage()

  return (
    <aside className="flex w-56 shrink-0 flex-col overflow-y-auto border-r bg-background p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <Button
          variant="outline"
          size="icon-sm"
          className="shrink-0"
          onClick={onBack}
          aria-label="Back to the default sidebar"
        >
          <ArrowLeft aria-hidden />
        </Button>
        <span className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          Shapes
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {SHAPES.map(({ kind, label, icon: Icon }) => (
          <button
            key={kind}
            type="button"
            title={label}
            onClick={() => addShape(kind)}
            className="group relative flex aspect-square flex-col items-center justify-center gap-1.5 rounded-md border bg-muted/50 transition-colors hover:bg-muted/80"
          >
            <Icon
              aria-hidden
              className="transition-transform group-hover:scale-105"
            />
            <span className="text-[11px] leading-tight font-normal whitespace-normal">
              {label}
            </span>
          </button>
        ))}
      </div>
    </aside>
  )
}
