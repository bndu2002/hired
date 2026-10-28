import { ConnectedAccountsTab } from './ConnectedAccountsTab.js';

/**
 * Configure page. For now hosts only the Connected Accounts tab (Gmail OAuth).
 * Templates + profile-field tabs land in later phases; when they do, this
 * grows a tab strip. Single section until then — no point faking tabs for one.
 */
export function ConfigurePage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Configure</h1>
        <p className="mt-1 text-sm text-slate-500">
          Connect the Gmail accounts the agent uses for tracking and sending.
        </p>
      </header>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Connected accounts
      </h2>
      <ConnectedAccountsTab />
    </div>
  );
}
