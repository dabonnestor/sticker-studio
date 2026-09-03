/**
 * The shared content shield (ticket #39 addendum; research #35 §3) — the
 * heuristic every Catalog provider applies to its hits. The sources return
 * **no** per-item metadata (no `AttributionRequired` analogue), so the app
 * cannot guarantee an item is cleared for standalone-merchandise sale the way
 * the Wikimedia license bar did. The shield here is a keyword denylist
 * (franchise, character, brand, and logo terms) applied verbatim to each
 * hit's text fields. Anything that trips the denylist is never returned —
 * silently, so it can't be shown. The user still holds the responsibility to
 * verify an image carries no third-party rights before selling; this shield
 * only filters the obvious.
 */

/**
 * A franchise / character / brand / logo keyword whose art must never surface
 * — the heuristic stand-in for the license bar. The sources' licenses bar
 * printing trademarked content on merchandise, and offer no per-item metadata
 * to test for it, so the app blocks the obvious categories. The list is
 * deliberately focused (character/brand nouns — not generic words like "star"
 * or "apple") to avoid starving the catalog for ordinary searches.
 *
 * Reviewer-maintainable: add recognizable franchise/character/brand names here
 * as they surface. This is a heuristic, not a guarantee — the user holds the
 * responsibility to confirm rights before selling.
 */
export const BLOCKED_TERMS = [
  "disney",
  "pokemon",
  "pikachu",
  "marvel",
  "avengers",
  "dc comics",
  "batman",
  "superman",
  "spider-man",
  "star wars",
  "lego",
  "nintendo",
  "mario",
  "sonic",
  "hello kitty",
  "mickey",
  "minions",
  "emoji",
  "mascot",
  "logo",
  "brand",
  "trademark",
  "copyright",
]

/**
 * A blocked term matches any of the hit's text fields — it must not surface.
 * Each provider feeds the fields its source exposes (Pixabay: tags and the
 * page URL; Unsplash: alt text, description, tags, and the photo page URL).
 */
export function isBlockedByShield(...fields: string[]): boolean {
  const haystack = fields.filter(Boolean).join(" ").toLowerCase()
  return BLOCKED_TERMS.some((term) => haystack.includes(term))
}
