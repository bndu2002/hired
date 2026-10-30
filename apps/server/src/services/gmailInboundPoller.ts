/**
 * Gmail inbound poller — the tracking engine.
 *
 * For each connected Google account (both roles), this service:
 *   1. Uses the stored `gmail_history_id` watermark + Gmail's users.history
 *      API to get only messages NEW since last poll (cheap incremental).
 *   2. For each new message: extracts From/Subject/body, routes through
 *      the LinkedIn notification parser (slice 2 scope) and/or the Gmail
 *      thread-id reply correlator (future Phase 4 scope — the correlator
 *      is wired now so when the sender slice stores thread_ids, replies
 *      get picked up without any poller change).
 *   3. For every match, appends the corresponding event via event.repo and
 *      updates the derived status cache via contact.repo. The state
 *      machine's `canApply*Event` predicates guard against illegal replays
 *      so a duplicate webhook or stale message won't throw.
 *   4. Advances the watermark on the account row.
 *
 * On the very first poll for a newly-connected account, there IS no
 * watermark yet. We call `users.getProfile` to establish one and return
 * without processing — we deliberately DON'T scan backlog, because the
 * mailbox could be years old. Tracking starts from "now."
 *
 * History-expired recovery: Gmail retains ~7 days of history. If our
 * watermark is older than that, `history.list` returns 404; we treat that
 * as a signal to re-baseline from the current historyId (same as first
 * poll) rather than erroring the tick.
 */

import type { gmail_v1 } from 'googleapis';
import type { AppEvent, GmailStatus, LinkedinStatus } from '@hired/types';
import { makeEvent } from '../core/events.js';
import {
  parseLinkedInNotification,
  type LinkedInNotification,
} from '../core/linkedinNotificationParser.js';
import {
  canApplyGmailEvent,
  canApplyLinkedinEvent,
  nextGmailStatus,
  nextLinkedinStatus,
} from '../core/stateMachines.js';
import * as contactRepo from '../db/repositories/contact.repo.js';
import * as eventRepo from '../db/repositories/event.repo.js';
import * as googleAccountRepo from '../db/repositories/googleAccount.repo.js';
import { logger } from '../logger.js';
import { buildGmailClient } from './gmail.js';

// ─── telemetry types ────────────────────────────────────────────────────────

export interface PollResult {
  readonly accountId: number;
  readonly email: string;
  readonly role: 'linkedin_notifications' | 'sending';
  /** null if this was a first-poll baseline establishment (no scan done). */
  readonly startedFromWatermark: string | null;
  readonly endedAtWatermark: string | null;
  readonly messagesSeen: number;
  readonly linkedinAcceptsRecorded: number;
  readonly linkedinRepliesRecorded: number;
  readonly gmailRepliesRecorded: number;
  readonly skippedUntracked: number;
  readonly errors: readonly string[];
  readonly elapsedMs: number;
}

// ─── public API ─────────────────────────────────────────────────────────────

/**
 * Poll one connected account. Safe to call concurrently with other accounts
 * (uses only account-scoped state), unsafe to call concurrently with ITSELF
 * for the same account (would process the same history twice before the
 * watermark updates). The cron caller serializes per-account.
 */
