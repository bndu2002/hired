/**
 * App settings routes — generic KV surface for the Configure UI.
 *
 *   GET  /api/settings          → { settings: Setting[] }
 *   GET  /api/settings/:key     → Setting            (404 when missing)
 *   PUT  /api/settings/:key     → Setting            (upsert)
 *
 * Zod validates both the key shape (lowercase identifiers + `.` separators,
 * no path tricks) and the value size (templates aren't that big; cap at a
 * sane upper bound). The repo is the only thing that touches `app_settings`;
 * routes stay thin.
 *
 * There's no DELETE in v1 — "clearing" a template means PUT-ing an empty
 * string, which the orchestrator can decide to treat as "no outreach copy
 * configured" rather than a 404 at render time. Keeping the surface tight.
 */

import { type Router as RouterType, Router } from 'express';
import { z } from 'zod';
import { logger } from '../logger.js';
import * as settingRepo from '../db/repositories/setting.repo.js';

export const settingsRouter: RouterType = Router();

// ─── validators ─────────────────────────────────────────────────────────────

/**
 * Key format: `linkedin.connect_template`, `gmail.subject`. Must start with
 * a lowercase letter so clients can't ping arbitrary paths. Dots are the
 * hierarchy separator; underscores allowed inside a segment.
 */
const KEY_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;
const keySchema = z.string().min(1).max(128).regex(KEY_RE, {
  message:
    'key must be lowercase identifier segments joined by dots (e.g. "linkedin.connect_template")',
});

/**
 * Values hold template bodies, display names, and the like. 20 KB cap — more
 * than any sensible outreach copy, less than something an abusive client
 * could use to fill up Postgres text storage via a stuck request.
 */
const valueSchema = z.string().max(20_000);

const putBodySchema = z.object({
  value: valueSchema,
});

// ─── GET /api/settings ──────────────────────────────────────────────────────

settingsRouter.get('/', async (_req, res, next) => {
  try {
    const settings = await settingRepo.listAll();
    res.json({ settings });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/settings/:key ────────────────────────────────────────────────

settingsRouter.get('/:key', async (req, res, next) => {
  try {
    const parsed = keySchema.safeParse(req.params.key);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: 'invalid_key', details: parsed.error.flatten() });
      return;
    }
    const key = parsed.data;

    const setting = await settingRepo.get(key);
    if (!setting) {
      res.status(404).json({ error: 'not_found', key });
      return;
    }
    res.json(setting);
  } catch (err) {
    next(err);
  }
});

// ─── PUT /api/settings/:key ────────────────────────────────────────────────

settingsRouter.put('/:key', async (req, res, next) => {
  try {
    const parsedKey = keySchema.safeParse(req.params.key);
    if (!parsedKey.success) {
      res
        .status(400)
        .json({ error: 'invalid_key', details: parsedKey.error.flatten() });
      return;
    }
    const parsedBody = putBodySchema.safeParse(req.body);
    if (!parsedBody.success) {
      res
        .status(400)
        .json({ error: 'invalid_payload', details: parsedBody.error.flatten() });
      return;
    }

    const key = parsedKey.data;
    const { value } = parsedBody.data;

    const setting = await settingRepo.set(key, value);
    logger.info({ key, valueLength: value.length }, 'setting upserted');
    res.json(setting);
  } catch (err) {
    next(err);
  }
});
