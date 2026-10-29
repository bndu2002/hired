import { describe, expect, it } from 'vitest';
import type { AppEvent, GmailStatus, LinkedinStatus } from '@hired/types';
import {
  canApplyGmailEvent,
  canApplyLinkedinEvent,
  nextGmailStatus,
  nextLinkedinStatus,
  projectGmailStatus,
  projectLinkedinStatus,
} from '../stateMachines.js';

/**
 * Builders — one-liner event construction keeps tests readable. The payload
 * detail doesn't matter for most status transitions; we fill required fields
 * with placeholder values.
 */

function discovery(): AppEvent {
  return {
    type: 'contact_discovered',
    payload: { discoveredVia: 'openai_web_search' },
  };
}

function connectDrafted(): AppEvent {
  return { type: 'linkedin_connect_drafted', payload: {} };
}
function connectSent(): AppEvent {
  return { type: 'linkedin_connect_sent', payload: {} };
}
function acceptance(): AppEvent {
  return {
    type: 'linkedin_acceptance_detected',
    payload: { fromGmailMessageId: 'abc' },
  };
}
function dmDrafted(): AppEvent {
  return { type: 'linkedin_dm_drafted', payload: { renderedBody: 'hi' } };
}
function dmSent(): AppEvent {
  return { type: 'linkedin_dm_sent', payload: {} };
}

function gmailQueued(): AppEvent {
  return { type: 'gmail_queued', payload: {} };
}
function gmailSent(): AppEvent {
  return {
    type: 'gmail_sent',
    payload: { threadId: 't1', messageId: 'm1' },
  };
}
function gmailBounced(): AppEvent {
  return {
    type: 'gmail_bounced',
    payload: { threadId: 't1', reason: 'User unknown' },
  };
}

function reply(channel: 'gmail' | 'linkedin'): AppEvent {
  return {
    type: 'reply_received',
    payload: { channel, snippet: 'yes thanks' },
  };
}

// ─── LinkedIn ───────────────────────────────────────────────────────────────

describe('nextLinkedinStatus — happy path transitions', () => {
  it('PENDING + connect_drafted → CONNECT_DRAFTED', () => {
    expect(nextLinkedinStatus('PENDING', connectDrafted())).toBe(
      'CONNECT_DRAFTED',
    );
  });

  it('CONNECT_DRAFTED + connect_sent → CONNECT_SENT', () => {
    expect(nextLinkedinStatus('CONNECT_DRAFTED', connectSent())).toBe(
      'CONNECT_SENT',
    );
  });

  it('PENDING + connect_sent → CONNECT_SENT (skip drafted)', () => {
    expect(nextLinkedinStatus('PENDING', connectSent())).toBe('CONNECT_SENT');
  });

  it('CONNECT_SENT + acceptance → CONNECTED', () => {
    expect(nextLinkedinStatus('CONNECT_SENT', acceptance())).toBe('CONNECTED');
  });

  it('CONNECTED + dm_drafted → DM_DRAFTED', () => {
    expect(nextLinkedinStatus('CONNECTED', dmDrafted())).toBe('DM_DRAFTED');
  });

  it('DM_DRAFTED + dm_sent → DM_SENT', () => {
    expect(nextLinkedinStatus('DM_DRAFTED', dmSent())).toBe('DM_SENT');
  });

  it('CONNECTED + dm_sent → DM_SENT (skip drafted)', () => {
    expect(nextLinkedinStatus('CONNECTED', dmSent())).toBe('DM_SENT');
  });

  it('DM_SENT + reply(linkedin) → REPLIED', () => {
    expect(nextLinkedinStatus('DM_SENT', reply('linkedin'))).toBe('REPLIED');
  });

  it('CONNECTED + reply(linkedin) → REPLIED (early reply before our DM)', () => {
    expect(nextLinkedinStatus('CONNECTED', reply('linkedin'))).toBe('REPLIED');
  });
});

describe('nextLinkedinStatus — idempotency', () => {
  it('CONNECT_SENT + connect_sent again → CONNECT_SENT (no-op)', () => {
    expect(nextLinkedinStatus('CONNECT_SENT', connectSent())).toBe(
      'CONNECT_SENT',
    );
  });

  it('CONNECTED + acceptance again → CONNECTED (no-op)', () => {
    expect(nextLinkedinStatus('CONNECTED', acceptance())).toBe('CONNECTED');
  });

  it('REPLIED + reply(linkedin) again → REPLIED (no-op)', () => {
    expect(nextLinkedinStatus('REPLIED', reply('linkedin'))).toBe('REPLIED');
  });
});

