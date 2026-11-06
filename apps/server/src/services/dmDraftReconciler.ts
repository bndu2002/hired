/**
 * DM-draft reconciliation loop — closes the "contact stranded in
 * CONNECTED without a draft" failure mode.
 *
 * The inline auto-draft (fired by the acceptance handler in
 * `gmailInboundPoller.ts`) is a best-effort side effect of acceptance
 * detection. If the server dies BETWEEN persisting
 * `linkedin_acceptance_detected` + flipping status to CONNECTED AND
 * running the auto-draft, the DM never gets rendered. On restart, the
 * handler's idempotent-skip rule treats the contact as "already
 * CONNECTED, nothing to do" and never retries. The real-world case
 * that surfaced this: Md Hussain, Nov 1 2026 — acceptance landed,
 * status flipped, process went off, no draft.
 *
 * This reconciler is the recovery path. It's driven by DB state, not
 * by event flow, so it doesn't care how a contact ended up in
 * CONNECTED-without-a-draft; if the invariant is violated, it heals.
 *
 * Call sites (both expected to invoke on every pass; cheap one-query):
 *   - server boot (index.ts), right after settings seeder, before the
 *     inbound-poll cron starts
 *   - inbound-poll tick start, before per-account polls
 *
 * Non-throwing. Any per-contact failure (template missing, render
 * error, DB hiccup) is caught, logged, counted, and we continue to
 * the next contact. The result summary lets the caller log one line
 * per invocation.
 */

import * as contactRepo from '../db/repositories/contact.repo.js';
import { logger } from '../logger.js';
import { autoDraftDmForContact } from './dmDraftRenderer.js';

export interface ReconcileResult {
  readonly scanned: number;
  readonly repaired: number;
  readonly skipped: number;
  readonly errors: readonly string[];
}

/**
 * Scan for CONNECTED contacts missing their DM draft and auto-draft each.
 *
 * Returns a counts summary. Does not throw.
 */
export async function reconcileMissingDmDrafts(): Promise<ReconcileResult> {
  const started = Date.now();
  const needing = await contactRepo.listContactsNeedingDmDraft();

  if (needing.length === 0) {
    logger.debug(
      { scanned: 0 },
      'dm-draft reconciler: nothing to reconcile',
    );
    return { scanned: 0, repaired: 0, skipped: 0, errors: [] };
  }

  let repaired = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const contact of needing) {
    try {
      const outcome = await autoDraftDmForContact(contact);
      if (outcome.status === 'drafted') {
        repaired += 1;
      } else {
        skipped += 1;
        logger.info(
          { contactId: contact.id, skipReason: outcome.skipReason },
          'dm-draft reconciler: contact skipped',
        );
      }
    } catch (err) {
      // dmDraftRenderer rethrows non-template errors; catch here so one
      // bad contact doesn't halt the loop. Record for the summary.
      const message =
        err instanceof Error ? err.message : String(err);
      errors.push(`contact ${contact.id}: ${message}`);
      logger.error(
        { contactId: contact.id, err },
        'dm-draft reconciler: unexpected error on contact',
      );
    }
  }

  const elapsedMs = Date.now() - started;
  logger.info(
    {
      scanned: needing.length,
      repaired,
      skipped,
      errorCount: errors.length,
      elapsedMs,
    },
    'dm-draft reconciler: pass complete',
  );

  return { scanned: needing.length, repaired, skipped, errors };
}
