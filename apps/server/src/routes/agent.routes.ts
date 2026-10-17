/**
 * Agent routes.
 *
 * Slice 1: POST /api/agent/discover
 *
 * Future slices add:
 *   POST /api/agent/send              — Phase B (dispatch gmail + queue linkedin)
 *   GET  /api/agent/daily-cap         — top-bar counter in dashboard
 */

import { type Router as RouterType, Router } from 'express';
import { z } from 'zod';
import { logger } from '../logger.js';
import * as orchestrator from '../services/orchestrator.js';

export const agentRouter: RouterType = Router();

const discoverBody = z.object({
  jobId: z.number().int().positive(),
  channels: z.enum(['gmail', 'linkedin', 'both']),
});

agentRouter.post('/discover', async (req, res, next) => {
  try {
    const parsed = discoverBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'invalid_payload',
        details: parsed.error.flatten(),
      });
      return;
    }

    const result = await orchestrator.runDiscoverPhase(parsed.data);

    switch (result.status) {
      case 'ok':
        res.status(201).json({
          runId: result.runId,
          discoveredVia: result.discoveredVia,
          contacts: result.contacts,
        });
        return;

      case 'cap_reached':
        res.status(429).json({
          error: 'cap_reached',
          message: `Daily cap reached (${result.currentCount}/${result.cap}). Resumes tomorrow.`,
          currentCount: result.currentCount,
          cap: result.cap,
        });
        return;

      case 'job_not_found':
        res.status(404).json({
          error: 'job_not_found',
          jobId: result.jobId,
        });
        return;

      case 'no_discovery':
        res.status(502).json({
          error: 'no_discovery',
          runId: result.runId,
          reason: result.reason,
          message:
            result.reason === 'all_adapters_failed'
              ? 'Every discovery adapter failed. Check SerpAPI key / quota.'
              : 'Discovery completed but found no candidates. Try a different job.',
        });
        return;

      default: {
        // Exhaustiveness check — TypeScript proves this is unreachable.
        const _exhaustive: never = result;
        void _exhaustive;
        logger.error({ result }, 'unhandled DiscoverResult status');
        res.status(500).json({ error: 'internal_error' });
        return;
      }
    }
  } catch (err) {
    next(err);
  }
});