describe('nextLinkedinStatus — illegal transitions throw', () => {
  it('CONNECTED + connect_drafted throws (backward)', () => {
    expect(() => nextLinkedinStatus('CONNECTED', connectDrafted())).toThrow(
      /illegal transition/,
    );
  });

  it('PENDING + acceptance throws (we never sent an invite)', () => {
    expect(() => nextLinkedinStatus('PENDING', acceptance())).toThrow(
      /illegal transition/,
    );
  });

  it('PENDING + reply(linkedin) throws (nothing to reply to)', () => {
    expect(() => nextLinkedinStatus('PENDING', reply('linkedin'))).toThrow(
      /illegal transition/,
    );
  });

  it('CONNECT_SENT + dm_drafted throws (need acceptance first)', () => {
    expect(() => nextLinkedinStatus('CONNECT_SENT', dmDrafted())).toThrow(
      /illegal transition/,
    );
  });
});

describe('nextLinkedinStatus — passthroughs', () => {
  it('non-LinkedIn events do not change status', () => {
    expect(nextLinkedinStatus('CONNECT_SENT', discovery())).toBe(
      'CONNECT_SENT',
    );
    expect(nextLinkedinStatus('CONNECT_SENT', gmailSent())).toBe(
      'CONNECT_SENT',
    );
  });

  it('reply(gmail) does not change linkedin status', () => {
    expect(nextLinkedinStatus('DM_SENT', reply('gmail'))).toBe('DM_SENT');
  });
});

describe('projectLinkedinStatus — full stream replays', () => {
  it('empty stream → PENDING', () => {
    expect(projectLinkedinStatus([])).toBe('PENDING');
  });

  it('full happy path → REPLIED', () => {
    const events = [
      discovery(),
      connectDrafted(),
      connectSent(),
      acceptance(),
      dmDrafted(),
      dmSent(),
      reply('linkedin'),
    ];
    expect(projectLinkedinStatus(events)).toBe('REPLIED');
  });

  it('duplicate events in stream are idempotent', () => {
    const events = [
      connectSent(),
      connectSent(),
      acceptance(),
      acceptance(),
    ];
    expect(projectLinkedinStatus(events)).toBe('CONNECTED');
  });

  it('malformed stream (acceptance before invite) throws', () => {
    expect(() =>
      projectLinkedinStatus([discovery(), acceptance()]),
    ).toThrow(/illegal transition/);
  });
});

// ─── Gmail ──────────────────────────────────────────────────────────────────

describe('nextGmailStatus — happy path transitions', () => {
  it('PENDING + queued → QUEUED', () => {
    expect(nextGmailStatus('PENDING', gmailQueued())).toBe('QUEUED');
  });

  it('QUEUED + sent → SENT', () => {
    expect(nextGmailStatus('QUEUED', gmailSent())).toBe('SENT');
  });

  it('PENDING + sent → SENT (skip queued)', () => {
    expect(nextGmailStatus('PENDING', gmailSent())).toBe('SENT');
  });

  it('SENT + bounced → BOUNCED', () => {
    expect(nextGmailStatus('SENT', gmailBounced())).toBe('BOUNCED');
  });

  it('SENT + reply(gmail) → REPLIED', () => {
    expect(nextGmailStatus('SENT', reply('gmail'))).toBe('REPLIED');
  });
});

describe('nextGmailStatus — idempotency and passthroughs', () => {
  it('SENT + sent again → SENT (no-op)', () => {
    expect(nextGmailStatus('SENT', gmailSent())).toBe('SENT');
  });

  it('reply(linkedin) does not change gmail status', () => {
    expect(nextGmailStatus('SENT', reply('linkedin'))).toBe('SENT');
  });

  it('non-gmail events pass through', () => {
    expect(nextGmailStatus('SENT', connectSent())).toBe('SENT');
    expect(nextGmailStatus('PENDING', discovery())).toBe('PENDING');
  });
});

