/**
 * Daily cap enforcement (D6) — atomic.
 *
 * The whole flow is a single SQL statement so there's no race window between
 * "read count" and "write new count." Multiple concurrent calls either both
 * fail or sequence through the UNIQUE constraint.
 */

import { pool } from '../client.js';

export interface CapCheckResult {
  allowed: boolean;
  /** Current count for today (either after increment, or current if denied). */
  currentCount: number;
}

/**
 * Increment today's run counter — but only if we're under `cap`.
 *
 * How the SQL works:
 *   - INSERT fresh row for today with count = 1 (first run of the day).
 *   - On conflict (today's row already exists): add 1 to the count, BUT
 *     only if the current count is still less than `cap`.
 *   - If the WHERE clause fails (count already at cap), neither insert nor
 *     update happens; RETURNING yields no rows. That's our "denied" signal.
 *
 * Postgres 9.5+ supports WHERE on ON CONFLICT UPDATE.
 */
export async function incrementIfUnderCap(cap: number): Promise<CapCheckResult> {
  const incrementResult = await pool.query<{ runs_count: number }>(
    `
    INSERT INTO daily_logs (run_date, runs_count)
    VALUES (CURRENT_DATE, 1)
    ON CONFLICT (run_date) DO UPDATE
      SET runs_count = daily_logs.runs_count + 1
      WHERE daily_logs.runs_count < $1
    RETURNING runs_count
    `,
    [cap],
  );

  if (incrementResult.rows.length > 0) {
    return { allowed: true, currentCount: incrementResult.rows[0]!.runs_count };
  }

  // Denied — fetch the current count to report back to the client.
  const currentResult = await pool.query<{ runs_count: number }>(
    'SELECT runs_count FROM daily_logs WHERE run_date = CURRENT_DATE',
  );
  return {
    allowed: false,
    currentCount: currentResult.rows[0]?.runs_count ?? cap,
  };
}

/** Read-only view used by the dashboard's "N/4 today" counter. */
export async function currentUsage(): Promise<number> {
  const result = await pool.query<{ runs_count: number }>(
    'SELECT runs_count FROM daily_logs WHERE run_date = CURRENT_DATE',
  );
  return result.rows[0]?.runs_count ?? 0;
}
