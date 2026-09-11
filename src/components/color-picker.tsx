import { useEffect, useRef, useState, type ReactNode } from "react"
import { HexColorPicker } from "react-colorful"
import { PipetteIcon, Slash } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/utils"
import { hexToRgb, hslToRgb, rgbToHex, rgbToHsl } from "@/lib/color-converter"

/** A full 6-digit hex color — the only shape the session commits. */
const HEX_PATTERN = /^#[0-9A-Fa-f]{6}$/

/** Border slider range and step — 0 (off) to 1 inch at the 96 DPI basis. */
const BORDER_RANGE = { min: 0, max: 96, step: 1 } as const

type ColorFormat = "HEX" | "RGB" | "HSL"

interface ColorValues {
  hex: string
  rgb: { r: number; g: number; b: number }
  hsl: { h: number; s: number; l: number }
}

/**
 * A color swatch opening the shadcn-input-color popover (react-colorful
 * picker, HEX/RGB/HSL format select, hex input, eyedropper) — shared by the
 * text, shape and canvas property sections. Two extension points serve the
 * border picker: `swatch` replaces the plain color background (the border
 * swatch's red slash while the border is off), and `children` renders
 * inside the popover below the color controls (the border width slider).
 * Skimming the popover previews live through onApply — applied without
 * recording, so dragging never pollutes the undo stack (§8). The session
 * commits one undoable step when the popover closes, by any gesture (click
 * outside, Escape, selecting a format): the close fires onOpenChange(false),
 * which commits the session's color through onChange.
 *
 * Only a real change commits. A session that left the color as it found it —
 * a skim, or a color re-entered unchanged — is not an interaction boundary
 * (ADR 0001), and recording it stacks a step that undoes to an identical
 * document: the next undo would look dead (setting the document border to
 * 16px then undoing needed two presses). Hex case is a spelling, not a color,
 * so every comparison here ignores it — the picker's own fields respell
 * uppercase, and the document keeps its own spelling until the user picks a
 * different color. A partial or invalid typed hex never commits, so it can't
 * leak into the document.
 */
