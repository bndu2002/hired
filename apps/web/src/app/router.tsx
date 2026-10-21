import { createBrowserRouter, Navigate } from 'react-router-dom';
import { RootLayout } from './layout.js';
import { DashboardPage } from '../features/dashboard/DashboardPage.js';
import { MyActivityPage } from '../features/my-activity/MyActivityPage.js';
import { LinkedinQueuePage } from '../features/linkedin-queue/LinkedinQueuePage.js';
import { ConfigurePage } from '../features/configure/ConfigurePage.js';
import { RunPage } from '../features/run-agent/RunPage.js';

/**
 * Route tree.
 *
 * `/run/:jobId` is a separate top-level route (not nested under the sidebar
 * layout) so the Run Agent modal can own the full viewport. We may revisit
 * if the modal is better opened as an overlay on top of the current page.
 */
export const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'activity', element: <MyActivityPage /> },
      { path: 'linkedin-queue', element: <LinkedinQueuePage /> },
      { path: 'configure', element: <ConfigurePage /> },
    ],
  },
  {
    path: '/run/:jobId',
    element: <RunPage />,
  },
  // Fallback: anything else bounces to Dashboard.
  {
    path: '*',
    element: <Navigate to="/" replace />,
  },
]);
