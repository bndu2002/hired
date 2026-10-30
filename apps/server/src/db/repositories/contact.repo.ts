/**
 * Contact repository — one row per discovered person inside a run.
 *
 * Status columns are derived caches (D3); mutations go through `appendEvent`
 * in event.repo.ts, not direct UPDATEs. The one exception for slice 1 is the
 * initial creation here, which sets `discovered_via` + base identity fields.
 *
 * See .kiro/specs/hired/design.md § 5-6.
 */

import type { GmailStatus, LinkedinStatus, PreviousContact } from '@hired/types';
import { pool } from '../client.js';

export interface Contact {
  id: number;
  runId: number;
  name: string;
  title: string | null;
  tenureHint: string | null;
  email: string | null;
  emailVerified: boolean;
  emailFoundVia: string | null;
  emailVerifiedVia: string | null;
  linkedinUrl: string | null;
  gmailStatus: GmailStatus;
  linkedinStatus: LinkedinStatus;
  /** Gmail thread id if we've already sent them an email; used by the poller
   *  to correlate inbound email replies back to the right contact. */
  gmailThreadId: string | null;
  /** Rendered LinkedIn DM text, populated by the inbound poller when it
   *  auto-drafts after a connection acceptance. Null until the auto-draft
   *  (or a future manual-draft UI) runs. The Queue surface reads this. */
  linkedinDmDraft: string | null;
  discoveredVia: string | null;
  createdAt: string;
}

interface ContactRow {
  id: number;
  run_id: number;
  name: string;
  title: string | null;
  tenure_hint: string | null;
  email: string | null;
  email_verified: boolean;
  email_found_via: string | null;
  email_verified_via: string | null;
  linkedin_url: string | null;
  gmail_status: string;
  linkedin_status: string;
  gmail_thread_id: string | null;
  linkedin_dm_draft: string | null;
  discovered_via: string | null;
  created_at: Date;
}

function rowToContact(r: ContactRow): Contact {
  return {
    id: r.id,
    runId: r.run_id,
    name: r.name,
    title: r.title,
    tenureHint: r.tenure_hint,
    email: r.email,
    emailVerified: r.email_verified,
    emailFoundVia: r.email_found_via,
    emailVerifiedVia: r.email_verified_via,
    linkedinUrl: r.linkedin_url,
    gmailStatus: r.gmail_status as GmailStatus,
    linkedinStatus: r.linkedin_status as LinkedinStatus,
    gmailThreadId: r.gmail_thread_id,
    linkedinDmDraft: r.linkedin_dm_draft,
    discoveredVia: r.discovered_via,
    createdAt: r.created_at.toISOString(),
  };
}

export interface CreateContactInput {
  name: string;
  title?: string | undefined;
  tenureHint?: string | undefined;
  linkedinUrl?: string | undefined;
  discoveredVia: string;
}

/**
 * Bulk insert contacts for a run. Single multi-row INSERT so N contacts
 * take one round trip instead of N.
 *
 * Each input row provides its own `discoveredVia` — in slice 1 all rows in a
 * call share the same source, but keeping it per-row keeps the door open for
 * hybrid-source discovery later without a schema or signature change.
 */