export async function pollAccount(accountId: number): Promise<PollResult> {
  const startedAt = Date.now();
  const errors: string[] = [];
  const { account, gmail } = await buildGmailClient(accountId);

  // First-poll baseline: no watermark yet, just record where we are.
  if (!account.gmailHistoryId) {
    const current = await currentHistoryId(gmail);
    if (current) {
      await googleAccountRepo.updateHistoryId(account.id, current);
    }
    logger.info(
      {
        accountId: account.id,
        email: account.email,
        role: account.role,
        establishedWatermark: current,
      },
      'gmail poll: first-run baseline established, no scan',
    );
    return {
      accountId: account.id,
      email: account.email,
      role: account.role,
      startedFromWatermark: null,
      endedAtWatermark: current,
      messagesSeen: 0,
      linkedinAcceptsRecorded: 0,
      linkedinRepliesRecorded: 0,
      gmailRepliesRecorded: 0,
      skippedUntracked: 0,
      errors,
      elapsedMs: Date.now() - startedAt,
    };
  }

  // Fetch new messages since the watermark. On 404 (history too old to serve)
  // we re-baseline so the next tick is useful rather than erroring forever.
  let messageIds: string[];
  try {
    messageIds = await collectNewMessageIds(gmail, account.gmailHistoryId);
  } catch (err) {
    const status = (err as { code?: number }).code;
    if (status === 404) {
      const current = await currentHistoryId(gmail);
      if (current) await googleAccountRepo.updateHistoryId(account.id, current);
      logger.warn(
        {
          accountId: account.id,
          email: account.email,
          oldWatermark: account.gmailHistoryId,
          newWatermark: current,
        },
        'gmail poll: history watermark expired, re-baselined',
      );
      return {
        accountId: account.id,
        email: account.email,
        role: account.role,
        startedFromWatermark: account.gmailHistoryId,
        endedAtWatermark: current,
        messagesSeen: 0,
        linkedinAcceptsRecorded: 0,
        linkedinRepliesRecorded: 0,
        gmailRepliesRecorded: 0,
        skippedUntracked: 0,
        errors: ['history_expired_rebaselined'],
        elapsedMs: Date.now() - startedAt,
      };
    }
    throw err;
  }

  let linkedinAccepts = 0;
  let linkedinReplies = 0;
  let gmailReplies = 0;
  let skipped = 0;

  for (const id of messageIds) {
    try {
      const { outcome } = await processMessage(gmail, id, account.role);
      if (outcome === 'linkedin_accept') linkedinAccepts++;
      else if (outcome === 'linkedin_reply') linkedinReplies++;
      else if (outcome === 'gmail_reply') gmailReplies++;
      else skipped++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`msg ${id}: ${msg}`);
      logger.warn(
        { accountId: account.id, messageId: id, err },
        'gmail poll: message processing failed, continuing',
      );
    }
  }

  // Advance the watermark to the latest point we've observed. We refresh
  // from the API rather than deriving from message history to be sure we
  // skip past things like label-changes that we never processed.
  const newWatermark = await currentHistoryId(gmail);
  if (newWatermark) {
    await googleAccountRepo.updateHistoryId(account.id, newWatermark);
  }

  const result: PollResult = {
    accountId: account.id,
    email: account.email,
    role: account.role,
    startedFromWatermark: account.gmailHistoryId,
    endedAtWatermark: newWatermark,
    messagesSeen: messageIds.length,
    linkedinAcceptsRecorded: linkedinAccepts,
    linkedinRepliesRecorded: linkedinReplies,
    gmailRepliesRecorded: gmailReplies,
    skippedUntracked: skipped,
    errors,
    elapsedMs: Date.now() - startedAt,
  };

  logger.info(result, 'gmail poll: account tick complete');
  return result;
}

/**
 * Poll all connected accounts across both roles. The cron calls this once per
 * tick. Returns results per account so the caller can log aggregates.
 *
 * Accounts are polled serially (not concurrently) to keep logs readable and
 * because the Gmail API is friendlier to steady traffic than bursts.
 */
export async function pollAllAccounts(): Promise<PollResult[]> {
  const linkedinAccounts = await googleAccountRepo.listByRole('linkedin_notifications');
  const sendingAccounts = await googleAccountRepo.listByRole('sending');
  const all = [...linkedinAccounts, ...sendingAccounts];

  const results: PollResult[] = [];
  for (const acct of all) {
    try {
      results.push(await pollAccount(acct.id));
    } catch (err) {
      logger.warn(
        { accountId: acct.id, email: acct.email, err },
        'gmail poll: whole-account tick failed, skipping until next tick',
      );
    }
  }
  return results;
}

