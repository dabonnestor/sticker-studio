import { useEffect, useState, type FormEvent } from "react"
import { Sticker } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { PREDESIGNS, renderPredesignPreview } from "@/fabric/designs"

/**
 * The landing page — the lead page for B2B print shops, rendered at `/`
 * (the editor lives at `/editor`, see src/lib/routing.ts). The editor is a
 * free demo of a licensed product; the offer is embedding it in a print
 * shop's site ("we build a design tool for your sticker shop"). Copy and
 * layout settled in the lead-gen grilling session: the hero leads with the
 * offer, every CTA points at the contact form (#contact), and the product
 * sections (features, demo video, predesign gallery) stay as proof of
 * capability. Vocabulary per CONTEXT.md (Export, Cut line, Predesign,
 * Document); branding reuses the app's look (Geist, neutral palette, shadcn
 * components). No screenshots: the hero is text-first and the gallery
 * renders the shipped Predesigns offscreen, exactly as the Designs panel
 * does.
 */

/** Formspree endpoint — create a form at formspree.io and paste its ID here. */
const FORM_ENDPOINT = "https://formspree.io/f/YOUR_FORM_ID"

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
    title: "Tell us about your shop",
    body: "You tell us what you sell and how orders flow today.",
  },
  {
    title: "We embed the design tool in your site",
    body: "Your customers design print-ready files in the browser, on your website.",
  },
  {
    title: "Your customers design, you print",
    body: "Orders keep flowing through your existing workflow.",
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

/**
 * The site header — logo left, lead CTA right. Shared with the legal
 * pages, which point the CTA back at the landing page's contact section
 * via `/#contact`.
 */
export function SiteNav({ ctaHref = "#contact" }: { ctaHref?: string }) {
  return (
    <header className="flex h-14 items-center gap-2 border-b bg-background px-6">
      <div className="flex items-center gap-2">
        <Sticker className="size-5 text-primary" aria-hidden />
        <span className="text-sm font-semibold tracking-tight">Sticker Studio</span>
      </div>
      <div className="flex-1" />
      <Button asChild size="sm">
        <a href={ctaHref}>Get it in your shop</a>
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

/**
 * The lead form — posts to Formspree (see FORM_ENDPOINT) and swaps to a
 * success state on submit. Four fields: name, email, shop, and the ask.
 */
function ContactForm() {
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">(
    "idle",
  )

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    setStatus("submitting")
    try {
      const response = await fetch(FORM_ENDPOINT, {
        method: "POST",
        body: new FormData(form),
        headers: { Accept: "application/json" },
      })
      if (!response.ok) throw new Error(`Form submission failed: ${response.status}`)
      form.reset()
      setStatus("success")
    } catch {
      setStatus("error")
    }
  }

  if (status === "success") {
    return (
      <p className="mx-auto mt-8 max-w-md rounded-lg border bg-card p-6 text-sm text-muted-foreground">
        Thanks — we'll be in touch.
      </p>
    )
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mx-auto mt-8 max-w-xl rounded-lg border bg-card p-6 text-left"
    >
      <input type="hidden" name="_subject" value="Sticker Studio — integration inquiry" />
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-medium">
          Name
          <Input name="name" required autoComplete="name" className="h-10 text-sm" />
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          Email
          <Input
            type="email"
            name="email"
            required
            autoComplete="email"
            className="h-10 text-sm"
          />
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          Shop
          <Input
            name="shop"
            required
            autoComplete="organization"
            className="h-10 text-sm"
          />
        </label>
        <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">
          What do you need?
          <Textarea name="message" required rows={4} className="text-sm" />
        </label>
      </div>
      <div className="mt-6 flex items-center gap-4">
        <Button type="submit" size="lg" disabled={status === "submitting"}>
          {status === "submitting" ? "Sending…" : "Get in touch"}
        </Button>
        {status === "error" && (
          <p className="text-sm text-destructive">
            Something went wrong — please try again.
          </p>
        )}
      </div>
    </form>
  )
}

/** The site footer — copyright, legal links, and the lead CTA. */
export function SiteFooter() {
  return (
    <footer className="border-t bg-background">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-6 text-sm text-muted-foreground sm:flex-row">
        <span>© {new Date().getFullYear()} Sticker Studio</span>
        <nav className="flex items-center gap-4">
          <a href="/privacy" className="underline-offset-4 hover:underline">
            Privacy
          </a>
          <a href="/terms" className="underline-offset-4 hover:underline">
            Terms
          </a>
          <a href="#contact" className="underline-offset-4 hover:underline">
            Get in touch
          </a>
        </nav>
      </div>
    </footer>
  )
}

/** The landing page — lead-gen for print shops (settled in the grilling session). */
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
            We build a design tool for your sticker shop. Your customers
            design print-ready files in the browser — you print them.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Button asChild size="lg">
              <a href="#contact">Get it in your shop</a>
            </Button>
            <Button asChild variant="outline" size="lg">
              <a href="/editor">Try the demo</a>
            </Button>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-6 py-14">
          <h2 className="text-center text-2xl font-semibold tracking-tight">
            What your customers get
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
            What your customers will use — from blank canvas to print-ready
            Export.
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

        <section id="contact" className="mx-auto max-w-3xl px-6 py-16 text-center">
          <h2 className="text-3xl font-semibold tracking-tight">
            Get it in your shop
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            Tell us about your shop and what you'd like to build — we'll reply
            with how it would work and what it costs.
          </p>
          <ContactForm />
        </section>
      </main>
      <SiteFooter />
    </div>
  )
}
