import { useNavigate } from 'react-router-dom';
import { ArrowRight, Building2, MapPin, Clock, ExternalLink } from 'lucide-react';
import type { Job } from '../../shared/api/jobs.js';
import { Button } from '../../shared/components/Button.js';
import { Badge } from '../../shared/components/Badge.js';

interface JobCardProps {
  readonly job: Job;
}

/** Humanize an ISO timestamp as a relative "N ago" string. */
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const diffSec = Math.max(0, (Date.now() - then) / 1000);
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
  if (diffSec < 86_400) return `${Math.round(diffSec / 3600)}h ago`;
  return `${Math.round(diffSec / 86_400)}d ago`;
}

export function JobCard({ job }: JobCardProps) {
  const navigate = useNavigate();

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 transition-shadow hover:shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
            <Building2 className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
            <span className="truncate">{job.companyName}</span>
            <Badge tone="neutral" title={`Captured ${timeAgo(job.createdAt)}`}>
              <Clock className="h-3 w-3" aria-hidden="true" />
              {timeAgo(job.createdAt)}
            </Badge>
          </div>

          <h3 className="mt-1 truncate text-base font-semibold text-slate-900">
            {job.jobTitle}
          </h3>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            {job.locationHint && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3" aria-hidden="true" />
                {job.locationHint}
              </span>
            )}
            {job.experienceRange && <span>{job.experienceRange}</span>}
            {job.postedHint && <span>{job.postedHint}</span>}
            <a
              href={job.jobUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-0.5 text-slate-500 hover:text-slate-900"
              onClick={(e) => e.stopPropagation()}
            >
              Open posting
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          </div>
        </div>

        <Button
          variant="primary"
          size="sm"
          trailing={<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />}
          onClick={() => navigate(`/run/${job.id}`)}
        >
          Run Agent
        </Button>
      </div>
    </article>
  );
}
