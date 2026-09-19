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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { EXPORT_FORMATS } from "@/fabric/export"

const REPO_URL = "https://github.com/dabonnestor/sticker-studio"

/**
 * The GitHub mark, drawn inline: lucide 1.x carries no brand icons, so the one
 * glyph the bar needs from outside its set is the one it draws itself. Filled
 * rather than stroked — the mark is a silhouette, not a line drawing — but it
 * still takes `currentColor`, so it sits in the row like any other icon.
 */
function GitHubMark() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5" aria-hidden>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  )
}

/**
 * Top bar (build spec §3): the brand, then the two ways to *open* a design —
 * New and Import File — left-aligned against the sidebar's column, and the two
 * ways to *write one out* — Save File and Export — held right by the spacer
 * between them. Opening is the left-to-right start of the workflow and saving
 * is its end, so the bar reads in the order the work happens. The repo link
 * trails the write-out group: it belongs to the same right-hand corner but to
 * no part of the workflow, so it is set apart rather than folded in.
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
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon-sm" className="ml-1" asChild>
                <a
                  href={REPO_URL}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label="Sticker Studio on GitHub"
                >
                  <GitHubMark />
                </a>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">View source on GitHub</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </header>
  )
}
