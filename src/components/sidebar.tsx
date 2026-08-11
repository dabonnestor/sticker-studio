import {
  Circle,
  Ellipse,
  ImagePlus,
  RectangleHorizontal,
  Square,
  Triangle,
  Type,
  type LucideIcon,
} from "lucide-react"

import { useStage } from "@/components/stage-context"
import { Button } from "@/components/ui/button"
import type { StickerShapeKind } from "@/fabric/shapes"

/** The sticker shapes (build spec §5) — labels here, kinds in the model. */
const SHAPES: { kind: StickerShapeKind; label: string; icon: LucideIcon }[] = [
  { kind: "square", label: "Square", icon: Square },
  { kind: "circle", label: "Circle", icon: Circle },
  { kind: "rectangle", label: "Rectangle", icon: RectangleHorizontal },
  { kind: "oval", label: "Oval", icon: Ellipse },
  { kind: "triangle", label: "Triangle", icon: Triangle },
]

function SectionHeading({ children }: { children: string }) {
  return (
    <h2 className="px-2 pb-1.5 text-xs font-medium tracking-wider text-muted-foreground uppercase">
      {children}
    </h2>
  )
}

/**
 * Left sidebar (build spec §3): Text, Shapes, and Image Upload sections.
 * Shape buttons add stickers centered on the canvas; Text arrives with the
 * text build, Image Upload with the selection build.
 */
export function Sidebar() {
  const { addShape } = useStage()

  return (
    <aside className="flex w-56 shrink-0 flex-col gap-5 overflow-y-auto border-r bg-background p-3">
      <section className="flex flex-col gap-1.5">
        <SectionHeading>Text</SectionHeading>
        <Button variant="outline" size="sm" className="justify-start gap-2">
          <Type aria-hidden />
          Add Text
        </Button>
      </section>

      <section className="flex flex-col gap-1.5">
        <SectionHeading>Shapes</SectionHeading>
        <div className="grid grid-cols-2 gap-2">
          {SHAPES.map(({ kind, label, icon: Icon }) => (
            <Button
              key={kind}
              variant="outline"
              size="sm"
              className="h-14 flex-col gap-1.5"
              onClick={() => addShape(kind)}
            >
              <Icon aria-hidden />
              <span className="text-[11px] leading-tight font-normal whitespace-normal">
                {label}
              </span>
            </Button>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-1.5">
        <SectionHeading>Image</SectionHeading>
        <Button variant="outline" size="sm" className="justify-start gap-2">
          <ImagePlus aria-hidden />
          Upload Image
        </Button>
      </section>
    </aside>
  )
}
