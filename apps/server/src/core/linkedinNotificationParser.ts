/**
 * LinkedIn notification email parser — pure, no I/O.
 *
 * Classifies a Gmail message as one of the LinkedIn notification types the
 * tracker cares about:
 *
 *   - 'connect_accepted' : "X accepted your invitation" / "you and X are now
 *                          connected". The person we sent a connect request
 *                          to said yes. We flip linkedin_status to CONNECTED.
 *   - 'message_received' : "X sent you a message" / "new message from X".
 *                          Could be a reply to our DM, or a cold incoming
 *                          message. The orchestrator decides which by looking
 *                          up the contact by linkedin_url or Gmail thread id.
 *
 * This file is in core/ so it has NO dependency on Gmail SDK types, the DB,
 * or logger. The poller extracts {from, subject, textBody, htmlBody} from a
 * Gmail message and hands those four strings here.
 *
 * The regex set is deliberately conservative — if we can't match the subject
 * confidently, we return null and the poller treats the message as "not a
 * LinkedIn notification we care about" (could be a connection request,
 * weekly digest, job alert, etc.). False negatives are cheap (we miss some
 * events, poll again on the next batch); false positives are expensive
 * (we'd flip a contact's state based on an unrelated email).
 */

// ─── types ───────────────────────────────────────────────────────────────────

export interface ParseableMessage {
  /** Raw `From:` header value, e.g. `"LinkedIn <invitations@linkedin.com>"`. */
  readonly from: string;
  /** Raw `Subject:` header value. */
  readonly subject: string;
  /** Decoded text/plain part, if present. */
  readonly textBody: string;
  /** Decoded text/html part, used as fallback for URL extraction. */
  readonly htmlBody: string;
}

export type LinkedInNotification =
  | {
      readonly kind: 'connect_accepted';
      /** canonical profile URL of the accepter. Required — if we can't find
       *  it we return null (an accept event with no identity is useless). */
      readonly linkedinUrl: string;
    }
  | {
      readonly kind: 'message_received';
      /** Profile URL of the sender. May be null — in that case the orchestrator
       *  falls back to matching by Gmail thread id. */
      readonly linkedinUrl: string | null;
    };

// ─── regex patterns ─────────────────────────────────────────────────────────

/** Matches any `*@linkedin.com` sender address. Permissive on the local part
 *  because LinkedIn uses many (invitations-noreply, messaging-noreply,
 *  notifications-noreply, etc.). */
const LINKEDIN_FROM_RE = /@linkedin\.com\b/i;

/** Subject patterns that indicate the email is a connection-accepted notice. */
const ACCEPT_SUBJECT_PATTERNS: readonly RegExp[] = [
  /\baccepted your invitation\b/i,
  /\baccepted your connection\b/i,
  /\bis now a connection\b/i,
  /\byou.{0,10}(are|'re|'ve)\s+(now\s+)?connected\b/i,
  /\byou and .+\s+are now connected\b/i,
];

/** Subject patterns that indicate the email is a new-message notice. */
const MESSAGE_SUBJECT_PATTERNS: readonly RegExp[] = [
  /\bmessage from\b/i,
  /\bsent you a message\b/i,
  /\bhas sent you\b/i,
  /\bnew message\b/i,
  /\byou have a message\b/i,
];

/**
 * Direct LinkedIn profile URL. Handles common subdomains (www, in, de, uk,
 * au, ca, br, fr, etc.) and bare `linkedin.com`. Also handles LinkedIn's
 * tracked-click prefix `/comm/` that modern notification emails insert
 * between the host and `/in/<slug>` (e.g. `in.linkedin.com/comm/in/kartik`).
 * The `/comm/` segment is stripped in `normalizeProfileUrl` so the canonical
 * form is `host/in/<slug>` regardless of source.
 *
 * Does NOT match /jobs/, /company/, /posts/, /messaging/, /comm/notifications
 * etc. Not greedy — stops at the first non-URL character (whitespace, quote,
 * `?`, `>`, etc.).
 */
const PROFILE_URL_RE =
  /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com(?:\/comm)?\/in\/[A-Za-z0-9_%-]+/gi;

