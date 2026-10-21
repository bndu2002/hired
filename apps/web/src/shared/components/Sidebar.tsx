import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Activity,
  Linkedin,
  Settings,
  type LucideIcon,
} from 'lucide-react';

/**
 * Left sidebar nav.
 *
 * Items follow design.md § 4 after D10 trimmed Happy Agent's extras:
 * Dashboard, My Activity, LinkedIn Queue, Configure. Jobs browser, Resumes,
 * Help, Upgrade, Reminders are intentionally not here.
 *
 * Items are kept in module scope (not state) because they never change at
 * runtime — React.StrictMode remounts would create new refs otherwise.
 */

interface NavItem {
  readonly label: string;
  readonly path: string;
  readonly icon: LucideIcon;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Dashboard', path: '/', icon: LayoutDashboard },
  { label: 'My Activity', path: '/activity', icon: Activity },
  { label: 'LinkedIn Queue', path: '/linkedin-queue', icon: Linkedin },
  { label: 'Configure', path: '/configure', icon: Settings },
];

export function Sidebar() {
  return (
    <aside
      className="w-56 shrink-0 border-r border-slate-200 bg-white"
      aria-label="Primary navigation"
    >
      <div className="px-4 py-5">
        <div className="text-lg font-semibold tracking-tight text-slate-900">
          Hired
        </div>
        <div className="text-xs text-slate-500">Referral outreach agent</div>
      </div>
      <nav className="px-2 pb-4">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map((item) => (
            <li key={item.path}>
              <NavLink
                to={item.path}
                end={item.path === '/'}
                className={({ isActive }) =>
                  [
                    'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-slate-100 font-medium text-slate-900'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                  ].join(' ')
                }
              >
                <item.icon className="h-4 w-4" aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
