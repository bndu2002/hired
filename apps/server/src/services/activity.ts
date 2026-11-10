/**
 * Activity service — composes the three activity.repo queries into the
 * shape the My Activity page consumes.
 *
 * The page's unit of display is a JOB, not a run. One row per unique
 * `jobs.job_url`, however many times the user clicked Run Agent on it.
 * This file does the grouping: runs → jobs, with contacts deduped across
 * runs so the same person doesn't appear multiple times under one job.
 *
 * Why do channel-splitting + event-to-label mapping + grouping HERE
 * (not in the route, not on the client):
 *
 *   1. Keeps the client dumb — it renders what it's given, no event-type
 *      strings leak into the UI. Means we can rename an internal event
 *      without touching web/.
 *   2. Centralizes the vocabulary in one place. The brief locks in
 *      "Connection sent / Connection accepted / Message sent / Reply
 *      received / Skipped / Bounced" — this file is where those strings
 *      live. Changing a label is one-line here, not a hunt across React
 *      components.
 *   3. Keeps the Zod schema at the HTTP boundary (routes) narrow and
 *      close to what the client actually consumes.
 *   4. Tab counts depend on the grouped view (responses = N jobs with a
 *      reply, not N runs). Grouping belongs on the same side as the
 *      counts so they're always consistent.
 */

import type {
  ActivityContact,
  ActivityEvent,
  RunWithJob,
} from '../db/repositories/activity.repo.js';
import {
  listContactsForRuns,
  listRunsWithJob,
  listTimelineEventsForContacts,
} from '../db/repositories/activity.repo.js';
import { logger } from '../logger.js';

// ─── public types (mirrored by the Zod schema on the client) ───────────────

/**
 * One row in the per-channel timeline inside a contact's message viewer
 * popover. `tone` drives the icon + color on the client; `label` is the
 * user-facing text verbatim.
 */
export interface TimelineEntry {
  readonly label: string;
  readonly at: string; // ISO
  readonly tone: 'done' | 'replied' | 'skipped' | 'bounced';
}

export interface ActivityContactView {
  readonly contactId: number;
  readonly name: string;
  readonly title: string | null;
  readonly selectedForGmail: boolean;
  readonly selectedForLinkedin: boolean;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly linkedinUrl: string | null;
  readonly gmailStatus: ActivityContact['gmailStatus'];
  readonly linkedinStatus: ActivityContact['linkedinStatus'];
  /**
   * Rendered LinkedIn DM text, when auto-draft (or reconciler) has
   * populated it. Null until a draft exists. The message viewer uses this
   * directly as the popover's MESSAGE body for the LinkedIn pill.
   */
  readonly linkedinDmDraft: string | null;
  readonly timeline: {
    readonly linkedin: readonly TimelineEntry[];
    readonly gmail: readonly TimelineEntry[];
  };
}

/**
 * One row on the My Activity table. Represents a unique job URL across
 * however many Run Agent runs the user has fired at it.
 *
 * - `jobKey` is the stable identity for expand/collapse state on the client.
 *   For normal rows it's `url:<lowercased jobUrl>`; for the (defensive)
 *   case where a run has no jobUrl, it falls back to `run:<runId>` so each
 *   null-URL run becomes its own row rather than collapsing together.
 * - `status` is the status of the LATEST run (by `created_at DESC`) in the
 *   group — "where did my most recent attempt land?" See user decision.
 * - `markedAsInterview` is true if ANY run in the group is flagged — one
 *   interview outcome belongs to the whole job.
 * - `lastActivity` is the MAX across all runs (which itself is MAX of each
 *   run's contact `last_activity`, computed in SQL).
 */
export interface ActivityJobView {
  readonly jobKey: string;
  readonly runBy: 'manual';
  readonly status: RunWithJob['status'];
  readonly markedAsInterview: boolean;
  readonly lastActivity: string;
  readonly company: string;
  readonly jobTitle: string;
  readonly jobUrl: string;
  /** IDs of every run collapsed into this row — handy for debugging + a
   *  future "Run history" expander. Latest-first (by `created_at DESC`). */
  readonly runIds: readonly number[];
  readonly contacts: readonly ActivityContactView[];
}

