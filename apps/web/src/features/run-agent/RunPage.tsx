import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Building2,
  Loader2,
  AlertCircle,
  Zap,
  Send,
  Users,
} from 'lucide-react';

import { useJob } from '../../shared/api/jobs.js';
import type { Channels, DiscoveredContactView } from '../../shared/api/agent.js';
import { useDiscover } from '../../shared/api/agent.js';
import { ApiError } from '../../shared/api/client.js';
import { Button } from '../../shared/components/Button.js';
import { ChannelPicker } from './ChannelPicker.js';
import { ContactList } from './ContactList.js';

/**
 * Run Agent — the review surface.
 *
 * Flow:
 *   1. Page loads with `jobId` from URL. We fetch the job for the header.
 *   2. User picks channels (default: both) and hits "Discover".
 *   3. POST /api/agent/discover fires. Server runs Phase A (discovery +
 *      email resolution).
 *   4. Contacts render in a table. User reviews, (de)selects rows.
 *   5. "Send" is disabled — Phase B (dispatch) lands in a later slice.
 *
 * Why not auto-discover on page load:
 *   Each discovery burns one of 4 daily runs (D6). A browser refresh would
 *   spend a slot silently. User must opt in with the Discover click.
 */
export function RunPage() {
  const { jobId: jobIdParam } = useParams<{ jobId: string }>();
  const jobId = Number.parseInt(jobIdParam ?? '', 10);
  const jobIdValid = Number.isFinite(jobId) && jobId > 0;

  const jobQuery = useJob(jobIdValid ? jobId : undefined);
  const discover = useDiscover();

  const [channels, setChannels] = useState<Channels>('both');
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(new Set());

  const contacts: readonly DiscoveredContactView[] = discover.data?.contacts ?? [];

  // When discovery lands, default-select contacts that have not been reached
  // in a prior run (scoring is Phase 3.1 — this is the minimal rule for now).
  useEffect(() => {
    if (!discover.data) return;
    const next = new Set<number>();
    for (const view of discover.data.contacts) {
      if (!view.previouslyContacted) next.add(view.contact.id);
    }
    setSelectedIds(next);
  }, [discover.data]);

  const canDiscover = jobIdValid && !discover.isPending;

  const resolvedEmails = useMemo(
    () => contacts.filter((v) => v.contact.email && v.contact.emailVerified).length,
    [contacts],
  );

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="mb-6">
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Dashboard
        </Link>
        <h1 className="mt-3 flex items-center gap-2 text-xl font-semibold text-slate-900">
          <Zap className="h-5 w-5 text-slate-700" aria-hidden="true" />
          Run Agent
        </h1>
      </div>

      {/* ── Job header card ────────────────────────────────────────────── */}
      {!jobIdValid && (
        <AlertCard tone="error" title="Invalid job id">
          The URL doesn't contain a valid job id.
        </AlertCard>
      )}
      {jobIdValid && jobQuery.isPending && (
        <div className="mb-4 flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading job…
        </div>
      )}
      {jobIdValid && jobQuery.isError && (
        <AlertCard tone="error" title="Couldn't load this job">
          {jobQuery.error.message}
        </AlertCard>
      )}
      {jobQuery.isSuccess && (
        <div className="mb-6 rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
            {jobQuery.data.companyName}
          </div>
          <h2 className="mt-1 text-lg font-semibold text-slate-900">
            {jobQuery.data.jobTitle}
          </h2>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
            {jobQuery.data.locationHint && <span>{jobQuery.data.locationHint}</span>}
            {jobQuery.data.experienceRange && <span>{jobQuery.data.experienceRange}</span>}
            {jobQuery.data.postedHint && <span>{jobQuery.data.postedHint}</span>}
          </div>
        </div>
      )}

      {/* ── Channel picker + Discover ──────────────────────────────────── */}
      <section className="mb-6">
        <div className="mb-2 text-sm font-medium text-slate-700">
          Outreach channels
        </div>
        <ChannelPicker
          value={channels}
          onChange={setChannels}
          disabled={discover.isPending}
        />
        <div className="mt-4 flex items-center justify-end gap-3">
          <Button
            variant="primary"
            disabled={!canDiscover}
            leading={
              discover.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Zap className="h-4 w-4" aria-hidden="true" />
              )
            }
            onClick={() => discover.mutate({ jobId, channels })}
          >
            {discover.isPending ? 'Discovering…' : 'Discover contacts'}
          </Button>
        </div>
      </section>

      {/* ── Error state ────────────────────────────────────────────────── */}
      {discover.isError && <DiscoverErrorAlert error={discover.error} />}

      {/* ── Results ────────────────────────────────────────────────────── */}
      {discover.isSuccess && (
        <section>
          <div className="mb-3 flex items-center justify-between text-sm">
            <div className="flex items-center gap-2 text-slate-600">
              <Users className="h-4 w-4 text-slate-400" aria-hidden="true" />
              <span>
                <span className="font-semibold text-slate-900">
                  {contacts.length}
                </span>{' '}
                contacts discovered via{' '}
                <span className="font-mono text-xs">{discover.data.discoveredVia}</span>
                {resolvedEmails > 0 && (
                  <> · {resolvedEmails} verified emails</>
                )}
              </span>
            </div>
            <div className="text-xs text-slate-500">
              Run #{discover.data.runId}
            </div>
          </div>

          {contacts.length === 0 ? (
            <AlertCard tone="info" title="No contacts found">
              Discovery completed but turned up no profiles. Try a different
              job, or check SerpAPI credits.
            </AlertCard>
          ) : (
            <>
              <ContactList
                contacts={contacts}
                channels={channels}
                selectedIds={selectedIds}
                onToggle={(id) => {
                  setSelectedIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  });
                }}
                onToggleAll={() => {
                  setSelectedIds((prev) =>
                    prev.size === contacts.length
                      ? new Set()
                      : new Set(contacts.map((v) => v.contact.id)),
                  );
                }}
              />

              <div className="mt-6 flex items-center justify-between">
                <div className="text-sm text-slate-500">
                  {selectedIds.size} of {contacts.length} selected
                </div>
                <Button
                  variant="primary"
                  disabled
                  leading={<Send className="h-4 w-4" aria-hidden="true" />}
                  title="Dispatch is Phase 4 (Gmail OAuth + send + LinkedIn Queue)."
                >
                  Send ({selectedIds.size}) — coming in Phase 4
                </Button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}

// ─── small helpers ───────────────────────────────────────────────────────────

interface AlertCardProps {
  readonly tone: 'error' | 'info';
  readonly title: string;
  readonly children: React.ReactNode;
}

function AlertCard({ tone, title, children }: AlertCardProps) {
  const classes =
    tone === 'error'
      ? 'border-rose-200 bg-rose-50 text-rose-800'
      : 'border-slate-200 bg-slate-50 text-slate-700';
  return (
    <div className={`flex items-start gap-3 rounded-lg border p-4 text-sm ${classes}`}>
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div>
        <div className="font-medium">{title}</div>
        <div className="mt-0.5 text-sm opacity-90">{children}</div>
      </div>
    </div>
  );
}

/**
 * Render the specific guidance for each discover error the server surfaces.
 * Server returns structured bodies for 429 (cap_reached), 404 (job_not_found),
 * and 502 (no_discovery) — we unpack them here.
 */
function DiscoverErrorAlert({ error }: { error: unknown }) {
  if (!(error instanceof ApiError)) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return (
      <AlertCard tone="error" title="Discovery failed">
        {message}
      </AlertCard>
    );
  }

  // Narrow the body shape at the usage site; it's an unknown from apiFetch.
  const body = error.body as
    | { error?: string; message?: string; currentCount?: number; cap?: number; reason?: string }
    | null
    | undefined;

  if (error.status === 401) {
    return (
      <AlertCard tone="error" title="Server rejected the shared secret">
        The dashboard's <code className="font-mono text-xs">X-Hired-Secret</code>{' '}
        header is missing or doesn't match the server's{' '}
        <code className="font-mono text-xs">SHARED_SECRET</code>. Verify{' '}
        <code className="font-mono text-xs">apps/web/.env</code> has{' '}
        <code className="font-mono text-xs">VITE_HIRED_SHARED_SECRET</code> set
        to the same value as the server's{' '}
        <code className="font-mono text-xs">SHARED_SECRET</code>, then restart{' '}
        <code className="font-mono text-xs">pnpm --filter web dev</code>.
      </AlertCard>
    );
  }
  if (error.status === 429) {
    return (
      <AlertCard tone="error" title="Daily cap reached">
        {body?.message ??
          `You've used your ${body?.cap ?? 4} runs today. Resets at midnight.`}
      </AlertCard>
    );
  }
  if (error.status === 502) {
    const isEmpty = body?.reason === 'empty_results';
    return (
      <AlertCard tone={isEmpty ? 'info' : 'error'} title={isEmpty ? 'No contacts found' : 'Discovery failed'}>
        {body?.message ??
          (isEmpty
            ? 'Discovery completed but found no profiles. Try a different job.'
            : 'Every discovery adapter failed. Check SerpAPI key/quota.')}
      </AlertCard>
    );
  }
  if (error.status === 404) {
    return (
      <AlertCard tone="error" title="Job not found">
        The server doesn't have a row for this job id anymore.
      </AlertCard>
    );
  }

  return (
    <AlertCard tone="error" title={`Discovery failed (${error.status})`}>
      {body?.message ?? error.message}
    </AlertCard>
  );
}
