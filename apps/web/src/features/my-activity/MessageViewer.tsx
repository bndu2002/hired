import { useEffect, useRef, useState } from 'react';
import {
  Check,
  ExternalLink,
  Pin,
  PinOff,
  X,
  Ban,
  type LucideIcon,
} from 'lucide-react';
import type {
  TimelineEntry,
  TimelineTone,
} from '../../shared/api/activity.js';

/**
 * The message viewer attached to a channel pill. Two mutually exclusive
 * presentations:
 *
 *   1. **Popover** — opened on pill click, floats to the right of the
 *      pill, closes on outside click or when the user pins it.
 *   2. **Pinned inline panel** — rendered below the contact row via the
 *      parent (MyActivityPage), independent of this component's open
 *      state. Promoted from a popover via "Click to pin full message".
 *
 * Why this component owns pop-open state but NOT pinned state:
 * - Popover open/closed is a per-pill UX detail (click-outside, hover
 *   intent, etc.) — belongs to the pill that triggered it.
 * - Pinned panels are a page-level concept (multiple can coexist,
 *   survive if the user collapses the parent row, don't close on outside
 *   clicks) — belongs to MyActivityPage.
 *
 * The two bodies share markup via `renderBody()`; the popover wraps it
 * in an absolute-positioned container, the pinned view wraps it in an
 * inline card.
 */

export type MessageViewerChannel = 'linkedin' | 'gmail';

export interface MessageViewerProps {
  readonly channel: MessageViewerChannel;
  readonly timeline: readonly TimelineEntry[];
  /**
   * The actual sent body. Null means "not stored" — for Gmail this is
   * the Phase 4.4 placeholder case (see my-activity-brief.md § MESSAGE).
   */
  readonly body: string | null;
  /**
   * Where to open the profile / message thread on LinkedIn. null for Gmail
   * (no LinkedIn URL for an email-only contact) — the "Open on LinkedIn"
   * link is hidden in that case.
   */
  readonly linkedinUrl: string | null;
  readonly isPinned: boolean;
  readonly onTogglePin: () => void;
  /** The clickable pill the popover anchors to. */
  readonly renderPill: (props: {
    isOpen: boolean;
    onClick: () => void;
  }) => React.ReactNode;
}

/**
 * Pill + popover. The pinned-inline body is rendered elsewhere (by the
 * parent) via `renderPinnedBody()` export below — same body shape, no
 * popover wrapper.
 */