export async function createMany(
  runId: number,
  inputs: readonly CreateContactInput[],
): Promise<Contact[]> {
  if (inputs.length === 0) return [];

  const colsPerRow = 6;
  const valuesClauses: string[] = [];
  const params: unknown[] = [];

  inputs.forEach((input, i) => {
    const base = i * colsPerRow;
    valuesClauses.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`,
    );
    params.push(
      runId,
      input.name,
      input.title ?? null,
      input.tenureHint ?? null,
      input.linkedinUrl ?? null,
      input.discoveredVia,
    );
  });

  const sql = `
    INSERT INTO contacts (run_id, name, title, tenure_hint, linkedin_url, discovered_via)
    VALUES ${valuesClauses.join(', ')}
    RETURNING *
  `;

  const result = await pool.query<ContactRow>(sql, params);
  return result.rows.map(rowToContact);
}

export async function getById(id: number): Promise<Contact | null> {
  const result = await pool.query<ContactRow>(
    'SELECT * FROM contacts WHERE id = $1',
    [id],
  );
  const row = result.rows[0];
  return row ? rowToContact(row) : null;
}

export async function listByRun(runId: number): Promise<Contact[]> {
  const result = await pool.query<ContactRow>(
    'SELECT * FROM contacts WHERE run_id = $1 ORDER BY id',
    [runId],
  );
  return result.rows.map(rowToContact);
}

// ─── email resolution update ─────────────────────────────────────────────────

export interface UpdateEmailInfoInput {
  contactId: number;
  email: string | null;
  emailVerified: boolean;
  emailFoundVia: string | null;
  emailVerifiedVia: string | null;
}

/**
 * Persist the resolved email + verification result for a single contact.
 * Called by the orchestrator after the email-finder/verifier chain runs.
 *
 * Called N times per Run Agent (once per contact that got an email attempt).
 * Could be batched into a single UPDATE with CASE WHENs if we ever care about
 * N round trips — for 1-8 contacts per run, individual updates are fine.
 */
export async function updateEmailInfo(input: UpdateEmailInfoInput): Promise<void> {
  await pool.query(
    `
    UPDATE contacts
       SET email              = $2,
           email_verified     = $3,
           email_found_via    = $4,
           email_verified_via = $5,
           last_activity      = now()
     WHERE id = $1
    `,
    [
      input.contactId,
      input.email,
      input.emailVerified,
      input.emailFoundVia,
      input.emailVerifiedVia,
    ],
  );
}

// ─── cross-run dedup lookup (soft dedup / Option A) ──────────────────────────

/**
 * For each LinkedIn URL in the input, find the most recent prior contact row
 * where any outreach actually happened (gmail_status != 'PENDING' OR
 * linkedin_status != 'PENDING'). Rows where we discovered the person but
 * never dispatched anything are NOT counted as "previously contacted" — the
 * person was just surfaced, not reached.
 *
 * Uses Postgres DISTINCT ON for per-URL latest row in a single query.
 * Returns a Map so callers do O(1) lookups per candidate.
 */
export async function findPreviousByLinkedinUrls(
  linkedinUrls: readonly string[],
): Promise<Map<string, PreviousContact>> {
  const result = new Map<string, PreviousContact>();
  if (linkedinUrls.length === 0) return result;

  const rows = await pool.query<{
    linkedin_url: string;
    run_id: number;
    gmail_status: string;
    linkedin_status: string;
    last_activity: Date;
  }>(
    `
    SELECT DISTINCT ON (linkedin_url)
      linkedin_url,
      run_id,
      gmail_status,
      linkedin_status,
      last_activity
    FROM contacts
    WHERE linkedin_url = ANY($1::text[])
      AND (gmail_status != 'PENDING' OR linkedin_status != 'PENDING')
    ORDER BY linkedin_url, last_activity DESC, id DESC
    `,
    [linkedinUrls as string[]],
  );

  for (const row of rows.rows) {
    result.set(row.linkedin_url, {
      lastOutreachAt: row.last_activity.toISOString(),
      lastRunId: row.run_id,
      lastGmailStatus: row.gmail_status as GmailStatus,
      lastLinkedinStatus: row.linkedin_status as LinkedinStatus,
    });
  }

  return result;
}


// ─── poller lookups ─────────────────────────────────────────────────────────

import type { LinkedinStatus as LinkedinStatusType, GmailStatus as GmailStatusType } from '@hired/types';
import { extractLinkedInSlug } from '../../core/linkedinNotificationParser.js';

/**
 * Look up the most recent contact whose linkedin_url matches the given URL.
 *
 * Matches by slug (the `/in/<slug>` portion) because different subsystems
 * store different subdomains for the same person — discovery via SerpAPI
 * often stores `in.linkedin.com/in/foo`, while LinkedIn's notification
 * emails use `www.linkedin.com/in/foo`. Both resolve to slug=`foo` and we
 * want them to match. Case-insensitive comparison on the slug.
 *
 * When a person was discovered in multiple runs, we return the most recent
 * row (ORDER BY id DESC) — that's the one whose status we want to update.
 */
export async function findByLinkedinUrl(url: string): Promise<Contact | null> {
  const slug = extractLinkedInSlug(url);
  if (!slug) return null;

  // Match any linkedin_url whose path ends with /in/<slug> (optionally
  // followed by / or query string). Case-insensitive. Escape SQL LIKE
  // metacharacters in the slug just in case a stored one has `%` or `_`.
  const escaped = slug.replace(/[%_\\]/g, (c) => `\\${c}`);
  const result = await pool.query<ContactRow>(
    `SELECT * FROM contacts
       WHERE linkedin_url ILIKE $1 ESCAPE '\\'
       ORDER BY id DESC
       LIMIT 1`,
    [`%/in/${escaped}%`],
  );
  const row = result.rows[0];
  return row ? rowToContact(row) : null;
}

/**
 * Look up the contact we previously sent email to on this Gmail thread.
 * Used by the poller when a reply lands in our sending inbox: we match the
 * reply's thread id back to the contact that originated the outbound.
 */
export async function findByGmailThreadId(threadId: string): Promise<Contact | null> {
  const result = await pool.query<ContactRow>(
    `SELECT * FROM contacts
       WHERE gmail_thread_id = $1
       ORDER BY id DESC
       LIMIT 1`,
    [threadId],
  );
  const row = result.rows[0];
  return row ? rowToContact(row) : null;
}

// ─── derived-cache status writes ────────────────────────────────────────────
//
// The event log is source of truth (D3). These setters just maintain the
// derived cache on the contact row — callers (poller, orchestrator) are
// responsible for computing the next status via core/stateMachines.ts and
// appending the matching event via event.repo.ts in the same logical
// operation.

/**
 * Set linkedin_status on a contact row and bump last_activity. Used by the
 * poller after appending a LinkedIn event. The orchestrator uses this too
 * when it writes outbound-side events (connect_sent, dm_sent).
 */
export async function updateLinkedinStatus(
  contactId: number,
  status: LinkedinStatusType,
): Promise<void> {
  await pool.query(
    `UPDATE contacts
        SET linkedin_status = $2,
            last_activity   = now()
      WHERE id = $1`,
    [contactId, status],
  );
}

export async function updateGmailStatus(
  contactId: number,
  status: GmailStatusType,
): Promise<void> {
  await pool.query(
    `UPDATE contacts
        SET gmail_status  = $2,
            last_activity = now()
      WHERE id = $1`,
    [contactId, status],
  );
}

/**
 * Set the selected_for_* flags on a contact row. Called by the orchestrator
 * at the send phase so the dashboard can show "X was selected for LinkedIn
 * in this run" without replaying the event stream.
 *
 * The source of truth is still the `contact_selected` event; this is just
 * the derived cache. See .kiro/specs/hired/design.md § 3 (D3).
 */
export async function updateSelection(
  contactId: number,
  selection: { gmail: boolean; linkedin: boolean },
): Promise<void> {
  await pool.query(
    `UPDATE contacts
        SET selected_for_gmail    = $2,
            selected_for_linkedin = $3,
            last_activity         = now()
      WHERE id = $1`,
    [contactId, selection.gmail, selection.linkedin],
  );
}

/**
 * Store a rendered LinkedIn DM draft on a contact row. Called by the inbound
 * poller when it detects a connection acceptance — the DM template gets
 * rendered against the contact's data and stashed here so the Queue UI can
 * display it later. Separate from the `linkedin_dm_drafted` event payload
 * for ergonomics: the Queue only needs the draft text, and querying the
 * contact row is cheaper than replaying events.
 */
export async function updateLinkedinDmDraft(
  contactId: number,
  draft: string,
): Promise<void> {
  await pool.query(
    `UPDATE contacts
        SET linkedin_dm_draft = $2,
            last_activity     = now()
      WHERE id = $1`,
    [contactId, draft],
  );
}

/**
 * The Queue UI's contact view: a contact row plus the minimal Job context
 * needed to render "connecting about {jobTitle} at {companyName}". A JOIN
 * saves N+1 queries vs listByLinkedinStatus + per-contact job lookups.
 */
export interface ContactWithJob extends Contact {
  job: {
    id: number;
    companyName: string;
    jobTitle: string;
  };
}

interface ContactWithJobRow extends ContactRow {
  job_id: number;
  job_company_name: string;
  job_title: string;
}

function rowToContactWithJob(r: ContactWithJobRow): ContactWithJob {
  return {
    ...rowToContact(r),
    job: {
      id: r.job_id,
      companyName: r.job_company_name,
      jobTitle: r.job_title,
    },
  };
}

/**
 * All contacts currently in the given LinkedIn status, enriched with their
 * owning Job's company + title. Sorted newest-first (by contact id) so the
 * Queue's "Next" button advances through recent work first — matches user
 * intuition after they just hit Send.
 *
 * Powers both `linkedinQueue.listConnect()` (status=CONNECT_DRAFTED) and
 * `linkedinQueue.listDm()` (status=DM_DRAFTED). Keeping the SQL generic so
 * future states (DM_SENT history view, DECLINED archive) reuse it.
 */
export async function listWithJobByLinkedinStatus(
  status: LinkedinStatus,
): Promise<ContactWithJob[]> {
  const result = await pool.query<ContactWithJobRow>(
    `
    SELECT c.*,
           j.id           AS job_id,
           j.company_name AS job_company_name,
           j.job_title    AS job_title
      FROM contacts c
      JOIN runs r ON r.id = c.run_id
      JOIN jobs j ON j.id = r.job_id
     WHERE c.linkedin_status = $1
     ORDER BY c.id DESC
    `,
    [status],
  );
  return result.rows.map(rowToContactWithJob);
}
