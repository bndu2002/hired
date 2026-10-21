import {
  CheckCircle2,
  AlertCircle,
  Mail,
  Linkedin,
  ExternalLink,
  History,
} from 'lucide-react';
import type { DiscoveredContactView, Channels } from '../../shared/api/agent.js';
import { Badge } from '../../shared/components/Badge.js';

interface ContactRowProps {
  readonly view: DiscoveredContactView;
  readonly channels: Channels;
  readonly selected: boolean;
  readonly onToggle: () => void;
}

/**
 * One row in the discovered-contacts table.
 *
 * Visual rules:
 *   - Checkbox state mirrors parent `selected`. Previously-contacted rows
 *     default to unselected (parent sets it so).
 *   - Email cell shows: address + verified/unverified/catch-all badge.
 *     `email === null` + `email_found_via === null` → "not found".
 *   - Channel availability pills follow the active `channels` setting
 *     to avoid showing Gmail capability on a LinkedIn-only run.
 */
export function ContactRow({ view, channels, selected, onToggle }: ContactRowProps) {
  const { contact, previouslyContacted } = view;
  const emailShown = channels !== 'linkedin';
  const linkedinShown = channels !== 'gmail';

  return (
    <tr
      className={`border-b border-slate-100 transition-colors ${selected ? 'bg-slate-50' : 'hover:bg-slate-50/60'}`}
    >
      <td className="w-10 px-3 py-3 align-top">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500"
          checked={selected}
          onChange={onToggle}
          aria-label={`Select ${contact.name}`}
        />
      </td>

      <td className="min-w-0 px-3 py-3 align-top">
        <div className="truncate text-sm font-medium text-slate-900">
          {contact.name}
        </div>
        {contact.title && (
          <div className="mt-0.5 truncate text-xs text-slate-500">
            {contact.title}
            {contact.tenureHint ? ` · ${contact.tenureHint}` : ''}
          </div>
        )}
        {previouslyContacted && (
          <div className="mt-1.5">
            <Badge tone="info" leading={<History className="h-3 w-3" aria-hidden="true" />}>
              Previously contacted · run #{previouslyContacted.lastRunId}
            </Badge>
          </div>
        )}
      </td>

      {emailShown && (
        <td className="min-w-0 px-3 py-3 align-top text-sm">
          <EmailCell contact={contact} />
        </td>
      )}

      {linkedinShown && (
        <td className="px-3 py-3 align-top text-sm">
          {contact.linkedinUrl ? (
            <a
              href={contact.linkedinUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-slate-700 hover:text-slate-900"
            >
              <Linkedin className="h-3.5 w-3.5" aria-hidden="true" />
              Open profile
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          ) : (
            <span className="text-slate-400">—</span>
          )}
        </td>
      )}
    </tr>
  );
}

// ─── email cell ──────────────────────────────────────────────────────────────

function EmailCell({ contact }: { contact: DiscoveredContactView['contact'] }) {
  if (!contact.email) {
    return <span className="text-slate-400">Not found</span>;
  }

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <Mail className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
        <span className="truncate font-mono text-xs text-slate-700">
          {contact.email}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {contact.emailVerified ? (
          <Badge
            tone="success"
            leading={<CheckCircle2 className="h-3 w-3" aria-hidden="true" />}
            title={
              contact.emailVerifiedVia
                ? `Verified via ${contact.emailVerifiedVia}`
                : 'Verified'
            }
          >
            Verified
          </Badge>
        ) : (
          <Badge
            tone="warning"
            leading={<AlertCircle className="h-3 w-3" aria-hidden="true" />}
            title="Deliverability unconfirmed. Review before sending."
          >
            Unverified
          </Badge>
        )}
        {contact.emailFoundVia && (
          <Badge tone="neutral" title={`Found via ${contact.emailFoundVia}`}>
            {contact.emailFoundVia}
          </Badge>
        )}
      </div>
    </div>
  );
}
