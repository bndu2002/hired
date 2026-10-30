/**
 * Run Agent orchestration.
 *
 * This is the brain of the system. HTTP routes are thin wrappers; the actual
 * state machine lives here. See .kiro/specs/hired/design.md § 9.
 *
 * Slice 1 implements Phase A only — discovery. Phase B (dispatch) + Phase F
 * (reply handling) land in later slices.
 */

import type { CandidateContact } from '../adapters/discovery/DiscoverySource.js';
import { DAILY_RUN_CAP, MAX_CONTACTS_PER_RUN } from '../core/constants.js';
import { makeEvent } from '../core/events.js';
import {
  canApplyLinkedinEvent,
  nextLinkedinStatus,
} from '../core/stateMachines.js';
import * as contactRepo from '../db/repositories/contact.repo.js';
import * as dailyLogRepo from '../db/repositories/dailyLog.repo.js';
import * as eventRepo from '../db/repositories/event.repo.js';
import * as jobRepo from '../db/repositories/job.repo.js';
import * as runRepo from '../db/repositories/run.repo.js';
import type { RunChannels } from '../db/repositories/run.repo.js';
import { logger } from '../logger.js';
import { discoveryRegistry } from './providerRegistry.js';

import type {
  Job,
  LinkedinStatus as LinkedinStatusType,
  PreviousContact,
} from '@hired/types';
import { companyNameToDomain } from '../core/companyDomain.js';
import { splitName } from '../core/nameSplit.js';
import type { Contact } from '../db/repositories/contact.repo.js';
import { emailFinderRegistry } from './providerRegistry.js';

// ─── types ───────────────────────────────────────────────────────────────────

export interface DiscoverInput {
  jobId: number;
  channels: RunChannels;
}

/**
 * One newly-discovered contact plus (optionally) a snapshot of the last time
 * we actually reached out to the same person — matched by linkedin_url.
 *
 * The modal uses `previouslyContacted` to default-uncheck candidates we've
 * already contacted and surface context ("Already contacted on Oct 10 · No
 * reply yet"). Cross-run dedup is soft (user can tick back on if a different
 * context justifies a second touch); see .kiro/specs/hired/design.md.
 */
export interface DiscoveredContactView {
  contact: contactRepo.Contact;
  previouslyContacted: PreviousContact | null;
}

/**
 * Discriminated union — routes `switch` on `status` to map to HTTP codes.
 * Keeping the shape rich enough that the client can render a sensible message
 * for each failure mode without magic string sniffing.
 */
export type DiscoverResult =
  | {
      status: 'ok';
      runId: number;
      contacts: DiscoveredContactView[];
      discoveredVia: string;
    }
  | {
      status: 'cap_reached';
      currentCount: number;
      cap: number;
    }
  | {
      status: 'job_not_found';
      jobId: number;
    }
  | {
      status: 'no_discovery';
      runId: number;
      reason: 'all_adapters_failed' | 'empty_results';
    };

// ─── Phase A — discovery ─────────────────────────────────────────────────────