export function MessageViewerPill(props: MessageViewerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close popover on outside click. We only wire the listener while open
  // so the normal (closed) case doesn't pay anything.
  useEffect(() => {
    if (!isOpen) return;
    function onDocMouseDown(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [isOpen]);

  function togglePopover() {
    // If pinned already, clicking the pill doesn't do anything new — the
    // pinned panel is already showing the content. Keep the pill
    // interactive (not disabled) so unpin + repin flows feel natural;
    // just no-op the popover.
    if (props.isPinned) return;
    setIsOpen((v) => !v);
  }

  function handlePin() {
    props.onTogglePin();
    setIsOpen(false);
  }

  return (
    <div ref={containerRef} className="relative inline-block">
      {props.renderPill({ isOpen, onClick: togglePopover })}
      {isOpen && (
        <div
          role="dialog"
          className="absolute right-0 top-full z-30 mt-1.5 w-96 rounded-lg border border-slate-200 bg-white p-3 shadow-lg"
        >
          <MessageBody
            timeline={props.timeline}
            body={props.body}
            channel={props.channel}
            linkedinUrl={props.linkedinUrl}
            footer={
              <button
                type="button"
                onClick={handlePin}
                className="flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900"
              >
                <Pin className="h-3 w-3" aria-hidden="true" />
                Click to pin full message
              </button>
            }
          />
        </div>
      )}
    </div>
  );
}

/**
 * The inline pinned panel. Rendered by MyActivityPage directly below the
 * contact row; MyActivityPage owns the pinned-set state. We re-use the
 * same MessageBody internals so the pinned view looks identical to the
 * popover minus positioning + the pin-footer swap.
 */
export function PinnedMessagePanel({
  channel,
  timeline,
  body,
  linkedinUrl,
  onUnpin,
}: {
  readonly channel: MessageViewerChannel;
  readonly timeline: readonly TimelineEntry[];
  readonly body: string | null;
  readonly linkedinUrl: string | null;
  readonly onUnpin: () => void;
}) {
  return (
    <div className="relative mt-1 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <button
        type="button"
        onClick={onUnpin}
        aria-label="Close pinned message"
        className="absolute right-2 top-2 rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <MessageBody
        timeline={timeline}
        body={body}
        channel={channel}
        linkedinUrl={linkedinUrl}
        footer={
          <div className="flex items-center gap-1 text-xs text-slate-500">
            <PinOff className="h-3 w-3" aria-hidden="true" />
            Pinned — click × to collapse
          </div>
        }
      />
    </div>
  );
}

// ─── shared body (timeline + MESSAGE + footer) ─────────────────────────────

interface MessageBodyProps {
  readonly channel: MessageViewerChannel;
  readonly timeline: readonly TimelineEntry[];
  readonly body: string | null;
  readonly linkedinUrl: string | null;
  readonly footer: React.ReactNode;
}

function MessageBody({
  channel,
  timeline,
  body,
  linkedinUrl,
  footer,
}: MessageBodyProps) {
  return (
    <div className="space-y-3">
      {timeline.length > 0 ? (
        <ul className="space-y-1">
          {timeline.map((entry, i) => (
            <TimelineRow key={`${entry.label}-${entry.at}-${i}`} entry={entry} />
          ))}
        </ul>
      ) : (
        <div className="text-xs text-slate-400">No activity yet.</div>
      )}

      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          Message
        </div>
        {body ? (
          <pre className="mt-1 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-md border border-slate-100 bg-slate-50 p-2 font-sans text-sm leading-relaxed text-slate-700">
            {body}
          </pre>
        ) : (
          // Phase 4.4 placeholder for Gmail: body isn't stored today because
          // dispatch hasn't landed. For LinkedIn, null body would mean the
          // auto-draft hasn't run yet (CONNECT_SENT state, awaiting accept).
          <div className="mt-1 rounded-md border border-dashed border-slate-200 bg-slate-50 p-2 text-xs italic text-slate-500">
            {channel === 'gmail'
              ? 'Email not dispatched yet. Gmail dispatch arrives in Phase 4.4.'
              : 'No draft yet — the DM auto-drafts after the connect is accepted.'}
          </div>
        )}
      </div>

      {channel === 'linkedin' && linkedinUrl && (
        <a
          href={linkedinUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900"
        >
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
          Open profile on LinkedIn
        </a>
      )}

      <div className="border-t border-slate-100 pt-2">{footer}</div>
    </div>
  );
}

// ─── timeline row ──────────────────────────────────────────────────────────

const TONE_STYLES: Record<
  TimelineTone,
  { icon: LucideIcon; iconClass: string; tag: string; tagClass: string }
> = {
  done: {
    icon: Check,
    iconClass: 'text-emerald-600',
    tag: 'Done',
    tagClass: 'text-emerald-700',
  },
  replied: {
    icon: Check,
    iconClass: 'text-emerald-600',
    tag: 'Received',
    tagClass: 'text-emerald-700',
  },
  skipped: {
    icon: Ban,
    iconClass: 'text-slate-400',
    tag: 'Skipped',
    tagClass: 'text-slate-500',
  },
  bounced: {
    icon: X,
    iconClass: 'text-rose-600',
    tag: 'Bounced',
    tagClass: 'text-rose-700',
  },
};

function TimelineRow({ entry }: { readonly entry: TimelineEntry }) {
  const style = TONE_STYLES[entry.tone];
  const Icon = style.icon;
  return (
    <li className="flex items-center justify-between gap-2 text-sm">
      <div className="flex items-center gap-2">
        <Icon className={`h-3.5 w-3.5 ${style.iconClass}`} aria-hidden={true} />
        <span className="text-slate-700">{entry.label}</span>
      </div>
      <span className={`text-xs font-medium ${style.tagClass}`}>
        {style.tag}
      </span>
    </li>
  );
}
