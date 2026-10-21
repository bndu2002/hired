/**
 * Contract tests for EmailVerifier adapters.
 *
 * Enforces the interface shape against every adapter we register, so any new
 * verifier is a drop-in replacement at the registry level (D4). Adding a new
 * EmailVerifier? Append a factory to `adapterFactories` and the suite fans out.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  EmailVerifier,
  VerifyStatus,
} from '../EmailVerifier.js';
import { ReoonVerifier } from '../ReoonVerifier.js';

const adapterFactories: ReadonlyArray<() => EmailVerifier> = [
  () => new ReoonVerifier('test-key'),
];

/** Canned "safe" responses per adapter so each one returns a valid result. */
const HAPPY_RESPONSES: Record<string, unknown> = {
  reoon: { status: 'safe', overall_score: 100, is_safe_to_send: true },
};

const VALID_VERIFY_STATUSES: readonly VerifyStatus[] = [
  'valid',
  'invalid',
  'accept_all',
  'unknown',
];

function mockResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
  } as unknown as Response;
}

for (const factory of adapterFactories) {
  const adapter = factory();

  describe(`EmailVerifier contract — ${adapter.name}`, () => {
    afterEach(() => vi.restoreAllMocks());

    it('declares the right `kind`', () => {
      expect(adapter.kind).toBe('email_verifier');
    });

    it('declares a non-empty `name`', () => {
      expect(typeof adapter.name).toBe('string');
      expect(adapter.name.length).toBeGreaterThan(0);
    });

    it('verify() returns a VerifyResult with a legal status', async () => {
      const canned = HAPPY_RESPONSES[adapter.name];
      if (!canned) {
        throw new Error(
          `No happy-path fixture for '${adapter.name}'. Add it to HAPPY_RESPONSES.`,
        );
      }
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse(canned));

      const result = await adapter.verify('arjun@appscrip.com');
      expect(VALID_VERIFY_STATUSES).toContain(result.status);
      expect(result.rawSource).toBe(adapter.name);
    });

    it('estimateCreditsRemaining() returns a number or null', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockResponse({ available_credits: 500, credits_left: 500 }),
      );
      const credits = await adapter.estimateCreditsRemaining();
      expect(credits === null || typeof credits === 'number').toBe(true);
    });
  });
}
