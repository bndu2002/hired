import { useMemo, useState } from 'react';
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Linkedin,
  Loader2,
  Mail,
  Search,
  User,
  Users,
} from 'lucide-react';
import {
  useActivity,
  type ActivityContact,
  type ActivityJob,
  type LinkedinStatus,
  type RunStatus,
} from '../../shared/api/activity.js';
import { Badge } from '../../shared/components/Badge.js';
import {
  MessageViewerPill,
  PinnedMessagePanel,
} from './MessageViewer.js';

/**
 * My Activity — the "where do I stand across every job?" page.
 *
 * One endpoint feeds everything: `GET /api/activity`. The server already
 * groups runs by job URL (one row per unique job, however many Run Agent
 * clicks landed on it) and dedupes contacts across runs — see
 * `services/activity.ts`. Filters (search, status, date range) are
 * client-side in v1; data volume is small (≪ 100 jobs). When the list
 * grows we'll push the filters server-side with query params.
 *
 * State owned here (versus in sub-components):
 *   - search / filter inputs (page-level)
 *   - which job rows are expanded (per-page). Keyed by `jobKey` (string)
 *     because `jobKey` is the stable identity across refetches.
 *   - which (contact, channel) pairs have pinned message panels. The
 *     server-side dedup gives each contact a stable `contactId` (the
 *     representative row's id), so pin keys don't thrash across polls.
 *
 * The popover open/close state lives inside MessageViewerPill — it's a
 * per-pill UX detail (click-outside, hover intent) with no cross-row
 * invariants.
 *
 * See .kiro/specs/hired/my-activity-brief.md for the full UX spec.
 */

type Tab = 'all' | 'responses' | 'interviews';
type StatusFilter = 'all' | 'success' | 'in_progress' | 'failed';

/** Key for the pinned-panel set: contactId + channel together are unique. */
function pinKey(contactId: number, channel: 'linkedin' | 'gmail'): string {
  return `${contactId}:${channel}`;
}

