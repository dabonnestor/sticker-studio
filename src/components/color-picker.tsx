import { useEffect, useRef, useState } from "react"
import { HexColorPicker } from "react-colorful"
import { PipetteIcon } from "lucide-react"

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
import { cn } from "@/lib/utils"
import { hexToRgb, hslToRgb, rgbToHex, rgbToHsl } from "@/lib/color-converter"

/** A full 6-digit hex color — the only shape the session commits. */
const HEX_PATTERN = /^#[0-9A-Fa-f]{6}$/

type ColorFormat = "HEX" | "RGB" | "HSL"

interface ColorValues {
  hex: string
  rgb: { r: number; g: number; b: number }
  hsl: { h: number; s: number; l: number }
}

/**
 * A color swatch opening the shadcn-input-color popover (react-colorful
 * picker, HEX/RGB/HSL format select, hex input, eyedropper) — shared by the
 * text, shape and canvas property sections. Skimming the popover previews
 * live through onApply — applied without recording, so dragging never
 * pollutes the undo stack (§8). The session commits exactly one undoable
 * step when the popover closes, by any gesture (click outside, Escape,
 * selecting a format): the close always fires onOpenChange(false), which
 * commits the last valid color through onChange. An untouched close commits
 * the same value, which history.commit() dedups to a no-op; a partial or
 * invalid typed hex never commits, so it can't leak into the document.
 */
function ColorPicker({
  value,
  onApply,
  onChange,
  disabled,
  ariaLabel,
  className,
}: {
  value: string
  onApply: (color: string) => void
  onChange: (color: string) => void
  disabled?: boolean
  ariaLabel: string
  className?: string
}) {
  const [colorFormat, setColorFormat] = useState<ColorFormat>("HEX")
  const [colorValues, setColorValues] = useState<ColorValues>(() => {
    const rgb = hexToRgb(value)
    return { hex: value, rgb, hsl: rgbToHsl(rgb.r, rgb.g, rgb.b) }
  })
  const [hexInputValue, setHexInputValue] = useState(value)
  const [hexInputError, setHexInputError] = useState<string | null>(null)
  // The last valid full hex — what the session commits on popover close.
  const lastValidRef = useRef(value)
  const onApplyRef = useRef(onApply)
  onApplyRef.current = onApply
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

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
    updateColorValues(newColor)
    lastValidRef.current = newColor.toUpperCase()
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
  // gesture (ADR 0001 §8).
  const handlePopoverChange = (open: boolean) => {
    if (!open) {
      setColorFormat("HEX")
      onChangeRef.current(lastValidRef.current)
    }
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
  useEffect(() => {
    updateColorValues(value)
    setHexInputValue(value.toUpperCase())
    lastValidRef.current = value.toUpperCase()
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
          style={{ backgroundColor: hexInputValue }}
        />
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
        </div>
        {hexInputError && (
          <p className="text-destructive mt-1.5 text-sm">{hexInputError}</p>
        )}
      </PopoverContent>
    </Popover>
  )
}

export { ColorPicker }
