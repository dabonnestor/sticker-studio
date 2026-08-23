import { useRef, useState, type ChangeEvent } from "react"
import {
  Circle,
  Ellipse,
  FaceSlightlySmiling,
  ImagePlus,
  RectangleHorizontal,
  Square,
  Triangle,
  Type,
  type LucideIcon,
} from "lucide-react"

import { ArtworkPanel } from "@/components/artwork-panel"

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

function SectionHeading({ children }: { children: string }) {
  return (
    <h2 className="px-2 pb-1.5 text-xs font-medium tracking-wider text-muted-foreground uppercase">
      {children}
    </h2>
  )
}

/**
 * Left sidebar (build spec §3): Text, Shapes, and Image sections. Shape
 * buttons add shapes centered on the canvas; Add Text drops a box at the
 * viewport center, already in its text session (§6). Upload Image opens a
 * file picker for an image file and places it centered, fit to the
 * Document, selected (§1).
 */
export function Sidebar() {
  const { addShape, addText, addImage, reportStatus } = useStage()
  // View state (ticket #41): whether the whole sidebar is given over to the
  // Artwork gallery or shows the default Text/Shapes/Image sections. Picked
  // by the Artwork button; the gallery's back affordance restores the default.
  const [view, setView] = useState<"default" | "artwork">("default")
  const fileInputRef = useRef<HTMLInputElement>(null)

  const onImageChosen = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Reset the input so picking the same file again re-triggers change.
    event.target.value = ""
    if (!file) return
    if (!file.type.startsWith("image/")) {
      reportStatus("Please choose an image file")
      return
    }
    const reader = new FileReader()
    reader.onerror = () => reportStatus("Couldn't read that file")
    reader.onload = () => {
      if (typeof reader.result === "string") void addImage(reader.result)
    }
    reader.readAsDataURL(file)
  }

  // Ticket #41 (Variant C): choosing Artwork swaps the entire sidebar for the
  // gallery; the gallery's back affordance restores this default view.
  if (view === "artwork") {
    return <ArtworkPanel onBack={() => setView("default")} />
  }

  return (
    <aside className="flex w-56 shrink-0 flex-col gap-5 overflow-y-auto border-r bg-background p-3">
      <section className="flex flex-col gap-1.5">
        <SectionHeading>Text</SectionHeading>
        <Button
          variant="outline"
          size="sm"
          className="justify-start gap-2"
          onClick={addText}
        >
          <Type aria-hidden />
          Text
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
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onImageChosen}
          aria-label="Upload an image file"
        />
        <Button
          variant="outline"
          size="sm"
          className="justify-start gap-2"
          onClick={() => fileInputRef.current?.click()}
        >
          <ImagePlus aria-hidden />
          Upload Image
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="justify-start gap-2"
          onClick={() => setView("artwork")}
        >
          <FaceSlightlySmiling aria-hidden />
          Graphics
        </Button>
      </section>
    </aside>
  )
}
