/**
 * PatternHeuristicFinder tests.
 *
 * Two layers:
 *   - Pure pattern generation (direct, no I/O)
 *   - Full adapter with a stub verifier registry — exercises short-circuit
 *     behavior across all three status outcomes (valid / accept_all /
 *     invalid+unknown).
 */

import { describe, expect, it, vi } from 'vitest';
import type { VerifyResult } from '../../emailVerifier/EmailVerifier.js';
import {
  PatternHeuristicFinder,
  generateEmailPatterns,
} from '../PatternHeuristicFinder.js';
import { ProviderRegistry } from '../../../services/providerRegistry.js';
import type { EmailVerifier } from '../../emailVerifier/EmailVerifier.js';

/** Build a stub verifier whose verify() behavior is controlled per-email. */
function stubVerifierWith(
  behavior: (email: string) => VerifyResult,
): EmailVerifier {
  return {
    name: 'stub',
    kind: 'email_verifier',
    verify: async (email) => behavior(email),
    estimateCreditsRemaining: async () => null,
  };
}

function registryWith(verifier: EmailVerifier): ProviderRegistry<EmailVerifier> {
  const reg = new ProviderRegistry<EmailVerifier>();
  reg.register(verifier);
  return reg;
}

// ─── pure generation ─────────────────────────────────────────────────────────

describe('generateEmailPatterns', () => {
  it('returns the standard 5 patterns for a two-token name', () => {
    const patterns = generateEmailPatterns({
      firstName: 'Priya',
      lastName: 'Sharma',
      companyDomain: 'appscrip.com',
    });
    expect(patterns).toEqual([
      'priya.sharma@appscrip.com',
      'priya@appscrip.com',
      'psharma@appscrip.com',
      'priyasharma@appscrip.com',
      'priya_sharma@appscrip.com',
    ]);
  });

  it('lowercases both names', () => {
    const patterns = generateEmailPatterns({
      firstName: 'PRIYA',
      lastName: 'Sharma',
      companyDomain: 'appscrip.com',
    });
    expect(patterns[0]).toBe('priya.sharma@appscrip.com');
  });

  it('strips internal whitespace from names', () => {
    const patterns = generateEmailPatterns({
      firstName: 'Priya ',
      lastName: ' Sharma Rao ',  // trailing spaces + inner space get stripped
      companyDomain: 'appscrip.com',
    });
    expect(patterns[0]).toBe('priya.sharmarao@appscrip.com');
  });

  it('returns only `first@domain` for single-name people (no lastName)', () => {
    const patterns = generateEmailPatterns({
      firstName: 'Rajesh',
      lastName: '',
      companyDomain: 'appscrip.com',
    });
    expect(patterns).toEqual(['rajesh@appscrip.com']);
  });

  it('returns empty when firstName is empty', () => {
    expect(generateEmailPatterns({
      firstName: '',
      lastName: 'Sharma',
      companyDomain: 'appscrip.com',
    })).toEqual([]);
  });
});

// ─── adapter: short-circuit behavior ─────────────────────────────────────────

describe('PatternHeuristicFinder.find', () => {
  it('returns the first pattern that verifies as valid', async () => {
    const verifier = stubVerifierWith((email) => ({
      status: email === 'priya.sharma@appscrip.com' ? 'valid' : 'invalid',
      rawSource: 'stub',
    }));
    const finder = new PatternHeuristicFinder(registryWith(verifier));

    const result = await finder.find({
      firstName: 'Priya',
      lastName: 'Sharma',
      companyDomain: 'appscrip.com',
    });

    expect(result).toEqual({
      email: 'priya.sharma@appscrip.com',
      confidence: 'medium',
      rawSource: 'pattern_heuristic',
    });
  });

  it('short-circuits on the second pattern when the first is invalid', async () => {
    const spy = vi.fn((email: string) => ({
      status: email === 'priya@appscrip.com' ? ('valid' as const) : ('invalid' as const),
      rawSource: 'stub',
    }));
    const finder = new PatternHeuristicFinder(
      registryWith(stubVerifierWith(spy)),
    );

    const result = await finder.find({
      firstName: 'Priya',
      lastName: 'Sharma',
      companyDomain: 'appscrip.com',
    });

    expect(result?.email).toBe('priya@appscrip.com');
    expect(spy).toHaveBeenCalledTimes(2); // only tried first.last and first
  });

  it('aborts immediately on accept_all (catch-all domain)', async () => {
    const spy = vi.fn(() => ({ status: 'accept_all' as const, rawSource: 'stub' }));
    const finder = new PatternHeuristicFinder(
      registryWith(stubVerifierWith(spy)),
    );

    const result = await finder.find({
      firstName: 'Priya',
      lastName: 'Sharma',
      companyDomain: 'catchalldomain.com',
    });

    expect(result).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1); // did not try more patterns
  });

  it('tries all 5 patterns and returns null when none verify', async () => {
    const spy = vi.fn(() => ({ status: 'invalid' as const, rawSource: 'stub' }));
    const finder = new PatternHeuristicFinder(
      registryWith(stubVerifierWith(spy)),
    );

    const result = await finder.find({
      firstName: 'Priya',
      lastName: 'Sharma',
      companyDomain: 'appscrip.com',
    });

    expect(result).toBeNull();
    expect(spy).toHaveBeenCalledTimes(5);
  });

  it('treats unknown status the same as invalid (tries next pattern)', async () => {
    const spy = vi.fn((email: string) => ({
      status:
        email === 'psharma@appscrip.com' ? ('valid' as const) : ('unknown' as const),
      rawSource: 'stub',
    }));
    const finder = new PatternHeuristicFinder(
      registryWith(stubVerifierWith(spy)),
    );

    const result = await finder.find({
      firstName: 'Priya',
      lastName: 'Sharma',
      companyDomain: 'appscrip.com',
    });

    expect(result?.email).toBe('psharma@appscrip.com');
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('returns null when no verifier is registered', async () => {
    const emptyRegistry = new ProviderRegistry<EmailVerifier>();
    const finder = new PatternHeuristicFinder(emptyRegistry);

    const result = await finder.find({
      firstName: 'Priya',
      lastName: 'Sharma',
      companyDomain: 'appscrip.com',
    });

    expect(result).toBeNull();
  });

  it('estimateCreditsRemaining returns null (credits live in the verifier)', async () => {
    const finder = new PatternHeuristicFinder(
      registryWith(stubVerifierWith(() => ({ status: 'valid', rawSource: 'stub' }))),
    );
    expect(await finder.estimateCreditsRemaining()).toBeNull();
  });
});
