/**
 * Pure helper: heuristically derive a company's email domain from the
 * company name scraped from Happy Agent (we don't scrape the domain
 * directly in v1).
 *
 * Approach: strip common corporate suffixes ("Pvt Ltd", "Inc", "LLC", etc.),
 * strip non-alphanumeric characters, lowercase, append `.com`.
 *
 *   "Appscrip"                        → "appscrip.com"
 *   "Flexiple"                        → "flexiple.com"
 *   "Softobiz Technologies Pvt Ltd"   → "softobiztechnologies.com"
 *   "Heads Up For Tails"              → "headsupfortails.com"
 *   "Deloitte USI"                    → "deloitteusi.com"
 *
 * Known limitations:
 *   - Can't produce .io / .co / .in / regional TLDs. Covers maybe 80% of
 *     the Indian job market — most companies use .com.
 *   - Company short-names vs legal entity names (Deloitte Consulting vs
 *     Deloitte) will produce the wrong guess sometimes.
 *   - The verifier catches bad guesses (returns `invalid`), so we burn 1-2
 *     verifier credits per miss but don't send to a wrong address.
 *
 * v2 upgrade path: add a `company_domain` column, scrape or ask the user,
 * fall back to this heuristic.
 */

const CORPORATE_SUFFIXES = [
  'pvt ltd',
  'private limited',
  'pvt. ltd.',
  'pvt limited',
  'private ltd',
  'ltd',
  'limited',
  'inc',
  'inc.',
  'incorporated',
  'corp',
  'corporation',
  'llc',
  'l.l.c.',
  'co',
  'co.',
  'company',
  'gmbh',
  'ag',
  'sa',
  's.a.',
  'bv',
  'b.v.',
];

export function companyNameToDomain(companyName: string): string {
  let normalized = companyName.toLowerCase().trim();

  // Strip suffixes at the END of the name (longest-match first so
  // "pvt ltd" is matched before "ltd").
  const sorted = [...CORPORATE_SUFFIXES].sort((a, b) => b.length - a.length);
  for (const suffix of sorted) {
    const re = new RegExp(`[\\s,]+${suffix.replace(/\./g, '\\.')}$`, 'i');
    normalized = normalized.replace(re, '');
    normalized = normalized.trim();
  }

  // Keep only alphanumerics (strips &, -, spaces, periods, apostrophes).
  const slug = normalized.replace(/[^a-z0-9]/g, '');

  if (slug.length === 0) {
    throw new Error(`companyNameToDomain: cannot derive domain from "${companyName}"`);
  }

  return `${slug}.com`;
}
