/**
 * Inbound-poll cron registration.
 *
 * Schedules `pollAllAccounts()` to run every minute, with a 2s warm-up tick
 * right after boot so the first poll happens immediately rather than waiting
 * for the next minute boundary (nice for dev iteration + first-run baseline
 * establishment on newly-connected accounts).
 *
 * Overlap protection: if a tick is still running when the next one is due,
 * we skip the new tick rather than queue it. The Gmail API is friendlier to
 * steady, serial traffic than bursts; our poll is also keyed by the per-
 * account history watermark, so skipping a tick costs nothing — the next
 * tick picks up every new message since the last successful watermark.
 *
 * Design.md § 9 originally called for 15-minute polling. 60s during the
 * tracking week gives us faster feedback for first-week validation; we'll
 * dial it back once the pipeline is proven.
 */

import cron from 'node-cron';
import { pollAllAccounts, type PollResult } from '../services/gmailInboundPoller.js';
import { logger } from '../logger.js';

const CRON_EXPR = '* * * * *'; // every minute (5-field, minute-granularity)
const INITIAL_DELAY_MS = 2_000;

let tickRunning = false;
let scheduled: cron.ScheduledTask | null = null;

/**
 * Register the cron. Idempotent — calling twice is a no-op (returns the
 * same task). Exported from here and called from index.ts after the HTTP
 * server has booted.
 *
 * Skips scheduling when NODE_ENV === 'test' so test runs don't trigger
 * background Gmail traffic.
 */
export function startInboundPollCron(nodeEnv: string): void {
  if (nodeEnv === 'test') {
    logger.info('inbound poll cron: skipped (NODE_ENV=test)');
    return;
  }
  if (scheduled) {
    logger.warn('inbound poll cron: already scheduled, ignoring duplicate start');
    return;
  }

  // Warm-up tick — fire shortly after boot so the user doesn't wait a full
  // minute to see activity in logs on first boot after connecting accounts.
  setTimeout(() => {
    void runOneTick('boot');
  }, INITIAL_DELAY_MS);

  scheduled = cron.schedule(CRON_EXPR, () => {
    void runOneTick('cron');
  });

  logger.info(
    { expr: CRON_EXPR, initialDelayMs: INITIAL_DELAY_MS },
    'inbound poll cron: scheduled',
  );
}

export function stopInboundPollCron(): void {
  if (scheduled) {
    scheduled.stop();
    scheduled = null;
    logger.info('inbound poll cron: stopped');
  }
}

async function runOneTick(trigger: 'boot' | 'cron'): Promise<void> {
  if (tickRunning) {
    logger.warn({ trigger }, 'inbound poll: previous tick still running, skipping');
    return;
  }
  tickRunning = true;
  const startedAt = Date.now();
  try {
    const results = await pollAllAccounts();
    const totals = summarize(results);
    logger.info(
      { trigger, totals, elapsedMs: Date.now() - startedAt },
      'inbound poll: tick complete',
    );
  } catch (err) {
    logger.error(
      { err, trigger },
      'inbound poll: tick failed (next tick will retry)',
    );
  } finally {
    tickRunning = false;
  }
}

function summarize(results: readonly PollResult[]): {
  accounts: number;
  messagesSeen: number;
  linkedinAccepts: number;
  linkedinReplies: number;
  gmailReplies: number;
  errors: number;
} {
  return {
    accounts: results.length,
    messagesSeen: results.reduce((n, r) => n + r.messagesSeen, 0),
    linkedinAccepts: results.reduce((n, r) => n + r.linkedinAcceptsRecorded, 0),
    linkedinReplies: results.reduce((n, r) => n + r.linkedinRepliesRecorded, 0),
    gmailReplies: results.reduce((n, r) => n + r.gmailRepliesRecorded, 0),
    errors: results.reduce((n, r) => n + r.errors.length, 0),
  };
}
