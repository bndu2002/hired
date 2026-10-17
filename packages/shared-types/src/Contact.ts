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
