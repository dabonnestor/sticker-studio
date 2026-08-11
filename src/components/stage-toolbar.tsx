import { useEffect, useState, type ReactNode } from "react"
import { Frame } from "lucide-react"

import { useStage } from "@/components/stage-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  DEFAULT_BORDER_COLOR,
  getBorderWidth,
  getCutExtent,
  getCutRadius,
  getStickerShapeKind,
} from "@/fabric/shapes"
import { commitPx, formatPx, type Unit } from "@/lib/units"
import { cn } from "@/lib/utils"

const UNITS: { value: Unit; label: string }[] = [
  { value: "in", label: "in" },
  { value: "mm", label: "mm" },
  { value: "px", label: "px" },
]

/**
 * A labeled numeric field over stored px, displayed in the active unit
 * (build spec §5): switching units re-labels without rescaling; the value
 * converts to integer px at commit (Enter/blur); invalid input reverts.
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
    <label className={cn("flex flex-col gap-0.5", className)}>
      <span className="text-[10px] leading-none text-muted-foreground">{label}</span>
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

/** The unit switch — a label swap over stored px, shared by all toolbar fields. */
function UnitSwitcher() {
  const { unit, setUnit } = useStage()
  return (
    <div className="flex items-center gap-0.5" role="group" aria-label="Units">
      {UNITS.map(({ value, label }) => (
        <Button
          key={value}
          variant="ghost"
          size="xs"
          aria-pressed={unit === value}
          className={cn(unit === value && "bg-muted")}
          onClick={() => setUnit(value)}
        >
          {label}
        </Button>
      ))}
    </div>
  )
}

/** A W×H field pair in the active unit — shared by Document and sticker size. */
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
    <div className="flex items-end gap-1.5">
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
 * Contextual shape-property section (build spec §5), visible only while a
 * single sticker is selected: size (square = one linked side, circle =
 * diameter, others W×H), the rounded-rectangle corner radius, and the inset
 * border (width + color). All values display in the active unit and commit
 * as px.
 */
function ShapeProps() {
  const { selection, unit, commitShapeProps } = useStage()
  const sticker = selection.length === 1 ? selection[0] : null
  const kind = sticker ? getStickerShapeKind(sticker) : null
  if (!sticker || !kind) return null

  const cut = getCutExtent(sticker)
  const borderWidth = getBorderWidth(sticker)

  const sizeFields: ReactNode =
    kind === "square" ? (
      <UnitField
        label="Side"
        valuePx={cut.width}
        unit={unit}
        onCommit={(side) => commitShapeProps({ size: { width: side, height: side } })}
      />
    ) : kind === "circle" ? (
      <UnitField
        label="Diameter"
        valuePx={cut.width}
        unit={unit}
        onCommit={(diameter) =>
          commitShapeProps({ size: { width: diameter, height: diameter } })
        }
      />
    ) : (
      <SizeFieldPair
        widthPx={cut.width}
        heightPx={cut.height}
        unit={unit}
        onCommit={(width, height) => commitShapeProps({ size: { width, height } })}
      />
    )

  return (
    <div className="flex items-end gap-2">
      {sizeFields}
      {kind === "rounded-rectangle" && (
        <UnitField
          label="Radius"
          valuePx={getCutRadius(sticker)}
          unit={unit}
          onCommit={(radius) => commitShapeProps({ cornerRadius: radius })}
        />
      )}
      <UnitField
        label="Border"
        valuePx={borderWidth}
        unit="px"
        onCommit={(width) => commitShapeProps({ borderWidth: width })}
      />
      <label className="flex flex-col gap-0.5">
        <span className="text-[10px] leading-none text-muted-foreground">Color</span>
        <input
          type="color"
          className="h-7 w-9 cursor-pointer rounded-md border border-input bg-transparent p-0.5"
          value={typeof sticker.stroke === "string" ? sticker.stroke : DEFAULT_BORDER_COLOR}
          disabled={borderWidth === 0}
          title={borderWidth === 0 ? "Border is off — set a width first" : "Border color"}
          onChange={(event) => commitShapeProps({ borderColor: event.target.value })}
        />
      </label>
    </div>
  )
}

/**
 * Stage toolbar strip (build spec §3): document properties (size with unit
 * display, edge-border toggle) plus the contextual shape-property section
 * while a single sticker is selected. The §7 selection controls (group,
 * arrange, flip, lock) arrive with the selection build.
 */
export function StageToolbar() {
  const { selection, edgeBorder, setEdgeBorder } = useStage()
  const hasSticker = selection.length === 1 && getStickerShapeKind(selection[0]) !== null

  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-t bg-background px-3">
      <DocumentSize />
      <UnitSwitcher />
      <Separator orientation="vertical" className="mx-1 h-5" />
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={edgeBorder ? "outline" : "ghost"}
              size="icon-sm"
              aria-pressed={edgeBorder}
              aria-label="Toggle canvas edge border"
              onClick={() => setEdgeBorder(!edgeBorder)}
            >
              <Frame aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Canvas edge border (view-only)</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {hasSticker && (
        <>
          <Separator orientation="vertical" className="mx-1 h-5" />
          <ShapeProps />
        </>
      )}
      <div className="flex-1" />
    </div>
  )
}
