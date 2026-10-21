import { Outlet } from 'react-router-dom';
import { Sidebar } from '../shared/components/Sidebar.js';
import { TopBar } from '../shared/components/TopBar.js';

/**
 * Root layout.
 *
 * Full-height two-column shell: fixed sidebar on the left, header + scrollable
 * content on the right. Child routes render into <Outlet />.
 *
 * CSS layout: a single flex row at the top level, then a flex column inside
 * the right pane. This keeps the sidebar from scrolling with the content.
 */
export function RootLayout() {
  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
