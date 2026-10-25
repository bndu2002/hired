import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { z } from 'zod';
import { apiFetch, ApiError } from './client.js';

/**
 * Agent API — currently just POST /api/agent/discover. Phase 4 will add
 * POST /api/agent/send (dispatch). Phase 6 will add GET /api/agent/daily-cap.
 */

// ─── schemas ─────────────────────────────────────────────────────────────────

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
]);

const PreviousContactSchema = z.object({
  lastOutreachAt: z.string(),
  lastRunId: z.number(),
  lastGmailStatus: GmailStatusSchema,
  lastLinkedinStatus: LinkedinStatusSchema,
});

const ContactSchema = z.object({
  id: z.number(),
  runId: z.number(),
  name: z.string(),
  title: z.string().nullable(),
  tenureHint: z.string().nullable(),
  email: z.string().nullable(),
  emailVerified: z.boolean(),
  emailFoundVia: z.string().nullable(),
  emailVerifiedVia: z.string().nullable(),
  linkedinUrl: z.string().nullable(),
  gmailStatus: GmailStatusSchema,
  linkedinStatus: LinkedinStatusSchema,
  discoveredVia: z.string().nullable(),
  createdAt: z.string(),
});

const DiscoveredContactViewSchema = z.object({
  contact: ContactSchema,
  previouslyContacted: PreviousContactSchema.nullable(),
});

const DiscoverResponseSchema = z.object({
  runId: z.number().int().positive(),
  discoveredVia: z.string(),
  contacts: z.array(DiscoveredContactViewSchema),
});

export type Contact = z.infer<typeof ContactSchema>;
export type PreviousContact = z.infer<typeof PreviousContactSchema>;
export type DiscoveredContactView = z.infer<typeof DiscoveredContactViewSchema>;
export type DiscoverResponse = z.infer<typeof DiscoverResponseSchema>;

export type Channels = 'gmail' | 'linkedin' | 'both';

export interface DiscoverInput {
  readonly jobId: number;
  readonly channels: Channels;
}

// ─── mutation hook ───────────────────────────────────────────────────────────

/**
 * Fire a Run Agent discovery pass.
 *
 * Error shape: on 429 (cap_reached) or 502 (no_discovery), apiFetch throws
 * ApiError. Callers can narrow on `.status` and read `.body` for structured
 * fields the server returned (currentCount/cap, reason, etc.).
 *
 * On success, invalidate the jobs list so the Dashboard's "last run" column
 * reflects freshness. (That column is Phase 6 work — invalidation here is
 * pre-wired so we don't have to remember later.)
 */
export function useDiscover(): UseMutationResult<DiscoverResponse, ApiError, DiscoverInput> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: DiscoverInput) => {
      const raw = await apiFetch<unknown>('/api/agent/discover', {
        method: 'POST',
        body: input,
      });
      return DiscoverResponseSchema.parse(raw);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
}
