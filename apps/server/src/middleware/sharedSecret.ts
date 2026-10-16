/**
 * Shared-secret middleware. All /api/* routes behind this require a matching
 * X-Hired-Secret header. The extension stores the secret in chrome.storage.local.
 *
 * This is the whole auth story for v1 — the server binds 127.0.0.1 only, and
 * the shared secret prevents other sites from making same-origin requests to
 * localhost from inside your browser (D-local-security in design.md § 16).
 */

import type { NextFunction, Request, Response } from 'express';
import { config } from '../config/index.js';

const HEADER = 'x-hired-secret';

export function sharedSecret(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const provided = req.header(HEADER);

  if (!provided) {
    res
      .status(401)
      .json({ error: 'missing_shared_secret', header: 'X-Hired-Secret' });
    return;
  }

  if (provided !== config.SHARED_SECRET) {
    res.status(401).json({ error: 'invalid_shared_secret' });
    return;
  }

  next();
}