describe('nextGmailStatus — illegal transitions throw', () => {
  it('PENDING + bounced throws (nothing to bounce)', () => {
    expect(() => nextGmailStatus('PENDING', gmailBounced())).toThrow(
      /illegal transition/,
    );
  });

  it('PENDING + reply(gmail) throws (nothing to reply to)', () => {
    expect(() => nextGmailStatus('PENDING', reply('gmail'))).toThrow(
      /illegal transition/,
    );
  });

  it('QUEUED + bounced throws (not sent yet)', () => {
    expect(() => nextGmailStatus('QUEUED', gmailBounced())).toThrow(
      /illegal transition/,
    );
  });
});

describe('projectGmailStatus — full stream replays', () => {
  it('empty stream → PENDING', () => {
    expect(projectGmailStatus([])).toBe('PENDING');
  });

  it('happy path to REPLIED', () => {
    expect(
      projectGmailStatus([
        discovery(),
        gmailQueued(),
        gmailSent(),
        reply('gmail'),
      ]),
    ).toBe('REPLIED');
  });

  it('bounce after send → BOUNCED', () => {
    expect(projectGmailStatus([gmailSent(), gmailBounced()])).toBe('BOUNCED');
  });
});

// ─── canApply predicates ────────────────────────────────────────────────────

describe('canApplyLinkedinEvent', () => {
  it('true for a legal transition', () => {
    expect(canApplyLinkedinEvent('PENDING', connectDrafted())).toBe(true);
  });

  it('true for idempotent repeat', () => {
    expect(canApplyLinkedinEvent('CONNECT_SENT', connectSent())).toBe(true);
  });

  it('false for an illegal backward transition', () => {
    expect(canApplyLinkedinEvent('CONNECTED', connectDrafted())).toBe(false);
  });

  it('true for a non-affecting event', () => {
    expect(canApplyLinkedinEvent('PENDING', discovery())).toBe(true);
  });
});

describe('canApplyGmailEvent', () => {
  it('true for a legal transition', () => {
    expect(canApplyGmailEvent('PENDING', gmailSent())).toBe(true);
  });

  it('false for illegal (bounce before send)', () => {
    expect(canApplyGmailEvent('PENDING', gmailBounced())).toBe(false);
  });
});

// ─── exhaustive status × event coverage ─────────────────────────────────────

/**
 * Sanity check that nextLinkedinStatus never crashes with an unexpected
 * TypeError for any (status, event-type) pair. It either returns the current
 * status or throws a well-formed "illegal transition" error — never an
 * undefined access.
 */
describe('exhaustive coverage', () => {
  const linkedinStatuses: readonly LinkedinStatus[] = [
    'PENDING',
    'CONNECT_DRAFTED',
    'CONNECT_SENT',
    'CONNECTED',
    'DM_DRAFTED',
    'DM_SENT',
    'REPLIED',
    'DECLINED',
  ];
  const gmailStatuses: readonly GmailStatus[] = [
    'PENDING',
    'QUEUED',
    'SENT',
    'REPLIED',
    'BOUNCED',
    'FAILED',
  ];
  const allEvents: AppEvent[] = [
    discovery(),
    connectDrafted(),
    connectSent(),
    acceptance(),
    dmDrafted(),
    dmSent(),
    gmailQueued(),
    gmailSent(),
    gmailBounced(),
    reply('gmail'),
    reply('linkedin'),
  ];

  it('nextLinkedinStatus either returns a valid status or throws cleanly', () => {
    for (const s of linkedinStatuses) {
      for (const e of allEvents) {
        try {
          const r = nextLinkedinStatus(s, e);
          expect(linkedinStatuses).toContain(r);
        } catch (err) {
          expect(err).toBeInstanceOf(Error);
          expect((err as Error).message).toMatch(/illegal transition/);
        }
      }
    }
  });

  it('nextGmailStatus either returns a valid status or throws cleanly', () => {
    for (const s of gmailStatuses) {
      for (const e of allEvents) {
        try {
          const r = nextGmailStatus(s, e);
          expect(gmailStatuses).toContain(r);
        } catch (err) {
          expect(err).toBeInstanceOf(Error);
          expect((err as Error).message).toMatch(/illegal transition/);
        }
      }
    }
  });
});
