import { Construction } from 'lucide-react';

interface PlaceholderPageProps {
  readonly title: string;
  readonly phase: string;
  readonly description: string;
}

/**
 * Standard "coming in Phase N" page used for nav items whose features
 * aren't built yet. Keeps the shell navigable without each page needing
 * its own skeleton markup.
 */
export function PlaceholderPage({
  title,
  phase,
  description,
}: PlaceholderPageProps) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
      <div className="mt-6 flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-5">
        <Construction
          className="mt-0.5 h-5 w-5 shrink-0 text-slate-400"
          aria-hidden="true"
        />
        <div>
          <div className="text-sm font-medium text-slate-700">
            Coming in {phase}
          </div>
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        </div>
      </div>
    </div>
  );
}
