/**
 * Run repository — one row per Run Agent click.
 *
 * See .kiro/specs/hired/design.md § 5.
 */

import { pool } from '../client.js';

export type RunChannels = 'gmail' | 'linkedin' | 'both';
export type RunStatus = 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';

export interface Run {
  id: number;
  jobId: number;
  channels: RunChannels;
  status: RunStatus;
  markedAsInterview: boolean;
  createdAt: string;
  completedAt: string | null;
}

interface RunRow {
  id: number;
  job_id: number;
  channels: string;
  status: string;
  marked_as_interview: boolean;
  created_at: Date;
  completed_at: Date | null;
}

function rowToRun(r: RunRow): Run {
  return {
    id: r.id,
    jobId: r.job_id,
    channels: r.channels as RunChannels,
    status: r.status as RunStatus,
    markedAsInterview: r.marked_as_interview,
    createdAt: r.created_at.toISOString(),
    completedAt: r.completed_at?.toISOString() ?? null,
  };
}

export async function createRun(input: {
  jobId: number;
  channels: RunChannels;
}): Promise<Run> {
  const result = await pool.query<RunRow>(
    `
    INSERT INTO runs (job_id, channels, status)
    VALUES ($1, $2, 'IN_PROGRESS')
    RETURNING *
    `,
    [input.jobId, input.channels],
  );
  const row = result.rows[0];
  if (!row) throw new Error('createRun: no row returned');
  return rowToRun(row);
}

export async function updateStatus(
  runId: number,
  status: RunStatus,
): Promise<void> {
  // Explicit cast on $2 — Postgres can't deduce whether it's VARCHAR (column type)
  // or text (string literal comparison in the CASE). Error 42P08 without it.
  await pool.query(
    `UPDATE runs
       SET status = $2::varchar,
           completed_at = CASE WHEN $2::varchar IN ('COMPLETED','FAILED') THEN now() ELSE completed_at END
       WHERE id = $1`,
    [runId, status],
  );
}

export async function getRunById(id: number): Promise<Run | null> {
  const result = await pool.query<RunRow>('SELECT * FROM runs WHERE id = $1', [id]);
  const row = result.rows[0];
  return row ? rowToRun(row) : null;
}
