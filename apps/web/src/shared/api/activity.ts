import {
  useQuery,
  type UseQueryResult,
} from '@tanstack/react-query';
import { z } from 'zod';
import { apiFetch } from './client.js';

/**
 * My Activity hooks — the data layer behind `/activity` page.
 *
 * Single endpoint: `GET /api/activity` returns everything up-front:
 * one row per unique job URL (collapsing however many runs the user
 * fired at it), with contacts deduped across runs and per-channel
 * timelines unioned. See `.kiro/specs/hired/my-activity-brief.md` and
 * `services/activity.ts` on the server side for the grouping rules.
 *
 * Filters are client-side in v1 (small data volumes).
 *
 * Zod narrows the server payload before anything else touches it so the
 * UI never sees a string where it expected a number, etc. The schemas
 * mirror the exported types in `apps/server/src/services/activity.ts`.
 */

// ─── reused enums (mirrored from shared-types) ──────────────────────────────

const GmailStatusSchema = z.enum([
  'PENDING',
  'QUEUED',
  'SENT',
  'REPLIED',
  'BOUNCED',
  'FAILED',
]);

const LinkedinStatusSchema = z.enum([
  'PENDING',
  'CONNECT_DRAFTED',
  'CONNECT_SENT',
  'CONNECTED',
  'DM_DRAFTED',
  'DM_SENT',
  'REPLIED',
  'DECLINED',
  'SKIPPED',
]);

const RunStatusSchema = z.enum(['IN_PROGRESS', 'COMPLETED', 'FAILED']);

// ─── timeline / contact / job schemas ──────────────────────────────────────

const TimelineToneSchema = z.enum([
  'done',
  'replied',
  'skipped',
  'bounced',
]);

const TimelineEntrySchema = z.object({
  label: z.string(),
  at: z.string(),
  tone: TimelineToneSchema,
});

const ContactSchema = z.object({
  contactId: z.number(),
  name: z.string(),
  title: z.string().nullable(),
  selectedForGmail: z.boolean(),
  selectedForLinkedin: z.boolean(),
  email: z.string().nullable(),
  emailVerified: z.boolean(),
  linkedinUrl: z.string().nullable(),
  gmailStatus: GmailStatusSchema,
  linkedinStatus: LinkedinStatusSchema,
  linkedinDmDraft: z.string().nullable(),
  timeline: z.object({
    linkedin: z.array(TimelineEntrySchema),
    gmail: z.array(TimelineEntrySchema),
  }),
});

/**
 * One row on the My Activity table — a unique job URL across however
 * many runs the user has fired at it. See server-side
 * `ActivityJobView` for the field semantics (status = latest run's,
 * markedAsInterview = any-run flag, lastActivity = MAX).
 */
const JobSchema = z.object({
  jobKey: z.string(),
  runBy: z.literal('manual'),
  status: RunStatusSchema,
  markedAsInterview: z.boolean(),
  lastActivity: z.string(),
  company: z.string(),
  jobTitle: z.string(),
  jobUrl: z.string(),
  runIds: z.array(z.number()),
  contacts: z.array(ContactSchema),
});

const ActivityResponseSchema = z.object({
  tabCounts: z.object({
    allActivity: z.number(),
    responses: z.number(),
    interviews: z.number(),
  }),
  jobs: z.array(JobSchema),
});

// ─── exported types (derived from Zod so types + runtime stay in sync) ─────

export type TimelineTone = z.infer<typeof TimelineToneSchema>;
export type TimelineEntry = z.infer<typeof TimelineEntrySchema>;
export type ActivityContact = z.infer<typeof ContactSchema>;
export type ActivityJob = z.infer<typeof JobSchema>;
export type ActivityResponse = z.infer<typeof ActivityResponseSchema>;
export type GmailStatus = z.infer<typeof GmailStatusSchema>;
export type LinkedinStatus = z.infer<typeof LinkedinStatusSchema>;
export type RunStatus = z.infer<typeof RunStatusSchema>;

// ─── query key + refetch cadence ────────────────────────────────────────────

export const activityKeys = {
  all: ['activity'] as const,
};

/**
 * Refetch cadence. The inbound poll runs every 60s and can land new
 * timeline events (acceptance, reply) on existing contacts without the
 * page knowing. 30s keeps the view fresh without hammering — same
 * cadence we use for the Configure page's connected-accounts freshness
 * check.
 */
const ACTIVITY_REFETCH_INTERVAL_MS = 30_000;

// ─── read ───────────────────────────────────────────────────────────────────

export function useActivity(): UseQueryResult<ActivityResponse> {
  return useQuery({
    queryKey: activityKeys.all,
    refetchInterval: ACTIVITY_REFETCH_INTERVAL_MS,
    queryFn: async () => {
      const raw = await apiFetch<unknown>('/api/activity');
      return ActivityResponseSchema.parse(raw);
    },
  });
}
