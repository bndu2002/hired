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
 * Google-account hooks for the Configure → Connected Accounts tab.
 *
 * Connecting an account is NOT an apiFetch — it's a full-page OAuth redirect
 * that can't carry the shared-secret header. So `startConnectUrl()` returns a
 * plain URL the component opens in a popup; the server's public /start route
 * redirects to Google. Listing and disconnecting ARE normal secret-gated XHR.
 */

export type GoogleAccountRole = 'linkedin_notifications' | 'sending';

const GoogleAccountPublicSchema = z.object({
  id: z.number(),
  email: z.string(),
  role: z.enum(['linkedin_notifications', 'sending']),
  scopes: z.string().nullable(),
  connectedAt: z.string(),
  lastPolledAt: z.string().nullable(),
});

const AccountsResponseSchema = z.object({
  accounts: z.array(GoogleAccountPublicSchema),
});

export type GoogleAccountPublic = z.infer<typeof GoogleAccountPublicSchema>;

export const googleAccountKeys = {
  all: ['google-accounts'] as const,
};

/**
 * URL the "Connect" button opens in a popup. Points at the server's PUBLIC
 * OAuth start endpoint (no shared secret — it's a browser navigation). The
 * Vite dev proxy forwards /api to the server, and because this is a top-level
 * navigation (not fetch), same-origin rules are satisfied.
 */
export function startConnectUrl(role: GoogleAccountRole): string {
  return `/api/auth/google/start?role=${encodeURIComponent(role)}`;
}

/**
 * How often the Configure page re-fetches the account list. 30s keeps the
 * "polled Nm ago" badge honest without hammering the server — the poll
 * itself runs every minute, so halving that cadence is enough resolution
 * for a human to see freshness.
 */
const ACCOUNTS_REFETCH_INTERVAL_MS = 30_000;

export function useGoogleAccounts(): UseQueryResult<GoogleAccountPublic[]> {
  return useQuery({
    queryKey: googleAccountKeys.all,
    refetchInterval: ACCOUNTS_REFETCH_INTERVAL_MS,
    queryFn: async () => {
      const raw = await apiFetch<unknown>('/api/auth/google/accounts');
      return AccountsResponseSchema.parse(raw).accounts;
    },
  });
}

export function useDisconnectGoogleAccount(): UseMutationResult<
  void,
  Error,
  number
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await apiFetch(`/api/auth/google/accounts/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: googleAccountKeys.all });
    },
  });
}
