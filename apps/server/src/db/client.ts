/**
 * The one Postgres connection pool for the whole server.
 *
 * Everything that reads or writes the DB goes through repositories in
 * `src/db/repositories/*`, which use this `pool` under the hood.
 *
 * `pg.Pool` is cheap to create but we only want one — connections are a
 * limited resource and the pool manages them.
 */

import pg from 'pg';
import { config } from '../config/index.js';

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 10,                   // small; this is a single-user tool
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// Fail loud if the pool errors mid-flight (e.g. DB restarted, network blip).
// coding-standards.md § error handling: no swallowed errors.
pool.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('postgres pool error:', err);
});

/**
 * Convenience helper for one-off parameterized queries.
 * For transactions, acquire a client with `pool.connect()` and `BEGIN`/`COMMIT`.
 */
export async function query<Row extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params?: readonly unknown[],
): Promise<pg.QueryResult<Row>> {
  return pool.query<Row>(text, params as unknown[] | undefined);
}
