import type { DiscoveredContactView, Channels } from '../../shared/api/agent.js';
import { ContactRow } from './ContactRow.js';

interface ContactListProps {
  readonly contacts: readonly DiscoveredContactView[];
  readonly channels: Channels;
  readonly selectedIds: ReadonlySet<number>;
  readonly onToggle: (id: number) => void;
  readonly onToggleAll: () => void;
}

/**
 * Table-of-contacts for the Run Agent review surface.
 *
 * Columns adapt to the chosen channels — a LinkedIn-only run hides the Email
 * column entirely, and vice versa. "Select all" in the header toggles every
 * row.
 */
export function ContactList({
  contacts,
  channels,
  selectedIds,
  onToggle,
  onToggleAll,
}: ContactListProps) {
  const allSelected =
    contacts.length > 0 && contacts.every((v) => selectedIds.has(v.contact.id));
  const noneSelected = selectedIds.size === 0;

  const showEmail = channels !== 'linkedin';
  const showLinkedin = channels !== 'gmail';

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <table className="w-full table-fixed">
        <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
          <tr>
            <th className="w-10 px-3 py-2">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = !allSelected && !noneSelected;
                }}
                onChange={onToggleAll}
                aria-label="Select all contacts"
              />
            </th>
            <th className="px-3 py-2">Contact</th>
            {showEmail && <th className="w-[36%] px-3 py-2">Email</th>}
            {showLinkedin && <th className="w-32 px-3 py-2">LinkedIn</th>}
          </tr>
        </thead>
        <tbody>
          {contacts.map((view) => (
            <ContactRow
              key={view.contact.id}
              view={view}
              channels={channels}
              selected={selectedIds.has(view.contact.id)}
              onToggle={() => onToggle(view.contact.id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
