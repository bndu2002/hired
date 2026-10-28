/**
 * Google account repository — connected Gmail accounts and their OAuth tokens.
 *
 * Tokens are encrypted at rest (core/crypto.ts, AES-256-GCM). Encryption
 * happens HERE, at the repo boundary: callers pass/receive plaintext tokens,
 * the DB only ever holds ciphertext. The encryption key comes from config.
 *
 * Multi-account by design: one install connects a 'linkedin_notifications'
 * inbox and a 'sending' inbox. UNIQUE(email, role) means re-connecting the
 * same account in the same role upserts rather than duplicating.
 *
 * See .kiro/specs/hired/design.md § 5 and migration 0004.
 */

import { config } from '../../config/index.js';
import { decryptSecret, encryptSecret } from '../../core/crypto.js';
import { pool } from '../client.js';

export type GoogleAccountRole = 'linkedin_notifications' | 'sending';

/** Domain object with PLAINTEXT tokens — only exists in memory, never logged. */
export interface GoogleAccount {
  id: number;
  email: string;
  role: GoogleAccountRole;
  accessToken: string;
  refreshToken: string;
  tokenExpiry: string | null; // ISO
  scopes: string | null;
  gmailHistoryId: string | null;
  connectedAt: string;
  lastPolledAt: string | null;
}

/** Safe public view — no tokens. This is what routes return to the client. */
export interface GoogleAccountPublic {
  id: number;
  email: string;
  role: GoogleAccountRole;
  scopes: string | null;
  connectedAt: string;
  lastPolledAt: string | null;
}

interface GoogleAccountRow {
  id: number;
  email: string;
  role: string;
  access_token_enc: string;
  refresh_token_enc: string;
  token_expiry: Date | null;
  scopes: string | null;
  gmail_history_id: string | null;
  connected_at: Date;
  last_polled_at: Date | null;
}

function rowToAccount(r: GoogleAccountRow): GoogleAccount {
  return {
    id: r.id,
    email: r.email,
    role: r.role as GoogleAccountRole,
    accessToken: decryptSecret(r.access_token_enc, config.TOKEN_ENCRYPTION_KEY),
    refreshToken: decryptSecret(r.refresh_token_enc, config.TOKEN_ENCRYPTION_KEY),
    tokenExpiry: r.token_expiry?.toISOString() ?? null,
    scopes: r.scopes,
    gmailHistoryId: r.gmail_history_id,
    connectedAt: r.connected_at.toISOString(),
    lastPolledAt: r.last_polled_at?.toISOString() ?? null,
  };
}

function rowToPublic(r: GoogleAccountRow): GoogleAccountPublic {
  return {
    id: r.id,
    email: r.email,
    role: r.role as GoogleAccountRole,
    scopes: r.scopes,
    connectedAt: r.connected_at.toISOString(),
    lastPolledAt: r.last_polled_at?.toISOString() ?? null,
  };
}

export interface UpsertGoogleAccountInput {
  email: string;
  role: GoogleAccountRole;
  accessToken: string;
  refreshToken: string;
  tokenExpiry: Date | null;
  scopes: string | null;
}

/**
 * Insert or update a connected account. Tokens are encrypted before they
 * touch SQL. ON CONFLICT (email, role) refreshes tokens + scopes but keeps
 * the existing gmail_history_id watermark (re-auth shouldn't reset the poll
 * cursor) and connected_at.
 */
export async function upsert(
  input: UpsertGoogleAccountInput,
): Promise<GoogleAccountPublic> {
  const accessEnc = encryptSecret(input.accessToken, config.TOKEN_ENCRYPTION_KEY);
  const refreshEnc = encryptSecret(input.refreshToken, config.TOKEN_ENCRYPTION_KEY);

  const result = await pool.query<GoogleAccountRow>(
    `
    INSERT INTO google_accounts
      (email, role, access_token_enc, refresh_token_enc, token_expiry, scopes)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (email, role) DO UPDATE SET
      access_token_enc  = EXCLUDED.access_token_enc,
      refresh_token_enc = EXCLUDED.refresh_token_enc,
      token_expiry      = EXCLUDED.token_expiry,
      scopes            = EXCLUDED.scopes
    RETURNING *
    `,
    [
      input.email,
      input.role,
      accessEnc,
      refreshEnc,
      input.tokenExpiry,
      input.scopes,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('upsert google account: no row returned');
  return rowToPublic(row);
}

/** List all connected accounts (tokenless public view) for the Configure UI. */
export async function listPublic(): Promise<GoogleAccountPublic[]> {
  const result = await pool.query<GoogleAccountRow>(
    'SELECT * FROM google_accounts ORDER BY role, email',
  );
  return result.rows.map(rowToPublic);
}

/** Full account WITH decrypted tokens, by id. For the Gmail client factory. */
export async function getById(id: number): Promise<GoogleAccount | null> {
  const result = await pool.query<GoogleAccountRow>(
    'SELECT * FROM google_accounts WHERE id = $1',
    [id],
  );
  const row = result.rows[0];
  return row ? rowToAccount(row) : null;
}

/**
 * All accounts for a given role, WITH decrypted tokens. The inbound poll
 * calls this for 'linkedin_notifications' + 'sending'; the sender calls it
 * for 'sending'.
 */
export async function listByRole(
  role: GoogleAccountRole,
): Promise<GoogleAccount[]> {
  const result = await pool.query<GoogleAccountRow>(
    'SELECT * FROM google_accounts WHERE role = $1 ORDER BY email',
    [role],
  );
  return result.rows.map(rowToAccount);
}

/** Persist a refreshed access token + new expiry after a token refresh. */
export async function updateAccessToken(
  id: number,
  accessToken: string,
  tokenExpiry: Date | null,
): Promise<void> {
  const accessEnc = encryptSecret(accessToken, config.TOKEN_ENCRYPTION_KEY);
  await pool.query(
    `UPDATE google_accounts
       SET access_token_enc = $2, token_expiry = $3
     WHERE id = $1`,
    [id, accessEnc, tokenExpiry],
  );
}

/** Advance the incremental-poll watermark after a successful poll. */
export async function updateHistoryId(
  id: number,
  gmailHistoryId: string,
): Promise<void> {
  await pool.query(
    `UPDATE google_accounts
       SET gmail_history_id = $2, last_polled_at = now()
     WHERE id = $1`,
    [id, gmailHistoryId],
  );
}

/** Disconnect an account. Hard delete — the user explicitly revoked it. */
export async function remove(id: number): Promise<boolean> {
  const result = await pool.query(
    'DELETE FROM google_accounts WHERE id = $1',
    [id],
  );
  return (result.rowCount ?? 0) > 0;
}