// ─── helpers ────────────────────────────────────────────────────────────────

function matchesAny(haystack: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((p) => p.test(haystack));
}

/**
 * Pull the FIRST clean `linkedin.com/in/<slug>` URL out of a body. Prefers
 * text/plain; falls back to text/html (strips the HTML entity encoding Gmail
 * may use for ampersands). Returns null if nothing matches.
 */
export function extractFirstProfileUrl(
  textBody: string,
  htmlBody: string,
): string | null {
  // Reset lastIndex because /g regexes are stateful — a prior .test() call on
  // the same regex in another file could have left it mid-string.
  PROFILE_URL_RE.lastIndex = 0;
  const fromText = PROFILE_URL_RE.exec(textBody);
  if (fromText) return normalizeProfileUrl(fromText[0]);

  // Fallback: scan the HTML body with entities unescaped. href values often
  // get `&amp;` / `&quot;` wrapping; replacing them before matching avoids
  // false negatives.
  PROFILE_URL_RE.lastIndex = 0;
  const unescaped = htmlBody
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
  const fromHtml = PROFILE_URL_RE.exec(unescaped);
  return fromHtml ? normalizeProfileUrl(fromHtml[0]) : null;
}

/**
 * Trim trailing punctuation that gets caught by greedy URL matchers in
 * running text ("...view the profile at https://linkedin.com/in/foo."), and
 * strip trailing slashes so two spellings of the same profile dedupe.
 */
export function normalizeProfileUrl(url: string): string {
  // Strip common trailing punctuation that isn't a legal URL char here.
  let out = url.replace(/[.,;:!?)\]'">]+$/, '');
  // Collapse trailing slashes.
  out = out.replace(/\/+$/, '');
  // LinkedIn routes email-notification clicks through `/comm/` for tracking —
  // strip the prefix so the canonical form matches what the discovery stage
  // stores (which uses the direct `linkedin.com/in/<slug>` shape).
  out = out.replace(/(linkedin\.com)\/comm\/in\//i, '$1/in/');
  return out;
}

/**
 * Extract the slug (vanity path) from a LinkedIn profile URL.
 *
 * Different subsystems store the same person's URL with different subdomains
 * — discovery via SerpAPI often stores `in.linkedin.com/in/foo`, while
 * LinkedIn's own notification emails use `www.linkedin.com/in/foo`. Matching
 * on the slug alone bridges both. Returns null if the input isn't a profile
 * URL.
 */
export function extractLinkedInSlug(url: string): string | null {
  // Case-insensitive match on `/in/<slug>` where slug is the usual LinkedIn
  // vanity-URL alphabet. Anchoring on `/in/` avoids false positives in query
  // strings or elsewhere.
  const m = url.match(/\/in\/([A-Za-z0-9_%-]+)/i);
  if (!m || !m[1]) return null;
  return m[1].toLowerCase();
}

// ─── public API ─────────────────────────────────────────────────────────────

/**
 * Classify a Gmail message. Returns:
 *   - null                       : not a LinkedIn notification we track
 *   - 'connect_accepted'         : with the accepter's profile URL
 *   - 'message_received'         : with the sender's profile URL (or null if
 *                                  the body doesn't contain a clean one — the
 *                                  caller falls back to Gmail thread matching)
 */
export function parseLinkedInNotification(
  msg: ParseableMessage,
): LinkedInNotification | null {
  if (!LINKEDIN_FROM_RE.test(msg.from)) return null;

  const subject = msg.subject;

  if (matchesAny(subject, ACCEPT_SUBJECT_PATTERNS)) {
    const linkedinUrl = extractFirstProfileUrl(msg.textBody, msg.htmlBody);
    // Accept event is only useful with the accepter's profile URL — without
    // it we can't correlate to the contact row that sent the invite.
    if (!linkedinUrl) return null;
    return { kind: 'connect_accepted', linkedinUrl };
  }

  if (matchesAny(subject, MESSAGE_SUBJECT_PATTERNS)) {
    const linkedinUrl = extractFirstProfileUrl(msg.textBody, msg.htmlBody);
    return { kind: 'message_received', linkedinUrl };
  }

  return null;
}
