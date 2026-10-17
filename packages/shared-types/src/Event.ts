/**
 * Append-only event log types.
 *
 * The `events` table is the source of truth (D3). Status columns on `contacts`
 * are derived caches that can be recomputed by replaying events in order.
 *
 * See `.kiro/specs/hired/design.md § 5` for the full type-to-payload map.
 *
 * NOTE: payload shapes land per event type in Phase 3 as orchestrator events
 * fire for real. For now this file exports the type-name constants and a
 * minimal envelope.
 */

export type EventType =
  // Discovery / selection
  | 'contact_discovered'
  | 'contact_selected'
  // Email path
  | 'email_find_attempted'
  | 'email_found'
  | 'email_not_found'
  | 'email_verified'
  | 'email_unverifiable'
  | 'gmail_queued'
  | 'gmail_sent'
  | 'gmail_bounced'
  // LinkedIn path (Flow B)
  | 'linkedin_connect_drafted'
  | 'linkedin_connect_sent'
  | 'linkedin_acceptance_detected'
  | 'linkedin_dm_drafted'
  | 'linkedin_dm_sent'
  // Reply handling
  | 'reply_received'
  | 'reply_classified'
  // User-driven
  | 'marked_as_interview'
  | 'queue_skipped'
  | 'run_completed';

export interface EventRow {
  id: number;
  contactId: number;
  eventType: EventType;
  payload: Record<string, unknown>;
  createdAt: string; // ISO timestamp
}
