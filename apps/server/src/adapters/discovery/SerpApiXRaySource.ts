/**
 * SerpApiXRaySource — Google X-ray search for LinkedIn profiles via SerpAPI.
 *
 * Why SerpAPI (over Brave Search API, which was the original plan):
 *   Brave started requiring a credit card at signup in early 2026, even for
 *   its free tier. SerpAPI's free tier (250/mo) has no card requirement and
 *   returns actual Google results, which is what we want for `site:` queries.
 *
 * How X-ray works:
 *   Query: `site:linkedin.com/in "{companyName}" ({role1} OR {role2} OR ...)`
 *   Returns ~10 LinkedIn profile links where Google found both the company
 *   name and one of the target roles. We parse name + role + URL out of each
 *   `organic_results` entry's title and snippet.
 *
 * Known limitations:
 *   - False positives: ex-employees whose profile still mentions the company.
 *     Mitigated downstream by tenure parsing in the modal (contacts marked
 *     "ex-" default to unchecked).
 *   - Non-English profiles: parsing degrades (name/title split assumes
 *     English separator conventions).
 *   - Catch-all / "Confidential" job listings: company name may be a code,
 *     query returns nothing. We accept this and let the orchestrator handle
 *     the empty result.
 *
 * See `.kiro/specs/hired/tasks.md § 3.3` and `.kiro/specs/hired/design.md § 7`.
 */

import { z } from 'zod';
import type {
  CandidateContact,
  DiscoveryInput,
  DiscoverySource,
} from './DiscoverySource.js';

// ─── config ──────────────────────────────────────────────────────────────────

const SERPAPI_SEARCH_URL = 'https://serpapi.com/search.json';
const SERPAPI_ACCOUNT_URL = 'https://serpapi.com/account';

/** Roles we X-ray for, ordered by referral usefulness. */
const DEFAULT_ROLES = [
  'recruiter',
  'talent acquisition',
  'engineering manager',
  'tech lead',
  'staff engineer',
  'senior engineer',
];

/** ISO 3166-1 alpha-2 country codes we know how to restrict to. */
export type RestrictCountry = 'IN';

export interface SerpApiXRayOptions {
  /**
   * Restrict discovery to one country's employees only. Match Happy Agent's
   * "Indian employees only" behavior for the Indian job market: a company
   * HQ'd elsewhere but hiring in India should still only yield India-based
   * contacts, because they're the ones with authority over Indian hires.
   *
   * When set, three layers of filtering apply:
   *   1. Query gets " 'India' " as a required term
   *   2. SerpAPI `gl=in` biases ranking toward Indian results
   *   3. Response is post-filtered against known India signals (see
   *      isIndianLocationSignal below)
   */
  readonly restrictToCountry?: RestrictCountry | undefined;
}

// ─── India-signal detection (pure, exported for direct tests) ────────────────

const INDIA_WORD = /\bindia\b/i;

const INDIAN_CITY_PATTERNS: readonly RegExp[] = [
  /\bbengaluru\b/i,
  /\bbangalore\b/i,
  /\bhyderabad\b/i,
  /\bmumbai\b/i,
  /\bdelhi\b/i,
  /\bncr\b/i,
  /\bnoida\b/i,
  /\bgurgaon\b/i,
  /\bgurugram\b/i,
  /\bpune\b/i,
  /\bchennai\b/i,
  /\bkolkata\b/i,
  /\bahmedabad\b/i,
  /\bjaipur\b/i,
  /\bchandigarh\b/i,
  /\bkochi\b/i,
  /\bcochin\b/i,
  /\btrivandrum\b/i,
  /\bthiruvananthapuram\b/i,
  /\bmysore\b/i,
  /\bmysuru\b/i,
  /\bindore\b/i,
];

/**
 * Decide whether a SerpAPI organic result is India-based.
 *
 * Signals (any one is enough):
 *   - URL subdomain is `in.linkedin.com` (strongest; LinkedIn's regional domain)
 *   - Snippet contains the word "India" (whole-word match, no "Indianapolis")
 *   - Snippet mentions a known Indian city
 */
