import { useEffect, useState } from "react"
import { Sticker } from "lucide-react"

import { Button } from "@/components/ui/button"
import { PREDESIGNS, renderPredesignPreview } from "@/fabric/designs"

/**
 * The landing page — the product page for B2B print shops, rendered at `/`
 * (the editor lives at `/editor`, see src/lib/routing.ts). Copy and layout
 * settled in the copy & layout draft (issue #45): Variant A "Classic SaaS" —
 * centered text hero, 4-card feature grid, demo video section, real-thumbnail
 * predesign gallery, 3-step how-it-works, CTA band. Vocabulary per CONTEXT.md
 * (Export, Cut line, Predesign, Document); branding reuses the app's look
 * (Geist, neutral palette, shadcn components). No screenshots: the hero is
 * text-first and the gallery renders the shipped Predesigns offscreen,
 * exactly as the Designs panel does.
 */

const FEATURES = [
  {
    title: "Print-ready from the start",
    body: "Every design exports at 300 DPI with a Cut line drawn automatically — no bleed, no dieline, no guesswork.",
  },
  {
    title: "Export in every format",
    body: "PNG, JPEG, PDF, or SVG at Document size — whatever your workflow takes.",
  },
  {
    title: "Predesigns to start from",
    body: "A gallery of ready-made designs your customers can make their own.",
  },
  {
    title: "No design skills needed",
    body: "Shapes, text, and artwork on a canvas — everything in the browser, nothing to install.",
  },
]

const STEPS = [
  {
    title: "Pick a Predesign or start blank",
    body: "Customers open the editor and choose where to start.",
  },
  {
    title: "Design in the browser",
    body: "Shapes, text, and artwork from the catalog. The Cut line is drawn for you.",
  },
  {
    title: "Export print-ready files",
    body: "300 DPI PNG, JPEG, PDF, or SVG, sized to the Document.",
  },
]

/** The three shipped Predesigns' thumbnails, rendered once (see DesignsPanel). */
function usePredesignThumbnails() {
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  useEffect(() => {
    let cancelled = false
    void Promise.all(
      PREDESIGNS.map(async (predesign) => {
        const dataURL = await renderPredesignPreview(predesign)
        if (!cancelled && dataURL) {
          setThumbs((prev) => ({ ...prev, [predesign.id]: dataURL }))
        }
      }),
    )
    return () => {
      cancelled = true
    }
  }, [])
  return thumbs
}

/** The site header — logo left, CTA right. */
function SiteNav() {
  return (
    <header className="flex h-14 items-center gap-2 border-b bg-background px-6">
      <div className="flex items-center gap-2">
        <Sticker className="size-5 text-primary" aria-hidden />
        <span className="text-sm font-semibold tracking-tight">Sticker Studio</span>
      </div>
      <div className="flex-1" />
      <Button asChild size="sm">
        <a href="/editor">Open the editor</a>
      </Button>
    </header>
  )
}

/** A predesign gallery tile — real rendered thumbnail over the design's name. */
function GalleryTile({
  predesign,
  thumb,
}: {
  predesign: (typeof PREDESIGNS)[number]
  thumb?: string
}) {
  return (
    <figure className="flex flex-col gap-2">
      <div className="aspect-square overflow-hidden rounded-lg border bg-muted/50">
        {thumb ? (
          <img
            src={thumb}
            alt={predesign.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="h-full w-full animate-pulse bg-muted" />
        )}
      </div>
      <figcaption className="text-center text-sm font-medium">
        {predesign.name}
      </figcaption>
    </figure>
  )
}

function SiteFooter() {
  return (
    <footer className="border-t bg-background">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6 text-sm text-muted-foreground">
        <span>© {new Date().getFullYear()} Sticker Studio</span>
        <a href="mailto:hello@stickerstudio.app" className="underline-offset-4 hover:underline">
          Get in touch
        </a>
      </div>
    </footer>
  )
}

/** The landing page — Variant A "Classic SaaS" (settled in issue #45). */
export function LandingPage() {
  const thumbs = usePredesignThumbnails()

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteNav />
      <main>
        <section className="mx-auto max-w-3xl px-6 pt-20 pb-16 text-center">
          <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
            For print shops
          </p>
          <h1 className="font-heading mt-4 text-5xl font-semibold tracking-tight">
            Let your customers design their own stickers.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg text-muted-foreground">
            Sticker Studio is a design tool you put in front of your customers.
            They design print-ready files in the browser — you print them.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Button asChild size="lg">
              <a href="/editor">Open the editor</a>
            </Button>
            <Button asChild variant="outline" size="lg">
              <a href="#designs">See the designs</a>
            </Button>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-6 py-14">
          <h2 className="text-center text-2xl font-semibold tracking-tight">
            Print-ready, from the first click
          </h2>
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-lg border bg-card p-4">
                <h3 className="text-sm font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-6 py-14">
          <h2 className="text-center text-2xl font-semibold tracking-tight">
            See it in action
          </h2>
          <p className="mx-auto mt-2 max-w-md text-center text-muted-foreground">
            A quick walkthrough of the editor — from blank canvas to
            print-ready Export.
          </p>
          <div className="mt-8 overflow-hidden rounded-lg border bg-card shadow-sm">
            <video
              src="/sticker-studio-demo.mp4"
              controls
              playsInline
              preload="metadata"
              className="aspect-video w-full"
            >
              <p className="p-4 text-sm text-muted-foreground">
                Your browser can't play this video.{" "}
                <a
                  href="/sticker-studio-demo.mp4"
                  className="underline underline-offset-4"
                >
                  Download the demo video
                </a>{" "}
                instead.
              </p>
            </video>
          </div>
        </section>

        <section id="designs" className="mx-auto max-w-5xl px-6 py-14">
          <h2 className="text-center text-2xl font-semibold tracking-tight">
            Start from a Predesign
          </h2>
          <p className="mx-auto mt-2 max-w-md text-center text-muted-foreground">
            Three ready-made designs, shipped with the app. Customers pick one
            and make it their own.
          </p>
          <div className="mt-8 grid grid-cols-3 gap-6">
            {PREDESIGNS.map((p) => (
              <GalleryTile key={p.id} predesign={p} thumb={thumbs[p.id]} />
            ))}
          </div>
        </section>

        <section className="border-t bg-muted/40">
          <div className="mx-auto max-w-5xl px-6 py-14">
            <h2 className="text-center text-2xl font-semibold tracking-tight">
              How it works
            </h2>
            <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
              {STEPS.map((s, i) => (
                <div key={s.title} className="rounded-lg border bg-card p-4">
                  <span className="text-xs font-semibold text-muted-foreground">
                    Step {i + 1}
                  </span>
                  <h3 className="mt-1 text-sm font-semibold">{s.title}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-6 py-16 text-center">
          <h2 className="text-3xl font-semibold tracking-tight">
            Ready to put a design tool in front of your customers?
          </h2>
          <div className="mt-6">
            <Button asChild size="lg">
              <a href="/editor">Open the editor</a>
            </Button>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  )
}
