import { useState } from 'react';
import {
  AlertCircle,
  Check,
  Clipboard,
  ClipboardCheck,
  ExternalLink,
  Linkedin,
  Loader2,
  Send,
  Ban,
} from 'lucide-react';
import {
  useLinkedinQueue,
  useMarkSent,
  useMarkSkipped,
  type MarkSentKind,
  type QueueConnectItem,
  type QueueDmItem,
} from '../../shared/api/linkedinQueue.js';
import { Badge } from '../../shared/components/Badge.js';
import { Button } from '../../shared/components/Button.js';

/**
 * LinkedIn Queue — the control surface for D1-compliant outreach.
 *
 * Two tabs:
 *   Connect : contacts in CONNECT_DRAFTED. Vandana opens LinkedIn, sends
 *             the connect request manually, hits "Mark sent" here.
 *   DM      : contacts in DM_DRAFTED (the inbound poller auto-rendered
 *             their draft when their acceptance email landed). Vandana
 *             copies the draft, opens LinkedIn messaging, pastes + sends,
 *             hits "Mark sent" here.
 *
 * Nothing on this page clicks LinkedIn or scripts the browser (D1).
 * Opening the profile uses a plain `window.open` into a new tab; the user
 * is in control of every network interaction on linkedin.com itself.
 *
 * The page re-fetches every 10s so a newly-arrived acceptance (which the
 * server poll detects within 60s) surfaces here within a tick or two.
 */

type Tab = 'connect' | 'dm';

export function LinkedinQueuePage() {
  const [activeTab, setActiveTab] = useState<Tab>('connect');
  const queueQuery = useLinkedinQueue();

  const connectCount = queueQuery.data?.connect.length ?? 0;
  const dmCount = queueQuery.data?.dm.length ?? 0;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">LinkedIn Queue</h1>
        <p className="mt-1 text-sm text-slate-500">
          Open each profile on LinkedIn, send the connect request or paste the
          draft, then mark it sent here. Nothing is sent automatically.
        </p>
      </header>

      <TabStrip
        activeTab={activeTab}
        connectCount={connectCount}
        dmCount={dmCount}
        onChange={setActiveTab}
      />

      {queueQuery.isError && (
        <ErrorBanner message={queueQuery.error.message} />
      )}

      {queueQuery.isPending ? (
        <LoadingState />
      ) : activeTab === 'connect' ? (
        <ConnectList items={queueQuery.data?.connect ?? []} />
      ) : (
        <DmList items={queueQuery.data?.dm ?? []} />
      )}
    </div>
  );
}

// ─── tabs ───────────────────────────────────────────────────────────────────

interface TabStripProps {
  readonly activeTab: Tab;
  readonly connectCount: number;
  readonly dmCount: number;
  readonly onChange: (tab: Tab) => void;
}

function TabStrip({
  activeTab,
  connectCount,
  dmCount,
  onChange,
}: TabStripProps) {
  return (
    <div
      className="mb-6 flex gap-1 border-b border-slate-200"
      role="tablist"
      aria-label="Queue sections"
    >
      <TabButton
        active={activeTab === 'connect'}
        onClick={() => onChange('connect')}
        label="Connect"
        count={connectCount}
      />
      <TabButton
        active={activeTab === 'dm'}
        onClick={() => onChange('dm')}
        label="DM"
        count={dmCount}
      />
    </div>
  );
}

interface TabButtonProps {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly label: string;
  readonly count: number;
}

function TabButton({ active, onClick, label, count }: TabButtonProps) {
  const base =
    '-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors';
  const activeClasses = 'border-slate-900 text-slate-900';
  const inactiveClasses =
    'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700';
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`${base} ${active ? activeClasses : inactiveClasses}`}
    >
      {label}
      <span
        className={
          'inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs ' +
          (active
            ? 'bg-slate-900 text-white'
            : 'bg-slate-100 text-slate-600')
        }
      >
        {count}
      </span>
    </button>
  );
}

