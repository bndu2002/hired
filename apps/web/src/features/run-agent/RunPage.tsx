import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  Loader2,
  AlertCircle,
  Zap,
  Send,
  Users,
} from 'lucide-react';

import { useJob } from '../../shared/api/jobs.js';
import type {
  Channels,
  DiscoveredContactView,
  SendResponse,
} from '../../shared/api/agent.js';
import { useDiscover, useSend } from '../../shared/api/agent.js';
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
 *   5. Hit Send — POST /api/agent/send writes `linkedin_connect_drafted`
 *      events for each LinkedIn-selected contact (Flow B, bare connect)
 *      and flips their status to CONNECT_DRAFTED. They show up in the
 *      LinkedIn Queue immediately. Gmail-selected contacts record intent
 *      but surface in `skipped[]` with `gmail_not_supported_yet` until
 *      Phase 4.4 (Gmail dispatch) lands.
 *
 * Why not auto-discover on page load:
 *   Each discovery burns one of 4 daily runs (D6). A browser refresh would
 *   spend a slot silently. User must opt in with the Discover click.
 *
 * Known UI simplification (v1): the global channel picker applies to ALL
 * selected contacts uniformly. requirements.md § 4 "Running the agent" asks
 * for PER-CONTACT channel toggles — that's an interaction upgrade for a
 * later slice (would need columns of toggles per row in ContactList).
 */
export function RunPage() {
  const { jobId: jobIdParam } = useParams<{ jobId: string }>();
  const jobId = Number.parseInt(jobIdParam ?? '', 10);
  const jobIdValid = Number.isFinite(jobId) && jobId > 0;

  const jobQuery = useJob(jobIdValid ? jobId : undefined);
  const discover = useDiscover();
  const send = useSend();

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

              {send.isError && <SendErrorAlert error={send.error} />}
              {send.isSuccess && <SendSuccessBanner result={send.data} />}

              <div className="mt-6 flex items-center justify-between">
                <div className="text-sm text-slate-500">
                  {selectedIds.size} of {contacts.length} selected
                </div>
                <Button
                  variant="primary"
                  disabled={
                    selectedIds.size === 0 ||
                    send.isPending ||
                    send.isSuccess
                  }
                  leading={
                    send.isPending ? (
                      <Loader2
                        className="h-4 w-4 animate-spin"
                        aria-hidden="true"
                      />
                    ) : send.isSuccess ? (
                      <Check className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Send className="h-4 w-4" aria-hidden="true" />
                    )
                  }
                  title={
                    selectedIds.size === 0
                      ? 'Select at least one contact first.'
                      : send.isSuccess
                        ? 'Already sent — selections are now in the LinkedIn Queue.'
                        : 'Writes linkedin_connect_drafted events for LinkedIn-selected contacts. Flow B: no custom note.'
                  }
                  onClick={() => {
                    if (!discover.data) return;
                    // Fan the modal's global channel setting out to each
                    // selected contact. Per-contact channel toggles would be
                    // a UI upgrade; v1 keeps all selections on the same
                    // channels. The server treats this correctly either way.
                    const gmail =
                      channels === 'gmail' || channels === 'both';
                    const linkedin =
                      channels === 'linkedin' || channels === 'both';
                    send.mutate({
                      runId: discover.data.runId,
                      selections: Array.from(selectedIds).map((contactId) => ({
                        contactId,
                        gmail,
                        linkedin,
                      })),
                    });
                  }}
                >
                  {send.isPending
                    ? 'Sending…'
                    : send.isSuccess
                      ? 'Sent'
                      : `Send (${selectedIds.size})`}
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

// ─── send-phase feedback ────────────────────────────────────────────────────

/**
 * Success banner after Send lands. Celebrates the LinkedIn drafts that
 * queued, explains the Gmail-skipped lines honestly (the server's
 * `skipped[]` surfaces reasons like `gmail_not_supported_yet` so the user
 * knows what did and didn't happen), and offers a direct link to the Queue.
 */
function SendSuccessBanner({ result }: { readonly result: SendResponse }) {
  const gmailDeferred = result.skipped.filter(
    (s) => s.reason === 'gmail_not_supported_yet',
  ).length;
  const otherSkips = result.skipped.filter(
    (s) => s.reason !== 'gmail_not_supported_yet',
  );
  return (
    <div className="mt-6 flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
      <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="flex-1">
        <div className="font-medium">
          {result.linkedinConnectDrafted} connect request
          {result.linkedinConnectDrafted === 1 ? '' : 's'} drafted
        </div>
        <ul className="mt-1 space-y-0.5 text-xs text-emerald-800">
          {gmailDeferred > 0 && (
            <li>
              {gmailDeferred} Gmail selection{gmailDeferred === 1 ? '' : 's'}{' '}
              recorded but not sent — Gmail dispatch ships in Phase 4.4.
            </li>
          )}
          {otherSkips.map((skip) => (
            <li key={`${skip.contactId}:${skip.reason}`}>
              Contact #{skip.contactId}: {skip.reason.replaceAll('_', ' ')}
              {skip.currentLinkedinStatus
                ? ` (status: ${skip.currentLinkedinStatus})`
                : ''}
            </li>
          ))}
        </ul>
        <Link
          to="/linkedin-queue"
          className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-emerald-900 underline-offset-2 hover:underline"
        >
          Go to LinkedIn Queue
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

/**
 * Error banner for the Send mutation. Mirrors the discover error layout —
 * narrows on ApiError to surface server-returned structured reasons when
 * present (400 invalid_selections, 404 run_not_found).
 */
function SendErrorAlert({ error }: { readonly error: unknown }) {
  if (!(error instanceof ApiError)) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return (
      <div className="mt-6">
        <AlertCard tone="error" title="Send failed">
          {message}
        </AlertCard>
      </div>
    );
  }

  const body = error.body as
    | {
        error?: string;
        reason?: string;
        offendingContactIds?: readonly number[];
        runId?: number;
      }
    | null
    | undefined;

  if (error.status === 404) {
    return (
      <div className="mt-6">
        <AlertCard tone="error" title="Run not found">
          The server doesn't recognize this run id anymore
          {body?.runId ? ` (${body.runId})` : ''}. Re-run discovery.
        </AlertCard>
      </div>
    );
  }
  if (error.status === 400) {
    return (
      <div className="mt-6">
        <AlertCard tone="error" title="Couldn't send">
          <div>
            {body?.reason === 'empty_selections' &&
              'No contacts were selected.'}
            {body?.reason === 'nothing_to_do' &&
              'No channel was ticked for any selection.'}
            {body?.reason === 'contact_not_in_run' && (
              <>
                Selections reference contacts that don't belong to this run:{' '}
                {body.offendingContactIds?.join(', ')}. Refresh the page.
              </>
            )}
            {!body?.reason && (body?.error ?? error.message)}
          </div>
        </AlertCard>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <AlertCard tone="error" title={`Send failed (${error.status})`}>
        {body?.error ?? error.message}
      </AlertCard>
    </div>
  );
}
