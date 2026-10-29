import { useEffect } from 'react';
import { Mail, Linkedin, Check, Loader2, AlertCircle, X } from 'lucide-react';
import {
  useGoogleAccounts,
  useDisconnectGoogleAccount,
  startConnectUrl,
  type GoogleAccountRole,
  type GoogleAccountPublic,
} from '../../shared/api/googleAccounts.js';
import { Button } from '../../shared/components/Button.js';
import { Badge } from '../../shared/components/Badge.js';

/**
 * Connected Accounts — connect/list/disconnect the two Gmail accounts.
 *
 *   linkedin_notifications : the Gmail that receives LinkedIn's accept/reply
 *                            emails. We poll it (read-only) to track LinkedIn
 *                            outreach without scraping LinkedIn itself.
 *   sending                : the Gmail used to send referral emails and to
 *                            read email replies.
 *
 * "Connect" opens the server's OAuth start URL in a popup. When the popup
 * finishes it postMessages back + closes; we listen for that and refetch.
 */

interface RoleSpec {
  readonly role: GoogleAccountRole;
  readonly label: string;
  readonly description: string;
  readonly Icon: typeof Mail;
}

/**
 * Humanize an ISO timestamp as "Ns ago" / "Nm ago" / "Nh ago" / "Nd ago".
 * Mirrors the helper in JobCard.tsx; kept local here for now — if a third
 * caller shows up we'll lift to shared/.
 */
function timeAgo(iso: string): string {
  const diffSec = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSec < 10) return 'just now';
  if (diffSec < 60) return `${Math.round(diffSec)}s ago`;
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
  if (diffSec < 86_400) return `${Math.round(diffSec / 3600)}h ago`;
  return `${Math.round(diffSec / 86_400)}d ago`;
}

const ROLES: readonly RoleSpec[] = [
  {
    role: 'linkedin_notifications',
    label: 'LinkedIn notifications inbox',
    description:
      'The Gmail linked to your LinkedIn account. We read its LinkedIn emails (read-only) to detect when connections are accepted and when people reply.',
    Icon: Linkedin,
  },
  {
    role: 'sending',
    label: 'Referral sending inbox',
    description:
      'The Gmail you want referral emails sent from. We send from here and read replies to track responses.',
    Icon: Mail,
  },
];

export function ConnectedAccountsTab() {
  const accountsQuery = useGoogleAccounts();
  const disconnect = useDisconnectGoogleAccount();

  // Refetch when an OAuth popup reports back (it postMessages then closes).
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.data && typeof e.data === 'object' && e.data.type === 'hired:oauth') {
        void accountsQuery.refetch();
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [accountsQuery]);

  function connect(role: GoogleAccountRole) {
    // Popup, not full-tab, so the dashboard stays put and can refresh on return.
    window.open(startConnectUrl(role), 'hired-oauth', 'width=520,height=640');
  }

  const accountsByRole = (role: GoogleAccountRole): GoogleAccountPublic[] =>
    accountsQuery.data?.filter((a) => a.role === role) ?? [];

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500">
        Connect two Gmail accounts so the agent can track LinkedIn acceptances
        and replies, and send referral emails. Tokens are encrypted at rest;
        you can disconnect anytime.
      </p>

      {accountsQuery.isError && (
        <div className="flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>Couldn't load connected accounts. {accountsQuery.error.message}</div>
        </div>
      )}

      {ROLES.map((spec) => {
        const connected = accountsByRole(spec.role);
        return (
          <section
            key={spec.role}
            className="rounded-lg border border-slate-200 bg-white p-5"
          >
            <div className="flex items-start gap-3">
              <spec.Icon
                className="mt-0.5 h-5 w-5 shrink-0 text-slate-400"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-slate-900">
                  {spec.label}
                </div>
                <p className="mt-0.5 text-xs text-slate-500">
                  {spec.description}
                </p>

                {/* Connected accounts for this role */}
                {connected.length > 0 && (
                  <ul className="mt-3 space-y-2">
                    {connected.map((acct) => (
                      <li
                        key={acct.id}
                        className="flex items-center justify-between gap-2 rounded-md border border-slate-100 bg-slate-50 px-3 py-2"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <Badge
                            tone="success"
                            leading={<Check className="h-3 w-3" aria-hidden="true" />}
                          >
                            Connected
                          </Badge>
                          <span className="truncate text-sm text-slate-700">
                            {acct.email}
                          </span>
                          {/* Poll freshness — lets Vandana see at a glance that
                              the tracking engine is alive and when it last ran
                              against this account's inbox. */}
                          <span
                            className="shrink-0 text-xs text-slate-400"
                            title={
                              acct.lastPolledAt
                                ? new Date(acct.lastPolledAt).toLocaleString()
                                : 'The inbound-poll cron hasn\u2019t run against this account yet; first tick fires ~2s after server boot.'
                            }
                          >
                            {acct.lastPolledAt
                              ? `polled ${timeAgo(acct.lastPolledAt)}`
                              : 'awaiting first poll'}
                          </span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          leading={<X className="h-3.5 w-3.5" aria-hidden="true" />}
                          disabled={disconnect.isPending}
                          onClick={() => disconnect.mutate(acct.id)}
                        >
                          Disconnect
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-3">
                  <Button
                    variant={connected.length > 0 ? 'secondary' : 'primary'}
                    size="sm"
                    leading={
                      accountsQuery.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : undefined
                    }
                    onClick={() => connect(spec.role)}
                  >
                    {connected.length > 0 ? 'Connect another' : 'Connect Gmail'}
                  </Button>
                </div>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