// ─── lists ──────────────────────────────────────────────────────────────────

function ConnectList({ items }: { readonly items: readonly QueueConnectItem[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="No pending connects"
        hint="Items appear here after you Send on a run. The agent writes them in CONNECT_DRAFTED; this tab lists them."
      />
    );
  }
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.contactId}>
          <ConnectCard item={item} />
        </li>
      ))}
    </ul>
  );
}

function DmList({ items }: { readonly items: readonly QueueDmItem[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="No DMs ready to send"
        hint="A DM lands here after someone accepts your connect request. The agent auto-drafts the message against your Configure template."
      />
    );
  }
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.contactId}>
          <DmCard item={item} />
        </li>
      ))}
    </ul>
  );
}

// ─── cards ──────────────────────────────────────────────────────────────────

interface ContactHeaderProps {
  readonly name: string;
  readonly title: string | null;
  readonly companyName: string;
  readonly jobTitle: string;
}

function ContactHeader({
  name,
  title,
  companyName,
  jobTitle,
}: ContactHeaderProps) {
  return (
    <div className="min-w-0 flex-1">
      <div className="truncate text-sm font-semibold text-slate-900">
        {name}
      </div>
      {title && (
        <div className="truncate text-xs text-slate-500">{title}</div>
      )}
      <div className="mt-1 text-xs text-slate-500">
        Re:{' '}
        <span className="font-medium text-slate-700">{jobTitle}</span> at{' '}
        <span className="font-medium text-slate-700">{companyName}</span>
      </div>
    </div>
  );
}

function ConnectCard({ item }: { readonly item: QueueConnectItem }) {
  const markSent = useMarkSent();

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start gap-3">
        <Linkedin
          className="mt-0.5 h-5 w-5 shrink-0 text-slate-400"
          aria-hidden="true"
        />
        <ContactHeader
          name={item.name}
          title={item.title}
          companyName={item.companyName}
          jobTitle={item.jobTitle}
        />
        <Badge tone="warning">CONNECT_DRAFTED</Badge>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          leading={<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />}
          onClick={() =>
            window.open(item.linkedinUrl, '_blank', 'noopener,noreferrer')
          }
        >
          Open on LinkedIn
        </Button>
        <Button
          variant="primary"
          size="sm"
          leading={
            markSent.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
            )
          }
          disabled={markSent.isPending}
          onClick={() =>
            markSent.mutate({ contactId: item.contactId, kind: 'connect' })
          }
        >
          Mark connect sent
        </Button>
      </div>

      {markSent.isError && (
        <MutationErrorRow error={markSent.error} kind="connect" />
      )}
    </div>
  );
}

