/**
 * ReoonVerifier tests.
 *
 * Two layers:
 *   - Pure status-mapping helper (direct)
 *   - Full adapter via vi.spyOn(fetch) with canned Reoon responses
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReoonVerifier, mapReoonStatus } from '../ReoonVerifier.js';

function mockResponse(body: unknown, { ok = true, status = 200 } = {}): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: async () => body,
  } as unknown as Response;
}

// ─── pure mapping ────────────────────────────────────────────────────────────

describe('mapReoonStatus', () => {
  it('maps safe → valid (older API responses)', () => {
    expect(mapReoonStatus('safe')).toBe('valid');
  });

  it('maps valid → valid (newer API responses)', () => {
    expect(mapReoonStatus('valid')).toBe('valid');
  });

  it('maps invalid → invalid', () => {
    expect(mapReoonStatus('invalid')).toBe('invalid');
  });

  it('maps catch_all variants → accept_all', () => {
    expect(mapReoonStatus('catch_all')).toBe('accept_all');
    expect(mapReoonStatus('catch-all')).toBe('accept_all');
    expect(mapReoonStatus('catchall')).toBe('accept_all');
  });

  it('maps disposable / role_account / unknown → unknown', () => {
    expect(mapReoonStatus('disposable')).toBe('unknown');
    expect(mapReoonStatus('role_account')).toBe('unknown');
    expect(mapReoonStatus('unknown')).toBe('unknown');
  });

  it('maps any unrecognized string → unknown (default-safe)', () => {
    expect(mapReoonStatus('something_new_reoon_added')).toBe('unknown');
  });

  it('is case-insensitive', () => {
    expect(mapReoonStatus('SAFE')).toBe('valid');
    expect(mapReoonStatus('CATCH_ALL')).toBe('accept_all');
  });
});

// ─── adapter ────────────────────────────────────────────────────────────────

describe('ReoonVerifier.verify', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns valid for a safe email', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockResponse({ status: 'safe', overall_score: 100, is_safe_to_send: true }),
    );

    const verifier = new ReoonVerifier('fake-key');
    const result = await verifier.verify('arjun@appscrip.com');

    expect(result.status).toBe('valid');
    expect(result.rawSource).toBe('reoon');
  });

  it('returns invalid with reason for invalid email', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockResponse({ status: 'invalid', overall_score: 0 }),
    );

    const verifier = new ReoonVerifier('fake-key');
    const result = await verifier.verify('nope@nowhere.xyz');

    expect(result.status).toBe('invalid');
    expect(result.reason).toBe('invalid');
  });

  it('returns accept_all for catch-all domain', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockResponse({ status: 'catch_all' }),
    );

    const verifier = new ReoonVerifier('fake-key');
    const result = await verifier.verify('anyone@catchalldomain.com');

    expect(result.status).toBe('accept_all');
  });

  it('flags disposable addresses with a reason', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockResponse({ status: 'disposable', is_disposable: true }),
    );

    const verifier = new ReoonVerifier('fake-key');
    const result = await verifier.verify('temp@mailinator.com');

    expect(result.status).toBe('unknown');
    expect(result.reason).toBe('disposable');
  });

  it('flags role accounts with a reason', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockResponse({ status: 'role_account', is_role_account: true }),
    );

    const verifier = new ReoonVerifier('fake-key');
    const result = await verifier.verify('info@appscrip.com');

    expect(result.status).toBe('unknown');
    expect(result.reason).toBe('role_account');
  });

  it('passes email, key and mode in the query string', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockResponse({ status: 'safe' }),
    );

    const verifier = new ReoonVerifier('my-key');
    await verifier.verify('x@y.com');

    const calledUrl = String(spy.mock.calls[0]?.[0]);
    expect(calledUrl).toContain('email=x%40y.com');
    expect(calledUrl).toContain('key=my-key');
    expect(calledUrl).toContain('mode=quick');
  });

  it('throws on non-OK status from Reoon', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockResponse({}, { ok: false, status: 500 }),
    );

    const verifier = new ReoonVerifier('fake-key');
    await expect(verifier.verify('x@y.com')).rejects.toThrow(/500/);
  });
});

describe('ReoonVerifier.estimateCreditsRemaining', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns available_credits when the usage endpoint reports it', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockResponse({ available_credits: 480 }),
    );

    const verifier = new ReoonVerifier('fake-key');
    expect(await verifier.estimateCreditsRemaining()).toBe(480);
  });

  it('falls back to credits_left if available_credits is absent', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockResponse({ credits_left: 300 }),
    );

    const verifier = new ReoonVerifier('fake-key');
    expect(await verifier.estimateCreditsRemaining()).toBe(300);
  });

  it('returns null on usage endpoint failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockResponse({}, { ok: false, status: 500 }),
    );

    const verifier = new ReoonVerifier('fake-key');
    expect(await verifier.estimateCreditsRemaining()).toBeNull();
  });
});

describe('ReoonVerifier constructor', () => {
  it('throws when apiKey is empty', () => {
    expect(() => new ReoonVerifier('')).toThrow(/apiKey/);
  });
});
