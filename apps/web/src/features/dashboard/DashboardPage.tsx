import { AlertCircle, Inbox, Loader2 } from 'lucide-react';
import { useJobs } from '../../shared/api/jobs.js';
import { JobCard } from './JobCard.js';

/**
 * Dashboard — list of recently captured jobs with a Run Agent entry point.
 *
 * Jobs land in the DB when the user presses Alt+H on a Happy Agent detail
 * pane (Phase 2). This page just reads them. "Run Agent" on any row navigates
 * to /run/:jobId where the orchestrator fires.
 *
 * Future (Phase 6): add "last run" column, per-row daily-cap awareness,
 * filter by state (replied / interview-marked).
 */
export function DashboardPage() {
  const jobsQuery = useJobs();

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          Jobs captured via <span className="font-mono text-xs">Alt+H</span> on
          Happy Agent. Click a job to run the agent against it.
        </p>
      </header>

      {jobsQuery.isPending && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading jobs…
        </div>
      )}

      {jobsQuery.isError && (
        <div className="flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <div className="font-medium">Couldn't load jobs</div>
            <div className="mt-0.5 text-rose-700">
              {jobsQuery.error.message}. Make sure the server is running at
              127.0.0.1:4000 and the shared secret matches.
            </div>
          </div>
        </div>
      )}

      {jobsQuery.isSuccess && jobsQuery.data.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-500">
          <Inbox className="h-8 w-8 text-slate-300" aria-hidden="true" />
          <div className="font-medium text-slate-700">No jobs yet</div>
          <div className="max-w-sm">
            Press <span className="font-mono text-xs">Alt+H</span> on a Happy
            Agent job detail to capture it. Captured jobs appear here.
          </div>
        </div>
      )}

      {jobsQuery.isSuccess && jobsQuery.data.length > 0 && (
        <div className="space-y-3">
          {jobsQuery.data.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  );
}