export async function runDiscoverPhase(
  input: DiscoverInput,
): Promise<DiscoverResult> {
  // 1. Validate the job exists BEFORE touching the counter — otherwise a
  //    bogus jobId would eat one of your 4 daily runs.
  const job = await jobRepo.getJobById(input.jobId);
  if (!job) {
    logger.warn({ jobId: input.jobId }, 'runDiscoverPhase: job not found');
    return { status: 'job_not_found', jobId: input.jobId };
  }

  // 2. Atomic cap check + increment (D6). If this fails we exit before
  //    creating any state.
  const cap = await dailyLogRepo.incrementIfUnderCap(DAILY_RUN_CAP);
  if (!cap.allowed) {
    logger.info({ currentCount: cap.currentCount, cap: DAILY_RUN_CAP }, 'daily cap reached');
    return { status: 'cap_reached', currentCount: cap.currentCount, cap: DAILY_RUN_CAP };
  }

  // 3. Create the run row. From this point on, the user has "spent" one of
  //    their daily 4 even if discovery fails.
  const run = await runRepo.createRun({ jobId: job.id, channels: input.channels });
  logger.info({ runId: run.id, jobId: job.id, companyName: job.companyName }, 'run created');

  // 4. Discovery via the fallback chain. Registry handles exhausted / failing
  //    adapters internally.
  const discoveryInputFields: {
    companyName: string;
    jobTitle: string;
    jobDescription?: string;
    limit: number;
  } = {
    companyName: job.companyName,
    jobTitle: job.jobTitle,
    limit: MAX_CONTACTS_PER_RUN,
  };
  if (job.jobDescription) {
    discoveryInputFields.jobDescription = job.jobDescription;
  }

  const discovery = await discoveryRegistry.resolve<CandidateContact[]>(
    (adapter) => adapter.discover(discoveryInputFields),
  );

  if (!discovery) {
    await runRepo.updateStatus(run.id, 'FAILED');
    logger.warn({ runId: run.id }, 'discovery: all adapters failed');
    return { status: 'no_discovery', runId: run.id, reason: 'all_adapters_failed' };
  }

  if (discovery.result.length === 0) {
    await runRepo.updateStatus(run.id, 'COMPLETED');
    logger.info(
      { runId: run.id, via: discovery.via },
      'discovery: adapter returned no candidates',
    );
    return { status: 'no_discovery', runId: run.id, reason: 'empty_results' };
  }

  // 5. Cross-run dedup lookup. Done BEFORE insert so we're asking: "which
  //    of these candidates have we actually reached out to in a prior run?"
  //    The repo query filters out PENDING-only rows (discovered-never-sent),
  //    so just-discovered-again counts as fresh.
  const candidateUrls = discovery.result
    .map((c) => c.linkedinUrl)
    .filter((url): url is string => Boolean(url));
  const previouslyContactedByUrl =
    await contactRepo.findPreviousByLinkedinUrls(candidateUrls);

  // 6. Insert the contact rows in bulk.
  const contacts = await contactRepo.createMany(
    run.id,
    discovery.result.slice(0, MAX_CONTACTS_PER_RUN).map((c) => {
      const input: contactRepo.CreateContactInput = {
        name: c.name,
        discoveredVia: discovery.via,
      };
      if (c.title) input.title = c.title;
      if (c.tenureHint) input.tenureHint = c.tenureHint;
      if (c.linkedinUrl) input.linkedinUrl = c.linkedinUrl;
      return input;
    }),
  );

  // 7. Append `contact_discovered` events — one per contact. D3 append-only.
  await Promise.all(
    contacts.map((contact) =>
      eventRepo.append(
        contact.id,
        makeEvent('contact_discovered', { discoveredVia: discovery.via }),
      ),
    ),
  );

  // 8. Email resolution — only when the user asked for gmail (saves credits).
  //    Runs the finder registry per contact. D2 is enforced inside the finders
  //    themselves (Snov's internal verification OR PatternHeuristicFinder's
  //    use of our verifier), so the orchestrator trusts their verdict.
  const emailEligible =
    input.channels === 'gmail' || input.channels === 'both';
  if (emailEligible) {
    await Promise.all(
      contacts.map((contact) => resolveEmailForContact(contact, job)),
    );
  }

  // 9. Re-fetch contacts after email resolution so the returned view reflects
  //    whatever updates landed. Cheap (one query); keeps the data path linear.
  const resolvedContacts = emailEligible
    ? await contactRepo.listByRun(run.id)
    : contacts;

  // 10. Build the enriched view attaching previous-contact info to each.
  const contactViews: DiscoveredContactView[] = resolvedContacts.map((contact) => ({
    contact,
    previouslyContacted:
      (contact.linkedinUrl &&
        previouslyContactedByUrl.get(contact.linkedinUrl)) ||
      null,
  }));

  // 11. Mark the run completed for Phase A. (Slice 2 will revisit when Phase B
  //     adds a DISPATCH_PENDING state between discovery and send.)
  await runRepo.updateStatus(run.id, 'COMPLETED');

  const previouslyContactedCount = contactViews.filter(
    (v) => v.previouslyContacted !== null,
  ).length;
  const resolvedEmailCount = contactViews.filter(
    (v) => v.contact.email !== null && v.contact.emailVerified,
  ).length;
  logger.info(
    {
      runId: run.id,
      contactCount: contacts.length,
      previouslyContactedCount,
      resolvedEmailCount,
      via: discovery.via,
    },
    'discovery phase completed',
  );

  return {
    status: 'ok',
    runId: run.id,
    contacts: contactViews,
    discoveredVia: discovery.via,
  };
}

