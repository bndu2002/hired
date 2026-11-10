/**
 * Activity routes — the HTTP surface the My Activity page consumes.
 *
 *   GET  /api/activity    → { tabCounts, runs: [...] }
 *
 * One endpoint, one shape, everything up-front. Filters (search, status,
 * date range) are applied client-side in v1 (my-activity-brief.md § v1
 * scope cut). When data volumes grow past ~100 runs we'll add query
 * params + server-side pushdown; profile first, optimize later.
 */

import { type Router as RouterType, Router } from 'express';
import * as activityService from '../services/activity.js';

export const activityRouter: RouterType = Router();

activityRouter.get('/', async (_req, res, next) => {
  try {
    const result = await activityService.listActivity();
    res.json(result);
  } catch (err) {
    next(err);
  }
});
