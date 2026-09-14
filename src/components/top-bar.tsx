import { useRef, type ChangeEvent } from "react"
import { ChevronDown, FolderOpen, Save, Sticker } from "lucide-react"

import { NewDesignMenu } from "@/components/new-design-menu"
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
import { EXPORT_FORMATS } from "@/fabric/export"

/**
 * Top bar (build spec §3): the brand, then the two ways to *open* a design —
 * New and Import File — left-aligned against the sidebar's column, and the two
 * ways to *write one out* — Save File and Export — held right by the spacer
 * between them. Opening is the left-to-right start of the workflow and saving
 * is its end, so the bar reads in the order the work happens.
 *
 * Import/Save are wired by the design-file build (§10); Export by the export
 * build (§11). The hidden file input opens for Import; Save downloads the
 * current Document as a Design file envelope; each Export item renders the
 * committed Document in that format.
 */
export function TopBar() {
  const {
    importDesignFile,
    saveDesignFile,
    exportCurrent,
    startNewDesign,
    isDocumentBlank,
    unit,
    setUnit,
  } = useStage()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const onImportChosen = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Reset the input so picking the same file again re-triggers change.
    event.target.value = ""
    if (!file) return
    void importDesignFile(file)
  }

  return (
    <header className="flex h-12 shrink-0 items-center border-b bg-background pr-4">
      {/* The brand stands in the sidebar's own column — the aside is w-56, and
          this block spans it exactly — so the file actions after it begin where
          the main column does. The stage toolbar sits in that column too, so
          the bar's left edge lines up with the toolbar's below it. */}
      <div className="flex w-56 shrink-0 items-center gap-2 pl-4">
        <Sticker className="size-5 text-primary" aria-hidden />
        <span className="text-sm font-semibold tracking-tight">
          Sticker Studio
        </span>
      </div>

      <div className="flex items-center gap-2">
        {/* Start-new (ticket #33): the auto-persist escape hatch — clears the
            stored working draft and resets the canvas, so the next load boots
            blank. Now a preset picker (map #48, ticket #55): the Document it
            creates is a sticker of the chosen shape at that preset's Default
            size, and a sheet holding work is confirmed before it goes.
            Deliberately scoped to the draft and the canvas: the manual Save and
            Export paths are unaffected. */}
        <NewDesignMenu
          onStartNew={startNewDesign}
          isDocumentBlank={isDocumentBlank}
          unit={unit}
          onUnitChange={setUnit}
        />

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
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-2">
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
              <DropdownMenuItem key={format} onClick={() => void exportCurrent(format)}>
                {format}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
