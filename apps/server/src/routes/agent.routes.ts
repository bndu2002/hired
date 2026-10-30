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

/**
 * One contact's channel ticks in the Run Agent modal. Zod enforces at least
 * one channel ticked per row — a row with both false shouldn't be in the
 * payload at all; the UI only ships rows the user actually selected.
 */
const selectionSchema = z
  .object({
    contactId: z.number().int().positive(),
    gmail: z.boolean(),
    linkedin: z.boolean(),
  })
  .refine((s) => s.gmail || s.linkedin, {
    message: 'selection must have at least one channel set to true',
  });

const sendBody = z.object({
  runId: z.number().int().positive(),
  // Spec: 1-8 contacts per run (MAX_CONTACTS_PER_RUN). Allow up to 8 here.
  selections: z.array(selectionSchema).min(1).max(8),
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

// ─── POST /api/agent/send ───────────────────────────────────────────────────

agentRouter.post('/send', async (req, res, next) => {
  try {
    const parsed = sendBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'invalid_payload',
        details: parsed.error.flatten(),
      });
      return;
    }

    const result = await orchestrator.runSendPhase(parsed.data);

    switch (result.status) {
      case 'ok':
        res.json({
          runId: result.runId,
          linkedinConnectDrafted: result.linkedinConnectDrafted,
          skipped: result.skipped,
        });
        return;

      case 'run_not_found':
        res.status(404).json({
          error: 'run_not_found',
          runId: result.runId,
        });
        return;

      case 'invalid_selections':
        res.status(400).json({
          error: 'invalid_selections',
          reason: result.reason,
          offendingContactIds: result.offendingContactIds,
        });
        return;

      default: {
        const _exhaustive: never = result;
        void _exhaustive;
        logger.error({ result }, 'unhandled SendResult status');
        res.status(500).json({ error: 'internal_error' });
        return;
      }
    }
  } catch (err) {
    next(err);
  }
});
