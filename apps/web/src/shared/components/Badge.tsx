import type { ReactNode } from 'react';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

interface BadgeProps {
  readonly tone?: Tone;
  readonly leading?: ReactNode;
  readonly children: ReactNode;
  readonly title?: string;
}

/**
 * Small status pill. Colors carry semantic meaning — see each tone below.
 *
 * Keep usage sparing. If a dashboard turns into a disco of pills, something
 * is wrong at the information-density layer, not the badge layer.
 */
const TONE_CLASSES: Record<Tone, string> = {
  // Default — just a label. Use for things like "Pattern Heuristic" or run IDs.
  neutral: 'bg-slate-100 text-slate-700',
  // Verified / delivered / accepted — green signals "this worked".
  success: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  // Catch-all / unverified / caution — amber signals "proceed with eyes open".
  warning: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  // Bounced / failed / blocked — red signals "stop".
  danger: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
  // Previously contacted / informational — indigo signals "FYI".
  info: 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200',
};

export function Badge({ tone = 'neutral', leading, children, title }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]}`}
      title={title}
    >
      {leading}
      {children}
    </span>
  );
}
