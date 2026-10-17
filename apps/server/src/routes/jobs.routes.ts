/**
 * Jobs routes.
 *
 * POST /api/jobs/run-via-hired  — extension pushes a scraped job
 * GET  /api/jobs                — list (recent first)
 * GET  /api/jobs/:id            — single
 */

import { type Router as RouterType, Router } from 'express';
import type { RunViaHiredResponse } from '@hired/types';
import { z } from 'zod';
import * as jobRepo from '../db/repositories/job.repo.js';
import { logger } from '../logger.js';

export const jobsRouter: RouterType = Router();

// Zod schema — the trust boundary. Payload coming from the browser extension
// is validated here before anything else touches it.
const runViaHiredBody = z.object({
  source: z.enum(['happy_agent', 'paste_link']),
  companyName: z.string().min(1).max(255),
  jobTitle: z.string().min(1).max(255),
  jobUrl: z.string().url(),
  jobDescription: z.string().max(50_000).optional(),
  mustHaveSkills: z.string().max(2_000).optional(),
  goodToHaveSkills: z.string().max(2_000).optional(),
  happyJobId: z.string().max(64).optional(),
  experienceRange: z.string().max(64).optional(),
  locationHint: z.string().max(128).optional(),
  postedHint: z.string().max(128).optional(),
});

jobsRouter.post('/run-via-hired', async (req, res, next) => {
  try {
    const parsed = runViaHiredBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'invalid_payload',
        details: parsed.error.flatten(),
      });
      return;
    }

    const { job, isNew } = await jobRepo.upsertByUrl(parsed.data);

    logger.info(
      { jobId: job.id, isNew, source: job.source },
      'job captured via extension',
    );

    const payload: RunViaHiredResponse = { jobId: job.id, isNew };
    res.status(isNew ? 201 : 200).json(payload);
  } catch (err) {
    next(err);
  }
});

jobsRouter.get('/', async (_req, res, next) => {
  try {
    const jobs = await jobRepo.listJobs();
    res.json(jobs);
  } catch (err) {
    next(err);
  }
});

jobsRouter.get('/:id', async (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.id ?? '', 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'invalid_id' });
      return;
    }
    const job = await jobRepo.getJobById(id);
    if (!job) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(job);
  } catch (err) {
    next(err);
  }
});