export function isIndianLocationSignal(
  snippet: string,
  linkedinUrl: string,
): boolean {
  if (linkedinUrl.includes('in.linkedin.com')) return true;
  if (INDIA_WORD.test(snippet)) return true;
  return INDIAN_CITY_PATTERNS.some((pattern) => pattern.test(snippet));
}

// ─── response schema (Zod) ───────────────────────────────────────────────────

/**
 * SerpAPI's response has many fields. We validate only what we need.
 * Zod's `.passthrough()` on the top-level object lets us ignore the rest.
 */
const OrganicResult = z.object({
  position: z.number().optional(),
  title: z.string().optional(),
  link: z.string(),
  snippet: z.string().optional(),
});

const SerpApiResponse = z
  .object({
    organic_results: z.array(OrganicResult).optional(),
    error: z.string().optional(),
  })
  .passthrough();

const SerpApiAccount = z
  .object({
    total_searches_left: z.number().optional(),
    plan_searches_left: z.number().optional(),
    this_month_usage: z.number().optional(),
  })
  .passthrough();

// ─── parsing helpers (pure, trivially unit-testable) ─────────────────────────

/**
 * LinkedIn X-ray titles typically look like:
 *   "Arjun Mehta - Staff Software Engineer - Appscrip | LinkedIn"
 *   "Priya Sharma | LinkedIn"
 *   "Dr. Trupti Patil - AI Automation Consultant | LinkedIn"
 *
 * Name is everything before the first " - " or " | ", whichever comes first.
 */
export function extractNameFromTitle(title: string): string {
  const dashIdx = title.indexOf(' - ');
  const pipeIdx = title.indexOf(' | ');
  const cutIdxs = [dashIdx, pipeIdx].filter((i) => i >= 0);
  const cut = cutIdxs.length === 0 ? title.length : Math.min(...cutIdxs);
  return title.slice(0, cut).trim();
}

/**
 * Role extraction. Try the title first (common pattern: "Name - Role - Company"),
 * then fall back to parsing the snippet for ". Role at Company." patterns.
 * Returns empty string if we can't find anything confident.
 */
export function extractRoleFromTitle(title: string): string {
  const parts = title.split(' - ');
  // "Name - Role - Company" → parts[1] = Role
  // "Name - Role at Company | LinkedIn" → parts[1] = Role at Company | LinkedIn
  if (parts.length >= 2 && parts[1]) {
    const second = parts[1];
    // Strip trailing " | LinkedIn" or " | ...site..."
    const pipeIdx = second.indexOf(' | ');
    const cleaned = pipeIdx >= 0 ? second.slice(0, pipeIdx) : second;
    // Strip trailing " at Company" if present
    const atIdx = cleaned.indexOf(' at ');
    return (atIdx >= 0 ? cleaned.slice(0, atIdx) : cleaned).trim();
  }
  return '';
}

export function extractRoleFromSnippet(snippet: string): string {
  // Pattern: "Name · Role at Company" or "Name · Role" or "Role at Company"
  // Also: ". Role at Company. ..."
  const atMatch = snippet.match(/[·.-]\s*([^·.]+?)\s+at\s+/i);
  if (atMatch?.[1]) {
    return atMatch[1].trim();
  }
  return '';
}

/**
 * Parse something like "2 years" or "6 months" from a snippet.
 * Returns the matched phrase or undefined.
 */
export function extractTenureHint(snippet: string): string | undefined {
  const match = snippet.match(
    /\b(\d+\+?\s*(?:years?|yrs?|months?|mos?))\b/i,
  );
  return match ? match[1] : undefined;
}

/** Canonicalize a LinkedIn URL — strip query params + trailing slashes. */
export function canonicalizeLinkedInUrl(url: string): string {
  try {
    const u = new URL(url);
    u.search = '';
    u.hash = '';
    let pathname = u.pathname;
    if (pathname.endsWith('/')) pathname = pathname.slice(0, -1);
    return `${u.protocol}//${u.host}${pathname}`;
  } catch {
    return url;
  }
}

