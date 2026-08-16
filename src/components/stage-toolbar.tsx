import { useEffect, useRef, useState, type ReactNode } from "react"
import {
  AlignCenter,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  Bold,
  Blend,
  CaseUpper,
  ChevronDown,
  FlipHorizontal2,
  FlipVertical2,
  Group as GroupIcon,
  Italic,
  Layers,
  Lock,
  Trash2,
  Type,
  Underline,
  Ungroup as UngroupIcon,
} from "lucide-react"

import { useStage } from "@/components/stage-context"
import { Button } from "@/components/ui/button"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { type AlignCommand } from "@/fabric/align"
import { type ArrangeCommand } from "@/fabric/arrange"
import { type FlipCommand } from "@/fabric/flip"
import { isGroup, isGrouped } from "@/fabric/groups"
import {
  DEFAULT_BORDER_COLOR,
  DEFAULT_FILL,
  getBorderWidth,
  getShapeKind,
} from "@/fabric/shapes"
import {
  FONT_FAMILIES,
  TEXT_FILL,
  getBoldWeight,
  getFontFamilySpec,
  isTextObject,
} from "@/fabric/text"
import { commitPx, formatPx, type Unit } from "@/lib/units"
import { cn } from "@/lib/utils"

const UNITS: { value: Unit; label: string }[] = [
  { value: "in", label: "in" },
  { value: "mm", label: "mm" },
  { value: "px", label: "px" },
]

/** Border slider range and step — 0 (off) to 1 inch at the 96 DPI basis. */
const BORDER_RANGE = { min: 0, max: 96, step: 1 } as const

/** Opacity slider range and step — 0 (transparent) to 100% (opaque). */
const OPACITY_RANGE = { min: 0, max: 100, step: 1 } as const

/** Line-height slider range and step — 0.5 (tight) to 3 (loose). */
const LINE_HEIGHT_RANGE = { min: 0.5, max: 3, step: 0.05 } as const

/** Letter-spacing slider range and step, in em (the §6 display unit). */
const LETTER_SPACING_RANGE = { min: -0.2, max: 1, step: 0.01 } as const

/** Standard font sizes (px) — the combobox presets; any size still types in. */
const FONT_SIZES = [
  8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 96,
  120, 144,
] as const

/**
 * A labeled numeric field over stored px, displayed in the active unit
 * (build spec §5): switching units re-labels without rescaling; the value
 * converts to integer px at commit (Enter/blur); invalid input reverts. The
 * label sits beside the input, like the shape-property controls.
 */
function UnitField({
  label,
  valuePx,
  unit,
  onCommit,
  className,
}: {
  label: string
  valuePx: number
  unit: Unit
  onCommit: (px: number) => void
  className?: string
}) {
  const [text, setText] = useState(() => formatPx(valuePx, unit))

  useEffect(() => {
    setText(formatPx(valuePx, unit))
  }, [valuePx, unit])

  const commit = () => {
    // Negative values are incoherent input, not a clamp — §5 sets no
    // min/max size limits (the export ceiling governs, §11).
    const value = Number(text)
    if (!Number.isFinite(value) || value < 0) {
      setText(formatPx(valuePx, unit))
      return
    }
    onCommit(commitPx(value, unit))
  }

  return (
    <label className={cn("flex items-center gap-1.5", className)}>
      <span className="w-3 text-[10px] leading-none text-muted-foreground">{label}</span>
      <Input
        className="h-7 w-16"
        inputMode="decimal"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur()
        }}
      />
    </label>
  )
}

/**
 * A color swatch input — shared by the text, shape and canvas property
 * sections. Skimming the dialog previews live through onApply — applied
 * without recording, so dragging never pollutes the undo stack (§8). The
 * session commits exactly one undoable step when the dialog closes, by any
 * gesture: the native `change` event covers a committed close (OK/Enter);
 * a click outside the dialog is a dismissal that fires no change, but the
 * click itself lands on the page and commits the session there; and a
 * cancelled close that touches no page (Escape on a separate-window
 * dialog) is caught by the page window refocusing when the dialog closes
 * either way. All three fallbacks commit through the dirty flag — set by
 * the drag `input` events — so unrelated clicks or refocuses (alt-tab)
 * never record, and the history commit's dedup makes a double-commit on a
 * committed close a no-op. React's onChange maps to the native `input`
 * event (every drag step), so the native change listener is attached
 * directly.
 */
function ColorInput({
  value,
  onApply,
  onChange,
  disabled,
  ariaLabel,
  tooltip,
}: {
  value: string
  onApply: (color: string) => void
  onChange: (color: string) => void
  disabled?: boolean
  ariaLabel: string
  tooltip: string
}) {
  const onApplyRef = useRef(onApply)
  onApplyRef.current = onApply
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const inputRef = useRef<HTMLInputElement>(null)
  const dirtyRef = useRef(false)
  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    const commitIfTouched = () => {
      if (dirtyRef.current) {
        onChangeRef.current(input.value)
        dirtyRef.current = false
      }
    }
    const onNativeChange = () => {
      onChangeRef.current(input.value)
      dirtyRef.current = false
    }
    input.addEventListener("change", onNativeChange)
    // The three dismissal gestures, all committing the session once: the
    // change event (OK/Enter), a click outside the dialog (the click lands
    // on the page), and the page window refocusing after a close that
    // touched no page (Escape on a separate-window dialog).
    document.addEventListener("pointerdown", commitIfTouched)
    window.addEventListener("focus", commitIfTouched)
    return () => {
      input.removeEventListener("change", onNativeChange)
      document.removeEventListener("pointerdown", commitIfTouched)
      window.removeEventListener("focus", commitIfTouched)
    }
  }, [])
  return (
    <TooltipLabel label={tooltip}>
      <input
        ref={inputRef}
        type="color"
        className="h-7 w-9 cursor-pointer rounded-md bg-transparent p-0.5"
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        onInput={(event) => {
          dirtyRef.current = true
          onApplyRef.current(event.currentTarget.value)
        }}
      />
    </TooltipLabel>
  )
}

