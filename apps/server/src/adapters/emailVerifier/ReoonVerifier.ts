/**
 * ReoonVerifier — email verification via Reoon's single-verify endpoint.
 *
 * Chosen as the day-1 verifier because it accepts gmail signups (unlike many
 * verifiers that gate behind business emails) and offers 600 verifications/mo
 * free — comfortably covering our 320-contact/mo target even if every contact
 * requires 1-2 verifier calls through PatternHeuristicFinder.
 *
 * API shape (as of late 2026):
 *   GET https://emailverifier.reoon.com/api/v1/verify/?email=X&key=KEY&mode=quick
 *     → { status: 'safe'|'invalid'|'catch_all'|'disposable'|'role_account'|'unknown', ... }
 *
 * Status mapping to our VerifyStatus (D2 — gated on 'valid' only):
 *   safe         → valid
 *   invalid      → invalid
 *   catch_all    → accept_all   (verifier can't confirm — domain accepts anything)
 *   disposable   → unknown      (ephemeral mail provider; treat as risky, LinkedIn fallback)
 *   role_account → unknown      (info@/support@; low referral yield)
 *   unknown      → unknown
 */

import { z } from 'zod';
import type {
  EmailVerifier,
  VerifyResult,
  VerifyStatus,
} from './EmailVerifier.js';

const REOON_VERIFY_URL = 'https://emailverifier.reoon.com/api/v1/verify/';
const REOON_USAGE_URL = 'https://emailverifier.reoon.com/api/v1/user-usage/';

/** Reoon's verify response — only the fields we actually use are validated. */
const ReoonVerifyResponse = z
  .object({
    status: z.string(),
    overall_score: z.number().optional(),
    is_safe_to_send: z.boolean().optional(),
    is_disposable: z.boolean().optional(),
    is_role_account: z.boolean().optional(),
  })
  .passthrough();

const ReoonUsageResponse = z
  .object({
    available_credits: z.number().optional(),
    credits_left: z.number().optional(),
  })
  .passthrough();

/**
 * Map Reoon's status string to our normalized VerifyStatus.
 * Exported for direct unit tests.
 */
export function mapReoonStatus(reoonStatus: string): VerifyStatus {
  switch (reoonStatus.toLowerCase()) {
    // Reoon uses both 'safe' (older) and 'valid' (newer) across API versions
    // and modes. Accept both as our canonical 'valid'.
    case 'safe':
    case 'valid':
      return 'valid';
    case 'invalid':
      return 'invalid';
    case 'catch_all':
    case 'catch-all':
    case 'catchall':
      return 'accept_all';
    case 'disposable':
    case 'role_account':
    case 'role-account':
    case 'unknown':
    default:
      return 'unknown';
  }
}

export class ReoonVerifier implements EmailVerifier {
  readonly name = 'reoon';
  readonly kind = 'email_verifier' as const;

  constructor(private readonly apiKey: string) {
    if (!apiKey) throw new Error('ReoonVerifier: apiKey required');
  }

  async verify(email: string): Promise<VerifyResult> {
    const url = new URL(REOON_VERIFY_URL);
    url.searchParams.set('email', email);
    url.searchParams.set('key', this.apiKey);
    url.searchParams.set('mode', 'quick');

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Reoon verify failed: ${response.status}`);
    }

    const raw = await response.json();
    const parsed = ReoonVerifyResponse.parse(raw);
    const status = mapReoonStatus(parsed.status);

    const result: VerifyResult = {
      status,
      rawSource: this.name,
    };

    // Attach a human-readable reason when we have it (useful for debugging
    // "why can't we send to this address?" in the dashboard).
    if (status === 'invalid') {
      result.reason = parsed.status;
    } else if (parsed.is_disposable) {
      result.reason = 'disposable';
    } else if (parsed.is_role_account) {
      result.reason = 'role_account';
    }

    return result;
  }

  async estimateCreditsRemaining(): Promise<number | null> {
    try {
      const url = new URL(REOON_USAGE_URL);
      url.searchParams.set('key', this.apiKey);
      const response = await fetch(url.toString());
      if (!response.ok) return null;

      const parsed = ReoonUsageResponse.parse(await response.json());
      return parsed.available_credits ?? parsed.credits_left ?? null;
    } catch {
      return null;
    }
  }
}
