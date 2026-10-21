/**
 * Top bar.
 *
 * Phase-1.5 shape: placeholder for the daily-cap counter (`N/4 today`) and
 * provider-credits summary that come in Phase 6. Left side will carry the
 * active page's breadcrumb once we have real pages wired.
 */
export function TopBar() {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6">
      <div className="text-sm text-slate-500">
        {/* Breadcrumb — filled by pages via <Outlet context> in a later phase */}
      </div>
      <div className="flex items-center gap-4 text-xs text-slate-500">
        <span
          className="rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-600"
          title="Daily run counter (D6) — wired in Phase 6"
        >
          –/4 today
        </span>
      </div>
    </header>
  );
}
