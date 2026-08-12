import { useEffect, useState, type ReactNode } from "react"
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  CaseUpper,
  ChevronDown,
  Italic,
  Underline,
} from "lucide-react"

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
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import {
  DEFAULT_BORDER_COLOR,
  DEFAULT_FILL,
  getBorderWidth,
  getShapeKind,
} from "@/fabric/shapes"
import {
  FONT_FAMILIES,
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

/** A color swatch input — shared by the shape and canvas property sections. */
function ColorInput({
  value,
  onChange,
  disabled,
  ariaLabel,
  title,
}: {
  value: string
  onChange: (color: string) => void
  disabled?: boolean
  ariaLabel: string
  title: string
}) {
  return (
    <input
      type="color"
      className="h-7 w-9 cursor-pointer rounded-md bg-transparent p-0.5"
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
      onChange={(event) => onChange(event.target.value)}
    />
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
          title="Canvas background color"
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
          onValueChange={([value]) => commitCanvasProps({ borderWidth: value })}
          aria-label="Border width"
        />
        <span className="w-8 text-right text-[10px] leading-none text-muted-foreground tabular-nums">
          {borderWidth}px
        </span>
        <ColorInput
          value={borderColor}
          disabled={borderWidth === 0}
          ariaLabel="Border color"
          title={borderWidth === 0 ? "Border is off — set a width first" : "Border color"}
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

  return (
    <div className="flex items-center gap-3">
      <label className="flex items-center gap-1.5">
        <span className="text-[10px] leading-none text-muted-foreground">Fill</span>
        <ColorInput
          value={typeof shape.fill === "string" ? shape.fill : DEFAULT_FILL}
          ariaLabel="Shape background color"
          title="Shape background color"
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
          onValueChange={([value]) => commitShapeProps({ borderWidth: value })}
          aria-label="Border width"
        />
        <span className="w-8 text-right text-[10px] leading-none text-muted-foreground tabular-nums">
          {borderWidth}px
        </span>
        <ColorInput
          value={typeof shape.stroke === "string" ? shape.stroke : DEFAULT_BORDER_COLOR}
          disabled={borderWidth === 0}
          ariaLabel="Border color"
          title={borderWidth === 0 ? "Border is off — set a width first" : "Border color"}
          onChange={(borderColor) => commitShapeProps({ borderColor })}
        />
      </label>
    </div>
  )
}

/**
 * Display formatting for NumberField — trailing zeros trimmed only after the
 * decimal point, so an integer like 10 px never renders as "1" (the plain
 * `0+$` pattern would strip the zero off an integer with no decimal).
 */
function formatNumberField(value: number, scale: number, decimals: number): string {
  return (value / scale).toFixed(decimals).replace(/\.\d*?0+$/, "")
}

/**
 * A small labeled numeric field, committing on Enter/blur — the UnitField
 * pattern without unit conversion. `scale` converts the displayed value to
 * the model value (letter spacing displays in em, stores thousandths — 1000
 * × the em), `decimals` the display precision. Invalid input or a value under
 * `min` reverts to the current value.
 */
function NumberField({
  label,
  value,
  scale = 1,
  decimals = 0,
  min,
  onCommit,
  title,
}: {
  label: string
  value: number
  scale?: number
  decimals?: number
  min?: number
  onCommit: (value: number) => void
  title?: string
}) {
  const [text, setText] = useState(() => formatNumberField(value, scale, decimals))

  useEffect(() => {
    setText(formatNumberField(value, scale, decimals))
  }, [value, scale, decimals])

  const commit = () => {
    const parsed = Number(text)
    if (!Number.isFinite(parsed) || (min !== undefined && parsed < min)) {
      setText(formatNumberField(value, scale, decimals))
      return
    }
    onCommit(scale > 1 ? Math.round(parsed * scale) : parsed)
  }

  return (
    <label className="flex items-center gap-1.5" title={title ?? label}>
      <span className="text-[10px] leading-none text-muted-foreground">{label}</span>
      <Input
        className="h-7 w-14"
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

/** A small toggle button — outline, filled while active (§6 property toggles). */
function ToggleButton({
  active,
  disabled,
  label,
  title,
  onClick,
  children,
}: {
  active: boolean
  disabled?: boolean
  label: string
  title?: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Button
      variant="outline"
      size="icon-sm"
      aria-label={label}
      title={title ?? label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(active && "bg-accent text-accent-foreground")}
    >
      {children}
    </Button>
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
 * single Text object is selected: the nine properties — family, size,
 * weight/italic (real faces only — static 400-only families show no faux
 * styling), underline, alignment, line height (1.2 default), letter spacing,
 * and the one-way uppercase flag. Values display in px (size), em
 * (letter spacing), or unitless (line height) and commit immediately.
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

  return (
    <div className="flex items-center gap-3">
      <label className="flex items-center gap-1.5">
        <span className="text-[10px] leading-none text-muted-foreground">Font</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 max-w-32 gap-1 px-2 text-xs font-normal"
              aria-label="Font family"
            >
              <span className="truncate">{text.fontFamily}</span>
              <ChevronDown aria-hidden className="size-3 shrink-0" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Font family</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {FONT_FAMILIES.map(({ family }) => (
              <DropdownMenuItem
                key={family}
                onClick={() => commitTextProps({ fontFamily: family })}
              >
                {family}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </label>

      <NumberField
        label="Size"
        title="Font size (px)"
        value={text.fontSize}
        min={1}
        onCommit={(fontSize) => commitTextProps({ fontSize })}
      />

      <label className="flex items-center gap-1.5">
        <span className="text-[10px] leading-none text-muted-foreground">Weight</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-12 gap-1 px-2 text-xs font-normal"
              disabled={onlyWeight}
              aria-label="Font weight"
              title={onlyWeight ? "This family ships a single weight" : "Font weight"}
            >
              {weight}
              {!onlyWeight && <ChevronDown aria-hidden className="size-3 shrink-0" />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Weight — real faces only</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {familySpec.weights.map((w) => (
              <DropdownMenuItem
                key={w}
                onClick={() => commitTextProps({ fontWeight: w })}
              >
                {w}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </label>

      <div className="flex items-center gap-0.5">
        <ToggleButton
          active={italic}
          disabled={!familySpec.italic}
          label="Italic"
          title={
            familySpec.italic
              ? "Italic"
              : "This family ships no italic face — no faux italic"
          }
          onClick={() => commitTextProps({ fontStyle: italic ? "normal" : "italic" })}
        >
          <Italic aria-hidden />
        </ToggleButton>
        <ToggleButton
          active={!!text.underline}
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
            label={label}
            onClick={() => commitTextProps({ textAlign: value })}
          >
            <Icon aria-hidden />
          </ToggleButton>
        ))}
      </div>

      <NumberField
        label="LH"
        title="Line height"
        value={text.lineHeight}
        decimals={2}
        min={0.1}
        onCommit={(lineHeight) => commitTextProps({ lineHeight })}
      />

      <NumberField
        label="LS"
        title="Letter spacing (em)"
        value={charSpacing}
        scale={1000}
        decimals={2}
        onCommit={(charSpacing) => commitTextProps({ charSpacing })}
      />

      <ToggleButton
        active={!!text.uppercase}
        label="Uppercase"
        title="Uppercase — one-way: turning it off stops forcing case but never restores it"
        onClick={() => commitTextProps({ uppercase: !text.uppercase })}
      >
        <CaseUpper aria-hidden />
      </ToggleButton>
    </div>
  )
}

/**
 * Stage toolbar strip (build spec §3): document properties — size with unit
 * display and the canvas look (background, border) — plus the contextual
 * shape-property section while a single shape is selected and the text
 * properties while a single Text object is selected (§6). The §7 selection
 * controls (group, arrange, flip, lock) arrive with the selection build.
 */
export function StageToolbar() {
  const { selection } = useStage()
  const hasShape = selection.length === 1 && getShapeKind(selection[0]) !== null
  const hasText = selection.length === 1 && isTextObject(selection[0])

  return (
    <div className="flex h-10 shrink-0 items-center gap-3 border-b bg-background px-3">
      <DocumentSize />
      <UnitSwitcher />
      <Separator orientation="vertical" className="mx-1 h-5" />
      <CanvasProps />
      {hasShape && (
        <>
          <Separator orientation="vertical" className="mx-1 h-5" />
          <ShapeProps />
        </>
      )}
      {hasText && (
        <>
          <Separator orientation="vertical" className="mx-1 h-5" />
          <TextProps />
        </>
      )}
      <div className="flex-1" />
    </div>
  )
}
