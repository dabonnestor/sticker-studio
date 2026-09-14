import { useEffect, useRef, useState, type Ref } from "react"
import { ChevronDown, FilePlus } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  CUSTOM_DEFAULT_SIZE,
  MIN_DOCUMENT_SIZE_PX,
  STICKER_SHAPE_LABELS,
  type DocumentSize,
  type StickerPreset,
  type StickerShape,
} from "@/fabric/outline"
import { commitPx, formatPx, type Unit } from "@/lib/units"

/**
 * The New dropdown (map #48, ticket #55) — the top bar's start-a-design
 * control, and the only place a Document's sticker preset is chosen.
 *
 * The preset list is a shape *at a size* (`presetDocument`), so picking one
 * resets both; Custom is the one entry whose size the user types. Because a
 * new design also clears the auto-saved draft, a Document holding work is
 * confirmed first — and the predicate behind "holds work" is the auto-persist
 * blank-guard's own, so the sheets that start a new design in silence are
 * exactly the sheets the guard already refuses to write.
 */

/**
 * The order the presets are offered in — the vocabulary's own order (Square,
 * Rectangle, Rounded corner, Oval, Circle), with Custom last because it is the
 * one entry that is not a fixed shape-at-a-size.
 */
const PRESET_ORDER: readonly StickerShape[] = [
  "square",
  "rectangle",
  "rounded-corner",
  "oval",
  "circle",
]

/** The design New is waiting on the discard confirmation to start. */
interface PendingNew {
  preset: StickerPreset
  size?: DocumentSize
}

/**
 * The px a typed Custom field commits, or null when it names no usable sheet —
 * unparseable, negative, or under the Document size floor. The floor is the
 * toolbar's own ({@link MIN_DOCUMENT_SIZE_PX}), so Custom cannot create a
 * sheet the toolbar would then refuse to resize.
 */
function typedSizePx(text: string, unit: Unit): number | null {
  const value = Number(text)
  if (!Number.isFinite(value) || value < 0) return null
  const px = commitPx(value, unit)
  return px < MIN_DOCUMENT_SIZE_PX ? null : px
}

/** One of Custom's two fields — a labelled size in the app's active unit. */
function CustomSizeField({
  label,
  name,
  text,
  unit,
  invalid,
  inputRef,
  onChange,
}: {
  /** The field's visible label, one character wide like the toolbar's. */
  label: string
  /** The accessible name the label stands in for. */
  name: string
  text: string
  unit: Unit
  invalid: boolean
  inputRef?: Ref<HTMLInputElement>
  onChange: (text: string) => void
}) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="w-3 text-[10px] leading-none text-muted-foreground">
        {label}
      </span>
      <Input
        ref={inputRef}
        className="h-7 w-20"
        inputMode="decimal"
        value={text}
        aria-invalid={invalid}
        aria-label={`${name} in ${unit}`}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

/**
 * Custom's fields — a width and a height in the app's active unit, and the one
 * control that creates the sheet.
 *
 * The panel lives *inside* the dropdown rather than beside it: Custom is one of
 * the presets New offers, and the fields are how that preset is filled in. It
 * therefore has to survive the menu's own keyboard rules, so its keydowns stop
 * at the panel — Radix's menu content runs typeahead on any character key
 * pressed within it, focus in an input included, which would jump focus onto a
 * preset mid-typing, and it swallows Tab the same way. Escape is deliberately
 * left to travel: the menu still dismisses from inside the fields.
 *
 * The fields open on {@link CUSTOM_DEFAULT_SIZE} rather than on the current
 * Document: Custom is Rectangle with the size left free, so the same click
 * yields the same starting numbers whatever is on the stage. The panel is keyed
 * by the active unit, so a unit switch re-labels the numbers it was opened on.
 */
