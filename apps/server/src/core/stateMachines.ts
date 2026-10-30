/**
 * Pure state-machine projections for contact status columns.
 *
 * The `events` table is the source of truth (D3). `contacts.linkedin_status`
 * and `contacts.gmail_status` are DERIVED CACHES — reconstructable by
 * replaying every event for a given contact in chronological order through
 * `projectLinkedinStatus` / `projectGmailStatus`.
 *
 * This file is in core/ and is strictly pure: no I/O, no logger, no DB. It
 * takes AppEvent objects in and returns status strings out. Tests cover
 * every transition path.
 *
 * Design choices worth knowing:
 *
 *   - Idempotent repeats are allowed. If a `linkedin_connect_sent` arrives
 *     when we're already CONNECT_SENT (duplicate webhook, retry, etc.) we
 *     return the current state unchanged rather than throw. Replaying the
 *     event log must be deterministic even with legal-but-redundant events.
 *
 *   - Illegal BACKWARD transitions throw. A `linkedin_connect_drafted` event
 *     when we're already CONNECTED is a bug — the event writer created a
 *     nonsensical row and we want it to fail loud so we notice. This is the
 *     "programmer error" case from coding-standards.md § error handling.
 *
 *   - Forward-skipping is allowed where the design permits. `CONNECT_DRAFTED
 *     → CONNECT_SENT` is normal; so is `PENDING → CONNECT_SENT` (if the
 *     orchestrator skips the drafted step and goes straight to sending). The
 *     per-event allowlists below encode what "forward" means for each event.
 *
 *   - Events the status doesn't care about (discovery, email verify,
 *     scheduling events) return the current state unchanged. The projection
 *     reduces the entire event stream regardless; irrelevant events are
 *     no-ops.
 */

import type { AppEvent, GmailStatus, LinkedinStatus } from '@hired/types';

// ─── LinkedIn state machine ─────────────────────────────────────────────────

/**
 * For a LinkedIn-affecting event, the set of statuses that can legally
 * transition INTO its target. If current is in `from`, we move to `to`. If
 * current is already `to`, no-op. Anything else throws.
 */
const LINKEDIN_TRANSITIONS: Readonly<
  Record<
    | 'linkedin_connect_drafted'
    | 'linkedin_connect_sent'
    | 'linkedin_acceptance_detected'
    | 'linkedin_dm_drafted'
    | 'linkedin_dm_sent',
    { readonly from: ReadonlySet<LinkedinStatus>; readonly to: LinkedinStatus }
  >
> = {
  linkedin_connect_drafted: {
    from: new Set(['PENDING']),
    to: 'CONNECT_DRAFTED',
  },
  linkedin_connect_sent: {
    from: new Set(['PENDING', 'CONNECT_DRAFTED']),
    to: 'CONNECT_SENT',
  },
  linkedin_acceptance_detected: {
    from: new Set(['CONNECT_SENT']),
    to: 'CONNECTED',
  },
  linkedin_dm_drafted: {
    from: new Set(['CONNECTED']),
    to: 'DM_DRAFTED',
  },
  linkedin_dm_sent: {
    from: new Set(['CONNECTED', 'DM_DRAFTED']),
    to: 'DM_SENT',
  },
};

/** Statuses from which a received DM counts as a reply. */
const LINKEDIN_REPLY_FROM: ReadonlySet<LinkedinStatus> = new Set([
  'CONNECTED',
  'DM_DRAFTED',
  'DM_SENT',
  'REPLIED',
]);

/**
 * Apply one event to the current LinkedIn status. Returns the new status.
 * Non-LinkedIn events pass through unchanged.
 *
 * @throws if the event implies an illegal backward transition.
 */
