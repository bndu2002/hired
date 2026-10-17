/**
 * Tests for the ProviderRegistry generic.
 *
 * Uses a tiny stub adapter type (not the real DiscoverySource) because the
 * registry is generic — testing the shape, not any specific adapter.
 */

import { describe, expect, it, vi } from 'vitest';
import { ProviderRegistry, type BaseAdapter } from '../providerRegistry.js';

interface StubAdapter extends BaseAdapter {
  readonly value: string;
}

function makeStub(name: string, value = `v-${name}`): StubAdapter {
  return {
    name,
    value,
    estimateCreditsRemaining: async () => null,
  };
}

describe('ProviderRegistry.register', () => {
  it('appends adapters in order', () => {
    const reg = new ProviderRegistry<StubAdapter>();
    reg.register(makeStub('a')).register(makeStub('b')).register(makeStub('c'));
    expect(reg.list().map((a) => a.name)).toEqual(['a', 'b', 'c']);
  });

  it('returns itself for chaining', () => {
    const reg = new ProviderRegistry<StubAdapter>();
    expect(reg.register(makeStub('a'))).toBe(reg);
  });
});

describe('ProviderRegistry.fallbackChain', () => {
  it('returns registration order', async () => {
    const reg = new ProviderRegistry<StubAdapter>();
    reg.register(makeStub('first')).register(makeStub('second'));
    const chain = await reg.fallbackChain();
    expect(chain.map((a) => a.name)).toEqual(['first', 'second']);
  });

  it('returns an empty chain when nothing is registered', async () => {
    const reg = new ProviderRegistry<StubAdapter>();
    expect(await reg.fallbackChain()).toEqual([]);
  });
});

describe('ProviderRegistry.resolve', () => {
  it('returns the first non-null result tagged with the adapter name', async () => {
    const reg = new ProviderRegistry<StubAdapter>();
    reg.register(makeStub('alpha', 'A'));
    reg.register(makeStub('beta', 'B'));

    const out = await reg.resolve(async (a) => a.value);

    expect(out).toEqual({ result: 'A', via: 'alpha' });
  });

  it('falls through when the first adapter returns null', async () => {
    const reg = new ProviderRegistry<StubAdapter>();
    reg.register(makeStub('alpha'));
    reg.register(makeStub('beta'));

    const out = await reg.resolve(async (a) =>
      a.name === 'alpha' ? null : 'from-beta',
    );

    expect(out).toEqual({ result: 'from-beta', via: 'beta' });
  });

  it('falls through when the first adapter throws', async () => {
    const reg = new ProviderRegistry<StubAdapter>();
    reg.register(makeStub('alpha'));
    reg.register(makeStub('beta'));

    const out = await reg.resolve(async (a) => {
      if (a.name === 'alpha') throw new Error('simulated adapter failure');
      return 'from-beta';
    });

    expect(out).toEqual({ result: 'from-beta', via: 'beta' });
  });

  it('returns null when every adapter returns null', async () => {
    const reg = new ProviderRegistry<StubAdapter>();
    reg.register(makeStub('alpha'));
    reg.register(makeStub('beta'));

    const out = await reg.resolve(async () => null);

    expect(out).toBeNull();
  });

  it('returns null when every adapter throws', async () => {
    const reg = new ProviderRegistry<StubAdapter>();
    reg.register(makeStub('alpha'));
    reg.register(makeStub('beta'));

    const out = await reg.resolve(async () => {
      throw new Error('bad');
    });

    expect(out).toBeNull();
  });

  it('short-circuits — does not call later adapters after a hit', async () => {
    const reg = new ProviderRegistry<StubAdapter>();
    reg.register(makeStub('alpha'));
    reg.register(makeStub('beta'));

    const fn = vi.fn(async (a: StubAdapter) =>
      a.name === 'alpha' ? 'done' : 'should-not-be-called',
    );
    await reg.resolve(fn);

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('treats empty array as a valid result (not fallback)', async () => {
    const reg = new ProviderRegistry<StubAdapter>();
    reg.register(makeStub('alpha'));
    reg.register(makeStub('beta'));

    const out = await reg.resolve(async (a) =>
      a.name === 'alpha' ? [] as string[] : ['from-beta'],
    );

    // Empty array is a result; registry should NOT fall through
    expect(out).toEqual({ result: [], via: 'alpha' });
  });
});
