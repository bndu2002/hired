/**
 * LinkedIn Queue service — the backend of Phase 5's Queue UI.
 *
 * Two reads + one mutation:
 *
 *   listConnect() → every contact in CONNECT_DRAFTED, with their job
 *       context. Vandana opens the Connect tab, clicks a contact's
 *       "Open on LinkedIn", sends the connect request manually on
 *       LinkedIn itself (D1), then hits "Mark sent" in the UI.
 *
 *   listDm()      → every contact in DM_DRAFTED, with their job context
 *       AND the auto-rendered DM body (from the inbound poller's
 *       auto-draft step). Same manual-send-then-mark-sent flow.
 *
 *   markSent({ contactId, kind: 'connect' | 'dm' }) → appends the
 *       corresponding `linkedin_connect_sent` / `linkedin_dm_sent` event
 *       and advances the state machine. Idempotent — a double-click
 *       returns `already_sent` instead of appending twice (same rule
 *       the inbound poller uses).
 *
 * Nothing in this file touches LinkedIn directly. Every state transition
 * is driven by a human action in the Queue UI (D1 — no scripted
 * LinkedIn). The service is just a thin wrapper around repos + the state
 * machine so routes can stay thin and testable.
 */

import type { LinkedinStatus } from '@hired/types';
import { makeEvent } from '../core/events.js';
import {
  canApplyLinkedinEvent,
  nextLinkedinStatus,
} from '../core/stateMachines.js';
import * as contactRepo from '../db/repositories/contact.repo.js';
import * as eventRepo from '../db/repositories/event.repo.js';
import { logger } from '../logger.js';

// ─── read types ─────────────────────────────────────────────────────────────

/** One row in the Connect tab. All fields that render in the Queue card. */
export interface QueueConnectItem {
  readonly contactId: number;
  readonly name: string;
  readonly title: string | null;
  readonly linkedinUrl: string;
  readonly runId: number;
  readonly companyName: string;
  readonly jobTitle: string;
}

/** One row in the DM tab. Same as connect, plus the auto-drafted body. */
export interface QueueDmItem extends QueueConnectItem {
  readonly draft: string;
}

// ─── reads ──────────────────────────────────────────────────────────────────

/**
 * List everything the user should Connect to right now. Filters out any
 * CONNECT_DRAFTED row that somehow lost its linkedin_url (shouldn't
 * happen — the send phase skips contacts without one — but a corrupted
 * row shouldn't crash the Queue).
 */
export async function listConnect(): Promise<QueueConnectItem[]> {
  const rows = await contactRepo.listWithJobByLinkedinStatus('CONNECT_DRAFTED');
  const items: QueueConnectItem[] = [];
  for (const r of rows) {
    if (!r.linkedinUrl) {
      logger.warn(
        { contactId: r.id, status: r.linkedinStatus },
        'queue: contact in CONNECT_DRAFTED without linkedin_url — skipping',
      );
      continue;
    }
    items.push({
      contactId: r.id,
      name: r.name,
      title: r.title,
      linkedinUrl: r.linkedinUrl,
      runId: r.runId,
      companyName: r.job.companyName,
      jobTitle: r.job.jobTitle,
    });
  }
  return items;
}

/**
 * List everything the user should DM right now. A DM_DRAFTED contact
 * without a stored draft is a bug (the poller writes both or neither);
 * we skip + log loudly rather than render an empty-draft card.
 */
export async function listDm(): Promise<QueueDmItem[]> {
  const rows = await contactRepo.listWithJobByLinkedinStatus('DM_DRAFTED');
  const items: QueueDmItem[] = [];
  for (const r of rows) {
    if (!r.linkedinUrl) {
      logger.warn(
        { contactId: r.id },
        'queue: contact in DM_DRAFTED without linkedin_url — skipping',
      );
      continue;
    }
    if (!r.linkedinDmDraft) {
      logger.error(
        { contactId: r.id },
        'queue: contact in DM_DRAFTED without a stored draft — poller invariant violated',
      );
      continue;
    }
    items.push({
      contactId: r.id,
      name: r.name,
      title: r.title,
      linkedinUrl: r.linkedinUrl,
      runId: r.runId,
      companyName: r.job.companyName,
      jobTitle: r.job.jobTitle,
      draft: r.linkedinDmDraft,
    });
  }
  return items;
}

// ─── mark-sent ──────────────────────────────────────────────────────────────

export type MarkSentKind = 'connect' | 'dm';

export interface MarkSentInput {
  readonly contactId: number;
  readonly kind: MarkSentKind;
}

export type MarkSentResult =
  | {
      status: 'ok';
      contactId: number;
      kind: MarkSentKind;
      from: LinkedinStatus;
      to: LinkedinStatus;
    }
  | {
      status: 'contact_not_found';
      contactId: number;
    }
  | {
      status: 'already_sent';
      contactId: number;
      kind: MarkSentKind;
      currentStatus: LinkedinStatus;
    }
  | {
      status: 'illegal_state';
      contactId: number;
      kind: MarkSentKind;
      currentStatus: LinkedinStatus;
    };

/**
 * Record that the user manually sent the connect request / DM on LinkedIn.
 *
 * Idempotency rules match the inbound poller:
 *   - current already equals target → `already_sent` (no event append)
 *   - state machine forbids the transition → `illegal_state`
 *   - otherwise append the event + flip the status cache
 */
export async function markSent(input: MarkSentInput): Promise<MarkSentResult> {
  const contact = await contactRepo.getById(input.contactId);
  if (!contact) {
    return { status: 'contact_not_found', contactId: input.contactId };
  }

  const event =
    input.kind === 'connect'
      ? makeEvent('linkedin_connect_sent', {})
      : makeEvent('linkedin_dm_sent', {});

  if (!canApplyLinkedinEvent(contact.linkedinStatus, event)) {
    logger.info(
      {
        contactId: contact.id,
        currentStatus: contact.linkedinStatus,
        kind: input.kind,
      },
      'queue: markSent rejected — illegal transition for current status',
    );
    return {
      status: 'illegal_state',
      contactId: contact.id,
      kind: input.kind,
      currentStatus: contact.linkedinStatus,
    };
  }

  const nextStatus = nextLinkedinStatus(contact.linkedinStatus, event);
  if (nextStatus === contact.linkedinStatus) {
    // Already at target — double-click, retry after a page refresh, etc.
    // No new event. Report the no-op so the UI can show "already sent"
    // instead of "sent now".
    return {
      status: 'already_sent',
      contactId: contact.id,
      kind: input.kind,
      currentStatus: contact.linkedinStatus,
    };
  }

  await eventRepo.append(contact.id, event);
  await contactRepo.updateLinkedinStatus(contact.id, nextStatus);
  logger.info(
    {
      contactId: contact.id,
      kind: input.kind,
      from: contact.linkedinStatus,
      to: nextStatus,
    },
    'queue: markSent applied',
  );

  return {
    status: 'ok',
    contactId: contact.id,
    kind: input.kind,
    from: contact.linkedinStatus,
    to: nextStatus,
  };
}
