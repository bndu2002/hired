/**
 * Pure helpers for constructing typed events.
 *
 * Why a helper and not just literal objects:
 *   - `makeEvent('contact_discovered', { discoveredVia: 'x' })` is checked
 *     at compile time — passing the wrong payload shape won't compile.
 *   - Centralizes the construction call site so the signature can evolve
 *     (e.g. automatic createdAt) without touching every call.
 *
 * No I/O here. Writing an event to the DB is `event.repo.ts` territory.
 *
 * See `.kiro/specs/hired/design.md § 5` (events are source of truth, D3).
 */

import type { AppEvent, EventPayloads, EventType } from '@hired/types';

/**
 * Compile-time-checked event constructor.
 *
 *   const e = makeEvent('contact_discovered', { discoveredVia: 'serpapi_xray' });
 *   // e.type === 'contact_discovered'
 *   // e.payload is typed as EventPayloads['contact_discovered']
 */
export function makeEvent<T extends EventType>(
  type: T,
  payload: EventPayloads[T],
): Extract<AppEvent, { type: T }> {
  return { type, payload } as Extract<AppEvent, { type: T }>;
}