export function MyActivityPage() {
  const activity = useActivity();

  const [activeTab, setActiveTab] = useState<Tab>('all');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [pinned, setPinned] = useState<ReadonlySet<string>>(new Set());

  function toggleExpanded(jobKey: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(jobKey)) next.delete(jobKey);
      else next.add(jobKey);
      return next;
    });
  }

  function togglePinned(key: string) {
    setPinned((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Client-side filter chain. Memoized to avoid re-filtering on every
  // keystroke that doesn't change the inputs.
  const filteredJobs = useMemo(() => {
    if (!activity.data) return [];
    const q = search.trim().toLowerCase();
    return activity.data.jobs.filter((job) => {
      // Tab-based pre-filter.
      if (activeTab === 'responses') {
        const hasReply = job.contacts.some(
          (c) =>
            c.timeline.linkedin.some((e) => e.tone === 'replied') ||
            c.timeline.gmail.some((e) => e.tone === 'replied'),
        );
        if (!hasReply) return false;
      }
      if (activeTab === 'interviews') {
        if (!job.markedAsInterview) return false;
      }

      // Status filter (independent of tab).
      if (statusFilter !== 'all') {
        const want: RunStatus =
          statusFilter === 'success'
            ? 'COMPLETED'
            : statusFilter === 'in_progress'
              ? 'IN_PROGRESS'
              : 'FAILED';
        if (job.status !== want) return false;
      }

      // Search substring on company + role.
      if (q.length > 0) {
        const hay = `${job.company} ${job.jobTitle}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });
  }, [activity.data, search, statusFilter, activeTab]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            Job Referral Activity
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Every job you've run the agent on, with the contacts you've
            reached out to. Click a row to expand its contacts.
          </p>
        </div>
        <div className="relative w-72 shrink-0">
          <Search
            className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Company or role…"
            className="h-9 w-full rounded-md border border-slate-200 bg-white pl-8 pr-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none"
          />
        </div>
      </header>

      <TabStrip
        activeTab={activeTab}
        counts={activity.data?.tabCounts}
        onChange={setActiveTab}
      />

      <FilterRow
        statusFilter={statusFilter}
        onStatusChange={setStatusFilter}
      />

      {activity.isError && (
        <ErrorBanner message={activity.error.message} />
      )}

      {activity.isPending ? (
        <LoadingState />
      ) : filteredJobs.length === 0 ? (
        <EmptyState tab={activeTab} hasFilters={search.length > 0 || statusFilter !== 'all'} />
      ) : (
        <ActivityTable
          jobs={filteredJobs}
          expanded={expanded}
          pinned={pinned}
          onToggleExpand={toggleExpanded}
          onTogglePin={togglePinned}
        />
      )}
    </div>
  );
}

// ─── tabs ───────────────────────────────────────────────────────────────────

interface TabStripProps {
  readonly activeTab: Tab;
  readonly counts: { allActivity: number; responses: number; interviews: number } | undefined;
  readonly onChange: (tab: Tab) => void;
}

function TabStrip({ activeTab, counts, onChange }: TabStripProps) {
  const items: ReadonlyArray<{ id: Tab; label: string; count: number }> = [
    { id: 'all', label: 'All Activity', count: counts?.allActivity ?? 0 },
    { id: 'responses', label: 'Responses', count: counts?.responses ?? 0 },
    { id: 'interviews', label: 'Interviews', count: counts?.interviews ?? 0 },
  ];
  return (
    <div className="mb-5 flex gap-1 border-b border-slate-200" role="tablist">
      {items.map((item) => {
        const active = item.id === activeTab;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.id)}
            className={
              '-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors ' +
              (active
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700')
            }
          >
            {item.label}
            <span
              className={
                'inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs ' +
                (active
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600')
              }
            >
              {item.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─── filters ────────────────────────────────────────────────────────────────

interface FilterRowProps {
  readonly statusFilter: StatusFilter;
  readonly onStatusChange: (f: StatusFilter) => void;
}

function FilterRow({ statusFilter, onStatusChange }: FilterRowProps) {
  // Date-range filter is scoped out of v1 (brief § v1 scope cut). Keeping
  // the Run By dropdown as a disabled-looking read-only field matches
  // Happy's layout density without actually filtering on anything (v1 is
  // always Manual per D7).
  return (
    <div className="mb-4 grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-3">
      <FilterField label="Run by">
        <select
          disabled
          value="all"
          className="h-8 w-full cursor-not-allowed rounded-md border border-slate-200 bg-slate-50 px-2 text-sm text-slate-500"
        >
          <option value="all">All runs</option>
        </select>
      </FilterField>
      <FilterField label="Referral Status">
        <select
          value={statusFilter}
          onChange={(e) => onStatusChange(e.target.value as StatusFilter)}
          className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-800 focus:border-slate-400 focus:outline-none"
        >
          <option value="all">All</option>
          <option value="success">Success</option>
          <option value="in_progress">In progress</option>
          <option value="failed">Failed</option>
        </select>
      </FilterField>
      <FilterField label="Last Activity">
        <div className="flex h-8 items-center rounded-md border border-dashed border-slate-200 bg-slate-50 px-2 text-xs text-slate-400">
          Date range filter — coming in Phase 6
        </div>
      </FilterField>
    </div>
  );
}

function FilterField({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      {children}
    </label>
  );
}

// ─── table ──────────────────────────────────────────────────────────────────

interface ActivityTableProps {
  readonly jobs: readonly ActivityJob[];
  readonly expanded: ReadonlySet<string>;
  readonly pinned: ReadonlySet<string>;
  readonly onToggleExpand: (jobKey: string) => void;
  readonly onTogglePin: (key: string) => void;
}

function ActivityTable({
  jobs,
  expanded,
  pinned,
  onToggleExpand,
  onTogglePin,
}: ActivityTableProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="grid grid-cols-[48px_80px_1fr_1fr_140px_140px] border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <div>No.</div>
        <div>Run By</div>
        <div>Company</div>
        <div>Role</div>
        <div>Status</div>
        <div className="text-right">Last Activity</div>
      </div>
      <ul>
        {jobs.map((job, index) => {
          const isExpanded = expanded.has(job.jobKey);
          return (
            <li key={job.jobKey} className="border-b border-slate-100 last:border-b-0">
              <JobRow
                number={index + 1}
                job={job}
                isExpanded={isExpanded}
                onToggleExpand={() => onToggleExpand(job.jobKey)}
              />
              {isExpanded && (
                <ul className="bg-slate-50/60">
                  {job.contacts.length === 0 ? (
                    <li className="px-6 py-4 text-xs text-slate-500">
                      No contacts recorded for this job yet.
                    </li>
                  ) : (
                    job.contacts.map((contact, i) => (
                      <ContactRowAndPins
                        key={contact.contactId}
                        number={i + 1}
                        contact={contact}
                        pinned={pinned}
                        onTogglePin={onTogglePin}
                      />
                    ))
                  )}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── job row ────────────────────────────────────────────────────────────────

interface JobRowProps {
  readonly number: number;
  readonly job: ActivityJob;
  readonly isExpanded: boolean;
  readonly onToggleExpand: () => void;
}

function JobRow({ number, job, isExpanded, onToggleExpand }: JobRowProps) {
  return (
    <div
      className="grid cursor-pointer grid-cols-[48px_80px_1fr_1fr_140px_140px] items-center px-4 py-3 transition-colors hover:bg-slate-50"
      onClick={onToggleExpand}
    >
      <div className="text-sm text-slate-500">{number}</div>
      <RunByPill />
      <div className="flex min-w-0 items-center gap-2">
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
        )}
        <span className="truncate text-sm font-medium text-slate-800">
          {job.company}
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-1">
        <a
          href={job.jobUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex min-w-0 items-center gap-1 truncate text-sm font-medium text-slate-700 underline-offset-2 hover:text-slate-900 hover:underline"
        >
          <span className="truncate">{job.jobTitle}</span>
          <ExternalLink className="h-3 w-3 shrink-0 text-slate-400" aria-hidden="true" />
        </a>
      </div>
      <div>
        <RunStatusBadge status={job.status} />
      </div>
      <div className="text-right text-xs leading-tight text-slate-500">
        <LastActivityCell at={job.lastActivity} />
      </div>
    </div>
  );
}

function RunByPill() {
  // v1 is always Manual (D7 — no auto-run yet). The pill still ships to
  // match Happy Agent's visual density.
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700">
      <User className="h-3 w-3" aria-hidden="true" />
      You
    </span>
  );
}

function RunStatusBadge({ status }: { readonly status: RunStatus }) {
  if (status === 'COMPLETED') {
    return <Badge tone="success">COMPLETED</Badge>;
  }
  if (status === 'IN_PROGRESS') {
    return <Badge tone="warning">IN PROGRESS</Badge>;
  }
  return <Badge tone="danger">FAILED</Badge>;
}

function LastActivityCell({ at }: { readonly at: string }) {
  const d = new Date(at);
  // "30 Sept 2026" / "at 7:52 PM" — matches Happy's two-line layout.
  const date = d.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  return (
    <>
      <div className="text-sm text-slate-700">{date}</div>
      <div className="text-xs text-slate-400">at {time}</div>
    </>
  );
}

// ─── contact row (expanded under a job) ────────────────────────────────────

interface ContactRowAndPinsProps {
  readonly number: number;
  readonly contact: ActivityContact;
  readonly pinned: ReadonlySet<string>;
  readonly onTogglePin: (key: string) => void;
}

function ContactRowAndPins({
  number,
  contact,
  pinned,
  onTogglePin,
}: ContactRowAndPinsProps) {
  const emailKey = pinKey(contact.contactId, 'gmail');
  const linkedinKey = pinKey(contact.contactId, 'linkedin');
  const emailPinned = pinned.has(emailKey);
  const linkedinPinned = pinned.has(linkedinKey);

  return (
    <li className="border-t border-slate-100 first:border-t-0 px-6 py-3">
      <div className="flex items-start gap-4">
        <div className="w-6 text-right text-xs font-medium text-slate-400 tabular-nums">
          {String(number).padStart(2, '0')}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-slate-900">
            {contact.name}
          </div>
          {contact.title && (
            <div className="truncate text-xs text-slate-500">{contact.title}</div>
          )}
        </div>
        <ContactChannels
          contact={contact}
          pinnedKeys={pinned}
          onTogglePin={onTogglePin}
        />
      </div>

      {/* Pinned panels live inline below the row. Both can be present
          simultaneously — Email first (matches Happy's visual rank). */}
      {emailPinned && (
        <PinnedMessagePanel
          channel="gmail"
          timeline={contact.timeline.gmail}
          body={null /* Phase 4.4 — Gmail body not stored today */}
          linkedinUrl={null}
          onUnpin={() => onTogglePin(emailKey)}
        />
      )}
      {linkedinPinned && (
        <PinnedMessagePanel
          channel="linkedin"
          timeline={contact.timeline.linkedin}
          body={contact.linkedinDmDraft}
          linkedinUrl={contact.linkedinUrl}
          onUnpin={() => onTogglePin(linkedinKey)}
        />
      )}
    </li>
  );
}

// ─── channel pills (email + linkedin) ──────────────────────────────────────

interface ContactChannelsProps {
  readonly contact: ActivityContact;
  readonly pinnedKeys: ReadonlySet<string>;
  readonly onTogglePin: (key: string) => void;
}

function ContactChannels({
  contact,
  pinnedKeys,
  onTogglePin,
}: ContactChannelsProps) {
  // Only render pills for channels the contact was actually selected for
  // in SOME run (server unions the flag across the dedupe bucket). If
  // neither channel was ever selected, show a quieter "Not contacted"
  // instead of empty space — makes discovery-only rows legible.
  if (!contact.selectedForGmail && !contact.selectedForLinkedin) {
    return (
      <div className="shrink-0 text-xs italic text-slate-400">
        Not contacted
      </div>
    );
  }
  return (
    <div className="flex shrink-0 items-center gap-2">
      <span className="text-xs text-slate-400">Contacted Via:</span>
      {contact.selectedForGmail && (
        <MessageViewerPill
          channel="gmail"
          timeline={contact.timeline.gmail}
          body={null /* Phase 4.4 */}
          linkedinUrl={null}
          isPinned={pinnedKeys.has(pinKey(contact.contactId, 'gmail'))}
          onTogglePin={() => onTogglePin(pinKey(contact.contactId, 'gmail'))}
          renderPill={({ isOpen, onClick }) => (
            <EmailPill
              email={contact.email}
              verified={contact.emailVerified}
              isActive={isOpen || pinnedKeys.has(pinKey(contact.contactId, 'gmail'))}
              onClick={onClick}
            />
          )}
        />
      )}
      {contact.selectedForLinkedin && (
        <MessageViewerPill
          channel="linkedin"
          timeline={contact.timeline.linkedin}
          body={contact.linkedinDmDraft}
          linkedinUrl={contact.linkedinUrl}
          isPinned={pinnedKeys.has(pinKey(contact.contactId, 'linkedin'))}
          onTogglePin={() => onTogglePin(pinKey(contact.contactId, 'linkedin'))}
          renderPill={({ isOpen, onClick }) => (
            <LinkedinPill
              status={contact.linkedinStatus}
              isActive={isOpen || pinnedKeys.has(pinKey(contact.contactId, 'linkedin'))}
              onClick={onClick}
            />
          )}
        />
      )}
    </div>
  );
}

function EmailPill({
  email,
  verified,
  isActive,
  onClick,
}: {
  readonly email: string | null;
  readonly verified: boolean;
  readonly isActive: boolean;
  readonly onClick: () => void;
}) {
  // "No email" means the finder couldn't resolve one; still render the
  // pill so the user can see the dead end + popover timeline (which will
  // be empty) rather than hiding what we tried.
  const dotClass = verified
    ? 'bg-emerald-500 ring-emerald-200'
    : email
      ? 'bg-amber-500 ring-amber-200'
      : 'bg-slate-300 ring-slate-200';
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors ' +
        (isActive
          ? 'border-slate-400 bg-slate-50 text-slate-900'
          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300')
      }
    >
      <Mail className="h-3 w-3 text-slate-400" aria-hidden="true" />
      <span className="max-w-[200px] truncate">{email ?? 'No email'}</span>
      <span
        className={`inline-block h-2 w-2 rounded-full ring-2 ${dotClass}`}
        aria-hidden="true"
      />
    </button>
  );
}

function LinkedinPill({
  status,
  isActive,
  onClick,
}: {
  readonly status: LinkedinStatus;
  readonly isActive: boolean;
  readonly onClick: () => void;
}) {
  // Status → dot color (my-activity-brief.md § LinkedIn pill shape).
  const dotClass = LINKEDIN_DOT_BY_STATUS[status];
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors ' +
        (isActive
          ? 'border-slate-400 bg-slate-50 text-slate-900'
          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300')
      }
    >
      <Linkedin className="h-3 w-3 text-slate-400" aria-hidden="true" />
      <span>LinkedIn</span>
      <ExternalLink className="h-3 w-3 text-slate-400" aria-hidden="true" />
      <span
        className={`inline-block h-2 w-2 rounded-full ring-2 ${dotClass}`}
        aria-hidden="true"
      />
    </button>
  );
}

const LINKEDIN_DOT_BY_STATUS: Record<LinkedinStatus, string> = {
  PENDING: 'bg-slate-300 ring-slate-200',
  CONNECT_DRAFTED: 'bg-amber-500 ring-amber-200',
  CONNECT_SENT: 'bg-amber-500 ring-amber-200',
  CONNECTED: 'bg-amber-500 ring-amber-200',
  DM_DRAFTED: 'bg-amber-500 ring-amber-200',
  DM_SENT: 'bg-emerald-500 ring-emerald-200',
  REPLIED: 'bg-emerald-500 ring-emerald-200',
  DECLINED: 'bg-rose-500 ring-rose-200',
  SKIPPED: 'bg-slate-400 ring-slate-200',
};

// ─── placeholder / empty / error states ────────────────────────────────────

function LoadingState() {
  return (
    <div className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-6 py-10 text-sm text-slate-500">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      Loading activity…
    </div>
  );
}

function EmptyState({
  tab,
  hasFilters,
}: {
  readonly tab: Tab;
  readonly hasFilters: boolean;
}) {
  let title: string;
  let hint: string;
  if (hasFilters) {
    title = 'No results';
    hint = 'Nothing matches the current search + status filters. Clear them to see more.';
  } else if (tab === 'responses') {
    title = 'No responses yet';
    hint = 'When someone replies to an outreach, their job shows up here.';
  } else if (tab === 'interviews') {
    title = 'No interviews yet';
    hint = 'Mark a job as "Interview" from its activity row to track interview-leading referrals here. (Button lands in Phase 6.)';
  } else {
    title = 'No activity yet';
    hint = 'Alt+H on a Happy Agent job → Run Agent → Send. Jobs appear here as soon as they land.';
  }
  return (
    <div className="rounded-lg border border-dashed border-slate-200 bg-white px-6 py-12 text-center">
      <Users className="mx-auto h-8 w-8 text-slate-300" aria-hidden="true" />
      <div className="mt-3 text-sm font-medium text-slate-700">{title}</div>
      <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">{hint}</p>
    </div>
  );
}

function ErrorBanner({ message }: { readonly message: string }) {
  return (
    <div className="mb-4 flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div>Couldn't load activity. {message}</div>
    </div>
  );
}