// ─── Phase B — send / draft ─────────────────────────────────────────────────

/**
 * One row's intent as reported by the Run Agent modal: a contact plus the
 * channels the user ticked for them. Either channel may be false, but at
 * least one must be true (enforced by the route-layer Zod).
 */
export interface Selection {
  readonly contactId: number;
  readonly gmail: boolean;
  readonly linkedin: boolean;
}

export interface SendInput {
  readonly runId: number;
  readonly selections: readonly Selection[];
}

/**
 * Why a contact was skipped during send. The route surfaces these in the
 * response so the UI can explain exactly what happened per contact — much
 * better than "we sent 3 of 5" with no detail.
 */
export interface SendSkip {
  readonly contactId: number;
  readonly reason:
    | 'no_linkedin_url'
    | 'linkedin_illegal_state'
    | 'linkedin_already_drafted'
    | 'gmail_not_supported_yet';
  readonly currentLinkedinStatus?: LinkedinStatusType;
}

export type SendResult =
  | {
      status: 'ok';
      runId: number;
      linkedinConnectDrafted: number;
      skipped: readonly SendSkip[];
    }
  | {
      status: 'run_not_found';
      runId: number;
    }
  | {
      status: 'invalid_selections';
      reason:
        | 'empty_selections'
        | 'nothing_to_do'
        | 'contact_not_in_run';
      offendingContactIds?: readonly number[];
    };

/**
 * Phase B — commit the user's selections from the Run Agent modal.
 *
 * In this slice we handle LinkedIn only (D1 — no scripted LinkedIn, so a
 * "send" here just means: write the `linkedin_connect_drafted` event + flip
 * status to CONNECT_DRAFTED, which makes the contact appear in the LinkedIn
 * Queue. The user does the actual Connect click on LinkedIn themselves).
 *
 * Gmail selections are explicitly deferred to a later slice; a selection
 * with `gmail: true` is accepted but surfaced in `skipped[]` with reason
 * `gmail_not_supported_yet`, so the UI can tell the user clearly.
 *
 * Idempotency: a re-POST (user double-clicks Send) will no-op per contact
 * via the state machine's `canApplyLinkedinEvent` guard and the "status
 * wouldn't change → skip the append" rule we adopted in Slice 2.
 */
