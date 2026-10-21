/**
 * PatternHeuristicFinder — fallback email finder with no external signup.
 *
 * Why it exists: Snov's free tier (50/mo) depletes well before our 320/mo
 * target. This adapter uses the already-registered EmailVerifier(s) to brute
 * through common address patterns (first.last@, first@, flast@, ...) and
 * returns the first one that comes back `valid`.
 *
 * Trade-off vs Snov: no crawled-data advantage. If the person's email is
 * `arjun.m@appscrip.com` (unusual pattern) and the domain is strict, we miss.
 * In practice, enough companies use the common patterns that this catches a
 * majority of real emails for the Indian job market.
 *
 * Credit cost: 1-5 verifier calls per find, short-circuited:
 *   - Returns on first `valid` → cost depends on which pattern matched (1-5)
 *   - Returns null on `accept_all` → cost 1 (don't try more patterns on
 *     catch-all domains; whole domain accepts anything so we can't verify)
 *   - Returns null on all-invalid → cost 5 (full sweep failed)
 *
 * See `.kiro/specs/hired/tasks.md § 3.4b`.
 */

import type {
  EmailFindInput,
  EmailFindResult,
  EmailFinder,
} from './EmailFinder.js';
import type { EmailVerifier } from '../emailVerifier/EmailVerifier.js';
import type { ProviderRegistry } from '../../services/providerRegistry.js';
import { logger } from '../../logger.js';

/**
 * Generate candidate email addresses in order of commonality for Indian
 * and global tech companies.
 *
 * Exported for direct unit tests (purely combinatorial, zero I/O).
 */
export function generateEmailPatterns(input: EmailFindInput): string[] {
  const { firstName, lastName, companyDomain } = input;

  const f = firstName.toLowerCase().replace(/\s+/g, '');
  if (!f) return [];

  // Single-name people: only try `first@`.
  if (!lastName) {
    return [`${f}@${companyDomain}`];
  }

  const l = lastName.toLowerCase().replace(/\s+/g, '');
  const firstInitial = f.charAt(0);

  return [
    `${f}.${l}@${companyDomain}`,     // first.last — most common at tech cos
    `${f}@${companyDomain}`,          // first — common at startups
    `${firstInitial}${l}@${companyDomain}`, // flast — common at consultancies
    `${f}${l}@${companyDomain}`,      // firstlast — occasional
    `${f}_${l}@${companyDomain}`,     // first_last — rare but seen
  ];
}

export class PatternHeuristicFinder implements EmailFinder {
  readonly name = 'pattern_heuristic';
  readonly kind = 'email_finder' as const;

  constructor(private readonly verifierRegistry: ProviderRegistry<EmailVerifier>) {}

  async find(input: EmailFindInput): Promise<EmailFindResult | null> {
    const patterns = generateEmailPatterns(input);
    if (patterns.length === 0) return null;

    for (const email of patterns) {
      const resolved = await this.verifierRegistry.resolve((v) => v.verify(email));
      if (!resolved) {
        // No verifier available at all — nothing we can do. Return null so
        // the orchestrator falls through to LinkedIn.
        logger.warn({ email }, 'pattern finder: no verifier registered');
        return null;
      }

      const status = resolved.result.status;

      if (status === 'valid') {
        return {
          email,
          confidence: 'medium',
          rawSource: this.name,
        };
      }

      if (status === 'accept_all') {
        // Catch-all domain: no pattern will produce a distinguishable result,
        // so we abort rather than burn more credits.
        logger.debug(
          { email, domain: input.companyDomain },
          'pattern finder: catch-all domain, giving up',
        );
        return null;
      }
      // status is 'invalid' or 'unknown' — try the next pattern.
    }

    return null;
  }

  /**
   * Returns null because we don't own credits — they live in the verifier
   * registry. The dashboard shows verifier credits directly.
   */
  async estimateCreditsRemaining(): Promise<number | null> {
    return null;
  }
}