export function buildXRayQuery(
  companyName: string,
  roles: readonly string[] = DEFAULT_ROLES,
  restrictToCountry?: RestrictCountry | undefined,
): string {
  const rolesClause = roles.map((r) => `"${r}"`).join(' OR ');
  // When restricted to India, we require "India" to appear somewhere on the
  // indexed LinkedIn page. Google indexes profile headlines, locations,
  // and about sections — so this catches location-tagged profiles directly.
  const countryClause = restrictToCountry === 'IN' ? ' "India"' : '';
  return `site:linkedin.com/in "${companyName}"${countryClause} (${rolesClause})`;
}

// ─── the adapter ─────────────────────────────────────────────────────────────

export class SerpApiXRaySource implements DiscoverySource {
  readonly name = 'serpapi_xray';
  readonly kind = 'discovery' as const;

  constructor(
    private readonly apiKey: string,
    private readonly options: SerpApiXRayOptions = {},
  ) {
    if (!apiKey) throw new Error('SerpApiXRaySource: apiKey required');
  }

  async discover(input: DiscoveryInput): Promise<CandidateContact[]> {
    const restrict = this.options.restrictToCountry;
    const q = buildXRayQuery(input.companyName, undefined, restrict);
    const url = new URL(SERPAPI_SEARCH_URL);
    url.searchParams.set('engine', 'google');
    url.searchParams.set('q', q);
    // Overfetch to leave room for both dedup and country filtering.
    url.searchParams.set('num', String(Math.min(input.limit * 3, 30)));
    url.searchParams.set('hl', 'en');
    if (restrict === 'IN') {
      url.searchParams.set('gl', 'in');
    }
    url.searchParams.set('api_key', this.apiKey);

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`SerpAPI request failed: ${response.status}`);
    }

    const raw = await response.json();
    const parsed = SerpApiResponse.parse(raw);
    if (parsed.error) {
      throw new Error(`SerpAPI returned error: ${parsed.error}`);
    }

    const results = parsed.organic_results ?? [];
    const candidates = results
      .filter((r) => r.link.includes('linkedin.com/in/'))
      .filter((r) => {
        // Country post-filter: only applies when restrictToCountry is set.
        if (restrict !== 'IN') return true;
        return isIndianLocationSignal(r.snippet ?? '', r.link);
      })
      .map((r) => this.parseResult(r))
      .filter((c): c is CandidateContact => c !== null);

    // Deduplicate by canonicalized LinkedIn URL.
    const seen = new Set<string>();
    const unique: CandidateContact[] = [];
    for (const c of candidates) {
      const key = c.linkedinUrl ?? c.name;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(c);
      if (unique.length >= input.limit) break;
    }

    return unique;
  }

  async estimateCreditsRemaining(): Promise<number | null> {
    try {
      const res = await fetch(
        `${SERPAPI_ACCOUNT_URL}?api_key=${this.apiKey}`,
      );
      if (!res.ok) return null;
      const data = SerpApiAccount.parse(await res.json());
      return data.total_searches_left ?? data.plan_searches_left ?? null;
    } catch {
      return null;
    }
  }

  // Pure helper; separated so it can be unit-tested without network.
  private parseResult(r: z.infer<typeof OrganicResult>): CandidateContact | null {
    const title = r.title ?? '';
    const snippet = r.snippet ?? '';
    if (!title) return null;

    const name = extractNameFromTitle(title);
    if (!name) return null;

    const roleFromTitle = extractRoleFromTitle(title);
    const roleFromSnippet = roleFromTitle === '' ? extractRoleFromSnippet(snippet) : '';
    const role = roleFromTitle || roleFromSnippet;

    const tenure = extractTenureHint(snippet);
    const canonUrl = canonicalizeLinkedInUrl(r.link);

    const contact: CandidateContact = {
      name,
      title: role,
      rawSource: this.name,
    };
    if (canonUrl) contact.linkedinUrl = canonUrl;
    if (tenure) contact.tenureHint = tenure;
    return contact;
  }
}
