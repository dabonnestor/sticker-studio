import { useState } from "react"
import {
  FaceSlightlySmiling,
  Image,
  ImagePlus,
  LayoutTemplate,
  Shapes,
  Type,
} from "lucide-react"

import { ArtworkPanel } from "@/components/artwork-panel"
import { DesignsPanel } from "@/components/designs-panel"
import { ImagesPanel } from "@/components/images-panel"
import { ShapesPanel } from "@/components/shapes-panel"
import { UploadsPanel } from "@/components/uploads-panel"

import { useStage } from "@/components/stage-context"
import { Button } from "@/components/ui/button"

function SectionHeading({ children }: { children: string }) {
  return (
    <h2 className="px-2 pb-1.5 text-xs font-medium tracking-wider text-muted-foreground uppercase">
      {children}
    </h2>
  )
}

/**
 * Left sidebar (build spec §3): Designs, Text, Shapes, Graphics, Images, and
 * Uploads sections. Shape buttons add shapes centered on the canvas; Add Text
 * drops a box at the viewport center, already in its text session (§6).
 * Graphics and Images open their search galleries (Pixabay art, Unsplash
 * photos); Uploads opens the Uploads panel — an upload button and the
 * recent-uploads gallery; Designs opens the predesigns gallery. Choosing an
 * image places it centered, fit to the Document, selected (§1); choosing a
 * design applies it like an import.
 */
export function Sidebar() {
  const { addText } = useStage()
  // View state (ticket #41): whether the whole sidebar is given over to a
  // panel or shows the default Text/Shapes/Image sections. Picked by the
  // section buttons; each panel's back affordance restores the default.
  const [view, setView] = useState<
    "default" | "artwork" | "shapes" | "images" | "uploads" | "designs"
  >("default")

  // Ticket #41 (Variant C): choosing Artwork, Shapes, Images, Uploads, or
  // Designs swaps the whole sidebar for that panel. All six stay mounted —
  // the inactive ones are display:none — so a panel's view state (the
  // Graphics and Images panels' search terms, results, and scroll; the
  // Uploads panel's gallery) survives navigating away and back. Only a
  // browser refresh, which remounts the entire app, resets it.
  return (
    <>
      <aside
        style={{ display: view === "default" ? "flex" : "none" }}
        className="flex w-56 shrink-0 flex-col gap-5 overflow-y-auto border-r bg-background p-3"
      >
      <section className="flex flex-col gap-1.5">
        <SectionHeading>Designs</SectionHeading>
        <Button
          variant="outline"
          size="sm"
          className="justify-start gap-2"
          onClick={() => setView("designs")}
        >
          <LayoutTemplate aria-hidden />
          Designs
        </Button>
      </section>

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
        <Button
          variant="outline"
          size="sm"
          className="justify-start gap-2"
          onClick={() => setView("shapes")}
        >
          <Shapes aria-hidden />
          Shapes
        </Button>
      </section>

      <section className="flex flex-col gap-1.5">
        <SectionHeading>Graphics</SectionHeading>
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

      <section className="flex flex-col gap-1.5">
        <SectionHeading>Images</SectionHeading>
        <Button
          variant="outline"
          size="sm"
          className="justify-start gap-2"
          onClick={() => setView("images")}
        >
          <Image aria-hidden />
          Images
        </Button>
      </section>

      <section className="flex flex-col gap-1.5">
        <SectionHeading>Uploads</SectionHeading>
        <Button
          variant="outline"
          size="sm"
          className="justify-start gap-2"
          onClick={() => setView("uploads")}
        >
          <ImagePlus aria-hidden />
          Uploads
        </Button>
      </section>
      </aside>
      <ArtworkPanel active={view === "artwork"} onBack={() => setView("default")} />
      <DesignsPanel active={view === "designs"} onBack={() => setView("default")} />
      <ImagesPanel active={view === "images"} onBack={() => setView("default")} />
      <ShapesPanel active={view === "shapes"} onBack={() => setView("default")} />
      <UploadsPanel active={view === "uploads"} onBack={() => setView("default")} />
    </>
  )
}
