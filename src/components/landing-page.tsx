import { Button } from "@/components/ui/button"

/**
 * The landing page — a stub until the build ticket (Build the landing page)
 * replaces it with the real page. Renders at `/`; links into the editor.
 */
export function LandingPage() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-6 bg-background text-foreground">
      <h1 className="font-heading text-4xl font-semibold tracking-tight">
        Sticker Studio
      </h1>
      <p className="max-w-md text-center text-muted-foreground">
        Design print-ready stickers in the browser — shapes, text, and artwork
        on a canvas, exported at 300 DPI.
      </p>
      <Button asChild size="lg">
        <a href="/editor">Open the editor</a>
      </Button>
    </div>
  )
}