function ColorPicker({
  value,
  onApply,
  onChange,
  disabled,
  ariaLabel,
  className,
  swatch,
  children,
}: {
  value: string
  onApply: (color: string) => void
  onChange: (color: string) => void
  disabled?: boolean
  ariaLabel: string
  className?: string
  /** Custom swatch content — replaces the plain color background. */
  swatch?: ReactNode
  /** Extra content rendered inside the popover, below the color controls. */
  children?: ReactNode
}) {
  const [colorFormat, setColorFormat] = useState<ColorFormat>("HEX")
  const [colorValues, setColorValues] = useState<ColorValues>(() => {
    const rgb = hexToRgb(value)
    return { hex: value, rgb, hsl: rgbToHsl(rgb.r, rgb.g, rgb.b) }
  })
  const [hexInputValue, setHexInputValue] = useState(value)
  const [hexInputError, setHexInputError] = useState<string | null>(null)
  // The last valid full hex — what the session commits on popover close. It
  // holds the document's own spelling until the user picks a color, so a
  // commit of an unpicked color is the value the document already has.
  const lastValidRef = useRef(value)
  // The color the document held when the card opened — the session's
  // baseline. The close commits only a change against it.
  const sessionStartRef = useRef(value)
  const onApplyRef = useRef(onApply)
  onApplyRef.current = onApply
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  /** True when two hex colors are the same color, spelling aside. */
  const sameColor = (a: string, b: string) => a.toUpperCase() === b.toUpperCase()

  const updateColorValues = (newColor: string) => {
    const rgb = hexToRgb(newColor)
    setColorValues({
      hex: newColor.toUpperCase(),
      rgb,
      hsl: rgbToHsl(rgb.r, rgb.g, rgb.b),
    })
    setHexInputValue(newColor.toUpperCase())
  }

  /** Apply a valid color live (no history) and remember it for the commit. */
  const apply = (newColor: string) => {
    const previous = lastValidRef.current
    updateColorValues(newColor)
    lastValidRef.current = newColor.toUpperCase()
    // Re-entering the color already in the document writes nothing: the
    // preview would only respell it, leaving the document differing from the
    // top of the undo stack by hex case — a difference the next commit would
    // then record as a step of its own.
    if (sameColor(newColor, previous)) return
    onApplyRef.current(newColor)
  }

  // Picker drags always produce a valid hex.
  const handleColorChange = (newColor: string) => apply(newColor)

  const handleHexChange = (raw: string) => {
    let formatted = raw.toUpperCase()
    if (!formatted.startsWith("#")) formatted = "#" + formatted
    if (formatted.length > 7 || !/^#[0-9A-Fa-f]*$/.test(formatted)) return
    setHexInputValue(formatted)
    if (HEX_PATTERN.test(formatted)) {
      setHexInputError(null)
      apply(formatted)
    } else {
      setHexInputError("Enter a valid color")
    }
  }

  const handleRgbChange = (component: "r" | "g" | "b", raw: string) => {
    const numValue = Number.parseInt(raw) || 0
    const clampedValue = Math.max(0, Math.min(255, numValue))
    const newRgb: ColorValues["rgb"] = {
      ...colorValues.rgb,
      [component]: clampedValue,
    }
    apply(rgbToHex(newRgb.r, newRgb.g, newRgb.b))
  }

  const handleHslChange = (component: "h" | "s" | "l", raw: string) => {
    const numValue = Number.parseInt(raw) || 0
    const clampedValue =
      component === "h"
        ? Math.max(0, Math.min(360, numValue))
        : Math.max(0, Math.min(100, numValue))
    const newHsl: ColorValues["hsl"] = {
      ...colorValues.hsl,
      [component]: clampedValue,
    }
    const rgb = hslToRgb(newHsl.h, newHsl.s, newHsl.l)
    apply(rgbToHex(rgb.r, rgb.g, rgb.b))
  }

  // The popover close is the commit boundary — one undoable step, by any
  // gesture (ADR 0001 §8) — but only for a session that changed the color.
  // Opening anchors the baseline; a close that finds the color where it
  // started records nothing (see the class doc).
  const handlePopoverChange = (open: boolean) => {
    if (open) {
      sessionStartRef.current = lastValidRef.current
      return
    }
    setColorFormat("HEX")
    const color = lastValidRef.current
    if (sameColor(color, sessionStartRef.current)) return
    onChangeRef.current(color)
  }

  type EyeDropperApi = { open: () => Promise<{ sRGBHex: string }> }
  const isEyeDropperAvailable = () =>
    typeof window !== "undefined" &&
    "EyeDropper" in window &&
    typeof (window as unknown as { EyeDropper?: new () => EyeDropperApi })
      .EyeDropper === "function"

  const handleEyeDropper = async () => {
    const EyeDropperCtor = (
      window as unknown as { EyeDropper?: new () => EyeDropperApi }
    ).EyeDropper
    if (!EyeDropperCtor) return
    try {
      const result = await new EyeDropperCtor().open()
      apply(result.sRGBHex)
    } catch {
      // User canceled the eyedropper.
    }
  }

  // Sync when the committed value changes from outside (undo/redo, commit).
  // During a drag the handler already applied the same color — the value
  // prop round-trips it, so the sync bails and skips a redundant re-render
  // per tick (the drag's rapid-fire onChange would otherwise double every
  // tick's render count and let fast pointer events nest into the commit).
  useEffect(() => {
    if (value.toUpperCase() === colorValues.hex) return
    updateColorValues(value)
    setHexInputValue(value.toUpperCase())
    // Verbatim, not uppercased: the picker's display normalizes, but what it
    // holds for the commit stays the document's own spelling — a value
    // restored from outside mid-session (an undo with the card open) then
    // commits back as the value the document already has.
    lastValidRef.current = value
  }, [value])

  return (
    <Popover onOpenChange={handlePopoverChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          disabled={disabled}
          aria-label={ariaLabel}
          className={cn("h-7 w-7 cursor-pointer rounded-md p-0.5 shadow-none", className)}
          style={swatch ? undefined : { backgroundColor: hexInputValue }}
        >
          {swatch}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="start">
        <div className="color-picker space-y-3">
          <div className="relative">
            <Button
              variant="ghost"
              size="icon-xs"
              className="absolute -top-1.5 -left-1 z-10 h-7 w-7 bg-transparent hover:bg-transparent"
              onClick={handleEyeDropper}
              disabled={!isEyeDropperAvailable()}
              aria-label="Pick a color from the screen"
            >
              <PipetteIcon className="h-3 w-3" />
            </Button>
            <HexColorPicker
              className="!aspect-square !h-[244.79px] !w-[244.79px]"
              color={colorValues.hex}
              onChange={handleColorChange}
            />
          </div>
          <div className="flex gap-2">
            <Select
              value={colorFormat}
              onValueChange={(format) => setColorFormat(format as ColorFormat)}
            >
              <SelectTrigger className="!h-7 !w-[4.8rem] rounded-sm px-2 py-1 !text-sm">
                <SelectValue placeholder="Color" />
              </SelectTrigger>
              <SelectContent className="min-w-20">
                <SelectItem value="HEX" className="h-7 text-sm">
                  HEX
                </SelectItem>
                <SelectItem value="RGB" className="h-7 text-sm">
                  RGB
                </SelectItem>
                <SelectItem value="HSL" className="h-7 text-sm">
                  HSL
                </SelectItem>
              </SelectContent>
            </Select>
            {colorFormat === "HEX" ? (
              <Input
                className="h-7 w-[160px] rounded-sm text-sm"
                value={hexInputValue}
                onChange={(event) => handleHexChange(event.target.value)}
                placeholder="#FF0000"
                maxLength={7}
              />
            ) : colorFormat === "RGB" ? (
              <div className="flex items-center">
                <Input
                  className="h-7 w-13 rounded-l-sm rounded-r-none text-center text-sm"
                  value={colorValues.rgb.r}
                  onChange={(event) => handleRgbChange("r", event.target.value)}
                  placeholder="255"
                  maxLength={3}
                />
                <Input
                  className="h-7 w-13 rounded-none border-x-0 text-center text-sm"
                  value={colorValues.rgb.g}
                  onChange={(event) => handleRgbChange("g", event.target.value)}
                  placeholder="255"
                  maxLength={3}
                />
                <Input
                  className="h-7 w-13 rounded-l-none rounded-r-sm text-center text-sm"
                  value={colorValues.rgb.b}
                  onChange={(event) => handleRgbChange("b", event.target.value)}
                  placeholder="255"
                  maxLength={3}
                />
              </div>
            ) : (
              <div className="flex items-center">
                <Input
                  className="h-7 w-13 rounded-l-sm rounded-r-none text-center text-sm"
                  value={colorValues.hsl.h}
                  onChange={(event) => handleHslChange("h", event.target.value)}
                  placeholder="360"
                  maxLength={3}
                />
                <Input
                  className="h-7 w-13 rounded-none border-x-0 text-center text-sm"
                  value={colorValues.hsl.s}
                  onChange={(event) => handleHslChange("s", event.target.value)}
                  placeholder="100"
                  maxLength={3}
                />
                <Input
                  className="h-7 w-13 rounded-l-none rounded-r-sm text-center text-sm"
                  value={colorValues.hsl.l}
                  onChange={(event) => handleHslChange("l", event.target.value)}
                  placeholder="100"
                  maxLength={3}
                />
              </div>
            )}
          </div>
          {children}
        </div>
        {hexInputError && (
          <p className="text-destructive mt-1.5 text-sm">{hexInputError}</p>
        )}
      </PopoverContent>
    </Popover>
  )
}

/**
 * Border picker — the ColorPicker's swatch and popover, extended for the
 * border property: the popover card adds the border width slider below the
 * color controls, so the toolbar shows one swatch instead of a slider +
 * color pair. The swatch reads the border state — the color while a border
 * is on (width > 0), a red slash while off, the default state: shapes and
 * documents start borderless (§4). The card's slider is the only way to
 * turn the border on, so it stays enabled at width 0 — the color controls
 * too, so a color can be set before the border exists. The slider previews
 * live without recording and commits the whole drag as ONE undoable step on
 * release; the color commits on popover close (ADR 0001, §8).
 */
function BorderPicker({
  value,
  width,
  onApply,
  onChange,
  onWidthChange,
  onWidthCommit,
  disabled,
  ariaLabel,
  className,
}: {
  value: string
  width: number
  onApply: (color: string) => void
  onChange: (color: string) => void
  onWidthChange: (width: number) => void
  onWidthCommit: (width: number) => void
  disabled?: boolean
  ariaLabel: string
  className?: string
}) {
  return (
    <ColorPicker
      value={value}
      onApply={onApply}
      onChange={onChange}
      disabled={disabled}
      ariaLabel={ariaLabel}
      className={className}
      swatch={
        width === 0 ? (
          <Slash aria-hidden className="size-4 text-destructive" />
        ) : undefined
      }
    >
      <label className="flex w-full items-center gap-2">
        <span className="text-[10px] leading-none text-muted-foreground">Border</span>
        <Slider
          className="flex-1"
          min={BORDER_RANGE.min}
          max={BORDER_RANGE.max}
          step={BORDER_RANGE.step}
          value={[width]}
          disabled={disabled}
          // Dragging previews live without recording; releasing the thumb
          // commits the whole drag as ONE undoable step (ADR 0001, §8).
          onValueChange={([value]) => onWidthChange(value)}
          onValueCommit={([value]) => onWidthCommit(value)}
          aria-label="Border width"
        />
        <span className="w-8 text-right text-[10px] leading-none text-muted-foreground tabular-nums">
          {width}px
        </span>
      </label>
    </ColorPicker>
  )
}

export { BorderPicker, ColorPicker }
