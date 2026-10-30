/**
 * LinkedIn Queue routes — the HTTP surface Phase 5's Queue UI consumes.
 *
 *   GET  /api/linkedin-queue             → { connect: [...], dm: [...] }
 *   POST /api/linkedin-queue/mark-sent   → body { contactId, kind }
 *                                           202 on ok, 404 on not_found,
 *                                           409 on already_sent / illegal_state
 *
 * The route layer is thin: Zod-validate input, call the service, map the
 * service's discriminated result to the right HTTP code. All business
 * logic lives in `services/linkedinQueue.ts`.
 */

import { type Router as RouterType, Router } from 'express';
import { z } from 'zod';
import { logger } from '../logger.js';
import * as linkedinQueue from '../services/linkedinQueue.js';

export const linkedinQueueRouter: RouterType = Router();

// ─── GET /api/linkedin-queue ────────────────────────────────────────────────

linkedinQueueRouter.get('/', async (_req, res, next) => {
  try {
    const [connect, dm] = await Promise.all([
      linkedinQueue.listConnect(),
      linkedinQueue.listDm(),
    ]);
    res.json({ connect, dm });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/linkedin-queue/mark-sent ────────────────────────────────────

const markSentBody = z.object({
  contactId: z.number().int().positive(),
  kind: z.enum(['connect', 'dm']),
});

linkedinQueueRouter.post('/mark-sent', async (req, res, next) => {
  try {
    const parsed = markSentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'invalid_payload',
        details: parsed.error.flatten(),
      });
      return;
    }

    const result = await linkedinQueue.markSent(parsed.data);

    switch (result.status) {
      case 'ok':
        // 202 Accepted — the state transition landed, but the "real"
        // action (the Connect click or DM send) happened on LinkedIn
        // outside our control. 202 is a better fit than 200 OK for
        // "we've recorded the user's claim that they sent it".
        res.status(202).json({
          contactId: result.contactId,
          kind: result.kind,
          statusChange: { from: result.from, to: result.to },
        });
        return;

      case 'contact_not_found':
        res.status(404).json({
          error: 'contact_not_found',
          contactId: result.contactId,
        });
        return;

      case 'already_sent':
        // 409 Conflict — current state is incompatible with the request
        // (the client thinks there's work to do; the server disagrees).
        // Idempotent from the user's perspective, so the UI can treat
        // this the same as 'ok' for display purposes.
        res.status(409).json({
          error: 'already_sent',
          contactId: result.contactId,
          kind: result.kind,
          currentStatus: result.currentStatus,
        });
        return;

      case 'illegal_state':
        res.status(409).json({
          error: 'illegal_state',
          contactId: result.contactId,
          kind: result.kind,
          currentStatus: result.currentStatus,
          message: `cannot mark ${result.kind} sent from status ${result.currentStatus}`,
        });
        return;

      default: {
        // Exhaustiveness check — TypeScript proves this is unreachable.
        const _exhaustive: never = result;
        void _exhaustive;
        logger.error({ result }, 'unhandled MarkSentResult status');
        res.status(500).json({ error: 'internal_error' });
        return;
      }
    }
  } catch (err) {
    next(err);
  }
});