// ─── Gmail-side helpers ─────────────────────────────────────────────────────

async function currentHistoryId(gmail: gmail_v1.Gmail): Promise<string | null> {
  const res = await gmail.users.getProfile({ userId: 'me' });
  return res.data.historyId ?? null;
}

/**
 * Walk users.history.list from the given watermark and return the IDs of
 * every new message that appeared in the inbox. Deduplicates — the same
 * message id can appear across multiple history records if it was e.g.
 * labeled then unlabeled.
 */
async function collectNewMessageIds(
  gmail: gmail_v1.Gmail,
  startHistoryId: string,
): Promise<string[]> {
  const seen = new Set<string>();
  let pageToken: string | undefined;

  do {
    const res = await gmail.users.history.list({
      userId: 'me',
      startHistoryId,
      historyTypes: ['messageAdded'],
      labelId: 'INBOX',
      ...(pageToken ? { pageToken } : {}),
    });

    const history = res.data.history ?? [];
    for (const entry of history) {
      for (const added of entry.messagesAdded ?? []) {
        const id = added.message?.id;
        if (id) seen.add(id);
      }
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return Array.from(seen);
}

export type MessageOutcome =
  | 'linkedin_accept'
  | 'linkedin_reply'
  | 'gmail_reply'
  | 'untracked';

/**
 * Rich result from processing one message. The poller's hot path only reads
 * `.outcome`; the dev endpoint reads everything (what the parser extracted,
 * which contact was matched, what the status transition was, why we skipped).
 */
export interface ProcessMessageResult {
  readonly outcome: MessageOutcome;
  readonly debug: {
    readonly from: string;
    readonly subject: string;
    readonly threadId: string | null;
    /** First 500 chars of each body — enough to eyeball, bounded for logs. */
    readonly textBodyPreview: string;
    readonly htmlBodyPreview: string;
    readonly parsed: LinkedInNotification | null;
    readonly matchedContactId: number | null;
    readonly matchedContactName: string | null;
    /** Status before/after for whichever channel this event affected. */
    readonly statusChange:
      | {
          channel: 'linkedin';
          from: LinkedinStatus;
          to: LinkedinStatus;
        }
      | {
          channel: 'gmail';
          from: GmailStatus;
          to: GmailStatus;
        }
      | null;
    /** Human-readable reason when outcome is 'untracked'. */
    readonly skipReason: string | null;
  };
}

/**
 * Pull one message, extract the headers + body, and route to the right
 * handler. Returns an outcome tag + debug payload. The poller discards debug;
 * the dev endpoint uses it to verify the pipeline on real messages.
 */
export async function processMessage(
  gmail: gmail_v1.Gmail,
  messageId: string,
  role: 'linkedin_notifications' | 'sending',
): Promise<ProcessMessageResult> {
  const res = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });
  const msg = res.data;
  const threadId = msg.threadId ?? null;
  const headers = headerMap(msg.payload?.headers ?? []);
  const from = headers.get('from') ?? '';
  const subject = headers.get('subject') ?? '';
  const { textBody, htmlBody } = extractBodies(msg.payload);

  const baseDebug = {
    from,
    subject,
    threadId,
    textBodyPreview: textBody.slice(0, 500),
    htmlBodyPreview: htmlBody.slice(0, 500),
  };

  // Path 1: LinkedIn notification (either inbox could see one).
  const parsed = parseLinkedInNotification({ from, subject, textBody, htmlBody });
  if (parsed) {
    return handleLinkedInNotification(parsed, messageId, baseDebug);
  }

  // Path 2: email reply correlation — only on the sending inbox, and only if
  // this message is on a thread we have a contact for.
  if (role === 'sending' && threadId) {
    const gmailResult = await handleGmailThreadReply(threadId, baseDebug);
    if (gmailResult) return gmailResult;
  }

  return {
    outcome: 'untracked',
    debug: {
      ...baseDebug,
      parsed: null,
      matchedContactId: null,
      matchedContactName: null,
      statusChange: null,
      skipReason:
        role === 'sending' && !threadId
          ? 'not a LinkedIn notification and no thread id'
          : 'not a LinkedIn notification; no matching gmail thread',
    },
  };
}

