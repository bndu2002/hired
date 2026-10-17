/**
 * Tests for SerpApiXRaySource. Two layers:
 *
 *   1. Pure parsing helpers — no HTTP, no mocks. Direct function assertions.
 *   2. End-to-end adapter — vi.spyOn mocks `global.fetch`. Verifies fetch
 *      wiring, Zod validation, dedup, and limit respect.
 *
 * Why not nock: Node 22's native `fetch` uses undici, which nock 13 doesn't
 * reliably intercept. Vitest's built-in spy works perfectly for this.
 *
 * The fixture mimics a real SerpAPI response for a Happy Agent job.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SerpApiXRaySource,
  buildXRayQuery,
  canonicalizeLinkedInUrl,
  extractNameFromTitle,
  extractRoleFromSnippet,
  extractRoleFromTitle,
  extractTenureHint,
} from '../SerpApiXRaySource.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const fixturePath = resolve(here, '../../../../test/fixtures/serpapi_response.json');
const serpapiFixture = JSON.parse(readFileSync(fixturePath, 'utf-8'));

/** Build a minimal Response-like object for fetch mocks. */
function mockResponse(body: unknown, { ok = true, status = 200 } = {}): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

// ─── pure parsing helpers ────────────────────────────────────────────────────

describe('extractNameFromTitle', () => {
  it('splits on " - "', () => {
    expect(extractNameFromTitle('Arjun Mehta - Staff SWE - Appscrip | LinkedIn'))
      .toBe('Arjun Mehta');
  });

  it('splits on " | " when no dash', () => {
    expect(extractNameFromTitle('Priya Sharma | LinkedIn')).toBe('Priya Sharma');
  });

  it('preserves honorifics', () => {
    expect(extractNameFromTitle('Dr. Trupti Patil | LinkedIn')).toBe('Dr. Trupti Patil');
  });

  it('returns the whole string if neither separator is found', () => {
    expect(extractNameFromTitle('No separator here')).toBe('No separator here');
  });

  it('picks the earliest separator', () => {
    expect(extractNameFromTitle('Vandana | Full Stack - Dev')).toBe('Vandana');
  });
});

describe('extractRoleFromTitle', () => {
  it('pulls middle segment of "Name - Role - Company"', () => {
    expect(extractRoleFromTitle('Arjun - Staff SWE - Appscrip | LinkedIn'))
      .toBe('Staff SWE');
  });

  it('strips trailing " | LinkedIn"', () => {
    expect(extractRoleFromTitle('X - Engineering Lead | LinkedIn'))
      .toBe('Engineering Lead');
  });

  it('strips " at Company" suffix', () => {
    expect(extractRoleFromTitle('X - Senior Recruiter at Appscrip | LinkedIn'))
      .toBe('Senior Recruiter');
  });

  it('returns empty when title has no second segment', () => {
    expect(extractRoleFromTitle('Just A Name | LinkedIn')).toBe('');
  });
});

describe('extractRoleFromSnippet', () => {
  it('finds "Role at Company" after middot', () => {
    expect(extractRoleFromSnippet('Arjun · Staff Software Engineer at Appscrip · 2 years'))
      .toBe('Staff Software Engineer');
  });

  it('finds "Role at Company" after period', () => {
    expect(extractRoleFromSnippet('Priya Sharma. Engineering Lead at Appscrip. 1 year.'))
      .toBe('Engineering Lead');
  });

  it('returns empty when nothing matches', () => {
    expect(extractRoleFromSnippet('Random snippet without the pattern')).toBe('');
  });
});

describe('extractTenureHint', () => {
  it('matches "2 years"', () => {
    expect(extractTenureHint('Staff SWE at Appscrip · 2 years · Bengaluru')).toBe('2 years');
  });

  it('matches "10+ years"', () => {
    expect(extractTenureHint('AI Automation Consultant · 10+ years · Working with ...'))
      .toBe('10+ years');
  });

  it('matches "8 months"', () => {
    expect(extractTenureHint('Senior Recruiter · 8 months · Hyderabad')).toBe('8 months');
  });

  it('returns undefined when nothing matches', () => {
    expect(extractTenureHint('No tenure here at all')).toBeUndefined();
  });
});

describe('canonicalizeLinkedInUrl', () => {
  it('strips query params', () => {
    expect(canonicalizeLinkedInUrl('https://in.linkedin.com/in/arjun?trk=public'))
      .toBe('https://in.linkedin.com/in/arjun');
  });

  it('strips trailing slash', () => {
    expect(canonicalizeLinkedInUrl('https://www.linkedin.com/in/priya/'))
      .toBe('https://www.linkedin.com/in/priya');
  });

  it('strips hash fragment', () => {
    expect(canonicalizeLinkedInUrl('https://www.linkedin.com/in/x#section'))
      .toBe('https://www.linkedin.com/in/x');
  });

  it('returns input unchanged on malformed URL', () => {
    expect(canonicalizeLinkedInUrl('not a url')).toBe('not a url');
  });
});

