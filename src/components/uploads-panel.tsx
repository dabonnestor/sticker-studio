import { useRef, type ChangeEvent } from "react"
import { ArrowLeft, ImagePlus, X } from "lucide-react"

import { useStage } from "@/components/stage-context"
import { Button } from "@/components/ui/button"

/**
 * The Uploads panel — the sidebar given over to the upload gallery, mirroring
 * the Shapes panel's pattern: a back affordance in the header restores the
 * default sidebar. An Upload button opens the system file picker and places
 * the chosen image on the canvas (the sidebar's old §1 flow, moved here); the
 * grid below lists the recent uploads — the shared, persisted gallery of
 * images uploaded (here) or pasted (Ctrl+V) into the Document — and picking
 * a tile re-places that same image. Browsing only changes view state — the
 * Document is untouched until a file is chosen or a tile is picked.
 */
export function UploadsPanel({ onBack, active }: { onBack: () => void; active: boolean }) {
  const { addImage, addRecentUpload, recentUploads, removeRecentUpload, reportStatus } =
    useStage()
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
      const dataURL = reader.result
      if (typeof dataURL !== "string") return
      // The original bytes go to the canvas (§1); the gallery side — the
      // downscaled copy, the merge, the over-cap refusal — is the shared
      // addRecentUpload, so an upload and a paste land in the same list.
      void addImage(dataURL)
      void addRecentUpload(dataURL, file.name)
    }
    reader.readAsDataURL(file)
  }

  return (
    // Kept mounted across navigation (see the Shapes panel) so returning to a
    // panel doesn't rebuild it; display:none hides it when another view is up.
    <aside
      style={{ display: active ? "flex" : "none" }}
      className="flex w-56 shrink-0 flex-col overflow-y-auto border-r bg-background p-3"
    >
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
          Uploads
        </span>
      </div>

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
        className="justify-start gap-2 border-dashed"
        onClick={() => fileInputRef.current?.click()}
      >
        <ImagePlus aria-hidden />
        Upload an image
      </Button>

      <h2 className="mt-4 px-2 pb-1.5 text-xs font-medium tracking-wider text-muted-foreground uppercase">
        Recent uploads
      </h2>

      {recentUploads.length === 0 ? (
        // The gallery's explicit empty state — nothing uploaded or pasted yet.
        <p className="rounded-md border border-dashed p-3 text-center text-xs leading-relaxed text-muted-foreground">
          No uploads yet.
          <br />
          Upload an image and it’ll appear here.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {recentUploads.map((upload) => (
            // A wrapper div keeps the tile and its remove button siblings —
            // a button can't nest a button, and the overlay X gets its own
            // hit area without swallowing the insert click.
            <div key={upload.dataURL} className="group relative">
              <button
                type="button"
                title={upload.name}
                onClick={() => void addImage(upload.dataURL)}
                className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-md border bg-muted/50 transition-colors hover:bg-muted/80"
              >
                <img
                  src={upload.dataURL}
                  alt={upload.name}
                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                />
              </button>
              <Button
                type="button"
                variant="outline"
                size="icon-xs"
                aria-label={`Remove ${upload.name} from recent uploads`}
                onClick={() => removeRecentUpload(upload.dataURL)}
                className="absolute top-1 right-1 rounded-full bg-background/90 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
              >
                <X aria-hidden />
              </Button>
            </div>
          ))}
        </div>
      )}
    </aside>
  )
}