/**
 * A tooltip over a toolbar control, opening below the trigger — the toolbar
 * hugs the top of the stage, so the default top-side tooltip would float up
 * over the top bar. The trigger sits inside a wrapper span so the tooltip
 * also fires over disabled controls: a disabled button or input swallows its
 * own pointer events, which would silence the hint that explains the state.
 */
function TooltipLabel({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>{children}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * The unit switch — a label swap over stored px, shared by all toolbar
 * fields. The active unit reads on the trigger; the dropdown offers the rest.
 */
function UnitSwitcher() {
  const { unit, setUnit } = useStage()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="w-14 gap-1 font-medium"
          aria-label="Units"
        >
          {unit}
          <ChevronDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Units</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {UNITS.map(({ value, label }) => (
          <DropdownMenuItem key={value} onClick={() => setUnit(value)}>
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A W×H field pair in the active unit — shared by Document and shape size. */
function SizeFieldPair({
  widthPx,
  heightPx,
  unit,
  onCommit,
}: {
  widthPx: number
  heightPx: number
  unit: Unit
  onCommit: (width: number, height: number) => void
}) {
  return (
    <div className="flex items-center gap-3">
      <UnitField
        label="W"
        valuePx={widthPx}
        unit={unit}
        onCommit={(width) => onCommit(width, heightPx)}
      />
      <UnitField
        label="H"
        valuePx={heightPx}
        unit={unit}
        onCommit={(height) => onCommit(widthPx, height)}
      />
    </div>
  )
}

/** Document size (§5) — the canvas dimensions, the basis of export size. */
function DocumentSize() {
  const { documentSize, setDocumentSize, unit } = useStage()
  return (
    <SizeFieldPair
      widthPx={documentSize.width}
      heightPx={documentSize.height}
      unit={unit}
      onCommit={setDocumentSize}
    />
  )
}

/**
 * Document look section (build spec §5) — always visible: the canvas
 * background color and the document border (width slider + color). Both are
 * document properties (the border is envelope-owned, ADR 0002) and use the
 * same control styling and inset border model as the shape-property section.
 */
function CanvasProps() {
  const { canvasProps, commitCanvasProps } = useStage()
  const { backgroundColor, borderWidth, borderColor } = canvasProps

  return (
    <div className="flex items-center gap-3">
      <label className="flex items-center gap-1.5">
        <span className="text-[10px] leading-none text-muted-foreground">Background</span>
        <ColorInput
          value={backgroundColor}
          ariaLabel="Canvas background color"
          tooltip="Canvas background color"
          onApply={(backgroundColor) => commitCanvasProps({ backgroundColor }, false)}
          onChange={(backgroundColor) => commitCanvasProps({ backgroundColor })}
        />
      </label>
      <label className="flex items-center gap-2">
        <span className="text-[10px] leading-none text-muted-foreground">Border</span>
        <Slider
          className="w-28"
          min={BORDER_RANGE.min}
          max={BORDER_RANGE.max}
          step={BORDER_RANGE.step}
          value={[borderWidth]}
          // Dragging previews live without recording; releasing the thumb
          // commits the whole drag as ONE undoable step (ADR 0001, §8).
          onValueChange={([value]) => commitCanvasProps({ borderWidth: value }, false)}
          onValueCommit={([value]) => commitCanvasProps({ borderWidth: value })}
          aria-label="Border width"
        />
        <span className="w-8 text-right text-[10px] leading-none text-muted-foreground tabular-nums">
          {borderWidth}px
        </span>
        <ColorInput
          value={borderColor}
          disabled={borderWidth === 0}
          ariaLabel="Border color"
          tooltip={borderWidth === 0 ? "Border is off — set a width first" : "Border color"}
          onApply={(borderColor) => commitCanvasProps({ borderColor }, false)}
          onChange={(borderColor) => commitCanvasProps({ borderColor })}
        />
      </label>
    </div>
  )
}

/**
 * Contextual shape-property section (build spec §5), visible only while a
 * single shape is selected: the background (fill) color and the inset border
 * (width slider + color). All values display in px and commit immediately.
 */
function ShapeProps() {
  const { selection, commitShapeProps } = useStage()
  const shape = selection.length === 1 ? selection[0] : null
  if (!shape) return null

  const borderWidth = getBorderWidth(shape)
  // §7 Q3: a locked object's properties render read-only — unlock lives in
  // the lock toggle next to these sections.
  const locked = shape.locked

  return (
    <div className="flex items-center gap-3">
      <label className="flex items-center gap-1.5">
        <span className="text-[10px] leading-none text-muted-foreground">Fill</span>
        <ColorInput
          value={typeof shape.fill === "string" ? shape.fill : DEFAULT_FILL}
          disabled={locked}
          ariaLabel="Shape background color"
          tooltip="Shape background color"
          onApply={(fillColor) => commitShapeProps({ fillColor }, false)}
          onChange={(fillColor) => commitShapeProps({ fillColor })}
        />
      </label>
      <label className="flex items-center gap-2">
        <span className="text-[10px] leading-none text-muted-foreground">Border</span>
        <Slider
          className="w-28"
          min={BORDER_RANGE.min}
          max={BORDER_RANGE.max}
          step={BORDER_RANGE.step}
          value={[borderWidth]}
          disabled={locked}
          // Dragging previews live without recording; releasing the thumb
          // commits the whole drag as ONE undoable step (ADR 0001, §8).
          onValueChange={([value]) => commitShapeProps({ borderWidth: value }, false)}
          onValueCommit={([value]) => commitShapeProps({ borderWidth: value })}
          aria-label="Border width"
        />
        <span className="w-8 text-right text-[10px] leading-none text-muted-foreground tabular-nums">
          {borderWidth}px
        </span>
        <ColorInput
          value={typeof shape.stroke === "string" ? shape.stroke : DEFAULT_BORDER_COLOR}
          disabled={locked || borderWidth === 0}
          ariaLabel="Border color"
          tooltip={borderWidth === 0 ? "Border is off — set a width first" : "Border color"}
          onApply={(borderColor) => commitShapeProps({ borderColor }, false)}
          onChange={(borderColor) => commitShapeProps({ borderColor })}
        />
      </label>
    </div>
  )
}

/**
 * Display formatting for the slider readouts — trailing zeros trimmed only
 * after the decimal point, so an integer like 10 px never renders as "1"
 * (the plain `0+$` pattern would strip the zero off an integer with no
 * decimal).
 */
function formatNumberField(value: number, scale: number, decimals: number): string {
  return (value / scale).toFixed(decimals).replace(/\.\d*?0+$/, "")
}

/**
 * Hover-preview state for a dropdown of property values (§6) — the Font
 * family and Weight controls share it: previewing applies a candidate to the
 * selection immediately, restore applies the anchored value (the committed
 * one when the menu opened or was last clicked), and commit anchors a click.
 * A preview that ends with the menu (Escape, outside click, unmount) restores
 * too.
 *
 * Only a click records history — preview and restore apply through onApply
 * without recording, so skimming a face or weight never pollutes the undo
 * stack (ADR 0001, §8): restoring the anchored value returns to a state the
 * stack already ends at, so the apply is a no-op step.
 *
 * Anchoring lives in a ref, not state: the restore runs from event handlers
 * that may fire in the same tick as the anchoring click, where a stale
 * closure would see the pre-click value. The unmount insurance applies
 * through refs, and only on unmount — React batches a leave + enter into one
 * render, so hovered jumps straight between two candidates and a
 * transition-triggered cleanup would apply the restore point right after
 * the new preview and revert it.
 */
function useHoverPreview<T>(
  value: T,
  /** Preview/restore — apply the candidate without recording history. */
  onApply: (candidate: T) => void,
  /** Click — apply and record one undoable step. */
  onCommit: (candidate: T) => void,
): {
  preview: (candidate: T) => void
  restore: () => void
  commit: (candidate: T) => void
} {
  // The candidate a hover preview restores to — the committed value when the
  // menu opened or last clicked.
  const anchoredRef = useRef(value)
  // The hovered candidate — null while the pointer isn't over an option.
  const [hovered, setHovered] = useState<T | null>(null)

  // Re-anchor the restore point to the committed value whenever no preview
  // is active — covers commits from other controls and selection changes.
  // A live preview must not clobber it: the prop already reads the previewed
  // value while hovering.
  useEffect(() => {
    if (hovered === null) anchoredRef.current = value
  }, [value, hovered])

  // Latest-value refs for the unmount-only cleanup: onApply is a fresh
  // closure every TextProps render, and hovered must stay visible to a
  // cleanup that runs after the final render.
  const onApplyRef = useRef(onApply)
  const hoveredRef = useRef<T | null>(null)
  useEffect(() => {
    onApplyRef.current = onApply
    hoveredRef.current = hovered
  })
  useEffect(() => {
    return () => {
      // A preview that survives the menu's unmount without an item-leave
      // (the selection dies under the menu) would stick on the text —
      // apply the restore point so no hovered value outlives the menu.
      if (hoveredRef.current !== null) onApplyRef.current(anchoredRef.current)
    }
  }, [])

  const preview = (candidate: T) => {
    setHovered(candidate)
    onApply(candidate)
  }
  const restore = () => {
    setHovered(null)
    onApply(anchoredRef.current)
  }
  const commit = (candidate: T) => {
    // Anchor the click: the menu closes and restore() runs on the same
    // tick, so the restore point must be the clicked value already.
    anchoredRef.current = candidate
    onCommit(candidate)
  }
  return { preview, restore, commit }
}

/**
 * Font family as a dropdown menu (§6) with hover preview: pointing at an
 * option applies it to the selection immediately, and moving off restores
 * the committed family — the face reads on the trigger throughout, so the
 * user can skim faces without committing; clicking picks the hovered face.
 * Skimming records no undo step — only the click does (§8).
 */
function FontFamilyField({
  family,
  onApply,
  onCommit,
  disabled,
}: {
  family: string
  /** Preview/restore — apply the family without recording history (§8). */
  onApply: (family: string) => void
  /** Click — apply the family and record one undoable step. */
  onCommit: (family: string) => void
  disabled?: boolean
}) {
  const { preview, restore, commit } = useHoverPreview(family, onApply, onCommit)

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (!open) restore()
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 max-w-32 gap-1 px-2 text-xs font-normal"
          disabled={disabled}
          aria-label="Font family"
        >
          <span className="truncate">{family}</span>
          <ChevronDown aria-hidden className="size-3 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Font family</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {FONT_FAMILIES.map(({ family: name }) => (
          <DropdownMenuItem
            key={name}
            onMouseEnter={() => preview(name)}
            onMouseLeave={restore}
            onClick={() => commit(name)}
          >
            {name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Font weight as a dropdown menu (§6) — the same hover preview as the family
 * picker (both share useHoverPreview): pointing at a weight applies it to
 * the selection immediately, moving off restores the committed weight,
 * clicking picks the hovered one. Skimming records no undo step — only the
 * click does (§8). The trigger offers no chevron and reads plain when the
 * family ships a single weight.
 */
function WeightField({
  weight,
  weights,
  onlyWeight,
  onApply,
  onCommit,
  disabled,
}: {
  weight: number
  weights: readonly number[]
  /** The family ships a single weight — nothing to pick, no chevron. */
  onlyWeight: boolean
  /** Preview/restore — apply the weight without recording history (§8). */
  onApply: (weight: number) => void
  /** Click — apply the weight and record one undoable step. */
  onCommit: (weight: number) => void
  disabled?: boolean
}) {
  const { preview, restore, commit } = useHoverPreview(weight, onApply, onCommit)

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (!open) restore()
      }}
    >
      <TooltipLabel
        label={onlyWeight ? "This family ships a single weight" : "Font weight"}
      >
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-12 gap-1 px-2 text-xs font-normal"
            disabled={disabled || onlyWeight}
            aria-label="Font weight"
          >
            {weight}
            {!onlyWeight && <ChevronDown aria-hidden className="size-3 shrink-0" />}
          </Button>
        </DropdownMenuTrigger>
      </TooltipLabel>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Weight</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {weights.map((w) => (
          <DropdownMenuItem
            key={w}
            onMouseEnter={() => preview(w)}
            onMouseLeave={restore}
            onClick={() => commit(w)}
          >
            {w}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Font size as a combobox (§6) — the shadcn/ui combobox (Base UI): an
 * editable field — any size types in and commits on Enter/blur — with a
 * trigger chevron that opens the standard-size presets, filtered as you
 * type. Picking a preset commits it; an invalid or sub-1 px value reverts
 * to the current size.
 */
function FontSizeField({
  value,
  onCommit,
  disabled,
}: {
  value: number
  onCommit: (size: number) => void
  disabled?: boolean
}) {
  const [input, setInput] = useState(() => String(value))

  useEffect(() => {
    setInput(String(value))
  }, [value])

  const commit = (size: number) => {
    if (!Number.isFinite(size) || size < 1) {
      setInput(String(value))
      return
    }
    onCommit(size)
  }

  return (
    <label className="flex items-center gap-1.5">
      <span className="text-[10px] leading-none text-muted-foreground">Size</span>
      <Combobox
        items={FONT_SIZES}
        value={value}
        onValueChange={(size) => {
          if (size !== null) commit(size)
        }}
        inputValue={input}
        onInputValueChange={setInput}
        // A numeric contains-filter — typing "2" surfaces 12, 20, 24, …
        filter={(size, query, toString) =>
          (toString ?? String)(size).includes(query.trim())
        }
      >
        <ComboboxInput
          className="h-7 w-16"
          inputMode="decimal"
          disabled={disabled}
          aria-label="Font size (px)"
          onBlur={(event) => commit(Number(event.currentTarget.value))}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur()
          }}
        />
        <ComboboxContent>
          <ComboboxList>
            {(size) => (
              <ComboboxItem key={size} value={size}>
                {size}
              </ComboboxItem>
            )}
          </ComboboxList>
          <ComboboxEmpty>No matching size</ComboboxEmpty>
        </ComboboxContent>
      </Combobox>
    </label>
  )
}

/** A small toggle button — outline, filled while active, tooltip on hover (§6 property toggles). */
function ToggleButton({
  active,
  disabled,
  label,
  tooltip,
  onClick,
  children,
}: {
  active: boolean
  disabled?: boolean
  label: string
  tooltip?: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <TooltipLabel label={tooltip ?? label}>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
        onClick={onClick}
        className={cn(active && "bg-accent text-accent-foreground")}
      >
        {children}
      </Button>
    </TooltipLabel>
  )
}

/** Alignment choices (§6) — the active one reads on the button group. */
const ALIGNMENTS: { value: "left" | "center" | "right"; label: string; icon: typeof AlignLeft }[] = [
  { value: "left", label: "Align left", icon: AlignLeft },
  { value: "center", label: "Align center", icon: AlignCenter },
  { value: "right", label: "Align right", icon: AlignRight },
]

/**
 * Contextual text-property section (build spec §6), visible only while a
 * single Text object is selected: the ten properties — family, size, color,
 * weight (a numeric dropdown, plus a Bold toggle that reads active at 500+
 * and writes the family's bold weight / back to 400), italic (real faces
 * only — static 400-only families show no faux styling), underline,
 * alignment, line height (1.2 default) and letter spacing (both behind the
 * spacing popover button), and the two-way uppercase toggle. Values display
 * in px (size), em (letter spacing), or unitless (line height) and commit
 * immediately.
 */
function TextProps() {
  const { selection, commitTextProps } = useStage()
  const text = selection.length === 1 ? selection[0] : null
  if (!isTextObject(text)) return null

  const familySpec = getFontFamilySpec(text.fontFamily) ?? FONT_FAMILIES[0]
  const weight = Number(text.fontWeight) || 400
  const italic = text.fontStyle === "italic"
  const charSpacing = typeof text.charSpacing === "number" ? text.charSpacing : 0
  const onlyWeight = familySpec.weights.length === 1
  // Bold reads the weight: active at 500 and above (the CSS-bold range), and
  // the toggle writes the family's bold weight or back to regular 400.
  const boldWeight = getBoldWeight(text.fontFamily)
  const bold = weight >= 500
  // §7 Q3: a locked object's properties render read-only — unlock lives in
  // the lock toggle next to these sections.
  const locked = text.locked

  return (
    <div className="flex items-center gap-3">
      <label className="flex items-center gap-1.5">
        <span className="text-[10px] leading-none text-muted-foreground">Font</span>
        <FontFamilyField
          family={text.fontFamily}
          disabled={locked}
          onApply={(fontFamily) => commitTextProps({ fontFamily }, false)}
          onCommit={(fontFamily) => commitTextProps({ fontFamily })}
        />
      </label>

      <FontSizeField
        value={text.fontSize}
        disabled={locked}
        onCommit={(fontSize) => commitTextProps({ fontSize })}
      />

      <label className="flex items-center gap-1.5">
        <span className="text-[10px] leading-none text-muted-foreground">Weight</span>
        <WeightField
          weight={weight}
          weights={familySpec.weights}
          onlyWeight={onlyWeight}
          disabled={locked}
          onApply={(fontWeight) => commitTextProps({ fontWeight }, false)}
          onCommit={(fontWeight) => commitTextProps({ fontWeight })}
        />
      </label>

      <label className="flex items-center gap-1.5">
        <span className="text-[10px] leading-none text-muted-foreground">Fill</span>
        <ColorInput
          value={typeof text.fill === "string" ? text.fill : TEXT_FILL}
          disabled={locked}
          ariaLabel="Text color"
          tooltip="Text color"
          onApply={(fillColor) => commitTextProps({ fillColor }, false)}
          onChange={(fillColor) => commitTextProps({ fillColor })}
        />
      </label>

      <div className="flex items-center gap-0.5">
        <ToggleButton
          active={bold}
          disabled={locked || boldWeight === undefined}
          label="Bold"
          tooltip={
            locked
              ? undefined
              : boldWeight === undefined
                ? "This family ships no bold face — no faux bold"
                : undefined
          }
          onClick={() => commitTextProps({ fontWeight: bold ? 400 : boldWeight })}
        >
          <Bold aria-hidden />
        </ToggleButton>
        <ToggleButton
          active={italic}
          disabled={locked || !familySpec.italic}
          label="Italic"
          tooltip={
            locked
              ? undefined
              : familySpec.italic
                ? "Italic"
                : "This family ships no italic face — no faux italic"
          }
          onClick={() => commitTextProps({ fontStyle: italic ? "normal" : "italic" })}
        >
          <Italic aria-hidden />
        </ToggleButton>
        <ToggleButton
          active={!!text.underline}
          disabled={locked}
          label="Underline"
          onClick={() => commitTextProps({ underline: !text.underline })}
        >
          <Underline aria-hidden />
        </ToggleButton>
      </div>

      <div className="flex items-center gap-0.5" role="group" aria-label="Text alignment">
        {ALIGNMENTS.map(({ value, label, icon: Icon }) => (
          <ToggleButton
            key={value}
            active={text.textAlign === value}
            disabled={locked}
            label={label}
            onClick={() => commitTextProps({ textAlign: value })}
          >
            <Icon aria-hidden />
          </ToggleButton>
        ))}
      </div>

      <Popover>
        <TooltipLabel label="Spacing">
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={locked}
              aria-label="Text spacing"
            >
              <Type aria-hidden />
            </Button>
          </PopoverTrigger>
        </TooltipLabel>
        <PopoverContent align="start" className="w-64">
          <div className="flex flex-col gap-3">
            <span className="text-[10px] leading-none text-muted-foreground">
              Spacing
            </span>
            <TooltipLabel label="Line height">
              <label className="flex items-center gap-2">
                <span className="w-16 text-[10px] leading-none text-muted-foreground">
                  Line height
                </span>
                <Slider
                  className="w-28"
                  min={LINE_HEIGHT_RANGE.min}
                  max={LINE_HEIGHT_RANGE.max}
                  step={LINE_HEIGHT_RANGE.step}
                  value={[text.lineHeight]}
                  // Dragging previews live without recording; releasing the
                  // thumb commits the drag as ONE undoable step (ADR 0001, §8).
                  onValueChange={([lineHeight]) =>
                    // Round the float the slider may produce (0.05 steps) — the
                    // model stores lineHeight as a plain number and JSON would
                    // keep the residue.
                    commitTextProps({ lineHeight: Math.round(lineHeight * 100) / 100 }, false)
                  }
                  onValueCommit={([lineHeight]) =>
                    commitTextProps({ lineHeight: Math.round(lineHeight * 100) / 100 })
                  }
                  aria-label="Line height"
                />
                <span className="w-8 text-right text-[10px] leading-none text-muted-foreground tabular-nums">
                  {formatNumberField(text.lineHeight, 1, 2)}
                </span>
              </label>
            </TooltipLabel>
            <TooltipLabel label="Letter spacing (em)">
              <label className="flex items-center gap-2">
                <span className="w-16 text-[10px] leading-none text-muted-foreground">
                  Letter spacing
                </span>
                <Slider
                  className="w-28"
                  min={LETTER_SPACING_RANGE.min}
                  max={LETTER_SPACING_RANGE.max}
                  step={LETTER_SPACING_RANGE.step}
                  value={[charSpacing / 1000]}
                  // Dragging previews live without recording; releasing the
                  // thumb commits the drag as ONE undoable step (ADR 0001, §8).
                  onValueChange={([em]) =>
                    commitTextProps({ charSpacing: Math.round(em * 1000) }, false)
                  }
                  onValueCommit={([em]) =>
                    commitTextProps({ charSpacing: Math.round(em * 1000) })
                  }
                  aria-label="Letter spacing (em)"
                />
                <span className="w-8 text-right text-[10px] leading-none text-muted-foreground tabular-nums">
                  {formatNumberField(charSpacing, 1000, 2)}
                </span>
              </label>
            </TooltipLabel>
          </div>
        </PopoverContent>
      </Popover>

      <ToggleButton
        active={!!text.uppercase}
        disabled={locked}
        label="Uppercase"
        onClick={() => commitTextProps({ uppercase: !text.uppercase })}
      >
        <CaseUpper aria-hidden />
      </ToggleButton>
    </div>
  )
}

/**
 * Lock toggle (§7 Q3, Q6) — the toolbar's lock control: locks the whole
 * selection; a fully locked selection unlocks. Locked objects stay
 * selectable but inert — no handles, no transforms, no text edit — and
 * their property sections render read-only (§7 Q3).
 */
function LockButton() {
  const { selection, toggleLock } = useStage()
  const allLocked = selection.length > 0 && selection.every((obj) => obj.locked)
  return (
    <ToggleButton
      active={allLocked}
      label={allLocked ? "Unlock" : "Lock"}
      onClick={toggleLock}
    >
      <Lock aria-hidden />
    </ToggleButton>
  )
}

/**
 * Delete (§13) — the toolbar's visible face of the Del hotkey: removes every
 * unlocked object in the selection, mirrors the key's locked-object skip
 * (§7 Q3). A fully locked selection offers no delete — the button disables
 * with an explanation.
 */
function DeleteButton() {
  const { selection, deleteSelection } = useStage()
  const allLocked = selection.length > 0 && selection.every((obj) => obj.locked)
  return (
    <TooltipLabel
      label={
        allLocked
          ? "Locked objects can't be deleted — unlock first"
          : "Delete"
      }
    >
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Delete selection"
        disabled={allLocked}
        onClick={deleteSelection}
      >
        <Trash2 aria-hidden />
      </Button>
    </TooltipLabel>
  )
}

/**
 * Group (§7 Q6) — Ctrl+G: wrap the selection in a single-level group. Group
 * requires ≥2 objects (the command flattens any group in the selection
 * first); below that the button disables with an explanation. Grouped
 * children are fixed in place (§7 Q5 — no structural commands inside a
 * group), so a selection containing them disables the button too. Locked
 * members group like any other — the locked flag rides on the child.
 */
function GroupButton() {
  const { selection, groupSelection } = useStage()
  const enabled = selection.length >= 2 && !selection.some((obj) => isGrouped(obj))
  return (
    <TooltipLabel
      label={
        selection.some((obj) => isGrouped(obj))
          ? "Ungroup first — grouped objects can't be grouped"
          : enabled
            ? "Group (Ctrl+G)"
            : "Select two or more objects to group"
      }
    >
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Group"
        disabled={!enabled}
        onClick={groupSelection}
      >
        <GroupIcon aria-hidden />
      </Button>
    </TooltipLabel>
  )
}

/**
 * Ungroup (§7 Q6) — Ctrl+Shift+G: dissolve the selected group in place, its
 * children rising to the group's z-slot. Enabled only for a single selected
 * unlocked group — a locked group is inert (§7 Q7 — no ungroup), anything
 * else has nothing to ungroup; both disable with an explanation.
 */
function UngroupButton() {
  const { selection, ungroupSelection } = useStage()
  const obj = selection.length === 1 ? selection[0] : null
  const enabled = !!obj && isGroup(obj) && !obj.locked
  const label = !obj || !isGroup(obj)
    ? "Select a group to ungroup"
    : obj.locked
      ? "Locked groups can't be ungrouped — unlock first"
      : "Ungroup (Ctrl+Shift+G)"
  return (
    <TooltipLabel label={label}>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Ungroup"
        disabled={!enabled}
        onClick={ungroupSelection}
      >
        <UngroupIcon aria-hidden />
      </Button>
    </TooltipLabel>
  )
}

/**
 * Opacity card — a popover like the Arrange and Align cards: the selection's
 * transparency as a 0–100% slider, committed live to the whole selection as
 * it moves (the readout shows the first object's value — the commit applies
 * to every unlocked object in the selection). The card body is a single
 * inline row, label + slider + readout, like the text-spacing card's rows.
 * Locked objects are inert (§7 Q3 — property edits skip them), so a fully
 * locked selection has nothing to edit — the trigger disables with an
 * explanation, like arrange's.
 */
function OpacityButton() {
  const { selection, commitOpacity } = useStage()
  const hasUnlocked = selection.some((obj) => !obj.locked)
  const value = selection[0]?.opacity ?? 1
  return (
    <Popover>
      <TooltipLabel
        label={
          hasUnlocked ? "Opacity" : "Locked objects can't be edited — unlock first"
        }
      >
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="icon-sm"
            disabled={!hasUnlocked}
            aria-label="Opacity"
          >
            <Blend aria-hidden />
          </Button>
        </PopoverTrigger>
      </TooltipLabel>
      <PopoverContent align="end" className="w-64">
        <TooltipLabel label="Opacity">
          <label className="flex items-center gap-2">
            <span className="w-16 text-[10px] leading-none text-muted-foreground">
              Opacity
            </span>
            <Slider
              className="w-28"
              min={OPACITY_RANGE.min}
              max={OPACITY_RANGE.max}
              step={OPACITY_RANGE.step}
              value={[Math.round(value * 100)]}
              // Dragging previews live without recording; releasing the thumb
              // commits the whole drag as ONE undoable step (ADR 0001, §8).
              onValueChange={([percent]) => commitOpacity(percent / 100, false)}
              onValueCommit={([percent]) => commitOpacity(percent / 100)}
              aria-label="Opacity"
            />
            <span className="w-8 text-right text-[10px] leading-none text-muted-foreground tabular-nums">
              {Math.round(value * 100)}%
            </span>
          </label>
        </TooltipLabel>
      </PopoverContent>
    </Popover>
  )
}

/**
 * The four z-order commands (§7 Q6) — the Arrange card's grid, listed
 * top-of-stack first, reading left-to-right, top-to-bottom.
 */
const ARRANGE_COMMANDS: {
  value: ArrangeCommand
  label: string
  icon: typeof ArrowUp
}[] = [
  { value: "to-front", label: "To front", icon: ArrowUpToLine },
  { value: "forward", label: "Forward", icon: ArrowUp },
  { value: "backward", label: "Backward", icon: ArrowDown },
  { value: "to-back", label: "To back", icon: ArrowDownToLine },
]

/**
 * Arrange card (§7 Q6) — a popover like the text-spacing card: the four
 * z-order commands — step forward or backward one slot, or to the very
 * front or back — as a two-column grid. The selection moves as a block and
 * locked objects are inert (§7 Q3, Q7 — no arrange), so a fully locked
 * selection has nothing to arrange — the trigger disables with an
 * explanation, like delete's. The card stays open — commands pick in a row,
 * and it closes on outside click or Escape.
 */
function ArrangeButton() {
  const { selection, arrangeSelection } = useStage()
  const hasUnlocked = selection.some((obj) => !obj.locked)
  return (
    <Popover>
      <TooltipLabel
        label={
          hasUnlocked
            ? "Arrange"
            : "Locked objects can't be rearranged — unlock first"
        }
      >
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="icon-sm"
            disabled={!hasUnlocked}
            aria-label="Arrange"
          >
            <Layers aria-hidden />
          </Button>
        </PopoverTrigger>
      </TooltipLabel>
      <PopoverContent align="end" className="w-56">
        <div className="flex flex-col gap-1.5">
          <span className="px-1 text-[10px] leading-none text-muted-foreground">
            Arrange
          </span>
          <div className="grid grid-cols-2 gap-0.5">
            {ARRANGE_COMMANDS.map(({ value, label, icon: Icon }) => (
              <Button
                key={value}
                variant="ghost"
                size="sm"
                className="flex h-auto items-center justify-start gap-1.5 px-2 py-1.5 text-[10px] font-normal"
                onClick={() => arrangeSelection(value)}
              >
                <Icon aria-hidden />
                {label}
              </Button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/**
 * The six alignment commands (a requested addition beyond §7 Q6's control
 * surface) — the Align card's grid: the vertical trio (top/middle/bottom)
 * in one column, the horizontal trio (left/center/right) in the other. The
 * reference is the Document for a lone selection, the selection's own bounds
 * for two or more (objects align to each other).
 */
const ALIGN_COMMANDS: {
  value: AlignCommand
  label: string
  icon: typeof AlignStartVertical
}[] = [
  { value: "top", label: "Align top", icon: AlignStartVertical },
  { value: "left", label: "Align left", icon: AlignStartHorizontal },
  { value: "middle", label: "Align middle", icon: AlignCenterVertical },
  { value: "center", label: "Align center", icon: AlignCenterHorizontal },
  { value: "bottom", label: "Align bottom", icon: AlignEndVertical },
  { value: "right", label: "Align right", icon: AlignEndHorizontal },
]

/**
 * Align card — a popover like the Arrange card: the six alignment commands
 * — the selection's edge or center meets a reference, vertically (top /
 * middle / bottom) and horizontally (left / center / right) — as a two-
 * column grid. The reference is the Document for a lone selection; for two
 * or more it is the selection's own bounds, so the objects align relative
 * to each other (the outermost object stays put and the rest come to it).
 * Locked objects are inert (§7 Q3, Q7 — no arrange), so a fully locked
 * selection has nothing to align — the trigger disables with an
 * explanation, like arrange's. The card stays open — commands pick in a
 * row, and it closes on outside click or Escape.
 */
function AlignButton() {
  const { selection, alignSelection } = useStage()
  const hasUnlocked = selection.some((obj) => !obj.locked)
  return (
    <Popover>
      <TooltipLabel
        label={
          hasUnlocked
            ? "Align"
            : "Locked objects can't be aligned — unlock first"
        }
      >
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="icon-sm"
            disabled={!hasUnlocked}
            aria-label="Align"
          >
            <AlignStartVertical aria-hidden />
          </Button>
        </PopoverTrigger>
      </TooltipLabel>
      <PopoverContent align="end" className="w-56">
        <div className="flex flex-col gap-1.5">
          <span className="px-1 text-[10px] leading-none text-muted-foreground">
            Align
          </span>
          <div className="grid grid-cols-2 gap-0.5">
            {ALIGN_COMMANDS.map(({ value, label, icon: Icon }) => (
              <Button
                key={value}
                variant="ghost"
                size="sm"
                className="flex h-auto items-center justify-start gap-1.5 px-2 py-1.5 text-[10px] font-normal"
                onClick={() => alignSelection(value)}
              >
                <Icon aria-hidden />
                {label}
              </Button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/**
 * The two flip commands (§7 Q6) — the Flip card's row: mirror the selection
 * horizontally or vertically. Each command is a toggle — applying it again
 * un-flips.
 */
const FLIP_COMMANDS: {
  value: FlipCommand
  label: string
  icon: typeof FlipHorizontal2
}[] = [
  { value: "horizontal", label: "Flip horizontal", icon: FlipHorizontal2 },
  { value: "vertical", label: "Flip vertical", icon: FlipVertical2 },
]

/**
 * Flip card (§7 Q6) — a popover like the Arrange and Align cards: the two
 * mirror commands — horizontal or vertical — as a two-column grid. The
 * selection flips as a unit, each object around its own center; locked
 * objects are inert (§7 Q3, Q7 — no flip), so a fully locked selection has
 * nothing to flip — the trigger disables with an explanation, like
 * arrange's. The card stays open — commands pick in a row, and it closes on
 * outside click or Escape.
 */
function FlipButton() {
  const { selection, flipSelection } = useStage()
  const hasUnlocked = selection.some((obj) => !obj.locked)
  return (
    <Popover>
      <TooltipLabel
        label={
          hasUnlocked ? "Flip" : "Locked objects can't be flipped — unlock first"
        }
      >
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="icon-sm"
            disabled={!hasUnlocked}
            aria-label="Flip"
          >
            <FlipVertical2 aria-hidden />
          </Button>
        </PopoverTrigger>
      </TooltipLabel>
      <PopoverContent align="end" className="w-56">
        <div className="flex flex-col gap-1.5">
          <span className="px-1 text-[10px] leading-none text-muted-foreground">
            Flip
          </span>
          <div className="grid grid-cols-2 gap-0.5">
            {FLIP_COMMANDS.map(({ value, label, icon: Icon }) => (
              <Button
                key={value}
                variant="ghost"
                size="sm"
                className="flex h-auto items-center justify-start gap-1.5 px-2 py-1.5 text-[10px] font-normal"
                onClick={() => flipSelection(value)}
              >
                <Icon aria-hidden />
                {label}
              </Button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/**
 * Stage toolbar strip (build spec §3): document properties — size with unit
 * display and the canvas look (background, border) — plus the contextual
 * shape-property section while a single shape is selected and the text
 * properties while a single Text object is selected (§6). While a shape or
 * text object is selected the toolbar narrows to just that object's own
 * properties — the document controls (size, units, canvas look) are hidden,
 * since the object's own size is what's being edited. Opacity, flip,
 * arrange, align, lock, and delete sit at the strip's end, visible for any
 * non-empty selection (§7 Q6).
 */
export function StageToolbar() {
  const { selection } = useStage()
  const hasShape = selection.length === 1 && getShapeKind(selection[0]) !== null
  const hasText = selection.length === 1 && isTextObject(selection[0])

  return (
    <TooltipProvider>
      <div className="flex h-10 shrink-0 items-center gap-3 border-b bg-background px-3">
        {!hasShape && !hasText && (
          <>
            <DocumentSize />
            <UnitSwitcher />
            <Separator orientation="vertical" className="mx-1 h-5" />
            <CanvasProps />
          </>
        )}
        {hasShape && <ShapeProps />}
        {hasText && <TextProps />}
        <div className="flex-1" />
        {selection.length > 0 && (
          <>
            <Separator orientation="vertical" className="mx-1 h-5" />
            <GroupButton />
            <UngroupButton />
            <Separator orientation="vertical" className="mx-1 h-5" />
            <OpacityButton />
            <FlipButton />
            <ArrangeButton />
            <AlignButton />
            <LockButton />
            <DeleteButton />
          </>
        )}
      </div>
    </TooltipProvider>
  )
}