export async function runSendPhase(input: SendInput): Promise<SendResult> {
  // Guard: empty selections is a routing error — the UI shouldn't let it
  // happen, but if it does we fail fast rather than silently COMPLETED.
  if (input.selections.length === 0) {
    return { status: 'invalid_selections', reason: 'empty_selections' };
  }

  // Guard: no channel ticked at all means the user hit Send with nothing
  // selected. Treat the same as empty.
  const anyChannel = input.selections.some((s) => s.gmail || s.linkedin);
  if (!anyChannel) {
    return { status: 'invalid_selections', reason: 'nothing_to_do' };
  }

  // 1. Load the run. Run-not-found gives us a crisp 404 at the route layer.
  const run = await runRepo.getRunById(input.runId);
  if (!run) {
    logger.warn({ runId: input.runId }, 'runSendPhase: run not found');
    return { status: 'run_not_found', runId: input.runId };
  }

  // 2. Load every contact in the run and index by id. We need the full
  //    Contact rows (not just ids) to read `linkedinUrl` and current
  //    `linkedinStatus` without issuing an extra per-contact query.
  const contacts = await contactRepo.listByRun(input.runId);
  const contactById = new Map<number, contactRepo.Contact>(
    contacts.map((c) => [c.id, c]),
  );

  // 3. Validate: every selected contactId must belong to this run. A
  //    mismatched id is likely a stale UI payload or a client bug — fail
  //    before mutating anything.
  const offending = input.selections
    .map((s) => s.contactId)
    .filter((id) => !contactById.has(id));
  if (offending.length > 0) {
    logger.warn(
      { runId: input.runId, offending },
      'runSendPhase: selection references contact not in run',
    );
    return {
      status: 'invalid_selections',
      reason: 'contact_not_in_run',
      offendingContactIds: offending,
    };
  }

  // 4. Process each selection. One pass; per-contact outcomes aggregated
  //    into the response. We don't bail on the first skip — a batch of 5
  //    where 1 lacks a linkedin_url should still land the other 4.
  const skipped: SendSkip[] = [];
  let linkedinConnectDrafted = 0;

  for (const selection of input.selections) {
    const contact = contactById.get(selection.contactId);
    if (!contact) continue; // unreachable after the validate step; satisfies TS

    // 4a. Record the user's intent for both channels. Append once per
    //     send-phase call — a user re-ticking different channels on retry
    //     is a legitimate new intent, so no dedup here. Status columns
    //     stay authoritative via their own setters below.
    await eventRepo.append(
      contact.id,
      makeEvent('contact_selected', {
        gmail: selection.gmail,
        linkedin: selection.linkedin,
      }),
    );
    await contactRepo.updateSelection(contact.id, {
      gmail: selection.gmail,
      linkedin: selection.linkedin,
    });

    // 4b. Gmail — deferred. Record the intent (above) but no send action
    //     in this slice. Surface explicitly so the UI can show "we noted
    //     you want to email X, but Gmail dispatch ships in a later slice".
    if (selection.gmail) {
      skipped.push({
        contactId: contact.id,
        reason: 'gmail_not_supported_yet',
      });
    }

    // 4c. LinkedIn — connect-drafted event + status flip.
    if (!selection.linkedin) continue;

    if (!contact.linkedinUrl) {
      skipped.push({ contactId: contact.id, reason: 'no_linkedin_url' });
      logger.info(
        { contactId: contact.id, runId: run.id },
        'runSendPhase: skipping linkedin — no profile URL on contact',
      );
      continue;
    }

    const connectEvent = makeEvent('linkedin_connect_drafted', {});
    if (!canApplyLinkedinEvent(contact.linkedinStatus, connectEvent)) {
      skipped.push({
        contactId: contact.id,
        reason: 'linkedin_illegal_state',
        currentLinkedinStatus: contact.linkedinStatus,
      });
      logger.info(
        {
          contactId: contact.id,
          currentStatus: contact.linkedinStatus,
          event: 'linkedin_connect_drafted',
        },
        'runSendPhase: skipping linkedin — illegal transition for current status',
      );
      continue;
    }

    const nextStatus = nextLinkedinStatus(contact.linkedinStatus, connectEvent);
    if (nextStatus === contact.linkedinStatus) {
      // Idempotent — already CONNECT_DRAFTED (user re-sent). Skip the append
      // so the event log stays clean. Same rule we adopted in Slice 2's
      // inbound handler.
      skipped.push({
        contactId: contact.id,
        reason: 'linkedin_already_drafted',
        currentLinkedinStatus: contact.linkedinStatus,
      });
      continue;
    }

    await eventRepo.append(contact.id, connectEvent);
    await contactRepo.updateLinkedinStatus(contact.id, nextStatus);
    linkedinConnectDrafted += 1;
  }

  logger.info(
    {
      runId: run.id,
      selections: input.selections.length,
      linkedinConnectDrafted,
      skipped: skipped.length,
    },
    'send phase completed',
  );

  return {
    status: 'ok',
    runId: run.id,
    linkedinConnectDrafted,
    skipped,
  };
}

