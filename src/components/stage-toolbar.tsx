import { useEffect, useState } from "react"
import { ChevronDown } from "lucide-react"

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
 * Stage toolbar strip (build spec §3): document properties — size with unit
 * display and the canvas look (background, border) — plus the contextual
 * shape-property section while a single shape is selected. The §7 selection
 * controls (group, arrange, flip, lock) arrive with the selection build.
 */
export function StageToolbar() {
  const { selection } = useStage()
  const hasShape = selection.length === 1 && getShapeKind(selection[0]) !== null

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
      <div className="flex-1" />
    </div>
  )
}
