/**
 * Contact repository — one row per discovered person inside a run.
 *
 * Status columns are derived caches (D3); mutations go through `appendEvent`
 * in event.repo.ts, not direct UPDATEs. The one exception for slice 1 is the
 * initial creation here, which sets `discovered_via` + base identity fields.
 *
 * See .kiro/specs/hired/design.md § 5-6.
 */

import type { GmailStatus, LinkedinStatus } from '@hired/types';
import { pool } from '../client.js';

export interface Contact {
  id: number;
  runId: number;
  name: string;
  title: string | null;
  tenureHint: string | null;
  email: string | null;
  emailVerified: boolean;
  linkedinUrl: string | null;
  gmailStatus: GmailStatus;
  linkedinStatus: LinkedinStatus;
  discoveredVia: string | null;
  createdAt: string;
}

interface ContactRow {
  id: number;
  run_id: number;
  name: string;
  title: string | null;
  tenure_hint: string | null;
  email: string | null;
  email_verified: boolean;
  linkedin_url: string | null;
  gmail_status: string;
  linkedin_status: string;
  discovered_via: string | null;
  created_at: Date;
}

function rowToContact(r: ContactRow): Contact {
  return {
    id: r.id,
    runId: r.run_id,
    name: r.name,
    title: r.title,
    tenureHint: r.tenure_hint,
    email: r.email,
    emailVerified: r.email_verified,
    linkedinUrl: r.linkedin_url,
    gmailStatus: r.gmail_status as GmailStatus,
    linkedinStatus: r.linkedin_status as LinkedinStatus,
    discoveredVia: r.discovered_via,
    createdAt: r.created_at.toISOString(),
  };
}

export interface CreateContactInput {
  name: string;
  title?: string | undefined;
  tenureHint?: string | undefined;
  linkedinUrl?: string | undefined;
  discoveredVia: string;
}

/**
 * Bulk insert contacts for a run. Single multi-row INSERT so N contacts
 * take one round trip instead of N.
 *
 * Each input row provides its own `discoveredVia` — in slice 1 all rows in a
 * call share the same source, but keeping it per-row keeps the door open for
 * hybrid-source discovery later without a schema or signature change.
 */
export async function createMany(
  runId: number,
  inputs: readonly CreateContactInput[],
): Promise<Contact[]> {
  if (inputs.length === 0) return [];

  const colsPerRow = 6;
  const valuesClauses: string[] = [];
  const params: unknown[] = [];

  inputs.forEach((input, i) => {
    const base = i * colsPerRow;
    valuesClauses.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`,
    );
    params.push(
      runId,
      input.name,
      input.title ?? null,
      input.tenureHint ?? null,
      input.linkedinUrl ?? null,
      input.discoveredVia,
    );
  });

  const sql = `
    INSERT INTO contacts (run_id, name, title, tenure_hint, linkedin_url, discovered_via)
    VALUES ${valuesClauses.join(', ')}
    RETURNING *
  `;

  const result = await pool.query<ContactRow>(sql, params);
  return result.rows.map(rowToContact);
}

export async function getById(id: number): Promise<Contact | null> {
  const result = await pool.query<ContactRow>(
    'SELECT * FROM contacts WHERE id = $1',
    [id],
  );
  const row = result.rows[0];
  return row ? rowToContact(row) : null;
}

export async function listByRun(runId: number): Promise<Contact[]> {
  const result = await pool.query<ContactRow>(
    'SELECT * FROM contacts WHERE run_id = $1 ORDER BY id',
    [runId],
  );
  return result.rows.map(rowToContact);
}
