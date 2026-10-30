/**
 * Settings repository — generic KV store (migration 0005).
 *
 * Hosts the LinkedIn connect/DM templates in v1, plus whatever user prefs
 * land later (gmail subject template, sender name, etc.). Hierarchical keys
 * by convention (`linkedin.connect_template`, `linkedin.dm_template`); the
 * schema doesn't enforce the dot-structure.
 *
 * No business logic here — just typed query wrappers. Zod lives at the HTTP
 * boundary (routes/settings.routes.ts).
 */

import { pool } from '../client.js';

export interface Setting {
  readonly key: string;
  readonly value: string;
  readonly updatedAt: string; // ISO
}

interface SettingRow {
  key: string;
  value: string;
  updated_at: Date;
}

function rowToSetting(r: SettingRow): Setting {
  return {
    key: r.key,
    value: r.value,
    updatedAt: r.updated_at.toISOString(),
  };
}

/** Fetch one setting. Returns null when the key doesn't exist. */
export async function get(key: string): Promise<Setting | null> {
  const result = await pool.query<SettingRow>(
    'SELECT key, value, updated_at FROM app_settings WHERE key = $1',
    [key],
  );
  const row = result.rows[0];
  return row ? rowToSetting(row) : null;
}

/**
 * UPSERT a setting value. Idempotent — inserts if missing, updates in place
 * if present. `updated_at` always refreshes to now() so the Configure UI can
 * surface last-edited stamps.
 */
export async function set(key: string, value: string): Promise<Setting> {
  const result = await pool.query<SettingRow>(
    `
    INSERT INTO app_settings (key, value)
    VALUES ($1, $2)
    ON CONFLICT (key)
    DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    RETURNING key, value, updated_at
    `,
    [key, value],
  );
  const row = result.rows[0];
  if (!row) throw new Error('setting.set: no row returned');
  return rowToSetting(row);
}

/**
 * Set a value ONLY if the key doesn't already exist. Used by the first-boot
 * seeder so re-boots don't overwrite the user's edits.
 *
 * Returns the setting (whether existing or newly inserted) and a flag
 * indicating which path was taken — useful for seeder log lines.
 */
export async function setIfAbsent(
  key: string,
  value: string,
): Promise<{ setting: Setting; inserted: boolean }> {
  // ON CONFLICT DO NOTHING + RETURNING gives us only the row when we INSERT;
  // we then SELECT the existing row for the no-op branch. Two round-trips in
  // the common seeded case; one in the first-boot case. Fine.
  const inserted = await pool.query<SettingRow>(
    `
    INSERT INTO app_settings (key, value)
    VALUES ($1, $2)
    ON CONFLICT (key) DO NOTHING
    RETURNING key, value, updated_at
    `,
    [key, value],
  );
  const insertedRow = inserted.rows[0];
  if (insertedRow) {
    return { setting: rowToSetting(insertedRow), inserted: true };
  }
  const existing = await get(key);
  if (!existing) throw new Error('setting.setIfAbsent: existing row vanished');
  return { setting: existing, inserted: false };
}

/** List every setting. Returned in alphabetical key order for stability. */
export async function listAll(): Promise<Setting[]> {
  const result = await pool.query<SettingRow>(
    'SELECT key, value, updated_at FROM app_settings ORDER BY key',
  );
  return result.rows.map(rowToSetting);
}
