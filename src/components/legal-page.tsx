import { SiteFooter, SiteNav } from "@/components/landing-page"

/**
 * The legal pages — Privacy Policy at `/privacy` and Terms of Service at
 * `/terms` (see src/lib/routing.ts). One shared layout renders a title, a
 * "last updated" date, and a list of headed sections. Copy is written to
 * match what the site actually does: the contact form posts to Formspree,
 * the editor demo auto-saves designs to the browser's local storage, and
 * the artwork search calls Pixabay and Unsplash. No analytics or tracking
 * scripts are shipped. The header and footer are the landing page's, with
 * the CTA pointing back to `/#contact`.
 */

const CONTACT_EMAIL = "dabonnestor@gmail.com"

type Section = { heading: string; body: string }

/** The shared legal layout — header, prose, footer. */
function LegalPage({
  title,
  updated,
  sections,
}: {
  title: string
  updated: string
  sections: Section[]
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteNav ctaHref="/#contact" />
      <main className="mx-auto max-w-3xl px-6 py-14">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          {title}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Last updated: {updated}
        </p>
        <div className="mt-8 space-y-8">
          {sections.map((s) => (
            <section key={s.heading}>
              <h2 className="text-lg font-semibold tracking-tight">{s.heading}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {s.body}
              </p>
            </section>
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}

/** The privacy policy — what the site collects and where it goes. */
export function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="September 10, 2026"
      sections={[
        {
          heading: "What we collect",
          body: `We only collect what you choose to send us through the contact
            form on the landing page: your name, email address, shop name,
            and the message you write. We don't run analytics, tracking
            scripts, or advertising on this site.`,
        },
        {
          heading: "How we use it",
          body: `We use the contact form details to reply to your inquiry about
            Sticker Studio. We don't sell, rent, or share your information
            with anyone outside of processing your message.`,
        },
        {
          heading: "Where it's processed",
          body: `Contact form submissions are processed by Formspree, a third-party
            form service. Their handling of your data is governed by their
            own privacy policy.`,
        },
        {
          heading: "The editor demo",
          body: `The design editor demo at /editor runs entirely in your browser.
            Your designs are auto-saved to your browser's local storage and
            never uploaded to our servers. Clearing your browser data
            removes them.`,
        },
        {
          heading: "Third-party artwork",
          body: `The editor's artwork search pulls images from Pixabay and
            Unsplash. Searching sends your query to those services, and any
            image you use is subject to their respective licenses.`,
        },
        {
          heading: "Contact",
          body: `Questions about this policy? Email ${CONTACT_EMAIL}.`,
        },
      ]}
    />
  )
}

/** The terms of service — what using the site and the demo means. */
export function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      updated="September 10, 2026"
      sections={[
        {
          heading: "The demo",
          body: `The design editor at /editor is a free demo of a licensed
            product. It's provided "as is" for evaluation — we may change or
            remove it at any time without notice.`,
        },
        {
          heading: "Your designs",
          body: `Everything you create in the editor is yours. We don't claim
            any ownership of your designs, and they stay in your browser
            unless you export them.`,
        },
        {
          heading: "Third-party artwork",
          body: `Images you add from the artwork search come from Pixabay and
            Unsplash and remain subject to their licenses. You're
            responsible for using them in line with those terms.`,
        },
        {
          heading: "No warranty",
          body: `The site and the demo are provided without warranty of any
            kind, express or implied. We don't guarantee that the demo will
            be uninterrupted or error-free.`,
        },
        {
          heading: "Limitation of liability",
          body: `To the fullest extent permitted by law, we won't be liable
            for any damages arising from your use of the site or the demo.`,
        },
        {
          heading: "Contact",
          body: `Questions about these terms? Email ${CONTACT_EMAIL}.`,
        },
      ]}
    />
  )
}
