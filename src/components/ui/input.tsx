import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * shadcn/ui text input (stage toolbar fields). Number fields arrive as text
 * with `inputMode="decimal"` so values like "1.5" or "50.8" parse cleanly.
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-7 w-full min-w-0 rounded-md border border-input bg-transparent px-2 text-xs shadow-xs outline-none transition-[color,box-shadow]",
        "placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground",
        "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
        className,
      )}
      {...props}
    />
  )
}

export { Input }
