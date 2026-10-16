/**
 * Simple forward-only migration runner.
 *
 * - Reads *.sql files from src/db/migrations/, sorted by filename.
 * - Tracks applied migrations in a `schema_migrations` table.
 * - Applies new ones in filename order, each in its own transaction.
 * - Idempotent: re-running does nothing if everything is already applied.
 *
 * Run via: pnpm --filter server migrate
 */

import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db/client.js';
import { logger } from '../src/logger.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const MIGRATIONS_DIR = resolve(here, '../src/db/migrations');

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    VARCHAR(255) PRIMARY KEY,
      applied_at  TIMESTAMPTZ DEFAULT now()
    )
  `);
}

async function appliedFilenames(): Promise<Set<string>> {
  const result = await pool.query<{ filename: string }>(
    'SELECT filename FROM schema_migrations',
  );
  return new Set(result.rows.map((r) => r.filename));
}

async function readMigrationFiles(): Promise<string[]> {
  const entries = await readdir(MIGRATIONS_DIR);
  return entries.filter((name) => name.endsWith('.sql')).sort();
}

async function applyOne(filename: string): Promise<void> {
  const sql = await readFile(resolve(MIGRATIONS_DIR, filename), 'utf-8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(
      'INSERT INTO schema_migrations (filename) VALUES ($1)',
      [filename],
    );
    await client.query('COMMIT');
    logger.info({ filename }, 'migration applied');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  logger.info({ dir: MIGRATIONS_DIR }, 'running migrations');
  await ensureMigrationsTable();

  const all = await readMigrationFiles();
  const applied = await appliedFilenames();
  const pending = all.filter((f) => !applied.has(f));

  if (pending.length === 0) {
    logger.info('no pending migrations');
    return;
  }

  logger.info({ pending }, `applying ${pending.length} migration(s)`);
  for (const filename of pending) {
    await applyOne(filename);
  }
  logger.info('migrations complete');
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    logger.error({ err }, 'migration failed');
    await pool.end();
    process.exit(1);
  });
