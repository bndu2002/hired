/**
 * Dev-only routes for live-validating slices before pushing.
 *
 * Behind the shared-secret gate like any other /api/* route. Used while
 * standing up a slice end-to-end against a real DB and real Gmail account.
 * Should be feature-flagged or removed before shipping to prod — same
 * footing as /api/discovery-test from the discovery-llm-rd slice.
 *
 *   GET  /api/dev/gmail-messages?accountId=N&q=&limit=
 *     List recent Gmail messages for an account, with optional query (defaults
 *     to `from:linkedin.com`). Lets Vandana see what IDs exist in the inbox
 *     without hunting through Gmail's web UI.
 *
 *   POST /api/dev/process-message
 *     Body: { accountId: number, messageId: string }
 *     Run one message through the exact same pipeline the inbound poller uses,
 *     bypassing the history watermark. Returns the parser result, matched
 *     contact (or skip reason), and status transition that happened.
 *
 * Side-effect warning: `process-message` MUTATES state the same way the poll
 * does. If you replay an old "accepted" email against a contact that's already
 * CONNECTED, the state-machine guards make it a no-op; still, don't run this
 * against production data expecting read-only behavior.
 */

import { type Router as RouterType, Router } from 'express';
import { z } from 'zod';
import { logger } from '../logger.js';
import { buildGmailClient } from '../services/gmail.js';
import { processMessage } from '../services/gmailInboundPoller.js';

export const devRouter: RouterType = Router();

// ─── list recent messages ───────────────────────────────────────────────────

const listQuerySchema = z.object({
  accountId: z.coerce.number().int().positive(),
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

devRouter.get('/gmail-messages', async (req, res, next) => {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: 'invalid_query', details: parsed.error.flatten() });
      return;
    }
    const { accountId, q, limit } = parsed.data;

    const { account, gmail } = await buildGmailClient(accountId);
    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: q ?? 'from:linkedin.com',
      maxResults: limit ?? 20,
    });

    const stubs = listRes.data.messages ?? [];
    // Enrich each stub with From/Subject/Date so the user can pick without a
    // second round-trip. Serial fetches — small list and this is dev.
    const enriched = [];
    for (const stub of stubs) {
      if (!stub.id) continue;
      const msg = await gmail.users.messages.get({
        userId: 'me',
        id: stub.id,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date'],
      });
      const headers = msg.data.payload?.headers ?? [];
      const h = (name: string): string =>
        headers.find((x) => x.name?.toLowerCase() === name.toLowerCase())
          ?.value ?? '';
      enriched.push({
        id: stub.id,
        threadId: msg.data.threadId ?? null,
        from: h('From'),
        subject: h('Subject'),
        date: h('Date'),
        snippet: msg.data.snippet ?? '',
      });
    }

    res.json({
      account: {
        id: account.id,
        email: account.email,
        role: account.role,
      },
      query: q ?? 'from:linkedin.com',
      count: enriched.length,
      messages: enriched,
    });
  } catch (err) {
    next(err);
  }
});

// ─── process one message through the pipeline ───────────────────────────────

const processBodySchema = z.object({
  accountId: z.number().int().positive(),
  messageId: z.string().min(1).max(128),
});

devRouter.post('/process-message', async (req, res, next) => {
  try {
    const parsed = processBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: 'invalid_payload', details: parsed.error.flatten() });
      return;
    }
    const { accountId, messageId } = parsed.data;

    const { account, gmail } = await buildGmailClient(accountId);
    logger.info(
      { accountId, messageId, email: account.email, role: account.role },
      'dev: replaying message through pipeline',
    );

    const result = await processMessage(gmail, messageId, account.role);

    // Dev-only: also fetch the full body and surface every linkedin.com URL
    // we can find, so we can see what shape LinkedIn's email templates
    // actually use when the parser's /in/<slug> regex comes up empty.
    const diagnostics = await collectUrlDiagnostics(gmail, messageId);

    logger.info(
      {
        accountId,
        messageId,
        outcome: result.outcome,
        matched: result.debug.matchedContactId,
        statusChange: result.debug.statusChange,
      },
      'dev: process-message complete',
    );

    res.json({
      account: {
        id: account.id,
        email: account.email,
        role: account.role,
      },
      messageId,
      ...result,
      diagnostics,
    });
  } catch (err) {
    next(err);
  }
});

// ─── diagnostic: see every linkedin.com URL the body contains ───────────────

/**
 * Pulls the full plaintext + html bodies and scans for every linkedin.com URL,
 * sorted into "profile-shaped" (what the parser accepts) and "other" (tracked
 * redirects, help pages, etc.). When the parser returns `parsed: null` on an
 * email we think should work, this tells us exactly what the body contains so
 * we can either expand the regex or decide a different extraction strategy.
 */
async function collectUrlDiagnostics(
  gmail: Awaited<ReturnType<typeof buildGmailClient>>['gmail'],
  messageId: string,
): Promise<{
  profileUrls: string[];
  otherLinkedinUrls: string[];
  textBodyLength: number;
  htmlBodyLength: number;
}> {
  const res = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });
  const bodies = extractAllBodies(res.data.payload);

  const combined = bodies.textBody + '\n' + bodies.htmlBody;
  // Loosest match: any https?://[subdomain.]linkedin.com/<something>
  const ALL = /https?:\/\/[a-z0-9.-]*linkedin\.com\/[^\s"'<>)]+/gi;
  const matches = combined.match(ALL) ?? [];

  // Dedupe, bucket by whether the path is /in/<slug>
  const seen = new Set<string>();
  const profileUrls: string[] = [];
  const otherLinkedinUrls: string[] = [];
  for (const raw of matches) {
    // Trim trailing punctuation / entity bits that caught on
    const clean = raw.replace(/[.,;:!?)\]'">]+$/, '');
    if (seen.has(clean)) continue;
    seen.add(clean);
    if (/\/in\/[A-Za-z0-9_%-]+/i.test(clean)) {
      profileUrls.push(clean);
    } else {
      otherLinkedinUrls.push(clean);
    }
  }

  return {
    profileUrls,
    otherLinkedinUrls: otherLinkedinUrls.slice(0, 20), // bound noise
    textBodyLength: bodies.textBody.length,
    htmlBodyLength: bodies.htmlBody.length,
  };
}

// Lightweight re-implementation of the body walker so we don't need to export
// extractBodies from the poller (keep its surface minimal).
function extractAllBodies(payload: unknown): {
  textBody: string;
  htmlBody: string;
} {
  let textBody = '';
  let htmlBody = '';
  function walk(part: unknown): void {
    if (!part || typeof part !== 'object') return;
    const p = part as {
      mimeType?: string;
      body?: { data?: string };
      parts?: unknown[];
    };
    const data = p.body?.data;
    if (data) {
      if (p.mimeType === 'text/plain' && !textBody) textBody = decode(data);
      else if (p.mimeType === 'text/html' && !htmlBody) htmlBody = decode(data);
    }
    for (const child of p.parts ?? []) walk(child);
  }
  walk(payload);
  return { textBody, htmlBody };
}

function decode(data: string): string {
  return Buffer.from(
    data.replace(/-/g, '+').replace(/_/g, '/'),
    'base64',
  ).toString('utf-8');
}
