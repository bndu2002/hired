/**
 * Structured logger. Use `logger` for all server-side logging.
 * No `console.log` in committed code (coding-standards.md § logging).
 *
 * Correlation IDs on every line: pass as the first arg to .info/.error/etc.
 *   logger.info({ requestId }, 'request handled');
 *   logger.error({ runId, err }, 'orchestrator failed');
 *
 * No PII in log messages. Reference contacts by id, not name/email.
 */

import pino from 'pino';
import { config } from './config/index.js';

const isDev = config.NODE_ENV !== 'production';

// `exactOptionalPropertyTypes` means we build two distinct option objects
// rather than conditionally setting `transport: undefined`.
export const logger = isDev
  ? pino({
      level: 'debug',
      transport: {
        target: 'pino-pretty',
        options: {
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
          singleLine: false,
        },
      },
    })
  : pino({ level: 'info' });
