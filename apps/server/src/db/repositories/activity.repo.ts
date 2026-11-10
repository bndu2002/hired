/**
 * Activity repository — read-only queries that power the My Activity page.
 *
 * The page shows a dashboard of every Run Agent run with its contacts
 * expanded on demand, plus a per-contact outreach-lifecycle timeline. See
 * `.kiro/specs/hired/my-activity-brief.md` for the full UX spec.
 *
 * We use three focused queries composed in `services/activity.ts` rather
 * than one giant JOIN:
 *
 *   1. `listRunsWithJob()` — one row per run with the owning job inlined.
 *   2. `listContactsForRuns(runIds)` — all contacts across those runs,
 *      filtered by run_id IN (...).
 *   3. `listTimelineEventsForContacts(contactIds)` — only the
 *      outreach-lifecycle events (connect_sent, acceptance_detected,
 *      dm_sent, gmail_sent, reply_received, queue_skipped). The service
 *      maps event rows to timeline-row objects.
 *
 * Three round-trips, each with a small bounded IN-list. Simpler than a
 * four-table JOIN with denormalized rows, and composable (the orchestrator
 * or a future API endpoint can call one piece without pulling the whole
 * tree).
 *
 * Parameterized queries only (coding-standards.md § database).
 */

import type { EventType, GmailStatus, LinkedinStatus } from '@hired/types';
import { pool } from '../client.js';

// ─── row shapes (raw from Postgres) ─────────────────────────────────────────

interface RunWithJobRow {
  run_id: number;
  run_channels: string;
  run_status: string;
  run_marked_as_interview: boolean;
  run_created_at: Date;
  run_completed_at: Date | null;
  job_id: number;
  company_name: string;
  job_title: string;
  job_url: string;
  /** MAX(contacts.last_activity) over this run, or run.created_at if the
   *  run has no contacts yet. Pre-computed in SQL so the service doesn't
   *  loop over contacts to derive it. */
  last_activity: Date;
}

interface ContactRow {
  id: number;
  run_id: number;
  name: string;
  title: string | null;
  email: string | null;
  email_verified: boolean;
  linkedin_url: string | null;
  selected_for_gmail: boolean;
  selected_for_linkedin: boolean;
  gmail_status: string;
  linkedin_status: string;
  linkedin_dm_draft: string | null;
  last_activity: Date;
}

interface EventRow {
  id: number;
  contact_id: number;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: Date;
}

// ─── exported view types (one hop away from the response shape) ────────────

export interface RunWithJob {
  readonly runId: number;
  readonly channels: 'gmail' | 'linkedin' | 'both';
  readonly status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  readonly markedAsInterview: boolean;
  readonly createdAt: string;
  readonly completedAt: string | null;
  readonly lastActivity: string;
  readonly job: {
    readonly id: number;
    readonly companyName: string;
    readonly jobTitle: string;
    readonly jobUrl: string;
  };
}

export interface ActivityContact {
  readonly id: number;
  readonly runId: number;
  readonly name: string;
  readonly title: string | null;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly linkedinUrl: string | null;
  readonly selectedForGmail: boolean;
  readonly selectedForLinkedin: boolean;
  readonly gmailStatus: GmailStatus;
  readonly linkedinStatus: LinkedinStatus;
  readonly linkedinDmDraft: string | null;
  readonly lastActivity: string;
}

export interface ActivityEvent {
  readonly id: number;
  readonly contactId: number;
  readonly eventType: EventType;
  readonly payload: Record<string, unknown>;
  readonly createdAt: string;
}

// ─── timeline event filter ─────────────────────────────────────────────────

/**
 * Events the timeline cares about (my-activity-brief.md § vocabulary).
 * Everything else — discovery, email-find, drafting, intermediate state —
 * is internal plumbing and gets filtered OUT so the user-facing timeline
 * only shows world-visible milestones.
 *
 * Kept here (not in `services/activity.ts`) because it's a DB-level
 * concern: the SQL filters by this list, so the service never has to
 * iterate rows just to drop them.
 */
export const TIMELINE_EVENT_TYPES: readonly EventType[] = [
  'linkedin_connect_sent',
  'linkedin_acceptance_detected',
  'linkedin_dm_sent',
  'gmail_sent',
  'gmail_bounced',
  'reply_received',
  'queue_skipped',
] as const;

// ─── row-to-view mappers ───────────────────────────────────────────────────

