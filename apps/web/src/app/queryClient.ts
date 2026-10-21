import { QueryClient } from '@tanstack/react-query';

/**
 * Shared TanStack Query client.
 *
 * Defaults tuned for this app:
 *   - staleTime 30s: dashboard polls (Activity, LinkedIn Queue) feel fresh
 *     without hammering the server on every mount.
 *   - retry: 1 for queries — the server is local, if it's down one retry
 *     is enough to catch a transient hiccup without masking real failures.
 *   - refetchOnWindowFocus: true — useful when the user tabs back after
 *     a run finishes so Activity updates automatically.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
    mutations: {
      retry: 0,
    },
  },
});
