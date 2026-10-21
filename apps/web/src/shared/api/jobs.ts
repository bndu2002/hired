import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { z } from 'zod';
import { apiFetch } from './client.js';

/**
 * Jobs API hooks.
 *
 * Zod schemas live here (coding-standards.md § language — "Zod at every I/O
 * boundary"). The server also exposes types from @hired/types, but we don't
 * import them for runtime parsing — the schema here is the actual trust
 * boundary. If the server drifts, parse() throws and TanStack Query surfaces
 * the error in the UI.
 */

const JobSchema = z.object({
  id: z.number().int().positive(),
  source: z.enum(['happy_agent', 'paste_link']),
  companyName: z.string(),
  jobTitle: z.string(),
  jobUrl: z.string(),
  jobDescription: z.string().optional(),
  mustHaveSkills: z.string().optional(),
  goodToHaveSkills: z.string().optional(),
  happyJobId: z.string().optional(),
  experienceRange: z.string().optional(),
  locationHint: z.string().optional(),
  postedHint: z.string().optional(),
  createdAt: z.string(),
});

export type Job = z.infer<typeof JobSchema>;

const JobsListSchema = z.array(JobSchema);

export const jobsKeys = {
  all: ['jobs'] as const,
  list: () => [...jobsKeys.all, 'list'] as const,
  detail: (id: number) => [...jobsKeys.all, 'detail', id] as const,
};

/** List recent jobs (DESC by createdAt, up to 100). */
export function useJobs(): UseQueryResult<Job[]> {
  return useQuery({
    queryKey: jobsKeys.list(),
    queryFn: async () => {
      const raw = await apiFetch<unknown>('/api/jobs');
      return JobsListSchema.parse(raw);
    },
  });
}

/** Single job by id. Enabled only when id is a positive integer. */
export function useJob(id: number | undefined): UseQueryResult<Job> {
  return useQuery({
    queryKey: jobsKeys.detail(id ?? -1),
    enabled: typeof id === 'number' && Number.isInteger(id) && id > 0,
    queryFn: async () => {
      const raw = await apiFetch<unknown>(`/api/jobs/${id}`);
      return JobSchema.parse(raw);
    },
  });
}
