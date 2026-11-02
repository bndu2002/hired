import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { z } from 'zod';
import { apiFetch } from './client.js';

/**
 * LinkedIn Queue hooks — the data layer behind `/linkedin-queue` page.
 *
 * The server owns all state transitions (D3 — events are the source of
 * truth). This file is purely a React Query wrapper over two endpoints:
 *
 *   GET  /api/linkedin-queue           → both tabs' data
 *   POST /api/linkedin-queue/mark-sent → advance one contact's status
 *
 * Zod narrows the server payload before anything else touches it so the
 * UI never sees a string where it expected a number, etc.
 */

// ─── schemas ────────────────────────────────────────────────────────────────

const ConnectItemSchema = z.object({
  contactId: z.number(),
  name: z.string(),
  title: z.string().nullable(),
  linkedinUrl: z.string(),
  runId: z.number(),
  companyName: z.string(),
  jobTitle: z.string(),
});

const DmItemSchema = ConnectItemSchema.extend({
  draft: z.string(),
});

const QueueResponseSchema = z.object({
  connect: z.array(ConnectItemSchema),
  dm: z.array(DmItemSchema),
});

export type QueueConnectItem = z.infer<typeof ConnectItemSchema>;
export type QueueDmItem = z.infer<typeof DmItemSchema>;
export type QueueResponse = z.infer<typeof QueueResponseSchema>;

export type MarkSentKind = 'connect' | 'dm';

export interface MarkSentInput {
  readonly contactId: number;
  readonly kind: MarkSentKind;
}

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

const MarkSentOkSchema = z.object({
  contactId: z.number(),
  kind: z.enum(['connect', 'dm']),
  statusChange: z.object({
    from: LinkedinStatusSchema,
    to: LinkedinStatusSchema,
  }),
});

export type MarkSentOk = z.infer<typeof MarkSentOkSchema>;

// ─── keys ───────────────────────────────────────────────────────────────────

export const linkedinQueueKeys = {
  all: ['linkedin-queue'] as const,
};

/**
 * How often the Queue re-fetches while open. The inbound poll runs every
 * 60s, so a 10s refetch is enough to catch newly-drafted DMs within a tick
 * or two of them being written on the server side. Short enough that
 * leaving the page open feels alive, long enough that we're not hammering.
 */
const QUEUE_REFETCH_INTERVAL_MS = 10_000;

// ─── read ───────────────────────────────────────────────────────────────────

export function useLinkedinQueue(): UseQueryResult<QueueResponse> {
  return useQuery({
    queryKey: linkedinQueueKeys.all,
    refetchInterval: QUEUE_REFETCH_INTERVAL_MS,
    queryFn: async () => {
      const raw = await apiFetch<unknown>('/api/linkedin-queue');
      return QueueResponseSchema.parse(raw);
    },
  });
}

// ─── mutation ───────────────────────────────────────────────────────────────

/**
 * POST /mark-sent returns 202 on real transitions and 409 on
 * already_sent / illegal_state. We treat BOTH as success from the UI's
 * perspective — a 409 "already_sent" means another tab or a prior click
 * already advanced this contact, and the right UX is to refresh the queue
 * (where the item will have disappeared) rather than surface an error.
 *
 * `apiFetch` throws ApiError on 409, so we catch it here and inspect the
 * body. illegal_state is a real error (programmer bug or stale UI); we
 * re-throw. already_sent we swallow + invalidate.
 */
export function useMarkSent(): UseMutationResult<
  MarkSentOk | { kind: MarkSentKind; alreadySent: true },
  Error,
  MarkSentInput
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input) => {
      try {
        const raw = await apiFetch<unknown>('/api/linkedin-queue/mark-sent', {
          method: 'POST',
          body: input,
        });
        return MarkSentOkSchema.parse(raw);
      } catch (err) {
        // apiFetch rethrows an ApiError with the body attached. We only
        // soft-handle `already_sent`; everything else bubbles.
        if (
          err &&
          typeof err === 'object' &&
          'status' in err &&
          err.status === 409 &&
          'body' in err &&
          err.body &&
          typeof err.body === 'object' &&
          'error' in err.body &&
          err.body.error === 'already_sent'
        ) {
          return { kind: input.kind, alreadySent: true as const };
        }
        throw err;
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: linkedinQueueKeys.all });
    },
  });
}
