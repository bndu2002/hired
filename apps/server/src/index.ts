/**
 * Entry point. Boots the Express server after env validation passes.
 *
 * Route layout:
 *   GET  /api/health              unprotected — monitoring
 *   *    /api/*                   requires X-Hired-Secret header
 *
 * Routes land per phase (see .kiro/specs/hired/tasks.md).
 */

import express from 'express';
import { OpenAiDiscoverySource } from './adapters/discovery/OpenAiDiscoverySource.js';
import { SerpApiXRaySource } from './adapters/discovery/SerpApiXRaySource.js';
import { PatternHeuristicFinder } from './adapters/emailFinder/PatternHeuristicFinder.js';
import { SnovFinder } from './adapters/emailFinder/SnovFinder.js';
import { ReoonVerifier } from './adapters/emailVerifier/ReoonVerifier.js';
import { config } from './config/index.js';
import { logger } from './logger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { sharedSecret } from './middleware/sharedSecret.js';
import {
  startInboundPollCron,
  stopInboundPollCron,
} from './jobs/inboundPoll.cron.js';
import { agentRouter } from './routes/agent.routes.js';
import { authPublicRouter, authProtectedRouter } from './routes/auth.routes.js';
import { devRouter } from './routes/dev.routes.js';
import { discoveryTestRouter } from './routes/discoveryTest.routes.js';
import { jobsRouter } from './routes/jobs.routes.js';
import {
  discoveryRegistry,
  emailFinderRegistry,
  emailVerifierRegistry,
} from './services/providerRegistry.js';

// Register adapters once at module load. Keeping this at module scope (not
// inside createApp) means a single registration applies across tests + prod,
// and tests can clear or override by re-importing the registry module.

// ─── Discovery (D9 — India-only) ──────────────────────────────────────────
//
// Primary: OpenAiDiscoverySource (web_search tool, Bing-backed). We confirmed
// in R&D (see feat/discovery-llm-rd commits) that it reliably finds real
// LinkedIn profiles across small AND large companies, where SerpAPI X-ray
// via Google has decayed to near-zero for big consultancies.
//
// Fallback: SerpApiXRaySource. Kept registered second so the provider
// registry's natural fallback chain kicks in when OpenAI 429s, times out,
// or returns zero profile URLs. Also fires when OPENAI_API_KEY isn't set
// at all (OpenAI registration is skipped in that case).
//
// Country is hardcoded 'India' / 'IN' for v1. Per-job configurability
// (from the captured job's location_hint) is a v2 target.
if (config.OPENAI_API_KEY) {
  discoveryRegistry.register(
    new OpenAiDiscoverySource(config.OPENAI_API_KEY, { country: 'India' }),
  );
} else {
  logger.warn(
    'OPENAI_API_KEY missing — OpenAiDiscoverySource not registered; SerpAPI X-ray is primary',
  );
}
discoveryRegistry.register(
  new SerpApiXRaySource(config.SERPAPI_API_KEY, { restrictToCountry: 'IN' }),
);

// ─── Email verifier (D2 — verified-only sends) ─────────────────────────────
emailVerifierRegistry.register(new ReoonVerifier(config.REOON_API_KEY));

// ─── Email finders — Snov first (crawled data), Pattern fallback ──────────
// Snov is optional at config level; skip registration if creds are absent.
// Pattern finder always registers — it uses the verifier registry to brute
// patterns, so it's a safety net when Snov quota runs out or isn't configured.
if (config.SNOV_CLIENT_ID && config.SNOV_CLIENT_SECRET) {
  emailFinderRegistry.register(
    new SnovFinder(config.SNOV_CLIENT_ID, config.SNOV_CLIENT_SECRET),
  );
} else {
  logger.warn(
    'SNOV_CLIENT_ID/SNOV_CLIENT_SECRET missing — SnovFinder not registered; PatternHeuristicFinder covers',
  );
}
emailFinderRegistry.register(new PatternHeuristicFinder(emailVerifierRegistry));

export function createApp(): express.Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));

  // Minimal CORS — Chrome extensions call us from a `chrome-extension://`
  // origin that varies per install. We echo the origin only when it's a
  // chrome-extension scheme OR the local web dashboard. Everything else is
  // ignored (not blocked here — the shared-secret header is still the real gate).
  app.use((req, res, next) => {
    const origin = req.header('Origin');
    if (
      origin &&
      (origin.startsWith('chrome-extension://') ||
        origin === 'http://localhost:5173' ||
        origin === 'http://127.0.0.1:5173')
    ) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header(
        'Access-Control-Allow-Headers',
        'Content-Type, X-Hired-Secret',
      );
      res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
      if (req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
      }
    }
    next();
  });

  // Public: monitoring. No secret required.
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, version: '0.0.1' });
  });

  // Public OAuth endpoints: reached via full-page browser navigation and
  // Google's redirect, which cannot carry the X-Hired-Secret header. Mounted
  // BEFORE the shared-secret gate. Safe because: loopback-only bind, the
  // consent flow is nonce-protected, and the callback only ever stores tokens
  // for accounts the user themselves authorized in Google's own consent UI.
  app.use('/api/auth', authPublicRouter);

  // Everything below this line requires the shared secret.
  app.use('/api', sharedSecret);

  app.use('/api/jobs', jobsRouter);
  app.use('/api/agent', agentRouter);
  // Protected OAuth endpoints (list/disconnect) — normal dashboard XHR.
  app.use('/api/auth', authProtectedRouter);
  // R&D only — compare OpenAI vs Gemini discovery adapters side-by-side.
  // Remove or feature-flag before main merge once a winner is picked.
  app.use('/api/discovery-test', discoveryTestRouter);
  // Dev-only — live-validate the inbound-poll pipeline against real Gmail
  // messages (list recent LinkedIn emails, replay one through processMessage).
  // Feature-flag or remove before main merge.
  app.use('/api/dev', devRouter);

  app.use(errorHandler);

  return app;
}

// Only boot if this file is the entrypoint (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('index.ts')) {
  const app = createApp();
  const server = app.listen(config.PORT, '127.0.0.1', () => {
    logger.info(
      { port: config.PORT, env: config.NODE_ENV },
      'hired server booted',
    );
    // Start the inbound poll AFTER the HTTP server is listening so the
    // process is observably alive before background traffic starts. The
    // cron is a no-op when no Gmail accounts are connected yet.
    startInboundPollCron(config.NODE_ENV);
  });

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'shutting down');
    stopInboundPollCron();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