function DmCard({ item }: { readonly item: QueueDmItem }) {
  const markSent = useMarkSent();
  const markSkipped = useMarkSkipped();
  const [copied, setCopied] = useState(false);
  // Two-click Skip: first click arms a confirmation row, second click fires
  // the mutation. Avoids a misclick turning into a quiet state transition
  // on a terminal state (SKIPPED). Local state only — nothing persisted.
  const [confirmingSkip, setConfirmingSkip] = useState(false);

  async function copyDraft() {
    try {
      await navigator.clipboard.writeText(item.draft);
      setCopied(true);
      // Reset the Copied! label after 2s so repeat clicks give feedback.
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can fail in insecure contexts. localhost is secure,
      // so this branch is defensive — show the label anyway, user is likely
      // on a weird setup.
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start gap-3">
        <Linkedin
          className="mt-0.5 h-5 w-5 shrink-0 text-slate-400"
          aria-hidden="true"
        />
        <ContactHeader
          name={item.name}
          title={item.title}
          companyName={item.companyName}
          jobTitle={item.jobTitle}
        />
        <Badge tone="info">DM_DRAFTED</Badge>
      </div>

      {/* Rendered draft — pre so the newlines in templates render as-is. */}
      <pre className="mt-3 whitespace-pre-wrap rounded-md border border-slate-100 bg-slate-50 p-3 font-sans text-sm leading-relaxed text-slate-700">
        {item.draft}
      </pre>

      {confirmingSkip ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-rose-200 bg-rose-50 p-2 text-sm text-rose-800">
          <span className="font-medium">Skip {item.name}?</span>
          <span className="text-xs text-rose-700">
            Status flips to SKIPPED. No DM will be sent.
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              disabled={markSkipped.isPending}
              onClick={() => setConfirmingSkip(false)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              leading={
                markSkipped.isPending ? (
                  <Loader2
                    className="h-3.5 w-3.5 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                )
              }
              disabled={markSkipped.isPending}
              onClick={() =>
                markSkipped.mutate(
                  { contactId: item.contactId, kind: 'dm' },
                  {
                    onSuccess: () => {
                      // Invalidate will remove the card from the list;
                      // local state reset is defensive in case the mutation
                      // succeeds but the invalidation refetch takes a tick.
                      setConfirmingSkip(false);
                    },
                  },
                )
              }
            >
              Yes, skip
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            leading={
              copied ? (
                <ClipboardCheck
                  className="h-3.5 w-3.5 text-emerald-600"
                  aria-hidden="true"
                />
              ) : (
                <Clipboard className="h-3.5 w-3.5" aria-hidden="true" />
              )
            }
            onClick={copyDraft}
          >
            {copied ? 'Copied' : 'Copy draft'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            leading={
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            }
            onClick={() =>
              window.open(item.linkedinUrl, '_blank', 'noopener,noreferrer')
            }
          >
            Open on LinkedIn
          </Button>
          <Button
            variant="primary"
            size="sm"
            leading={
              markSent.isPending ? (
                <Loader2
                  className="h-3.5 w-3.5 animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
              )
            }
            disabled={markSent.isPending}
            onClick={() =>
              markSent.mutate({ contactId: item.contactId, kind: 'dm' })
            }
          >
            Mark DM sent
          </Button>
          <Button
            variant="ghost"
            size="sm"
            leading={<Ban className="h-3.5 w-3.5" aria-hidden="true" />}
            onClick={() => setConfirmingSkip(true)}
            title="Decide not to send this DM. Marks the contact SKIPPED (terminal)."
          >
            Skip
          </Button>
        </div>
      )}

      {markSent.isError && (
        <MutationErrorRow error={markSent.error} kind="dm" />
      )}
      {markSkipped.isError && (
        <SkipErrorRow error={markSkipped.error} name={item.name} />
      )}
    </div>
  );
}

// ─── sub-UI ────────────────────────────────────────────────────────────────

function EmptyState({
  title,
  hint,
}: {
  readonly title: string;
  readonly hint: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-slate-200 bg-white px-6 py-10 text-center">
      <div className="text-sm font-medium text-slate-700">{title}</div>
      <p className="mx-auto mt-2 max-w-md text-xs text-slate-500">{hint}</p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-6 py-10 text-sm text-slate-500">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      Loading queue…
    </div>
  );
}

function ErrorBanner({ message }: { readonly message: string }) {
  return (
    <div className="mb-4 flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div>Couldn't load the queue. {message}</div>
    </div>
  );
}

function MutationErrorRow({
  error,
  kind,
}: {
  readonly error: Error;
  readonly kind: MarkSentKind;
}) {
  return (
    <div className="mt-3 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <div>
        Couldn't mark {kind === 'dm' ? 'DM' : 'connect'} sent. {error.message}
      </div>
    </div>
  );
}

function SkipErrorRow({
  error,
  name,
}: {
  readonly error: Error;
  readonly name: string;
}) {
  return (
    <div className="mt-3 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <div>
        Couldn't skip {name}. {error.message}
      </div>
    </div>
  );
}
