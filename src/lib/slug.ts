export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'office'
}

/**
 * Candidate slugs to try in order (`office`, `office-2`, `office-3`, ...).
 *
 * A pre-insert "does this slug exist" SELECT can't be trusted here: RLS on
 * `organizations` only allows reading orgs you're already a member of, and a
 * brand-new signup isn't a member of anything yet, so such a check would
 * silently see nothing regardless of real collisions. Instead the caller
 * should attempt an insert per candidate and move to the next one on a
 * unique-constraint violation (Postgres error code 23505).
 */
export function* slugCandidates(base: string, maxAttempts = 20): Generator<string> {
  const root = slugify(base)
  yield root
  for (let suffix = 2; suffix <= maxAttempts; suffix++) {
    yield `${root}-${suffix}`
  }
}
