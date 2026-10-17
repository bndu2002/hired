/**
 * Tests for the makeEvent helper. These are mostly compile-time guarantees;
 * runtime assertions sanity-check the shape at runtime too.
 */

import { describe, expect, it } from 'vitest';
import { makeEvent } from '../events.js';

describe('makeEvent', () => {
  it('builds a contact_discovered event with the right shape', () => {
    const event = makeEvent('contact_discovered', {
      discoveredVia: 'serpapi_xray',
    });
    expect(event.type).toBe('contact_discovered');
    expect(event.payload.discoveredVia).toBe('serpapi_xray');
  });

  it('builds a contact_selected event with gmail+linkedin flags', () => {
    const event = makeEvent('contact_selected', { gmail: true, linkedin: false });
    expect(event.type).toBe('contact_selected');
    expect(event.payload).toEqual({ gmail: true, linkedin: false });
  });

  it('builds an email_found event with confidence', () => {
    const event = makeEvent('email_found', {
      email: 'arjun@appscrip.com',
      foundVia: 'snov',
      confidence: 'high',
    });
    expect(event.payload.confidence).toBe('high');
  });

  it('builds a payloadless event like linkedin_connect_sent', () => {
    const event = makeEvent('linkedin_connect_sent', {});
    expect(event.type).toBe('linkedin_connect_sent');
    expect(event.payload).toEqual({});
  });

  // Negative compile-time checks are implicit — if the wrong payload shape
  // were passed, tsc --noEmit would fail at the earlier `pnpm typecheck`
  // step, before this test file ever runs.
});
