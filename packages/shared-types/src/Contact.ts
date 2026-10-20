/**
 * Contact type — a discovered person inside a Run Agent run.
 *
 * Mirrors the `contacts` table in `apps/server/src/db/schema.sql`.
 * See `.kiro/specs/hired/design.md § 5-6` for the full state machines.
 *
 * NOTE: expands in Phase 3 when the orchestrator lands. Status enums
 * are kept here for cross-package consistency.
 */

export type GmailStatus =
  | 'PENDING'
  | 'QUEUED'
  | 'SENT'
  | 'REPLIED'
  | 'BOUNCED'
  | 'FAILED';

export type LinkedinStatus =
  | 'PENDING'
  | 'CONNECT_DRAFTED'
  | 'CONNECT_SENT'
  | 'CONNECTED'
  | 'DM_DRAFTED'
  | 'DM_SENT'
  | 'REPLIED'
  | 'DECLINED';

export type Sentiment = 'POSITIVE' | 'NEGATIVE';

/**
 * Snapshot of the most recent prior outreach to a given person
 * (keyed by `linkedin_url`). Used by the Run Agent modal to default-uncheck
 * candidates we've already contacted and surface the context.
 *
 * Null in the API response means "we've never actually sent anything to this
 * person before" — either they're genuinely new, or earlier runs discovered
 * them but we never dispatched outreach.
 *
 * See .kiro/specs/hired/design.md — cross-run dedup (Option A, soft via UI).
 */
export interface PreviousContact {
  /** ISO timestamp of the previous contact's last activity. */
  lastOutreachAt: string;
  /** The run that produced the previous contact row. */
  lastRunId: number;
  lastGmailStatus: GmailStatus;
  lastLinkedinStatus: LinkedinStatus;
}