export function nextLinkedinStatus(
  current: LinkedinStatus,
  event: AppEvent,
): LinkedinStatus {
  // reply_received is cross-channel — only apply when channel is linkedin.
  if (event.type === 'reply_received') {
    if (event.payload.channel !== 'linkedin') return current;
    if (current === 'REPLIED') return current; // idempotent
    if (!LINKEDIN_REPLY_FROM.has(current)) {
      throw new Error(
        `linkedin state machine: illegal transition ${current} + reply_received(linkedin)`,
      );
    }
    return 'REPLIED';
  }

  // Non-LinkedIn events never change linkedin_status.
  if (!(event.type in LINKEDIN_TRANSITIONS)) return current;

  const rule =
    LINKEDIN_TRANSITIONS[event.type as keyof typeof LINKEDIN_TRANSITIONS];
  if (current === rule.to) return current; // idempotent
  if (!rule.from.has(current)) {
    throw new Error(
      `linkedin state machine: illegal transition ${current} + ${event.type}`,
    );
  }
  return rule.to;
}

/**
 * Replay a full event stream in chronological order to compute the current
 * LinkedIn status. The empty stream yields PENDING.
 */
export function projectLinkedinStatus(
  events: readonly AppEvent[],
): LinkedinStatus {
  let status: LinkedinStatus = 'PENDING';
  for (const event of events) {
    status = nextLinkedinStatus(status, event);
  }
  return status;
}

// ─── Gmail state machine ────────────────────────────────────────────────────

const GMAIL_TRANSITIONS: Readonly<
  Record<
    'gmail_queued' | 'gmail_sent' | 'gmail_bounced',
    { readonly from: ReadonlySet<GmailStatus>; readonly to: GmailStatus }
  >
> = {
  gmail_queued: {
    from: new Set(['PENDING']),
    to: 'QUEUED',
  },
  gmail_sent: {
    // Allow skipping QUEUED (orchestrator may send without an explicit queue
    // step for small runs).
    from: new Set(['PENDING', 'QUEUED']),
    to: 'SENT',
  },
  gmail_bounced: {
    from: new Set(['SENT']),
    to: 'BOUNCED',
  },
};

/** Statuses from which a received email reply counts as REPLIED. */
const GMAIL_REPLY_FROM: ReadonlySet<GmailStatus> = new Set(['SENT', 'REPLIED']);

/**
 * Apply one event to the current Gmail status. Returns the new status.
 * Non-Gmail events pass through unchanged.
 *
 * @throws if the event implies an illegal backward transition.
 */
export function nextGmailStatus(
  current: GmailStatus,
  event: AppEvent,
): GmailStatus {
  if (event.type === 'reply_received') {
    if (event.payload.channel !== 'gmail') return current;
    if (current === 'REPLIED') return current;
    if (!GMAIL_REPLY_FROM.has(current)) {
      throw new Error(
        `gmail state machine: illegal transition ${current} + reply_received(gmail)`,
      );
    }
    return 'REPLIED';
  }

  if (!(event.type in GMAIL_TRANSITIONS)) return current;

  const rule = GMAIL_TRANSITIONS[event.type as keyof typeof GMAIL_TRANSITIONS];
  if (current === rule.to) return current;
  if (!rule.from.has(current)) {
    throw new Error(
      `gmail state machine: illegal transition ${current} + ${event.type}`,
    );
  }
  return rule.to;
}

export function projectGmailStatus(events: readonly AppEvent[]): GmailStatus {
  let status: GmailStatus = 'PENDING';
  for (const event of events) {
    status = nextGmailStatus(status, event);
  }
  return status;
}

// ─── pre-flight validation (used by the poller/orchestrator before append) ──

/**
 * Non-throwing check: can this event be legally applied given the current
 * status? Used by orchestrator code to decide whether to append an event or
 * skip (e.g., a duplicate webhook arrives — we want to skip, not blow up).
 */
export function canApplyLinkedinEvent(
  current: LinkedinStatus,
  event: AppEvent,
): boolean {
  try {
    nextLinkedinStatus(current, event);
    return true;
  } catch {
    return false;
  }
}

export function canApplyGmailEvent(
  current: GmailStatus,
  event: AppEvent,
): boolean {
  try {
    nextGmailStatus(current, event);
    return true;
  } catch {
    return false;
  }
}