type BaseDebug = {
  readonly from: string;
  readonly subject: string;
  readonly threadId: string | null;
  readonly textBodyPreview: string;
  readonly htmlBodyPreview: string;
};

async function handleLinkedInNotification(
  parsed: LinkedInNotification,
  gmailMessageId: string,
  baseDebug: BaseDebug,
): Promise<ProcessMessageResult> {
  // Both branches need a profile URL to find the contact. The parser
  // guarantees it for 'connect_accepted'; for 'message_received' it may be
  // null, in which case we can't correlate without a thread-level signal
  // (LinkedIn notifications don't thread by sender, so we have no fallback).
  const linkedinUrl = parsed.linkedinUrl;
  if (!linkedinUrl) {
    return {
      outcome: 'untracked',
      debug: {
        ...baseDebug,
        parsed,
        matchedContactId: null,
        matchedContactName: null,
        statusChange: null,
        skipReason: 'no profile URL in message body — cannot correlate',
      },
    };
  }

  const contact = await contactRepo.findByLinkedinUrl(linkedinUrl);
  if (!contact) {
    // Legit LinkedIn notification but the person isn't in our DB (connection
    // from before we started using the tool, personal network, etc).
    return {
      outcome: 'untracked',
      debug: {
        ...baseDebug,
        parsed,
        matchedContactId: null,
        matchedContactName: null,
        statusChange: null,
        skipReason: `no contact in DB with linkedin_url matching ${linkedinUrl}`,
      },
    };
  }

  let event: AppEvent;
  if (parsed.kind === 'connect_accepted') {
    event = makeEvent('linkedin_acceptance_detected', {
      fromGmailMessageId: gmailMessageId,
    });
  } else {
    event = makeEvent('reply_received', {
      channel: 'linkedin',
      snippet: '',
    });
  }

  // Guard against illegal replay via the state machine's non-throwing
  // predicate. A duplicate acceptance for an already-CONNECTED contact,
  // for example, becomes a silent no-op rather than an error.
  if (!canApplyLinkedinEvent(contact.linkedinStatus, event)) {
    logger.info(
      {
        contactId: contact.id,
        currentStatus: contact.linkedinStatus,
        eventType: event.type,
      },
      'gmail poll: skipping linkedin event (illegal/redundant for current status)',
    );
    return {
      outcome: 'untracked',
      debug: {
        ...baseDebug,
        parsed,
        matchedContactId: contact.id,
        matchedContactName: contact.name,
        statusChange: null,
        skipReason: `event ${event.type} illegal from status ${contact.linkedinStatus}`,
      },
    };
  }

  const nextStatus = nextLinkedinStatus(contact.linkedinStatus, event);
  if (nextStatus === contact.linkedinStatus) {
    // Idempotent no-op — the state machine's `canApplyLinkedinEvent` already
    // allowed it (so this isn't a programmer error), and status won't change.
    // Skip the append entirely: `fromGmailMessageId` on the FIRST append is
    // already the audit trail for this real-world occurrence. Re-encountering
    // the same message (watermark rebaseline after a history-expired 404,
    // dev-endpoint replay, duplicate Gmail delivery) should NOT bloat the
    // event log — idempotency means safe to call again with no side effects.
    //
    // D3's "events are append-only" is about never mutating existing rows;
    // it's not a license to write duplicate rows for the same event.
    return {
      outcome: 'untracked',
      debug: {
        ...baseDebug,
        parsed,
        matchedContactId: contact.id,
        matchedContactName: contact.name,
        statusChange: null,
        skipReason: `already in status ${contact.linkedinStatus}; duplicate ${event.type} skipped`,
      },
    };
  }

  await eventRepo.append(contact.id, event);
  await contactRepo.updateLinkedinStatus(contact.id, nextStatus);
  return {
    outcome: parsed.kind === 'connect_accepted' ? 'linkedin_accept' : 'linkedin_reply',
    debug: {
      ...baseDebug,
      parsed,
      matchedContactId: contact.id,
      matchedContactName: contact.name,
      statusChange: {
        channel: 'linkedin',
        from: contact.linkedinStatus,
        to: nextStatus,
      },
      skipReason: null,
    },
  };
}

