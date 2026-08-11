/** Stable random object id (ADR 0002) — generated at creation, never reused. */
export function newId(): string {
  return crypto.randomUUID()
}
