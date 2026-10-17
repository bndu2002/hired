/**
 * Contract tests for DiscoverySource adapters.
 *
 * The point of this file: enforce the interface shape against every adapter
 * we register, so any new adapter is interchangeable at the registry level
 * (D4 — pluggable swap boundary).
 *
 * Add a new DiscoverySource implementation? It just has to pass these tests
 * to be considered a drop-in replacement — no changes needed here.
 *
 * How we isolate from live HTTP: each adapter is instantiated with the key
 * it needs, then we `vi.spyOn(global.fetch)` to a canned happy-path response
 * so the actual network isn't touched.
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import type { DiscoverySource, DiscoveryInput } from '../DiscoverySource.js';
import { SerpApiXRaySource } from '../SerpApiXRaySource.js';

/**
 * Register every adapter under test here. Adding a second DiscoverySource later?
 * Append a factory below. Tests fan out automatically.
 */
const adapterFactories: ReadonlyArray<() => DiscoverySource> = [
  () => new SerpApiXRaySource('test-key'),
];

/** Canned happy-path responses, keyed by adapter name. */
const HAPPY_RESPONSES: Record<string, unknown> = {
  serpapi_xray: {
    organic_results: [
      {
        position: 1,
        title: 'Jane Doe - Engineering Manager - TestCo | LinkedIn',
        link: 'https://www.linkedin.com/in/jane-doe-test',
        snippet: 'Jane Doe · Engineering Manager at TestCo · 3 years',
      },
    ],
  },
};

const BASIC_INPUT: DiscoveryInput = {
  companyName: 'TestCo',
  jobTitle: 'Senior Engineer',
  limit: 4,
};

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

  describe(`DiscoverySource contract — ${adapter.name}`, () => {
    afterEach(() => vi.restoreAllMocks());

    it('declares the right `kind`', () => {
      expect(adapter.kind).toBe('discovery');
    });

    it('declares a non-empty `name`', () => {
      expect(typeof adapter.name).toBe('string');
      expect(adapter.name.length).toBeGreaterThan(0);
    });

    it('discover() returns an array of CandidateContact objects', async () => {
      const canned = HAPPY_RESPONSES[adapter.name];
      if (!canned) {
        throw new Error(
          `No happy-path fixture for adapter '${adapter.name}'. Add one to HAPPY_RESPONSES.`,
        );
      }
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse(canned));

      const results = await adapter.discover(BASIC_INPUT);
      expect(Array.isArray(results)).toBe(true);

      for (const contact of results) {
        // Required fields
        expect(typeof contact.name).toBe('string');
        expect(contact.name.length).toBeGreaterThan(0);
        expect(typeof contact.title).toBe('string');
        expect(contact.rawSource).toBe(adapter.name);

        // Optional-but-typed fields
        if (contact.linkedinUrl !== undefined) {
          expect(typeof contact.linkedinUrl).toBe('string');
        }
        if (contact.tenureHint !== undefined) {
          expect(typeof contact.tenureHint).toBe('string');
        }
      }
    });

    it('discover() respects the `limit` input', async () => {
      // Build a response with 20 identical-shape results; adapter must cap at limit.
      const canned = HAPPY_RESPONSES[adapter.name] as Record<string, unknown>;
      const results = canned['organic_results'] as unknown[];
      const inflated = {
        ...canned,
        organic_results: Array.from({ length: 20 }, (_, i) => ({
          ...(results[0] as object),
          link: `https://www.linkedin.com/in/person-${i}`,
          title: `Person ${i} - Role - TestCo | LinkedIn`,
        })),
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse(inflated));

      const output = await adapter.discover({ ...BASIC_INPUT, limit: 3 });
      expect(output.length).toBeLessThanOrEqual(3);
    });

    it('estimateCreditsRemaining() returns a number or null', async () => {
      // Mock the account/credits endpoint with a plausible shape.
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockResponse({ total_searches_left: 100, plan_searches_left: 100 }),
      );
      const credits = await adapter.estimateCreditsRemaining();
      expect(credits === null || typeof credits === 'number').toBe(true);
    });
  });
}
