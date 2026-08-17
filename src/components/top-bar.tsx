import { useRef, type ChangeEvent } from "react"
import { ChevronDown, FolderOpen, Save, Sticker } from "lucide-react"

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

/** The four export formats (build spec §11). Wired in the export build. */
const EXPORT_FORMATS = ["PNG", "JPEG", "PDF", "SVG"] as const

/**
 * Top bar (build spec §3): logo, Import File, Save File, Export dropdown.
 * Import/Save are wired by the design-file build (§10); Export by the export
 * build. The hidden file input opens for Import; Save downloads the current
 * Document as a Design file envelope.
 */
export function TopBar() {
  const { importDesignFile, saveDesignFile } = useStage()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const onImportChosen = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Reset the input so picking the same file again re-triggers change.
    event.target.value = ""
    if (!file) return
    void importDesignFile(file)
  }

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-4">
      <div className="mr-4 flex items-center gap-2">
        <Sticker className="size-5 text-primary" aria-hidden />
        <span className="text-sm font-semibold tracking-tight">
          Sticker Studio
        </span>
      </div>

      <div className="flex-1" />

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={onImportChosen}
        aria-label="Import a design file"
      />
      <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
        <FolderOpen aria-hidden />
        Import File
      </Button>
      <Button variant="outline" size="sm" onClick={saveDesignFile}>
        <Save aria-hidden />
        Save File
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            Export
            <ChevronDown aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Export</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {EXPORT_FORMATS.map((format) => (
            <DropdownMenuItem key={format}>{format}</DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}