export interface ActivityResponse {
  readonly tabCounts: {
    readonly allActivity: number; // = jobs.length
    readonly responses: number; // jobs with ≥ 1 reply_received
    readonly interviews: number; // jobs with marked_as_interview = true
  };
  readonly jobs: readonly ActivityJobView[];
}

// ─── event-row → timeline-entry mapping ─────────────────────────────────────

/**
 * Translate one raw event row into (channel, timelineEntry). Returns null
 * when the event doesn't belong on either timeline (shouldn't happen if
 * the repo's SQL filter is correct, but the function is total so a stray
 * event type is a no-op instead of a crash).
 *
 * The brief (my-activity-brief.md § vocabulary) is authoritative for the
 * label strings — don't rename here without updating the brief.
 */
function eventToTimelineEntry(
  event: ActivityEvent,
): { channel: 'linkedin' | 'gmail'; entry: TimelineEntry } | null {
  const at = event.createdAt;
  switch (event.eventType) {
    case 'linkedin_connect_sent':
      return {
        channel: 'linkedin',
        entry: { label: 'Connection sent', at, tone: 'done' },
      };
    case 'linkedin_acceptance_detected':
      return {
        channel: 'linkedin',
        entry: { label: 'Connection accepted', at, tone: 'done' },
      };
    case 'linkedin_dm_sent':
      return {
        channel: 'linkedin',
        entry: { label: 'Message sent', at, tone: 'done' },
      };
    case 'gmail_sent':
      return {
        channel: 'gmail',
        entry: { label: 'Message sent', at, tone: 'done' },
      };
    case 'gmail_bounced':
      return {
        channel: 'gmail',
        entry: { label: 'Bounced', at, tone: 'bounced' },
      };
    case 'reply_received': {
      // Cross-channel event — discriminate on payload.channel.
      const channel = (event.payload as { channel?: string }).channel;
      if (channel !== 'linkedin' && channel !== 'gmail') return null;
      return {
        channel,
        entry: { label: 'Reply received', at, tone: 'replied' },
      };
    }
    case 'queue_skipped': {
      // kind: 'dm' → LinkedIn-timeline Skipped row (phase-5.3c).
      // kind: 'connect' is reserved for a future Connect-tab Skip and is
      // not surfaced on this timeline (not meaningful in a message viewer).
      const kind = (event.payload as { kind?: string }).kind;
      if (kind !== 'dm') return null;
      return {
        channel: 'linkedin',
        entry: { label: 'Skipped', at, tone: 'skipped' },
      };
    }
    default:
      // Any other event type was filtered out by activity.repo's SQL.
      // Returning null is defensive — a new event-type addition won't
      // crash the service; the author will see nothing on the timeline
      // and remember to extend both this switch AND TIMELINE_EVENT_TYPES.
      return null;
  }
}

// ─── grouping helpers ───────────────────────────────────────────────────────

/**
 * Stable key for grouping runs into one row. Normally the lowercased
 * `jobUrl`; falls back to `run:<id>` for the (shouldn't-happen) case
 * where a run has no jobUrl so each such run keeps its own row instead
 * of collapsing together with every other null-URL run.
 */
function makeJobKey(run: RunWithJob): string {
  const url = run.job.jobUrl?.trim();
  return url ? `url:${url.toLowerCase()}` : `run:${run.runId}`;
}

/**
 * Dedupe key for a contact. Priority: linkedinUrl → email → name.
 * Normalized to lowercase + trimmed. Namespaced (`li:` / `em:` / `nm:`)
 * so a company's domain-shaped email can't accidentally collide with
 * someone's LinkedIn slug.
 *
 * This is deliberately lossy — if two different humans happen to share a
 * name AND one lacks both linkedinUrl and email, they'll collapse into
 * one row. Acceptable: in practice both would be in the same run (same
 * discovery pass) and we'd rather show them merged than show "Jane Doe"
 * twice with identical blank channels.
 */
function dedupeKey(c: ActivityContact): string {
  if (c.linkedinUrl && c.linkedinUrl.trim()) {
    return `li:${c.linkedinUrl.trim().toLowerCase()}`;
  }
  if (c.email && c.email.trim()) {
    return `em:${c.email.trim().toLowerCase()}`;
  }
  return `nm:${c.name.trim().toLowerCase()}`;
}