// ─── email resolution per contact ────────────────────────────────────────────

/**
 * Try to find + record an email address for one contact.
 *
 * Pipeline:
 *   1. Split name into first/last. Skip if we can't get a lastName (finders
 *      can't work with single-name people — those fall back to LinkedIn-only).
 *   2. Derive the company's email domain heuristically from job.companyName.
 *   3. emailFinderRegistry.resolve() — iterates finders in order; first
 *      non-null wins. SnovFinder (if registered) is primary;
 *      PatternHeuristicFinder is the always-registered fallback.
 *   4. Log events (email_find_attempted, email_found | email_not_found) and
 *      the verification outcome (email_verified | email_unverifiable).
 *   5. UPDATE the contact row with the resolved email + flags.
 *
 * Error handling: adapter failures are expected; the registry logs them and
 * returns null. Everything that gets to this function is non-fatal — we never
 * fail the whole run because of one contact's email resolution.
 */
async function resolveEmailForContact(
  contact: Contact,
  job: Job,
): Promise<void> {
  const { firstName, lastName } = splitName(contact.name);
  if (!firstName || !lastName) {
    // Finders need both names; skip without logging an event (nothing to log).
    return;
  }

  let companyDomain: string;
  try {
    companyDomain = companyNameToDomain(job.companyName);
  } catch (err) {
    logger.warn(
      { contactId: contact.id, companyName: job.companyName, err },
      'cannot derive company domain, skipping email resolution',
    );
    return;
  }

  const findInput: {
    firstName: string;
    lastName: string;
    companyDomain: string;
    linkedinUrl?: string;
  } = { firstName, lastName, companyDomain };
  if (contact.linkedinUrl) findInput.linkedinUrl = contact.linkedinUrl;

  const resolved = await emailFinderRegistry.resolve((finder) =>
    finder.find(findInput),
  );

  await eventRepo.append(
    contact.id,
    makeEvent('email_find_attempted', {
      foundVia: resolved?.via ?? 'none',
      success: resolved !== null,
    }),
  );

  if (!resolved) {
    await eventRepo.append(
      contact.id,
      makeEvent('email_not_found', { reason: 'all finders returned null' }),
    );
    return;
  }

  await eventRepo.append(
    contact.id,
    makeEvent('email_found', {
      email: resolved.result.email,
      foundVia: resolved.via,
      confidence: resolved.result.confidence,
    }),
  );

  // D2 — the finder either used our verifier (PatternHeuristicFinder) or
  // its own (Snov). High + medium confidence are both backed by a verifier
  // saying "this is a real address or at least a reachable domain". Low
  // confidence means the finder couldn't confirm — treat as unverified.
  const emailVerified = resolved.result.confidence !== 'low';

  await contactRepo.updateEmailInfo({
    contactId: contact.id,
    email: resolved.result.email,
    emailVerified,
    emailFoundVia: resolved.via,
    emailVerifiedVia: emailVerified ? resolved.via : null,
  });

  if (emailVerified) {
    await eventRepo.append(
      contact.id,
      makeEvent('email_verified', {
        verifiedVia: resolved.via,
        status: 'valid',
      }),
    );
  } else {
    await eventRepo.append(
      contact.id,
      makeEvent('email_unverifiable', {
        verifiedVia: resolved.via,
        status: 'unknown',
        reason: `low confidence (${resolved.result.confidence})`,
      }),
    );
  }
}
