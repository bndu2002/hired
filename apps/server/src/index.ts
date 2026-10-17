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
import { SerpApiXRaySource } from './adapters/discovery/SerpApiXRaySource.js';
import { config } from './config/index.js';
import { logger } from './logger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { sharedSecret } from './middleware/sharedSecret.js';
import { agentRouter } from './routes/agent.routes.js';
import { jobsRouter } from './routes/jobs.routes.js';
import { discoveryRegistry } from './services/providerRegistry.js';

// Register adapters once at module load. Keeping this at module scope (not
// inside createApp) means a single registration applies across tests + prod,
// and tests can clear or override by re-importing the registry module.
discoveryRegistry.register(new SerpApiXRaySource(config.SERPAPI_API_KEY));

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

  // Everything below this line requires the shared secret.
  app.use('/api', sharedSecret);

  app.use('/api/jobs', jobsRouter);
  app.use('/api/agent', agentRouter);

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
  });

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'shutting down');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
