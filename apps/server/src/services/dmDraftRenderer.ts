/**
 * LinkedIn DM auto-draft renderer.
 *
 * Takes a contact that's in CONNECTED state and renders their referral DM
 * template against the job's context, persists the rendered body on the
 * contact row, writes a `linkedin_dm_drafted` event, and advances the
 * state machine CONNECTED → DM_DRAFTED.
 *
 * Previously this logic lived inline inside `gmailInboundPoller.ts` and
 * fired as a side-effect of acceptance detection. It's extracted here so
 * BOTH callers can share the logic:
 *
 *   1. **Live path (poller):** when a `linkedin_acceptance_detected` event
 *      successfully flips a contact to CONNECTED, call this to render +
 *      persist in the same handler. Fast; works for the happy case.
 *
 *   2. **Reconciliation (dmDraftReconciler):** on server boot and at the
 *      start of each poll tick, scan for CONNECTED contacts with no
 *      stored draft and run this on each. Catches any contact that got
 *      stranded by a server crash between the acceptance event persisting
 *      and the inline draft call completing — the exact failure mode that
 *      left Md Hussain in CONNECTED-without-a-draft limbo during the
 *      Phase 5.3 test week.
 *
 * All failure modes are returned as a `skipped` outcome with a reason,
 * never thrown. Callers log and move on. The contact stays in CONNECTED
 * and the reconciliation loop will retry on the next pass.
 */

import type { Contact } from '../db/repositories/contact.repo.js';
import * as contactRepo from '../db/repositories/contact.repo.js';
import * as eventRepo from '../db/repositories/event.repo.js';
import * as jobRepo from '../db/repositories/job.repo.js';
import * as runRepo from '../db/repositories/run.repo.js';
import * as settingRepo from '../db/repositories/setting.repo.js';
import { makeEvent } from '../core/events.js';
import {
  canApplyLinkedinEvent,
  nextLinkedinStatus,
} from '../core/stateMachines.js';
import { render, UnresolvedTemplateVarsError } from '../core/templating.js';
import type { LinkedinStatus } from '@hired/types';
import { logger } from '../logger.js';
import { SETTING_KEYS } from './settingsSeeder.js';

// ─── public type ────────────────────────────────────────────────────────────

/**
 * Outcome of a single auto-draft attempt. Non-throwing — any failure
 * surfaces as a `skipped` with a human-readable reason the caller can log,
 * display in the dev endpoint, or expose on a Queue "render failed" badge
 * (future UX).
 */
export type DmDraftOutcome =
  | {
      readonly status: 'drafted';
      readonly renderedBody: string;
      readonly newLinkedinStatus: LinkedinStatus;
    }
  | { readonly status: 'skipped'; readonly skipReason: string };

// ─── public API ─────────────────────────────────────────────────────────────

/**
 * Render + persist the DM for one contact.
 *
 * Preconditions the caller is responsible for:
 *   - `contact.linkedinStatus === 'CONNECTED'` (otherwise the state
 *     machine's `canApplyLinkedinEvent` check inside will reject).
 *   - The caller has decided this contact actually needs a draft (either
 *     via the inline acceptance path or the reconciler's SQL filter).
 *
 * See the module header for why we have two callers.
 */
