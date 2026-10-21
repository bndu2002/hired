/**
 * Provider registry — the fallback-chain + credit-telemetry layer for
 * pluggable adapters.
 *
 * How it fits D4 (swap boundary):
 *   The orchestrator calls `discoveryRegistry.resolve((a) => a.discover(input))`.
 *   The registry iterates the registered adapters in preference order and
 *   returns the first non-null result tagged with which adapter produced it.
 *   The orchestrator never names an adapter directly.
 *
 * Adding a new adapter is three lines:
 *   1. Import the adapter class.
 *   2. `discoveryRegistry.register(new X(config.X_API_KEY))`
 *   3. Done. Contract tests pick it up automatically.
 *
 * See `.kiro/specs/hired/design.md § 7-8`.
 */

import { logger } from '../logger.js';
import type { DiscoverySource } from '../adapters/discovery/DiscoverySource.js';
import type { EmailFinder } from '../adapters/emailFinder/EmailFinder.js';
import type { EmailVerifier } from '../adapters/emailVerifier/EmailVerifier.js';

// ─── base interface every registered adapter satisfies ───────────────────────

export interface BaseAdapter {
  readonly name: string;
  estimateCreditsRemaining(): Promise<number | null>;
}

// ─── generic registry ────────────────────────────────────────────────────────

export class ProviderRegistry<T extends BaseAdapter> {
  private readonly adapters: T[] = [];

  /** Register in preference order — earlier = tried first. */
  register(adapter: T): this {
    this.adapters.push(adapter);
    logger.info(
      { adapter: adapter.name, totalRegistered: this.adapters.length },
      'adapter registered',
    );
    return this;
  }

  /** Introspection helper (useful for tests + the credit-telemetry dashboard). */
  list(): readonly T[] {
    return this.adapters;
  }

  /**
   * Fallback chain. For v1: registration order.
   *
   * v2+ can enrich this with:
   *   - skip adapters whose `estimateCreditsRemaining()` is 0
   *   - prefer adapters with higher remaining credits
   *   - respect a user-configured override order
   */
  async fallbackChain(): Promise<T[]> {
    return [...this.adapters];
  }

  /**
   * Iterate the fallback chain. For each adapter, call `fn(adapter)`:
   *   - if it returns a non-null value → return `{ result, via: adapter.name }`
   *   - if it returns `null` → try the next adapter
   *   - if it throws → log + try the next adapter (adapter failures are expected,
   *     coding-standards.md § error handling — "adapter failures are expected
   *     and non-fatal")
   *
   * Returns `null` only when every adapter failed or returned null.
   */
  async resolve<R>(
    fn: (adapter: T) => Promise<R | null>,
  ): Promise<{ result: R; via: string } | null> {
    const chain = await this.fallbackChain();
    for (const adapter of chain) {
      try {
        const result = await fn(adapter);
        if (result !== null && result !== undefined) {
          return { result, via: adapter.name };
        }
        logger.debug({ adapter: adapter.name }, 'adapter returned null, trying next');
      } catch (err) {
        logger.warn(
          { adapter: adapter.name, err },
          'adapter threw, falling back to next',
        );
      }
    }
    return null;
  }
}

// ─── the three module-level singletons ───────────────────────────────────────

/** All DiscoverySource adapters. */
export const discoveryRegistry = new ProviderRegistry<DiscoverySource>();

/** All EmailFinder adapters. SnovFinder first, PatternHeuristicFinder fallback. */
export const emailFinderRegistry = new ProviderRegistry<EmailFinder>();

/** All EmailVerifier adapters. ReoonVerifier is day-1. */
export const emailVerifierRegistry = new ProviderRegistry<EmailVerifier>();
