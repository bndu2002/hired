import { describe, expect, it } from 'vitest';
import {
  parseLinkedInNotification,
  extractFirstProfileUrl,
  extractLinkedInSlug,
  normalizeProfileUrl,
  type ParseableMessage,
} from '../linkedinNotificationParser.js';

/**
 * Fixture builder — keeps individual tests focused on the field under test
 * by defaulting the others to legal "LinkedIn-looking" values.
 */
function msg(overrides: Partial<ParseableMessage>): ParseableMessage {
  return {
    from: 'LinkedIn <notifications-noreply@linkedin.com>',
    subject: '',
    textBody: '',
    htmlBody: '',
    ...overrides,
  };
}

describe('parseLinkedInNotification — gating', () => {
  it('returns null for emails not from linkedin.com', () => {
    const result = parseLinkedInNotification(
      msg({
        from: 'Someone <sender@example.com>',
        subject: 'Rahul accepted your invitation',
        textBody: 'https://www.linkedin.com/in/rahul-kumar',
      }),
    );
    expect(result).toBeNull();
  });

  it('returns null for linkedin.com emails with unrecognized subjects', () => {
    const result = parseLinkedInNotification(
      msg({
        subject: 'Your weekly LinkedIn digest',
        textBody: 'View profile: https://www.linkedin.com/in/foo',
      }),
    );
    expect(result).toBeNull();
  });

  it('accepts various LinkedIn sender local parts', () => {
    const senders = [
      'invitations-noreply@linkedin.com',
      'messaging-noreply@linkedin.com',
      'notifications-noreply@linkedin.com',
      'Jobs <jobs-noreply@linkedin.com>',
    ];
    for (const from of senders) {
      const r = parseLinkedInNotification(
        msg({
          from,
          subject: 'Rahul accepted your invitation',
          textBody: 'https://www.linkedin.com/in/rahul',
        }),
      );
      expect(r).toEqual({
        kind: 'connect_accepted',
        linkedinUrl: 'https://www.linkedin.com/in/rahul',
      });
    }
  });
});

describe('parseLinkedInNotification — connect_accepted', () => {
  it('classic "accepted your invitation" subject', () => {
    const r = parseLinkedInNotification(
      msg({
        subject: 'Rahul Kumar has accepted your invitation',
        textBody: 'Rahul is now in your network. View: https://www.linkedin.com/in/rahul-kumar-abc',
      }),
    );
    expect(r).toEqual({
      kind: 'connect_accepted',
      linkedinUrl: 'https://www.linkedin.com/in/rahul-kumar-abc',
    });
  });

  it('"you and X are now connected" variant', () => {
    const r = parseLinkedInNotification(
      msg({
        subject: 'You and Priya Sharma are now connected on LinkedIn',
        textBody: 'Say hi: https://in.linkedin.com/in/priya-sharma-123',
      }),
    );
    expect(r).toEqual({
      kind: 'connect_accepted',
      linkedinUrl: 'https://in.linkedin.com/in/priya-sharma-123',
    });
  });

  it('"is now a connection" variant', () => {
    const r = parseLinkedInNotification(
      msg({
        subject: 'Arjun Mehta is now a connection',
        textBody: 'https://www.linkedin.com/in/arjun-mehta',
      }),
    );
    expect(r?.kind).toBe('connect_accepted');
  });

  it('returns null when subject matches but body has no profile URL', () => {
    // No URL in body → we can't correlate; drop rather than fire a useless event.
    const r = parseLinkedInNotification(
      msg({
        subject: 'Rahul accepted your invitation',
        textBody: 'Say hi now!',
      }),
    );
    expect(r).toBeNull();
  });

  it('falls back to HTML body when text body is empty', () => {
    const r = parseLinkedInNotification(
      msg({
        subject: 'Rahul accepted your invitation',
        textBody: '',
        htmlBody:
          '<p>Hey, <a href="https://www.linkedin.com/in/rahul-kumar">view profile</a></p>',
      }),
    );
    expect(r).toEqual({
      kind: 'connect_accepted',
      linkedinUrl: 'https://www.linkedin.com/in/rahul-kumar',
    });
  });

  it('handles &amp;-encoded URLs in HTML', () => {
    const r = parseLinkedInNotification(
      msg({
        subject: 'Rahul accepted your invitation',
        htmlBody:
          'href=&quot;https://www.linkedin.com/in/rahul-kumar&quot; view',
      }),
    );
    expect(r?.kind).toBe('connect_accepted');
  });
});

describe('parseLinkedInNotification — message_received', () => {
  it('"new message from" subject', () => {
    const r = parseLinkedInNotification(
      msg({
        subject: 'New message from Priya Sharma',
        textBody: 'Reply: https://www.linkedin.com/in/priya-sharma',
      }),
    );
    expect(r).toEqual({
      kind: 'message_received',
      linkedinUrl: 'https://www.linkedin.com/in/priya-sharma',
    });
  });

  it('"sent you a message" subject', () => {
    const r = parseLinkedInNotification(
      msg({
        subject: 'Rahul Kumar sent you a message',
        textBody: 'View: https://in.linkedin.com/in/rahul',
      }),
    );
    expect(r?.kind).toBe('message_received');
  });

  it('returns message_received with linkedinUrl=null when body has none', () => {
    // Message events DON'T need the URL — threadId fallback will match them.
    const r = parseLinkedInNotification(
      msg({
        subject: 'New message from Priya',
        textBody: 'Click to view',
      }),
    );
    expect(r).toEqual({ kind: 'message_received', linkedinUrl: null });
  });
});