describe('buildXRayQuery', () => {
  it('wraps company and roles correctly', () => {
    const q = buildXRayQuery('Appscrip', ['recruiter', 'engineering manager']);
    expect(q).toBe(
      'site:linkedin.com/in "Appscrip" ("recruiter" OR "engineering manager")',
    );
  });
});

// ─── end-to-end adapter via fetch spy ────────────────────────────────────────

describe('SerpApiXRaySource.discover', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns parsed, deduped, limit-capped contacts for a real-shape response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse(serpapiFixture));

    const source = new SerpApiXRaySource('fake-key');
    const results = await source.discover({
      companyName: 'Appscrip',
      jobTitle: 'Full-Stack Engineer',
      limit: 4,
    });

    // Fixture has 6 organic_results — one is a company page (not /in/),
    // one is a dedup of position 1. Expect 3-4 unique /in/ profiles.
    expect(results.length).toBeGreaterThanOrEqual(3);
    expect(results.length).toBeLessThanOrEqual(4);

    const names = results.map((r) => r.name);
    expect(names).toContain('Arjun Mehta');
    expect(names).toContain('Priya Sharma');
    expect(names).toContain('Rahul Kumar');

    // Company /company/ URL should have been filtered out
    expect(names).not.toContain('Appscrip Careers');

    // Dedup: Arjun appears exactly once even though fixture lists him twice
    expect(names.filter((n) => n === 'Arjun Mehta')).toHaveLength(1);

    const arjun = results.find((r) => r.name === 'Arjun Mehta');
    expect(arjun?.title).toBe('Staff Software Engineer');
    expect(arjun?.linkedinUrl).toBe('https://in.linkedin.com/in/arjun-mehta-dev');
    expect(arjun?.tenureHint).toBe('2 years');
    expect(arjun?.rawSource).toBe('serpapi_xray');
  });

  it('passes company name through to the query string', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockResponse({ organic_results: [] }),
    );

    const source = new SerpApiXRaySource('fake-key');
    await source.discover({ companyName: 'Appscrip', jobTitle: 'x', limit: 4 });

    const calledUrl = String(spy.mock.calls[0]?.[0]);
    expect(calledUrl).toContain('serpapi.com/search.json');
    expect(decodeURIComponent(calledUrl)).toContain('"Appscrip"');
    expect(decodeURIComponent(calledUrl)).toContain('site:linkedin.com/in');
  });

  it('throws when SerpAPI returns a non-OK status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockResponse({ error: 'Rate limit exceeded' }, { ok: false, status: 429 }),
    );

    const source = new SerpApiXRaySource('fake-key');
    await expect(source.discover({
      companyName: 'Anywhere',
      jobTitle: 'any',
      limit: 4,
    })).rejects.toThrow(/429/);
  });

  it('throws when SerpAPI payload carries an error field', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockResponse({ error: 'Invalid API key', organic_results: [] }),
    );

    const source = new SerpApiXRaySource('bad-key');
    await expect(source.discover({
      companyName: 'X',
      jobTitle: 'y',
      limit: 4,
    })).rejects.toThrow(/Invalid API key/);
  });

  it('returns [] when organic_results is missing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockResponse({ search_metadata: { status: 'Success' } }),
    );

    const source = new SerpApiXRaySource('fake-key');
    const results = await source.discover({
      companyName: 'X',
      jobTitle: 'y',
      limit: 4,
    });
    expect(results).toEqual([]);
  });
});

describe('SerpApiXRaySource.estimateCreditsRemaining', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns total_searches_left when SerpAPI exposes it', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockResponse({ total_searches_left: 237, this_month_usage: 13 }),
    );

    const source = new SerpApiXRaySource('fake-key');
    expect(await source.estimateCreditsRemaining()).toBe(237);
  });

  it('returns null when the account endpoint fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockResponse({}, { ok: false, status: 500 }),
    );

    const source = new SerpApiXRaySource('fake-key');
    expect(await source.estimateCreditsRemaining()).toBeNull();
  });
});

describe('SerpApiXRaySource constructor', () => {
  it('throws if apiKey is empty', () => {
    expect(() => new SerpApiXRaySource('')).toThrow(/apiKey/);
  });
});
