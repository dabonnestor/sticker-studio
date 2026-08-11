import {
  Circle,
  Ellipse,
  ImagePlus,
  RectangleHorizontal,
  Square,
  SquareRoundCorner,
  Type,
  type LucideIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"

/** The five sticker shapes (build spec §5). Wired in the document-model build. */
const SHAPES: { label: string; icon: LucideIcon }[] = [
  { label: "Square", icon: Square },
  { label: "Circle", icon: Circle },
  { label: "Rectangle", icon: RectangleHorizontal },
  { label: "Oval", icon: Ellipse },
  { label: "Rounded rectangle", icon: SquareRoundCorner },
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
 * Buttons are inert until their builds wire them up (text: text build,
 * shapes: document-model build, image: selection build).
 */
export function Sidebar() {
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
          {SHAPES.map(({ label, icon: Icon }) => (
            <Button
              key={label}
              variant="outline"
              size="sm"
              className="h-14 flex-col gap-1.5"
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