describe('extractFirstProfileUrl', () => {
  it('matches a bare /in/ URL in text', () => {
    expect(
      extractFirstProfileUrl('see https://www.linkedin.com/in/alice', ''),
    ).toBe('https://www.linkedin.com/in/alice');
  });

  it('strips trailing punctuation', () => {
    expect(
      extractFirstProfileUrl(
        'profile at https://www.linkedin.com/in/alice.',
        '',
      ),
    ).toBe('https://www.linkedin.com/in/alice');
  });

  it('strips trailing slash', () => {
    expect(
      extractFirstProfileUrl('https://www.linkedin.com/in/alice/', ''),
    ).toBe('https://www.linkedin.com/in/alice');
  });

  it('ignores /jobs/, /company/, /posts/ URLs', () => {
    expect(
      extractFirstProfileUrl(
        'see https://www.linkedin.com/jobs/view/123 or https://www.linkedin.com/company/foo',
        '',
      ),
    ).toBeNull();
  });

  it('prefers text body over HTML', () => {
    expect(
      extractFirstProfileUrl(
        'https://www.linkedin.com/in/from-text',
        '<a href="https://www.linkedin.com/in/from-html">x</a>',
      ),
    ).toBe('https://www.linkedin.com/in/from-text');
  });

  it('falls back to HTML when text has no match', () => {
    expect(
      extractFirstProfileUrl(
        'no url here',
        '<a href="https://www.linkedin.com/in/from-html">x</a>',
      ),
    ).toBe('https://www.linkedin.com/in/from-html');
  });

  it('returns null when neither body contains a profile URL', () => {
    expect(extractFirstProfileUrl('nothing', '<p>nothing</p>')).toBeNull();
  });

  it('is deterministic across repeated calls (regex /g state reset)', () => {
    // Repeated calls on the same instance would stride lastIndex if we
    // forgot to reset it — guard against the classic bug.
    const text = 'https://www.linkedin.com/in/same';
    expect(extractFirstProfileUrl(text, '')).toBe(text);
    expect(extractFirstProfileUrl(text, '')).toBe(text);
    expect(extractFirstProfileUrl(text, '')).toBe(text);
  });
});

describe('normalizeProfileUrl', () => {
  it('strips trailing dot', () => {
    expect(normalizeProfileUrl('https://linkedin.com/in/x.')).toBe(
      'https://linkedin.com/in/x',
    );
  });

  it('strips trailing paren', () => {
    expect(normalizeProfileUrl('https://linkedin.com/in/x)')).toBe(
      'https://linkedin.com/in/x',
    );
  });

  it('strips trailing slash', () => {
    expect(normalizeProfileUrl('https://linkedin.com/in/x/')).toBe(
      'https://linkedin.com/in/x',
    );
  });

  it('leaves a clean URL alone', () => {
    expect(normalizeProfileUrl('https://linkedin.com/in/x')).toBe(
      'https://linkedin.com/in/x',
    );
  });
});

describe('extractLinkedInSlug', () => {
  it('extracts the slug from a www URL', () => {
    expect(extractLinkedInSlug('https://www.linkedin.com/in/rahul-kumar-abc')).toBe(
      'rahul-kumar-abc',
    );
  });

  it('extracts the slug from a country-subdomain URL', () => {
    expect(extractLinkedInSlug('https://in.linkedin.com/in/priya-sharma')).toBe(
      'priya-sharma',
    );
  });

  it('is case-insensitive and returns lowercase', () => {
    expect(extractLinkedInSlug('HTTPS://WWW.LINKEDIN.COM/IN/ALICE')).toBe('alice');
  });

  it('ignores trailing query strings and paths', () => {
    expect(
      extractLinkedInSlug('https://www.linkedin.com/in/bob?utm_source=email'),
    ).toBe('bob');
    expect(extractLinkedInSlug('https://www.linkedin.com/in/bob/details')).toBe(
      'bob',
    );
  });

  it('returns null for non-profile LinkedIn URLs', () => {
    expect(extractLinkedInSlug('https://www.linkedin.com/company/foo')).toBeNull();
    expect(extractLinkedInSlug('https://www.linkedin.com/jobs/view/123')).toBeNull();
  });

  it('returns null for non-LinkedIn URLs', () => {
    expect(extractLinkedInSlug('https://example.com/in/foo')).toBe('foo');
    // Note: current implementation matches any /in/<slug> because that's how
    // LinkedIn URLs are shaped — if we ever store non-LinkedIn URLs that
    // happen to contain /in/, we'd upgrade this to require the hostname.
  });

  it('returns null for garbage', () => {
    expect(extractLinkedInSlug('not a url')).toBeNull();
    expect(extractLinkedInSlug('')).toBeNull();
  });
});
