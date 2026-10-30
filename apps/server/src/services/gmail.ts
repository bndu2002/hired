/**
 * Gmail client factory — one authenticated client per connected Google account.
 *
 * Responsibilities:
 *   - Load a connected account from the repo (decrypts tokens inside the repo)
 *   - Build a `googleapis` OAuth2 client seeded with its access + refresh tokens
 *   - Wire an `on('tokens', ...)` listener so that whenever googleapis refreshes
 *     the access token internally, we persist the new token to Postgres via
 *     the repo. Google doesn't always resend a refresh_token on refresh, so we
 *     ignore `tokens.refresh_token` here and only update the access token.
 *
 * Callers (poller, future sender) do:
 *   const { gmail } = await buildGmailClient(accountId);
 *   await gmail.users.messages.list({ userId: 'me', ... });
 *
 * The returned object exposes the raw Gmail client plus the resolved account
 * so callers can read email/role/historyId without a second DB round trip.
 */

import { google, type gmail_v1 } from 'googleapis';
import { config } from '../config/index.js';
import * as googleAccountRepo from '../db/repositories/googleAccount.repo.js';
import type { GoogleAccount } from '../db/repositories/googleAccount.repo.js';
import { logger } from '../logger.js';

export interface GmailClientHandle {
  readonly account: GoogleAccount;
  readonly gmail: gmail_v1.Gmail;
}

/**
 * Build a Gmail client bound to a specific connected account. Throws if the
 * account doesn't exist.
 *
 * Why a factory rather than a long-lived singleton: tokens get refreshed in
 * place by googleapis, and each call reloads the latest encrypted tokens from
 * the DB. The poller runs every 90s — a fresh client per tick is cheap and
 * means we never operate on stale credentials after a refresh happened in
 * another process.
 */
export async function buildGmailClient(
  accountId: number,
): Promise<GmailClientHandle> {
  const account = await googleAccountRepo.getById(accountId);
  if (!account) {
    throw new Error(`gmail: account id=${accountId} not found`);
  }

  const auth = new google.auth.OAuth2(
    config.GOOGLE_CLIENT_ID,
    config.GOOGLE_CLIENT_SECRET,
    config.GOOGLE_REDIRECT_URI,
  );
  auth.setCredentials({
    access_token: account.accessToken,
    refresh_token: account.refreshToken,
    expiry_date: account.tokenExpiry ? new Date(account.tokenExpiry).getTime() : null,
  });

  // googleapis refreshes the access_token internally on 401. We hook that so
  // the refreshed token lands back in Postgres (encrypted via the repo) and
  // the next poll tick starts from the latest token rather than refreshing
  // again. We DON'T persist a new refresh_token here — Google rarely rotates
  // them, and when it does, re-connecting the account via OAuth is the right
  // move anyway.
  auth.on('tokens', (tokens) => {
    if (!tokens.access_token) return;
    const expiry = tokens.expiry_date ? new Date(tokens.expiry_date) : null;
    googleAccountRepo
      .updateAccessToken(account.id, tokens.access_token, expiry)
      .then(() =>
        logger.info(
          { accountId: account.id, email: account.email, role: account.role },
          'gmail: access token refreshed and persisted',
        ),
      )
      .catch((err) =>
        logger.warn(
          { err, accountId: account.id },
          'gmail: failed to persist refreshed access token',
        ),
      );
  });

  const gmail = google.gmail({ version: 'v1', auth });
  return { account, gmail };
}
