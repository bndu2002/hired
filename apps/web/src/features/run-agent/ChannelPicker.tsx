import { Mail, Linkedin, Layers } from 'lucide-react';
import type { Channels } from '../../shared/api/agent.js';

interface ChannelPickerProps {
  readonly value: Channels;
  readonly onChange: (value: Channels) => void;
  readonly disabled?: boolean;
}

interface Option {
  readonly value: Channels;
  readonly label: string;
  readonly description: string;
  readonly Icon: typeof Mail;
}

const OPTIONS: readonly Option[] = [
  {
    value: 'both',
    label: 'Both',
    description: 'Email where verified, LinkedIn otherwise',
    Icon: Layers,
  },
  {
    value: 'gmail',
    label: 'Gmail only',
    description: 'Email only; skip contacts without a verified address',
    Icon: Mail,
  },
  {
    value: 'linkedin',
    label: 'LinkedIn only',
    description: 'Connect request + DM-after-accept',
    Icon: Linkedin,
  },
];

/**
 * Segmented control for the run's outreach channels. Three mutually
 * exclusive options; the chosen value drives whether the orchestrator
 * fires the email finder chain and which channels show in each row's pills.
 */
export function ChannelPicker({ value, onChange, disabled }: ChannelPickerProps) {
  return (
    <fieldset
      className="flex gap-2"
      aria-label="Outreach channels"
      disabled={disabled}
    >
      {OPTIONS.map((opt) => {
        const selected = opt.value === value;
        return (
          <label
            key={opt.value}
            className={[
              'flex min-w-0 flex-1 cursor-pointer items-start gap-2 rounded-lg border p-3 transition',
              selected
                ? 'border-slate-900 bg-slate-50 ring-1 ring-slate-900'
                : 'border-slate-200 bg-white hover:border-slate-300',
              disabled ? 'cursor-not-allowed opacity-60' : '',
            ].join(' ')}
          >
            <input
              type="radio"
              className="sr-only"
              name="channels"
              value={opt.value}
              checked={selected}
              onChange={() => onChange(opt.value)}
            />
            <opt.Icon
              className={`mt-0.5 h-4 w-4 shrink-0 ${selected ? 'text-slate-900' : 'text-slate-400'}`}
              aria-hidden="true"
            />
            <div className="min-w-0">
              <div className="text-sm font-medium text-slate-900">{opt.label}</div>
              <div className="text-xs text-slate-500">{opt.description}</div>
            </div>
          </label>
        );
      })}
    </fieldset>
  );
}
