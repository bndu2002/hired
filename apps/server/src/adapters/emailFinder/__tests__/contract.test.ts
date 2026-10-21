/**
 * Contract tests for EmailFinder adapters.
 *
 * Factory pattern per adapter so each can arrange its own happy-path mocks
 * (Snov needs OAuth + find HTTP mocks; PatternHeuristicFinder needs a stub
 * verifier registry). Adding a new EmailFinder is a one-entry append to
 * `adapterFactories`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EmailFinder, EmailFindResult } from '../EmailFinder.js';
import type { EmailVerifier } from '../../emailVerifier/EmailVerifier.js';
import { ProviderRegistry } from '../../../services/providerRegistry.js';
import { PatternHeuristicFinder } from '../PatternHeuristicFinder.js';
import { SnovFinder } from '../SnovFinder.js';

interface AdapterFactory {
  name: string;
  create(): EmailFinder;
  /** Arrange a happy-path "found a valid email" scenario for this adapter. */
  arrangeFind(): void;
  /** Arrange a happy-path credit-remaining scenario. */
  arrangeCredits(): void;
}

function mockResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
  } as unknown as Response;
}

function stubVerifier(email: string): EmailVerifier {
  return {
    name: 'stub-verifier',
    kind: 'email_verifier',
    verify: async (candidate) => ({
      status: candidate === email ? 'valid' : 'invalid',
      rawSource: 'stub-verifier',
    }),
    estimateCreditsRemaining: async () => 100,
  };
}

const adapterFactories: ReadonlyArray<AdapterFactory> = [
  {
    name: 'snov',
    create: () => new SnovFinder('cid', 'sec'),
    arrangeFind: () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          mockResponse({ access_token: 'tok', expires_in: 3600 }),
        )
        .mockResolvedValueOnce(
          mockResponse({
            data: {
              emails: [{ email: 'priya.sharma@test.com', status: 'valid' }],
            },
          }),
        );
    },
    arrangeCredits: () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          mockResponse({ access_token: 'tok', expires_in: 3600 }),
        )
        .mockResolvedValueOnce(mockResponse({ data: { balance: '42' } }));
    },
  },
  {
    name: 'pattern_heuristic',
    create: () => {
      const registry = new ProviderRegistry<EmailVerifier>();
      // First pattern (first.last@...) will verify as valid.
      registry.register(stubVerifier('priya.sharma@test.com'));
      return new PatternHeuristicFinder(registry);
    },
    arrangeFind: () => {
      // Pattern finder uses the registry we injected — no HTTP to arrange.
    },
    arrangeCredits: () => {
      // Pattern finder returns null for credits by design.
    },
  },
];

for (const factory of adapterFactories) {
  describe(`EmailFinder contract — ${factory.name}`, () => {
    afterEach(() => vi.restoreAllMocks());

    it('declares kind="email_finder"', () => {
      const adapter = factory.create();
      expect(adapter.kind).toBe('email_finder');
    });

    it('declares the matching name', () => {
      const adapter = factory.create();
      expect(adapter.name).toBe(factory.name);
    });

    it('find() returns a well-formed EmailFindResult on happy path', async () => {
      factory.arrangeFind();
      const adapter = factory.create();

      const result: EmailFindResult | null = await adapter.find({
        firstName: 'Priya',
        lastName: 'Sharma',
        companyDomain: 'test.com',
      });

      expect(result).not.toBeNull();
      expect(typeof result!.email).toBe('string');
      expect(result!.email).toContain('@');
      expect(['high', 'medium', 'low']).toContain(result!.confidence);
      expect(result!.rawSource).toBe(factory.name);
    });

    it('estimateCreditsRemaining() returns a number or null', async () => {
      factory.arrangeCredits();
      const adapter = factory.create();

      const credits = await adapter.estimateCreditsRemaining();
      expect(credits === null || typeof credits === 'number').toBe(true);
    });
  });
}
