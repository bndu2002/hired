/**
 * Append-only event log types.
 *
 * The `events` table is the source of truth (D3). Status columns on `contacts`
 * are derived caches that can be recomputed by replaying events in order.
 *
 * See `.kiro/specs/hired/design.md § 5-6` for the full type-to-payload map.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Payload shapes, one per event type
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map of event type names to their expected payload shapes. The source of
 * truth for both server (writes events) and web (reads them). Keeping this
 * exhaustive means TypeScript catches typos at compile time.
 */
export interface EventPayloads {
  // Discovery / selection
  contact_discovered: {
    discoveredVia: string;              // adapter name
    rawFields?: Record<string, unknown>; // whatever the adapter returned
  };
  contact_selected: {
    gmail: boolean;
    linkedin: boolean;
  };

  // Email path
  email_find_attempted: {
    foundVia: string;                   // adapter name
    success: boolean;
  };
  email_found: {
    email: string;
    foundVia: string;
    confidence: 'high' | 'medium' | 'low';
  };
  email_not_found: {
    reason: string;
  };
  email_verified: {
    verifiedVia: string;                // adapter name
    status: 'valid' | 'accept_all' | 'unknown';
  };
  email_unverifiable: {
    verifiedVia: string;
    status: 'invalid' | 'accept_all' | 'unknown';
    reason?: string;
  };
  gmail_queued: {
    templateId?: string;
  };
  gmail_sent: {
    threadId: string;
    messageId: string;
  };
  gmail_bounced: {
    threadId: string;
    reason: string;
  };

  // LinkedIn path (Flow B)
  linkedin_connect_drafted: Record<string, never>;        // no payload needed
  linkedin_connect_sent: Record<string, never>;
  linkedin_acceptance_detected: {
    fromGmailMessageId: string;
  };
  linkedin_dm_drafted: {
    renderedBody: string;
  };
  linkedin_dm_sent: Record<string, never>;

  // Reply handling
  reply_received: {
    channel: 'gmail' | 'linkedin';
    snippet: string;
  };
  reply_classified: {
    sentiment: 'POSITIVE' | 'NEGATIVE';
    intent: string;
  };

  // User-driven
  marked_as_interview: {
    note?: string;
  };
  queue_skipped: {
    kind: 'connect' | 'dm';
  };
  run_completed: Record<string, never>;
}

/** All known event type names, derived from the payload map. */
export type EventType = keyof EventPayloads;

/**
 * A fully-typed event. Discriminated union: narrowing on `type` reveals the
 * exact payload shape. Use this in switch statements for exhaustive handling.
 *
 *   switch (event.type) {
 *     case 'contact_discovered':  // event.payload.discoveredVia is string
 *     case 'email_found':         // event.payload.email is string
 *   }
 */
export type AppEvent = {
  [K in EventType]: { type: K; payload: EventPayloads[K] };
}[EventType];

/** As persisted in the `events` table. */
export interface EventRow {
  id: number;
  contactId: number;
  eventType: EventType;
  payload: Record<string, unknown>;   // JSONB; narrowed by eventType at read time
  createdAt: string;                   // ISO timestamp
}
