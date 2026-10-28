/**
 * Google OAuth routes — connect / list / disconnect Gmail accounts.
 *
 *   GET    /api/auth/google/start?role=...   → redirect to Google consent
 *   GET    /api/auth/google/callback         → exchange code, store, show result
 *   GET    /api/auth/google/accounts         → list connected accounts (tokenless)
 *   DELETE /api/auth/google/accounts/:id     → disconnect one account
 *
 * The callback renders a tiny self-closing HTML page rather than JSON, because
 * it's the landing page of a browser redirect from Google, not an XHR. It
 * posts a message to the opener (the Configure tab) and closes itself, so the
 * dashboard can refresh its account list without a manual reload.
 *
 * NOTE on auth: /start and /callback are reached via full-page browser
 * navigation / Google's redirect, so they CANNOT carry the X-Hired-Secret
 * header. They're mounted BEFORE the sharedSecret middleware in index.ts.
 * /accounts (list) and DELETE are normal XHR from the dashboard and DO sit
 * behind the shared secret.
 */

import { type Router as RouterType, Router } from 'express';
import { z } from 'zod';
import * as googleAccountRepo from '../db/repositories/googleAccount.repo.js';
import { logger } from '../logger.js';
import {
  buildConsentUrl,
  exchangeCode,
} from '../services/googleOAuth.js';

// ─── public sub-router (no shared secret — browser navigation / redirect) ────

export const authPublicRouter: RouterType = Router();

const roleSchema = z.enum(['linkedin_notifications', 'sending']);

authPublicRouter.get('/google/start', (req, res, next) => {
  try {
    const parsed = roleSchema.safeParse(req.query.role);
    if (!parsed.success) {
      res.status(400).json({
        error: 'invalid_role',
        message: "role must be 'linkedin_notifications' or 'sending'",
      });
      return;
    }
    const { url } = buildConsentUrl(parsed.data);
    res.redirect(url);
  } catch (err) {
    next(err);
  }
});

authPublicRouter.get('/google/callback', async (req, res) => {
  try {
    // Google may redirect back with an error (user denied consent, etc.).
    if (typeof req.query.error === 'string') {
      res.status(400).send(renderCallbackPage({ ok: false, message: req.query.error }));
      return;
    }

    const code = req.query.code;
    const state = req.query.state;
    if (typeof code !== 'string' || typeof state !== 'string') {
      res
        .status(400)
        .send(renderCallbackPage({ ok: false, message: 'missing code or state' }));
      return;
    }

    const result = await exchangeCode(code, state);
    const account = await googleAccountRepo.upsert({
      email: result.email,
      role: result.role,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      tokenExpiry: result.tokenExpiry,
      scopes: result.scopes,
    });

    logger.info(
      { email: account.email, role: account.role },
      'oauth: account connected',
    );

    res.send(
      renderCallbackPage({
        ok: true,
        message: `Connected ${account.email} as ${account.role}`,
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'connection failed';
    logger.warn({ err }, 'oauth callback failed');
    // Render a readable error page instead of a stack trace.
    res.status(502).send(renderCallbackPage({ ok: false, message }));
    // Don't forward to errorHandler — we've already responded with HTML.
  }
});

// ─── protected sub-router (shared secret — normal dashboard XHR) ─────────────

export const authProtectedRouter: RouterType = Router();

authProtectedRouter.get('/google/accounts', async (_req, res, next) => {
  try {
    const accounts = await googleAccountRepo.listPublic();
    res.json({ accounts });
  } catch (err) {
    next(err);
  }
});

authProtectedRouter.delete('/google/accounts/:id', async (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.id ?? '', 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'invalid_id' });
      return;
    }
    const removed = await googleAccountRepo.remove(id);
    if (!removed) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── callback landing page ───────────────────────────────────────────────────

/**
 * Minimal HTML the OAuth callback returns. It notifies the dashboard tab (the
 * window that opened this popup) so it can refresh, then closes itself after a
 * beat. No scripts from untrusted sources; all inline + first-party.
 */
function renderCallbackPage(result: { ok: boolean; message: string }): string {
  const title = result.ok ? 'Connected ✓' : 'Connection failed';
  const color = result.ok ? '#047857' : '#b91c1c';
  // Escape the message for safe HTML embedding.
  const safeMessage = result.message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>${title}</title></head>
  <body style="font-family: system-ui, sans-serif; padding: 2rem; color: #0f172a;">
    <h2 style="color: ${color}; margin: 0 0 0.5rem;">${title}</h2>
    <p style="color: #475569;">${safeMessage}</p>
    <p style="color: #94a3b8; font-size: 0.85rem;">You can close this window.</p>
    <script>
      try { window.opener && window.opener.postMessage({ type: 'hired:oauth', ok: ${result.ok} }, '*'); } catch (e) {}
      setTimeout(function () { window.close(); }, 1500);
    </script>
  </body>
</html>`;
}
