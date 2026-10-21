import { useParams } from 'react-router-dom';
import { PlaceholderPage } from '../../shared/components/PlaceholderPage.js';

/**
 * /run/:jobId — mount point for the Run Agent modal that opens after Alt+H
 * captures a job. For now a placeholder; the actual modal UI lands in Phase 3.9.
 */
export function RunPage() {
  const { jobId } = useParams<{ jobId: string }>();

  return (
    <PlaceholderPage
      title={`Run Agent — Job #${jobId ?? '?'}`}
      phase="Phase 3.9"
      description="Modal with discovered contacts, resolved emails, channel selection, and Send button."
    />
  );
}