/**
 * Pick which contact row "wins" when the same person appears across
 * multiple runs. Rule: the row with the most timeline events wins
 * (richest history → most informative status + draft). Ties broken by
 * most-recent `last_activity`.
 *
 * The timeline for the returned view is NOT taken from this one row —
 * it's the union across all deduped rows. See `unionTimeline`.
 */
function pickRepresentativeContact(
  rows: readonly ActivityContact[],
  timelineByContact: ReadonlyMap<
    number,
    { linkedin: readonly TimelineEntry[]; gmail: readonly TimelineEntry[] }
  >,
): ActivityContact {
  // Invariant: callers never pass an empty array. The reduce below would
  // throw with no initial value — asserting here gives a clearer error.
  if (rows.length === 0) {
    throw new Error('pickRepresentativeContact: empty rows');
  }
  const eventCount = (id: number): number => {
    const t = timelineByContact.get(id);
    return t ? t.linkedin.length + t.gmail.length : 0;
  };
  return rows.reduce((best, cur) => {
    const bestN = eventCount(best.id);
    const curN = eventCount(cur.id);
    if (curN > bestN) return cur;
    if (curN < bestN) return best;
    return new Date(cur.lastActivity).getTime() >
      new Date(best.lastActivity).getTime()
      ? cur
      : best;
  });
}

/**
 * Union of timeline entries across every contactId in the dedupe bucket.
 * Each per-contact timeline is already chronological (SQL ORDER BY), but
 * concatenating two chronological lists is NOT chronological — hence the
 * sort. localeCompare on ISO strings is lexicographic and matches time
 * order for the fixed ISO-8601 shape we emit from Postgres.
 */
function unionTimeline(
  contactIds: readonly number[],
  timelineByContact: ReadonlyMap<
    number,
    { linkedin: readonly TimelineEntry[]; gmail: readonly TimelineEntry[] }
  >,
): { linkedin: TimelineEntry[]; gmail: TimelineEntry[] } {
  const linkedin: TimelineEntry[] = [];
  const gmail: TimelineEntry[] = [];
  for (const id of contactIds) {
    const t = timelineByContact.get(id);
    if (!t) continue;
    linkedin.push(...t.linkedin);
    gmail.push(...t.gmail);
  }
  linkedin.sort((a, b) => a.at.localeCompare(b.at));
  gmail.sort((a, b) => a.at.localeCompare(b.at));
  return { linkedin, gmail };
}

// ─── composition ────────────────────────────────────────────────────────────

/**
 * The one function the HTTP route calls. Returns everything the page
 * needs in a single payload: one row per unique jobUrl with contacts
 * deduped across runs.
 */