async function handleGmailThreadReply(
  threadId: string,
  baseDebug: BaseDebug,
): Promise<ProcessMessageResult | null> {
  const contact = await contactRepo.findByGmailThreadId(threadId);
  if (!contact) return null; // caller will fall through to 'untracked'

  const event: AppEvent = makeEvent('reply_received', {
    channel: 'gmail',
    snippet: '',
  });
  if (!canApplyGmailEvent(contact.gmailStatus, event)) {
    logger.info(
      {
        contactId: contact.id,
        currentStatus: contact.gmailStatus,
        eventType: event.type,
      },
      'gmail poll: skipping gmail event (illegal/redundant for current status)',
    );
    return {
      outcome: 'untracked',
      debug: {
        ...baseDebug,
        parsed: null,
        matchedContactId: contact.id,
        matchedContactName: contact.name,
        statusChange: null,
        skipReason: `event ${event.type} illegal from gmail status ${contact.gmailStatus}`,
      },
    };
  }

  const nextStatus = nextGmailStatus(contact.gmailStatus, event);
  if (nextStatus === contact.gmailStatus) {
    // Idempotent no-op — see the matching comment in
    // handleLinkedInNotification. The first `reply_received` append is the
    // audit trail; further observations of the same thread shouldn't bloat
    // the log.
    return {
      outcome: 'untracked',
      debug: {
        ...baseDebug,
        parsed: null,
        matchedContactId: contact.id,
        matchedContactName: contact.name,
        statusChange: null,
        skipReason: `already in gmail status ${contact.gmailStatus}; duplicate reply_received skipped`,
      },
    };
  }

  await eventRepo.append(contact.id, event);
  await contactRepo.updateGmailStatus(contact.id, nextStatus);
  return {
    outcome: 'gmail_reply',
    debug: {
      ...baseDebug,
      parsed: null,
      matchedContactId: contact.id,
      matchedContactName: contact.name,
      statusChange: {
        channel: 'gmail',
        from: contact.gmailStatus,
        to: nextStatus,
      },
      skipReason: null,
    },
  };
}

// ─── MIME-shape helpers ─────────────────────────────────────────────────────

function headerMap(
  headers: readonly { name?: string | null; value?: string | null }[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const h of headers) {
    if (h.name && h.value) out.set(h.name.toLowerCase(), h.value);
  }
  return out;
}

/**
 * Walk a Gmail payload tree and pull out the first `text/plain` and `text/html`
 * bodies we find. Multipart messages are recursive; single-part messages have
 * their body directly on the top-level payload.
 */
function extractBodies(payload: gmail_v1.Schema$MessagePart | undefined): {
  textBody: string;
  htmlBody: string;
} {
  let textBody = '';
  let htmlBody = '';

  function walk(part: gmail_v1.Schema$MessagePart | undefined): void {
    if (!part) return;
    const mime = part.mimeType ?? '';
    const data = part.body?.data;
    if (data) {
      if (mime === 'text/plain' && !textBody) {
        textBody = decodeBase64Url(data);
      } else if (mime === 'text/html' && !htmlBody) {
        htmlBody = decodeBase64Url(data);
      }
    }
    for (const child of part.parts ?? []) walk(child);
  }
  walk(payload);
  return { textBody, htmlBody };
}

function decodeBase64Url(data: string): string {
  // Gmail uses URL-safe base64 (RFC 4648 §5): - for +, _ for /, no padding.
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64').toString('utf-8');
}
