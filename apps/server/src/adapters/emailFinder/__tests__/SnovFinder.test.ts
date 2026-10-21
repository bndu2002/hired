/**
 * SnovFinder tests.
 *
 * Covers:
 *   - mapSnovStatus pure helper (direct)
 *   - Auth is called on first find, cached on subsequent
 *   - Status mapping drives EmailFindResult.confidence
 *   - Missing lastName short-circuits before any HTTP call
 *   - Empty email list / invalid-only list returns null
 *   - Auth failure throws
 *   - estimateCreditsRemaining normalises string balances
 *
 * Uses vi.spyOn(fetch); each call gets its own canned Response in order.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { SnovFinder, mapSnovStatus } from '../SnovFinder.js';

function mockResponse(body: unknown, { ok = true, status = 200 } = {}): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: async () => body,
  } as unknown as Response;
}

const authOk = () =>
  mockResponse({
    access_token: 'tok_abc',
    expires_in: 3600,
    token_type: 'Bearer',
  });

// ─── pure mapping ────────────────────────────────────────────────────────────

describe('mapSnovStatus', () => {
  it('valid → high', () => {
    expect(mapSnovStatus('valid')).toEqual({ usable: true, confidence: 'high' });
  });

  it('catch-all variants → medium', () => {
    expect(mapSnovStatus('catch-all')).toEqual({ usable: true, confidence: 'medium' });
    expect(mapSnovStatus('catch_all')).toEqual({ usable: true, confidence: 'medium' });
    expect(mapSnovStatus('catchall')).toEqual({ usable: true, confidence: 'medium' });
  });

  it('unknown / undefined → low', () => {
    expect(mapSnovStatus('unknown')).toEqual({ usable: true, confidence: 'low' });
    expect(mapSnovStatus(undefined)).toEqual({ usable: true, confidence: 'low' });
  });

  it('invalid → not usable', () => {
    expect(mapSnovStatus('invalid')).toEqual({ usable: false });
  });

  it('is case-insensitive', () => {
    expect(mapSnovStatus('VALID')).toEqual({ usable: true, confidence: 'high' });
  });
});

// ─── adapter ────────────────────────────────────────────────────────────────

describe('SnovFinder.find', () => {
  afterEach(() => vi.restoreAllMocks());

  it('authenticates then returns the first usable email with high confidence', async () => {
    const findBody = {
      data: {
        emails: [
          { email: 'priya.sharma@appscrip.com', status: 'valid' },
        ],
      },
    };
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(authOk())
      .mockResolvedValueOnce(mockResponse(findBody));

    const finder = new SnovFinder('cid', 'sec');
    const result = await finder.find({
      firstName: 'Priya',
      lastName: 'Sharma',
      companyDomain: 'appscrip.com',
    });

    expect(result).toEqual({
      email: 'priya.sharma@appscrip.com',
      confidence: 'high',
      rawSource: 'snov',
    });
  });

  it('maps catch-all status to medium confidence', async () => {
    const findBody = {
      data: { emails: [{ email: 'x@catchall.com', status: 'catch-all' }] },
    };
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(authOk())
      .mockResolvedValueOnce(mockResponse(findBody));

    const finder = new SnovFinder('cid', 'sec');
    const result = await finder.find({
      firstName: 'A',
      lastName: 'B',
      companyDomain: 'catchall.com',
    });

    expect(result?.confidence).toBe('medium');
  });

  it('returns null when every returned email is invalid', async () => {
    const findBody = {
      data: { emails: [{ email: 'nope@domain.com', status: 'invalid' }] },
    };
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(authOk())
      .mockResolvedValueOnce(mockResponse(findBody));

    const finder = new SnovFinder('cid', 'sec');
    const result = await finder.find({
      firstName: 'A',
      lastName: 'B',
      companyDomain: 'domain.com',
    });

    expect(result).toBeNull();
  });

  it('returns null when no emails are returned', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(authOk())
      .mockResolvedValueOnce(mockResponse({ data: { emails: [] } }));

    const finder = new SnovFinder('cid', 'sec');
    const result = await finder.find({
      firstName: 'A',
      lastName: 'B',
      companyDomain: 'd.com',
    });
    expect(result).toBeNull();
  });

  it('accepts legacy shape with top-level `emails`', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(authOk())
      .mockResolvedValueOnce(
        mockResponse({ emails: [{ email: 'legacy@x.com', status: 'valid' }] }),
      );

    const finder = new SnovFinder('cid', 'sec');
    const result = await finder.find({
      firstName: 'A',
      lastName: 'B',
      companyDomain: 'x.com',
    });
    expect(result?.email).toBe('legacy@x.com');
  });

  it('short-circuits without any HTTP calls when lastName is empty', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');

    const finder = new SnovFinder('cid', 'sec');
    const result = await finder.find({
      firstName: 'Rajesh',
      lastName: '',
      companyDomain: 'x.com',
    });

    expect(result).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('throws when auth fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockResponse({ error: 'invalid_client' }, { ok: false, status: 401 }),
    );

    const finder = new SnovFinder('bad-cid', 'bad-sec');
    await expect(
      finder.find({ firstName: 'A', lastName: 'B', companyDomain: 'd.com' }),
    ).rejects.toThrow(/auth failed: 401/);
  });

  it('throws when find endpoint errors with 5xx', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(authOk())
      .mockResolvedValueOnce(mockResponse({}, { ok: false, status: 429 }));

    const finder = new SnovFinder('cid', 'sec');
    await expect(
      finder.find({ firstName: 'A', lastName: 'B', companyDomain: 'd.com' }),
    ).rejects.toThrow(/find failed: 429/);
  });

  it('returns null when find endpoint returns 404 (no result found)', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(authOk())
      .mockResolvedValueOnce(
        mockResponse({ error: 'not_found' }, { ok: false, status: 404 }),
      );

    const finder = new SnovFinder('cid', 'sec');
    const result = await finder.find({
      firstName: 'A',
      lastName: 'B',
      companyDomain: 'd.com',
    });
    expect(result).toBeNull();
  });

  it('returns null when response body has success:false', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(authOk())
      .mockResolvedValueOnce(mockResponse({ success: false }));

    const finder = new SnovFinder('cid', 'sec');
    const result = await finder.find({
      firstName: 'A',
      lastName: 'B',
      companyDomain: 'd.com',
    });
    expect(result).toBeNull();
  });

  it('caches the access token across sequential finds', async () => {
    const findBody = {
      data: { emails: [{ email: 'x@d.com', status: 'valid' }] },
    };
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(authOk())        // auth call (first find)
      .mockResolvedValueOnce(mockResponse(findBody))  // first find
      .mockResolvedValueOnce(mockResponse(findBody)); // second find (no re-auth)

    const finder = new SnovFinder('cid', 'sec');
    await finder.find({ firstName: 'A', lastName: 'B', companyDomain: 'd.com' });
    await finder.find({ firstName: 'C', lastName: 'D', companyDomain: 'd.com' });

    expect(spy).toHaveBeenCalledTimes(3); // auth once, find twice
  });
});

describe('SnovFinder.estimateCreditsRemaining', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns numeric balance from `data.balance` string', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(authOk())
      .mockResolvedValueOnce(mockResponse({ data: { balance: '25.50' } }));

    const finder = new SnovFinder('cid', 'sec');
    expect(await finder.estimateCreditsRemaining()).toBe(25.5);
  });

  it('returns numeric balance from top-level `balance`', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(authOk())
      .mockResolvedValueOnce(mockResponse({ balance: 42 }));

    const finder = new SnovFinder('cid', 'sec');
    expect(await finder.estimateCreditsRemaining()).toBe(42);
  });

  it('returns null on balance endpoint failure', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(authOk())
      .mockResolvedValueOnce(mockResponse({}, { ok: false, status: 500 }));

    const finder = new SnovFinder('cid', 'sec');
    expect(await finder.estimateCreditsRemaining()).toBeNull();
  });
});

describe('SnovFinder constructor', () => {
  it('throws when clientId or clientSecret is empty', () => {
    expect(() => new SnovFinder('', 'sec')).toThrow(/required/);
    expect(() => new SnovFinder('cid', '')).toThrow(/required/);
  });
});