export async function listActivity(): Promise<ActivityResponse> {
  const started = Date.now();

  // Step 1: runs + jobs. Already ordered newest-first by last_activity.
  const runs = await listRunsWithJob();
  if (runs.length === 0) {
    logger.info({ elapsedMs: Date.now() - started }, 'activity: empty');
    return {
      tabCounts: { allActivity: 0, responses: 0, interviews: 0 },
      jobs: [],
    };
  }

  // Step 2 + 3: contacts across all runs; events across all those contacts.
  // Two more round-trips. For small volumes (≪ 100 runs) this is cheaper
  // than one giant JOIN that denormalizes jobs across contact-event pairs.
  const runIds = runs.map((r) => r.runId);
  const contacts = await listContactsForRuns(runIds);
  const contactIds = contacts.map((c) => c.id);
  const events = await listTimelineEventsForContacts(contactIds);

  // Build timelineByContact. SQL already returned events in chronological
  // order so the per-contact arrays here are chronological too.
  const timelineByContact = new Map<
    number,
    { linkedin: TimelineEntry[]; gmail: TimelineEntry[] }
  >();
  for (const event of events) {
    const mapped = eventToTimelineEntry(event);
    if (!mapped) continue;
    let bucket = timelineByContact.get(event.contactId);
    if (!bucket) {
      bucket = { linkedin: [], gmail: [] };
      timelineByContact.set(event.contactId, bucket);
    }
    bucket[mapped.channel].push(mapped.entry);
  }

  // Group contacts by runId for cross-reference during the job walk.
  const contactsByRun = new Map<number, ActivityContact[]>();
  for (const c of contacts) {
    const bucket = contactsByRun.get(c.runId);
    if (bucket) bucket.push(c);
    else contactsByRun.set(c.runId, [c]);
  }

  // ─── group runs by job key ─────────────────────────────────────────────
  // Preserve the newest-first order from the SQL by inserting into a
  // Map (which preserves insertion order) — the first run per key sets
  // the position of that key in the response.
  const runsByJobKey = new Map<string, RunWithJob[]>();
  for (const run of runs) {
    const key = makeJobKey(run);
    const bucket = runsByJobKey.get(key);
    if (bucket) bucket.push(run);
    else runsByJobKey.set(key, [run]);
  }

  // ─── assemble per-job view ─────────────────────────────────────────────
  let responsesCount = 0;
  let interviewsCount = 0;

  const jobViews: ActivityJobView[] = [];
  for (const [jobKey, runGroup] of runsByJobKey) {
    // Latest run by created_at wins for status (user decision).
    const latest = runGroup.reduce((best, cur) =>
      new Date(cur.createdAt).getTime() > new Date(best.createdAt).getTime()
        ? cur
        : best,
    );
    const anyInterview = runGroup.some((r) => r.markedAsInterview);
    const lastActivity = runGroup
      .map((r) => r.lastActivity)
      .reduce((a, b) => (a > b ? a : b));

    // Collect every contact row across every run in this group, then
    // dedupe to one representative per person. Timeline for each
    // representative is the union across all their rows.
    const allContacts = runGroup.flatMap(
      (r) => contactsByRun.get(r.runId) ?? [],
    );
    const bucketsByDedupeKey = new Map<string, ActivityContact[]>();
    for (const c of allContacts) {
      const dk = dedupeKey(c);
      const bucket = bucketsByDedupeKey.get(dk);
      if (bucket) bucket.push(c);
      else bucketsByDedupeKey.set(dk, [c]);
    }

    let jobHasReply = false;
    const contactViews: ActivityContactView[] = [];
    for (const bucket of bucketsByDedupeKey.values()) {
      const rep = pickRepresentativeContact(bucket, timelineByContact);
      const timeline = unionTimeline(
        bucket.map((c) => c.id),
        timelineByContact,
      );
      // selected_for_* reflects the user's intent to reach out. If she
      // selected the person in ANY run (even an earlier one), the pill
      // belongs on the row — same reason the timeline is a union, not
      // the latest-row's snapshot.
      const selectedForGmail = bucket.some((c) => c.selectedForGmail);
      const selectedForLinkedin = bucket.some((c) => c.selectedForLinkedin);

      if (
        timeline.linkedin.some((e) => e.tone === 'replied') ||
        timeline.gmail.some((e) => e.tone === 'replied')
      ) {
        jobHasReply = true;
      }

      contactViews.push({
        contactId: rep.id,
        name: rep.name,
        title: rep.title,
        selectedForGmail,
        selectedForLinkedin,
        email: rep.email,
        emailVerified: rep.emailVerified,
        linkedinUrl: rep.linkedinUrl,
        gmailStatus: rep.gmailStatus,
        linkedinStatus: rep.linkedinStatus,
        linkedinDmDraft: rep.linkedinDmDraft,
        timeline,
      });
    }

    if (jobHasReply) responsesCount += 1;
    if (anyInterview) interviewsCount += 1;

    // Latest-first for runIds array matches the status-wins ordering.
    const runIdsLatestFirst = [...runGroup]
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .map((r) => r.runId);

    jobViews.push({
      jobKey,
      runBy: 'manual' as const,
      status: latest.status,
      markedAsInterview: anyInterview,
      lastActivity,
      company: latest.job.companyName,
      jobTitle: latest.job.jobTitle,
      jobUrl: latest.job.jobUrl,
      runIds: runIdsLatestFirst,
      contacts: contactViews,
    });
  }

  logger.info(
    {
      runs: runs.length,
      jobs: jobViews.length,
      contacts: contacts.length,
      events: events.length,
      responsesCount,
      interviewsCount,
      elapsedMs: Date.now() - started,
    },
    'activity: assembled',
  );

  return {
    tabCounts: {
      allActivity: jobViews.length,
      responses: responsesCount,
      interviews: interviewsCount,
    },
    jobs: jobViews,
  };
}
