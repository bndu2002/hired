/**
 * Global error handler — the last middleware. Any uncaught error from a route
 * or earlier middleware lands here. We log the full error (for the operator)
 * and return a sanitized message to the client.
 *
 * See coding-standards.md § error handling: routes always respond; swallowed
 * errors are forbidden; this is the ONE place we catch everything.
 */

import type { NextFunction, Request, Response } from 'express';
import { logger } from '../logger.js';

// 4-arg signature is required so Express recognizes this as an error handler.
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  const message = err instanceof Error ? err.message : 'unknown_error';

  logger.error(
    {
      err,
      path: req.path,
      method: req.method,
    },
    'unhandled error in request pipeline',
  );

  if (res.headersSent) {
    // Response already started — let Express handle finalization.
    return;
  }

  res.status(500).json({
    error: 'internal_error',
    message,
  });
}
