/**
 * SnovFinder — email discovery via Snov.io's name+domain endpoint.
 *
 * Day-1 email finder because Snov accepts gmail signups (Hunter rejects
 * non-business emails). 50 credits/mo free; the fallback chain to
 * PatternHeuristicFinder covers us when the quota depletes.
 *
 * Auth: OAuth2 client credentials.
 *   POST /v1/oauth/access_token  →  { access_token, expires_in }
 * We cache the token in memory with a 60s pre-expiry buffer so a single
 * server process does ~1 auth call per hour, not one per find.
 *
 * Find: POST /v2/get-emails-from-names (currently stable in 2026).
 *   Body: { firstName, lastName, domain, access_token }
 *   Returns: { data: { emails: [{ email, status }] } }
 *
 * Status mapping to our EmailFindResult confidence:
 *   valid       → high
 *   catch-all   → medium   (verifier can't confirm; our orchestrator will
 *                            still verify and may drop it)
 *   unknown     → low
 *   invalid     → return null (no usable address)
 *
 * See `.kiro/specs/hired/tasks.md § 3.4a`.
 */

import { z } from 'zod';
import type {
  EmailFindInput,
  EmailFindResult,
  EmailFinder,
} from './EmailFinder.js';
import { logger } from '../../logger.js';

const SNOV_AUTH_URL = 'https://api.snov.io/v1/oauth/access_token';
// Stable v1 endpoint. The v2 path (/v2/get-emails-from-names) returns 404 as
// of our testing on Oct 2026 — Snov quietly renamed endpoints over time.
const SNOV_FIND_URL = 'https://api.snov.io/v1/get-emails-from-names';
const SNOV_BALANCE_URL = 'https://api.snov.io/v1/get-balance';

/** Buffer before token expiry to avoid using it as it dies mid-request. */
const TOKEN_EXPIRY_BUFFER_MS = 60_000;

// ─── response schemas ────────────────────────────────────────────────────────

const AuthResponse = z
  .object({
    access_token: z.string(),
    expires_in: z.number().int().positive(),
    token_type: z.string().optional(),
  })
  .passthrough();

/** Snov's find response — permissive on shape, strict on what we read. */
const FindResponse = z
  .object({
    success: z.boolean().optional(),
    data: z
      .object({
        emails: z
          .array(
            z
              .object({
                email: z.string(),
                status: z.string().optional(),
                smtp_status: z.string().optional(),
              })
              .passthrough(),
          )
          .optional(),
      })
      .passthrough()
      .optional(),
    emails: z
      .array(
        z
          .object({
            email: z.string(),
            status: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

const BalanceResponse = z
  .object({
    success: z.boolean().optional(),
    data: z
      .object({
        balance: z.union([z.number(), z.string()]).optional(),
      })
      .passthrough()
      .optional(),
    balance: z.union([z.number(), z.string()]).optional(),
  })
  .passthrough();

// ─── helpers ─────────────────────────────────────────────────────────────────

export function mapSnovStatus(snovStatus: string | undefined):
  | { usable: true; confidence: 'high' | 'medium' | 'low' }
  | { usable: false } {
  switch (snovStatus?.toLowerCase()) {
    case 'valid':
      return { usable: true, confidence: 'high' };
    case 'catch-all':
    case 'catch_all':
    case 'catchall':
      return { usable: true, confidence: 'medium' };
    case 'unknown':
    case undefined:
    case '':
      return { usable: true, confidence: 'low' };
    case 'invalid':
    default:
      return { usable: false };
  }
}

// ─── adapter ─────────────────────────────────────────────────────────────────

interface CachedToken {
  token: string;
  /** epoch ms when the token expires (buffer already applied). */
  expiresAtMs: number;
}

export class SnovFinder implements EmailFinder {
  readonly name = 'snov';
  readonly kind = 'email_finder' as const;

  private cachedToken: CachedToken | null = null;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {
    if (!clientId || !clientSecret) {
      throw new Error('SnovFinder: clientId and clientSecret required');
    }
  }

  async find(input: EmailFindInput): Promise<EmailFindResult | null> {
    if (!input.firstName || !input.lastName) {
      // Snov requires both. Single-name people fall through to the next
      // adapter (PatternHeuristicFinder generates `first@`).
      return null;
    }

    const token = await this.getAccessToken();

    const response = await fetch(SNOV_FIND_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        firstName: input.firstName,
        lastName: input.lastName,
        domain: input.companyDomain,
      }),
    });

    // 404 is Snov's way of saying "no result for this name+domain" — not an
    // error for us; return null so the registry falls to the next finder.
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`Snov find failed: ${response.status}`);
    }

    const parsed = FindResponse.parse(await response.json());

    // Snov sometimes returns success:false even with 200 OK when nothing was
    // found. Treat that the same as 404 — no email.
    if (parsed.success === false) return null;

    // Snov has moved emails between top-level and data.emails across versions.
    // Try both.
    const emails = parsed.data?.emails ?? parsed.emails ?? [];
    if (emails.length === 0) return null;

    // Pick the best-status email returned (Snov sometimes returns a few).
    for (const candidate of emails) {
      const mapped = mapSnovStatus(candidate.status);
      if (mapped.usable) {
        return {
          email: candidate.email,
          confidence: mapped.confidence,
          rawSource: this.name,
        };
      }
    }

    return null;
  }

  async estimateCreditsRemaining(): Promise<number | null> {
    try {
      const token = await this.getAccessToken();
      const response = await fetch(SNOV_BALANCE_URL, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return null;

      const parsed = BalanceResponse.parse(await response.json());
      const raw = parsed.data?.balance ?? parsed.balance;
      if (raw === undefined) return null;

      const asNumber = typeof raw === 'string' ? Number(raw) : raw;
      return Number.isFinite(asNumber) ? asNumber : null;
    } catch {
      return null;
    }
  }

  // ─── auth with in-memory cache ─────────────────────────────────────────────

  /**
   * Fetches a fresh access token, or returns the cached one if it's still
   * valid (with a 60s buffer before actual expiry).
   */
  private async getAccessToken(): Promise<string> {
    const nowMs = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAtMs > nowMs) {
      return this.cachedToken.token;
    }

    const response = await fetch(SNOV_AUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });

    if (!response.ok) {
      throw new Error(`Snov auth failed: ${response.status}`);
    }

    const parsed = AuthResponse.parse(await response.json());
    this.cachedToken = {
      token: parsed.access_token,
      expiresAtMs: nowMs + parsed.expires_in * 1000 - TOKEN_EXPIRY_BUFFER_MS,
    };
    logger.debug({ expiresIn: parsed.expires_in }, 'snov: token refreshed');
    return parsed.access_token;
  }
}
