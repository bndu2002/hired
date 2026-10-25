/**
 * Discovery test route — R&D only.
 *
 * POST /api/discovery-test lets Vandana invoke either the OpenAI or Gemini
 * discovery adapter directly, from curl or Postman, without touching the DB,
 * burning the daily-run cap, or going through the orchestrator.
 *
 * The response is deliberately verbose: it returns both the normalized
 * CandidateContact[] AND a `debug` object with the raw LLM response, the
 * prompts actually sent, token usage, estimated cost, and (for Gemini) the
 * grounding search queries + sources the model used. The point is to compare
 * engines side-by-side with full transparency before picking one to plug into
 * the real pipeline.
 *
 * Nothing persists here. No events, no runs, no contact rows.
 *
 * This route is intended to be removed (or at least downgraded to a dev-only
 * build flag) once the primary engine is chosen. See the branch's commit log.
 */

import { type Router as RouterType, Router } from 'express';
import { z } from 'zod';
import {
  GeminiDiscoverySource,
  type GeminiDiscoveryOptions,
} from '../adapters/discovery/GeminiDiscoverySource.js';
import {
  OpenAiDiscoverySource,
  type OpenAiDiscoveryOptions,
} from '../adapters/discovery/OpenAiDiscoverySource.js';
import { config } from '../config/index.js';
import { logger } from '../logger.js';

export const discoveryTestRouter: RouterType = Router();

// ─── request schema ─────────────────────────────────────────────────────────

const requestSchema = z.object({
  engine: z.enum(['openai', 'gemini']),
  companyName: z.string().min(1).max(255),
  /** Max profiles to request. The LLM may return fewer. */
  limit: z.number().int().min(1).max(20).default(8),
  /** Geo hint appended to the prompt (e.g. "India"). Optional. */
  country: z.string().max(64).optional(),
  /** Roles to target; falls back to each adapter's defaults if absent. */
  roles: z.array(z.string().min(1)).max(10).optional(),
  /** Override the default model (useful for A/B'ing LLM versions). */
  model: z.string().min(1).max(64).optional(),
});

// ─── route ──────────────────────────────────────────────────────────────────

discoveryTestRouter.post('/', async (req, res, next) => {
  try {
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'invalid_payload',
        details: parsed.error.flatten(),
      });
      return;
    }

    const { engine, companyName, limit, country, roles, model } = parsed.data;

    logger.info(
      { engine, companyName, limit, country: country ?? null },
      'discovery-test invoked',
    );

    const input = {
      companyName,
      jobTitle: '', // not used by LLM adapters, kept for interface conformance
      limit,
    };

    if (engine === 'openai') {
      if (!config.OPENAI_API_KEY) {
        res.status(503).json({
          error: 'engine_not_configured',
          engine,
          message:
            'OPENAI_API_KEY is not set in .env. Add it (from platform.openai.com) and restart the server.',
        });
        return;
      }

      const options: OpenAiDiscoveryOptions = {
        ...(model !== undefined ? { model } : {}),
        ...(country !== undefined ? { country } : {}),
        ...(roles !== undefined ? { roles } : {}),
      };
      const adapter = new OpenAiDiscoverySource(config.OPENAI_API_KEY, options);
      const result = await adapter.discoverWithDebug(input);
      res.json({
        engine,
        candidatesCount: result.candidates.length,
        candidates: result.candidates,
        debug: result.debug,
      });
      return;
    }

    if (engine === 'gemini') {
      const options: GeminiDiscoveryOptions = {
        ...(model !== undefined ? { model } : {}),
        ...(country !== undefined ? { country } : {}),
        ...(roles !== undefined ? { roles } : {}),
      };
      const adapter = new GeminiDiscoverySource(config.GEMINI_API_KEY, options);
      const result = await adapter.discoverWithDebug(input);
      res.json({
        engine,
        candidatesCount: result.candidates.length,
        candidates: result.candidates,
        debug: result.debug,
      });
      return;
    }

    // Exhaustiveness guard — TypeScript proves this is unreachable.
    const _never: never = engine;
    void _never;
    res.status(500).json({ error: 'unreachable' });
  } catch (err) {
    // Adapter throws on API failure (401/5xx/parse failure). Surface the
    // message so the dev can see what went wrong without digging into logs.
    const message = err instanceof Error ? err.message : 'unknown error';
    logger.warn({ err, message }, 'discovery-test adapter threw');
    if (!res.headersSent) {
      res.status(502).json({
        error: 'adapter_failed',
        message,
      });
      return;
    }
    next(err);
  }
});
