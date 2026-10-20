/**
 * Pure helper: split a display name into { firstName, lastName }.
 *
 * Used by the orchestrator before calling `EmailFinder.find({ firstName,
 * lastName, domain })`. Keeping it in `core/` (pure, no I/O) so it's trivially
 * unit-testable.
 *
 * Rules (chosen for the mixed Indian/global names we see from SerpAPI X-ray):
 *   - Strip common honorifics (Dr, Mr, Mrs, Ms, Prof) if they're the first token.
 *   - firstName = first remaining token.
 *   - lastName = last remaining token (if there's more than one).
 *   - Single-token names → firstName set, lastName null. Email finders generally
 *     can't operate without a last name, so the orchestrator will fall back
 *     to LinkedIn-only outreach for those contacts.
 *
 * Edge cases we accept imperfect handling on (v1 scope):
 *   - "van der Berg Peter" → firstName "van", lastName "Peter" (wrong, but
 *     rare in Indian job market).
 *   - Hyphenated last names like "Smith-Jones" survive intact.
 */

const HONORIFICS = new Set([
  'dr', 'dr.', 'mr', 'mr.', 'mrs', 'mrs.', 'ms', 'ms.',
  'prof', 'prof.', 'professor', 'sir', 'rev', 'rev.',
]);

export interface SplitName {
  firstName: string | null;
  lastName: string | null;
}

export function splitName(fullName: string): SplitName {
  const tokens = fullName
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  if (tokens.length === 0) return { firstName: null, lastName: null };

  // Drop a leading honorific if present.
  const first = tokens[0]!.toLowerCase().replace(/[.,]$/, '');
  const start = HONORIFICS.has(first) || HONORIFICS.has(first + '.') ? 1 : 0;

  const remaining = tokens.slice(start);
  if (remaining.length === 0) return { firstName: null, lastName: null };

  const firstName = remaining[0]!;
  const lastName = remaining.length > 1 ? remaining[remaining.length - 1]! : null;

  return { firstName, lastName };
}