function rowToRunWithJob(r: RunWithJobRow): RunWithJob {
  return {
    runId: r.run_id,
    channels: r.run_channels as RunWithJob['channels'],
    status: r.run_status as RunWithJob['status'],
    markedAsInterview: r.run_marked_as_interview,
    createdAt: r.run_created_at.toISOString(),
    completedAt: r.run_completed_at?.toISOString() ?? null,
    lastActivity: r.last_activity.toISOString(),
    job: {
      id: r.job_id,
      companyName: r.company_name,
      jobTitle: r.job_title,
      jobUrl: r.job_url,
    },
  };
}

function rowToContact(r: ContactRow): ActivityContact {
  return {
    id: r.id,
    runId: r.run_id,
    name: r.name,
    title: r.title,
    email: r.email,
    emailVerified: r.email_verified,
    linkedinUrl: r.linkedin_url,
    selectedForGmail: r.selected_for_gmail,
    selectedForLinkedin: r.selected_for_linkedin,
    gmailStatus: r.gmail_status as GmailStatus,
    linkedinStatus: r.linkedin_status as LinkedinStatus,
    linkedinDmDraft: r.linkedin_dm_draft,
    lastActivity: r.last_activity.toISOString(),
  };
}

function rowToEvent(r: EventRow): ActivityEvent {
  return {
    id: r.id,
    contactId: r.contact_id,
    eventType: r.event_type as EventType,
    payload: r.payload,
    createdAt: r.created_at.toISOString(),
  };
}

// ─── queries ────────────────────────────────────────────────────────────────

/**
 * Every run, newest first, with the owning job inlined.
 *
 * `last_activity` is derived in SQL as the MAX of the run's contact
 * last_activity timestamps, falling back to the run's own `created_at`
 * when the run has no contacts yet (shouldn't happen in practice since
 * discovery inserts contacts synchronously, but we're defensive).
 */
export async function listRunsWithJob(): Promise<RunWithJob[]> {
  const result = await pool.query<RunWithJobRow>(
    `
    SELECT
      r.id                   AS run_id,
      r.channels              AS run_channels,
      r.status                AS run_status,
      r.marked_as_interview   AS run_marked_as_interview,
      r.created_at            AS run_created_at,
      r.completed_at          AS run_completed_at,
      j.id                   AS job_id,
      j.company_name          AS company_name,
      j.job_title             AS job_title,
      j.job_url               AS job_url,
      COALESCE(
        (SELECT MAX(c.last_activity)
           FROM contacts c
          WHERE c.run_id = r.id),
        r.created_at
      ) AS last_activity
    FROM runs r
    JOIN jobs j ON j.id = r.job_id
    ORDER BY last_activity DESC, r.id DESC
    `,
  );
  return result.rows.map(rowToRunWithJob);
}

/**
 * All contacts across the given run ids. Returns [] if the list is empty
 * (avoid "WHERE run_id IN ()" which Postgres rejects).
 */
export async function listContactsForRuns(
  runIds: readonly number[],
): Promise<ActivityContact[]> {
  if (runIds.length === 0) return [];
  const result = await pool.query<ContactRow>(
    `
    SELECT
      id, run_id, name, title, email, email_verified,
      linkedin_url, selected_for_gmail, selected_for_linkedin,
      gmail_status, linkedin_status, linkedin_dm_draft, last_activity
    FROM contacts
    WHERE run_id = ANY($1::int[])
    ORDER BY run_id, id
    `,
    [runIds],
  );
  return result.rows.map(rowToContact);
}

/**
 * All TIMELINE-RELEVANT events across the given contact ids, in
 * chronological order. The event-type filter is applied in SQL via
 * `event_type = ANY($2::text[])` so we don't ship irrelevant rows over
 * the wire.
 */
export async function listTimelineEventsForContacts(
  contactIds: readonly number[],
): Promise<ActivityEvent[]> {
  if (contactIds.length === 0) return [];
  const result = await pool.query<EventRow>(
    `
    SELECT id, contact_id, event_type, payload, created_at
    FROM events
    WHERE contact_id = ANY($1::int[])
      AND event_type = ANY($2::text[])
    ORDER BY created_at ASC, id ASC
    `,
    [contactIds, TIMELINE_EVENT_TYPES as readonly string[]],
  );
  return result.rows.map(rowToEvent);
}