export async function autoDraftDmForContact(
  contact: Contact,
): Promise<DmDraftOutcome> {
  // 1. Resolve the Job that owns this contact's Run — we need
  //    { companyName, jobTitle, jobUrl } for template variables. Two
  //    queries; acceptances are rare (handful per day) so the chattiness
  //    is fine.
  const run = await runRepo.getRunById(contact.runId);
  if (!run) {
    logger.warn(
      { contactId: contact.id, runId: contact.runId },
      'auto DM draft: run not found for contact — skipping',
    );
    return { status: 'skipped', skipReason: 'run_not_found' };
  }
  const job = await jobRepo.getJobById(run.jobId);
  if (!job) {
    logger.warn(
      { contactId: contact.id, runId: run.id, jobId: run.jobId },
      'auto DM draft: job not found for run — skipping',
    );
    return { status: 'skipped', skipReason: 'job_not_found' };
  }

  // 2. Pull the DM template. If missing (settings not seeded, user
  //    cleared the template), skip with a clear reason.
  const dmTemplate = await settingRepo.get(SETTING_KEYS.linkedinDmTemplate);
  if (!dmTemplate || !dmTemplate.value.trim()) {
    logger.warn(
      { contactId: contact.id, key: SETTING_KEYS.linkedinDmTemplate },
      'auto DM draft: template setting missing or empty — skipping',
    );
    return { status: 'skipped', skipReason: 'template_missing' };
  }

  // 3. Build the render context. The spec (requirements.md § 4.6) names
  //    four variables: outreachEmployeeName, jobTitle, companyName, jobLink.
  //
  //    `outreachEmployeeName` resolves to the contact's FULL name — the
  //    `contacts.name` column as discovered. We deliberately do NOT split
  //    on whitespace to extract a "first name" here. splitName() treats
  //    "Md Hussain" as {firstName: "Md"} because "Md" is the first token,
  //    but "Md" is an honorific abbreviation for Muhammad, not a first
  //    name. Same breakage for "Er. MOHD SHAZEB NOMAN" (Er. is an
  //    engineering title in India), "Dr. Preeti", "Sri Ram Krishna", etc.
  //    Using the full name is strictly better for a DM to someone you
  //    don't know: no honorific heuristics, no single-token edge cases,
  //    and "Hi Md Hussain," reads professionally from a stranger.
  //
  //    splitName() still lives in core/nameSplit.ts and is used by the
  //    email-finder path where Snov actually needs {first, last}.
  const vars: Record<string, string> = {
    outreachEmployeeName: contact.name,
    jobTitle: job.jobTitle,
    companyName: job.companyName,
    jobLink: job.jobUrl,
  };

  let renderedBody: string;
  try {
    renderedBody = render(dmTemplate.value, vars);
  } catch (err) {
    if (err instanceof UnresolvedTemplateVarsError) {
      logger.warn(
        {
          contactId: contact.id,
          missing: err.missing,
          templateKey: SETTING_KEYS.linkedinDmTemplate,
        },
        'auto DM draft: template references unknown variables — skipping',
      );
      return {
        status: 'skipped',
        skipReason: `template_unresolved_vars: ${err.missing.join(',')}`,
      };
    }
    throw err;
  }

  // 4. State machine: CONNECTED + linkedin_dm_drafted → DM_DRAFTED. If the
  //    contact somehow isn't CONNECTED anymore (reconciler read it fresh
  //    just now, so it should be — but defensive), bail safely.
  const dmEvent = makeEvent('linkedin_dm_drafted', { renderedBody });
  if (!canApplyLinkedinEvent('CONNECTED', dmEvent)) {
    logger.error(
      { contactId: contact.id, currentStatus: contact.linkedinStatus },
      'auto DM draft: state machine rejected linkedin_dm_drafted from CONNECTED — unreachable',
    );
    return { status: 'skipped', skipReason: 'state_machine_rejected' };
  }
  const newStatus = nextLinkedinStatus('CONNECTED', dmEvent);

  // 5. Persist: event + status cache + stored draft. Three writes done
  //    sequentially. If the process dies between any pair, the next
  //    reconciliation pass picks up where we left off:
  //      - event only  → next poll re-reads status (still CONNECTED or
  //                      already DM_DRAFTED), replay reconstructs.
  //      - event + status → next reconcile sees status=DM_DRAFTED with
  //                         null draft, which the SQL filter in the
  //                         reconciler ignores — but see follow-up #M8
  //                         for the "DM_DRAFTED with null draft" edge
  //                         case; for now the invariant holds because
  //                         we always write draft last-of-three.
  await eventRepo.append(contact.id, dmEvent);
  await contactRepo.updateLinkedinStatus(contact.id, newStatus);
  await contactRepo.updateLinkedinDmDraft(contact.id, renderedBody);

  logger.info(
    {
      contactId: contact.id,
      runId: run.id,
      renderedBodyLength: renderedBody.length,
    },
    'auto DM draft: rendered + persisted',
  );

  return {
    status: 'drafted',
    renderedBody,
    newLinkedinStatus: newStatus,
  };
}