function CustomSizeForm({
  unit,
  onCreate,
}: {
  unit: Unit
  onCreate: (size: DocumentSize) => void
}) {
  const [width, setWidth] = useState(() =>
    formatPx(CUSTOM_DEFAULT_SIZE.width, unit),
  )
  const [height, setHeight] = useState(() =>
    formatPx(CUSTOM_DEFAULT_SIZE.height, unit),
  )
  const widthRef = useRef<HTMLInputElement>(null)

  // The panel is opened in order to be typed into — the caret starts in W.
  useEffect(() => {
    widthRef.current?.focus()
  }, [])

  const widthPx = typedSizePx(width, unit)
  const heightPx = typedSizePx(height, unit)
  const ready = widthPx !== null && heightPx !== null

  return (
    <div
      onKeyDown={(event) => {
        if (event.key !== "Escape") event.stopPropagation()
      }}
      className="mt-1 flex flex-col gap-2 rounded-md border border-border p-2"
    >
      <div className="flex items-center gap-2">
        <CustomSizeField
          label="W"
          name="Width"
          text={width}
          unit={unit}
          invalid={widthPx === null}
          inputRef={widthRef}
          onChange={setWidth}
        />
        <CustomSizeField
          label="H"
          name="Height"
          text={height}
          unit={unit}
          invalid={heightPx === null}
          onChange={setHeight}
        />
      </div>
      {/* The floor says itself the way it does in the toolbar — when a field
          is under it, in the unit the number was typed in. */}
      {!ready && (
        <p className="text-xs text-destructive">
          Minimum {formatPx(MIN_DOCUMENT_SIZE_PX, unit)} {unit}
        </p>
      )}
      <Button
        size="sm"
        disabled={!ready}
        onKeyDown={(event) => {
          // The menu around the panel has nothing focusable after Create, so
          // the browser's own Tab would dead-end here. The panel is a form:
          // Tab from its last control returns to its first.
          if (event.key === "Tab" && !event.shiftKey) {
            event.preventDefault()
            widthRef.current?.focus()
          }
        }}
        onClick={() => {
          if (widthPx === null || heightPx === null) return
          onCreate({ width: widthPx, height: heightPx })
        }}
      >
        Create
      </Button>
    </div>
  )
}

/**
 * Start-new (ticket #33) as a preset picker, in the top-bar File area. The
 * reset is scoped to the working draft and the canvas — manual Save, Import,
 * and Export are untouched.
 *
 * Takes its wiring as props rather than reaching for the stage context, the
 * way the toolbar's pickers do: the menu's whole job is deciding *which*
 * preset and *whether* to confirm, and both are answerable without a canvas.
 */
export function NewDesignMenu({
  onStartNew,
  isDocumentBlank,
  unit,
}: {
  /** Start the design — the stage context's `startNewDesign`. */
  onStartNew: (preset: StickerPreset, customSize?: DocumentSize) => void
  /**
   * Whether the Document is factory-blank — the auto-persist blank-guard's
   * predicate. Its own predicate, not a lookalike: the sheets that start a new
   * design in silence are then exactly the sheets the guard refuses to write.
   */
  isDocumentBlank: () => boolean
  /** The app's active display unit, for Custom's fields. */
  unit: Unit
}) {
  const [open, setOpen] = useState(false)
  const [customOpen, setCustomOpen] = useState(false)
  const [pending, setPending] = useState<PendingNew | null>(null)

  /**
   * Start a design on a preset, through the confirmation when the current
   * Document holds work. A pristine canvas has nothing there to lose, so it
   * starts the new design in silence.
   */
  const requestNew = (preset: StickerPreset, size?: DocumentSize) => {
    if (isDocumentBlank()) onStartNew(preset, size)
    else setPending({ preset, size })
  }

  return (
    <>
      <DropdownMenu
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          // The Custom panel is a transient state of the menu, not of the
          // app: reopening New offers the presets again, panel closed.
          if (!next) setCustomOpen(false)
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <FilePlus aria-hidden />
            New
            <ChevronDown aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        {/* Wider than the trigger: Custom's two fields and its Create button
            need the room the "New" label doesn't have. */}
        <DropdownMenuContent align="start" className="min-w-56">
          {PRESET_ORDER.map((shape) => (
            <DropdownMenuItem key={shape} onSelect={() => requestNew(shape)}>
              {STICKER_SHAPE_LABELS[shape]}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            // Radix closes the menu on select, and moves focus back to the
            // trigger with it — but here the select only *opens* the fields,
            // which are useless to anyone who then has to reopen the menu to
            // reach them. Swallowing the select is what keeps the menu up.
            onSelect={(event) => {
              event.preventDefault()
              setCustomOpen(true)
            }}
          >
            Custom…
          </DropdownMenuItem>
          {customOpen && (
            <CustomSizeForm
              key={unit}
              unit={unit}
              onCreate={(size) => {
                setOpen(false)
                requestNew("custom", size)
              }}
            />
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={pending !== null}
        onOpenChange={(next) => {
          if (!next) setPending(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard the current design?</AlertDialogTitle>
            <AlertDialogDescription>
              Starting a new design clears the canvas and the auto-saved draft.
              This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pending) onStartNew(pending.preset, pending.size)
                setPending(null)
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
