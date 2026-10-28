/**
 * Google OAuth2 service — consent URLs, code exchange, token refresh.
 *
 * Wraps `googleapis`' OAuth2 client. This is the ONLY place we talk to
 * Google's auth endpoints. Routes call these functions; the repo stores what
 * comes back.
 *
 * Multi-account design: the `role` a user is connecting (linkedin_notifications
 * vs sending) is carried through the OAuth `state` parameter so the callback
 * knows which role to tag the returned tokens with. State is signed-ish by
 * being opaque + validated against the shared secret flow isn't needed here
 * because the whole server is loopback + shared-secret gated; we still include
 * a nonce to prevent a stale/forged callback from silently succeeding.
 *
 * Scopes:
 *   - gmail.readonly : read inbox (poll for LinkedIn accept/reply emails,
 *                      and for the sending account, its own replies)
 *   - gmail.send     : send referral emails (only needed for the sending
 *                      account, but we request it for both for simplicity;
 *                      the readonly account just won't use it)
 *   - userinfo.email : so we can record WHICH email got connected
 *
 * `access_type: offline` + `prompt: consent` ensures we get a refresh_token
 * every time (Google only returns it on first consent unless prompted).
 */

import { google } from 'googleapis';
import { randomBytes } from 'node:crypto';
import { config } from '../config/index.js';
import { logger } from '../logger.js';
import type { GoogleAccountRole } from '../db/repositories/googleAccount.repo.js';

// Scopes requested for every connected account. Space-joined for storage.
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
] as const;

/**
 * Build a fresh OAuth2 client bound to our app credentials.
 *
 * Return type is inferred from `google.auth.OAuth2` rather than imported from
 * the transitive `google-auth-library` package (not a direct dependency, so
 * TS can't resolve its path). `ReturnType<...>` gives us the exact type
 * without the extra import.
 */
type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

function makeOAuthClient(): OAuth2Client {
  return new google.auth.OAuth2(
    config.GOOGLE_CLIENT_ID,
    config.GOOGLE_CLIENT_SECRET,
    config.GOOGLE_REDIRECT_URI,
  );
}

// ─── state (CSRF-ish nonce + role) ───────────────────────────────────────────

/**
 * Pending OAuth flows, keyed by nonce. The callback validates the nonce it
 * receives against this set, which prevents a replayed/forged callback from
 * being accepted. In-memory is fine — the flow completes in seconds and the
 * server is single-user + loopback. Entries expire after 10 minutes.
 */
interface PendingFlow {
  role: GoogleAccountRole;
  createdAt: number;
}
const pendingFlows = new Map<string, PendingFlow>();
const FLOW_TTL_MS = 10 * 60 * 1000;

function pruneExpiredFlows(): void {
  const now = Date.now();
  for (const [nonce, flow] of pendingFlows) {
    if (now - flow.createdAt > FLOW_TTL_MS) pendingFlows.delete(nonce);
  }
}

// ─── consent URL ─────────────────────────────────────────────────────────────

export interface ConsentUrlResult {
  url: string;
  nonce: string;
}

/**
 * Build the Google consent URL for connecting an account in a given role.
 * Returns the URL to redirect the user to, plus the nonce we're tracking.
 */
export function buildConsentUrl(role: GoogleAccountRole): ConsentUrlResult {
  pruneExpiredFlows();
  const nonce = randomBytes(16).toString('hex');
  pendingFlows.set(nonce, { role, createdAt: Date.now() });

  const client = makeOAuthClient();
  const url = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // force refresh_token every time
    scope: [...GOOGLE_SCOPES],
    state: nonce,
    include_granted_scopes: true,
  });

  logger.info({ role, nonce }, 'oauth: built consent url');
  return { url, nonce };
}

// ─── code exchange ───────────────────────────────────────────────────────────

export interface ExchangeResult {
  role: GoogleAccountRole;
  email: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiry: Date | null;
  scopes: string | null;
}

/**
 * Exchange the authorization code from the callback for tokens, and look up
 * which email was connected. Validates the state nonce. Throws on any failure
 * (bad code, unknown nonce, missing refresh token, etc.) — the callback route
 * turns that into a user-facing error page.
 */
export async function exchangeCode(
  code: string,
  state: string,
): Promise<ExchangeResult> {
  pruneExpiredFlows();
  const flow = pendingFlows.get(state);
  if (!flow) {
    throw new Error('oauth state not recognized (expired or forged)');
  }
  pendingFlows.delete(state); // one-time use

  const client = makeOAuthClient();
  const { tokens } = await client.getToken(code);

  if (!tokens.access_token) {
    throw new Error('oauth exchange returned no access_token');
  }
  if (!tokens.refresh_token) {
    // Happens if the user previously consented and Google skipped re-issuing
    // a refresh token. prompt=consent should prevent this, but guard anyway.
    throw new Error(
      'oauth exchange returned no refresh_token — revoke app access in your Google account and reconnect',
    );
  }

  client.setCredentials(tokens);

  // Look up the connected account's email address.
  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const me = await oauth2.userinfo.get();
  const email = me.data.email;
  if (!email) {
    throw new Error('could not read connected account email from userinfo');
  }

  logger.info(
    { role: flow.role, email },
    'oauth: exchanged code, resolved connected email',
  );

  return {
    role: flow.role,
    email,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    scopes: tokens.scope ?? null,
  };
}

// ─── token refresh ───────────────────────────────────────────────────────────

export interface RefreshedToken {
  accessToken: string;
  tokenExpiry: Date | null;
}

/**
 * Refresh an expired access token using the stored refresh token. Returns the
 * new access token + expiry. Callers (Gmail client factory) persist it via
 * googleAccount.repo.updateAccessToken.
 */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<RefreshedToken> {
  const client = makeOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await client.refreshAccessToken();
  if (!credentials.access_token) {
    throw new Error('token refresh returned no access_token');
  }
  return {
    accessToken: credentials.access_token,
    tokenExpiry: credentials.expiry_date
      ? new Date(credentials.expiry_date)
      : null,
  };
}
