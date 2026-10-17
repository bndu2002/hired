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
import * as contactRepo from '../db/repositories/contact.repo.js';
import * as dailyLogRepo from '../db/repositories/dailyLog.repo.js';
import * as eventRepo from '../db/repositories/event.repo.js';
import * as jobRepo from '../db/repositories/job.repo.js';
import * as runRepo from '../db/repositories/run.repo.js';
import type { RunChannels } from '../db/repositories/run.repo.js';
import { logger } from '../logger.js';
import { discoveryRegistry } from './providerRegistry.js';

// ─── types ───────────────────────────────────────────────────────────────────

export interface DiscoverInput {
  jobId: number;
  channels: RunChannels;
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
      contacts: contactRepo.Contact[];
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

  // 5. Insert the contact rows in bulk.
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

  // 6. Append `contact_discovered` events — one per contact. D3 append-only.
  await Promise.all(
    contacts.map((contact) =>
      eventRepo.append(
        contact.id,
        makeEvent('contact_discovered', { discoveredVia: discovery.via }),
      ),
    ),
  );

  // 7. Mark the run completed for Phase A. (Slice 2 will revisit when Phase B
  //    adds a DISPATCH_PENDING state between discovery and send.)
  await runRepo.updateStatus(run.id, 'COMPLETED');

  logger.info(
    { runId: run.id, contactCount: contacts.length, via: discovery.via },
    'discovery phase completed',
  );

  return {
    status: 'ok',
    runId: run.id,
    contacts,
    discoveredVia: discovery.via,
  };
}
