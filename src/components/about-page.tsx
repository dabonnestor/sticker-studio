import { SiteFooter, SiteNav } from "@/components/landing-page"

/**
 * The About page at `/about` (see src/lib/routing.ts) — who Sticker Studio
 * is and what it builds. It reuses the landing page's header and footer
 * (the CTA pointing back to /#contact) and the legal pages' prose layout,
 * but the copy is the landing page's offer, not legal boilerplate.
 * Vocabulary per CONTEXT.md (Export, Cut line, Predesign, Document).
 */

/** The About page — a short, headed account of the team and the product. */
export function AboutPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteNav ctaHref="/#contact" />
      <main className="mx-auto max-w-3xl px-6 py-14">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          About Sticker Studio
        </h1>
        <div className="mt-8 space-y-8">
          <section>
            <h2 className="text-lg font-semibold tracking-tight">Who we are</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              We're a small team that builds design tools for print shops.
              Sticker Studio started from a simple observation: ordering
              stickers shouldn't require design software. We make the design
              step something your customers can handle themselves — in the
              browser, on your website.
            </p>
          </section>
          <section>
            <h2 className="text-lg font-semibold tracking-tight">
              What we build
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Sticker Studio is a client-side design tool for sticker shops.
              Customers start from a Predesign or a blank canvas, arrange
              shapes, Text, and Artwork, and export print-ready files — PNG,
              JPEG, PDF, or SVG at Document size and 300 DPI, with a Cut line
              drawn automatically. Everything runs in the browser; nothing to
              install.
            </p>
          </section>
          <section>
            <h2 className="text-lg font-semibold tracking-tight">
              Try the demo
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              The editor at{" "}
              <a href="/editor" className="underline underline-offset-4">
                /editor
              </a>{" "}
              is a free demo of the product — the real thing, running in your
              browser. Your designs auto-save locally and export just as a
              print shop would receive them. Explore it, then get in touch
              when you're ready to put Sticker Studio in your shop.
            </p>
          </section>
          <section>
            <h2 className="text-lg font-semibold tracking-tight">
              Get in touch
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Want Sticker Studio in your shop's site? Tell us about your shop
              through the{" "}
              <a href="/#contact" className="underline underline-offset-4">
                contact form
              </a>{" "}
              on the landing page and we'll reply with how it would work and
              what it costs.
            </p>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}
