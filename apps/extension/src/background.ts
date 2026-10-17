/**
 * Hired extension — background service worker.
 *
 * Two jobs:
 *
 *   (a) Hotkey plumbing — Alt+H → forward to content script of the active
 *       Happy Agent tab. Silently ignore on any other site.
 *
 *   (b) Server proxy — content script can't do CORS to localhost reliably in
 *       MV3, so it asks us ("post-run-via-hired", payload). We attach the
 *       stored shared secret and fetch.
 */

import type { RunViaHiredPayload } from '@hired/types';

const HAPPY_HOST = 'platform.uplers.com';
const SERVER_BASE = 'http://127.0.0.1:4000';

// eslint-disable-next-line no-console
console.log('[hired] background service worker loaded');

// ─── hotkey → active tab ─────────────────────────────────────────────────────

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'run-via-hired') return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.includes(HAPPY_HOST)) {
    // Silent on non-Happy tabs — don't leak that an extension is installed.
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'run-via-hired' });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[hired] could not deliver hotkey to content script:', err);
  }
});

// ─── server proxy ────────────────────────────────────────────────────────────

interface PostMessage {
  type: 'post-run-via-hired';
  payload: RunViaHiredPayload;
}

function isPostMessage(m: unknown): m is PostMessage {
  return (
    typeof m === 'object' &&
    m !== null &&
    'type' in m &&
    (m as { type: unknown }).type === 'post-run-via-hired'
  );
}

async function postToServer(payload: RunViaHiredPayload): Promise<{
  ok: boolean;
  status?: number;
  body?: unknown;
  error?: string;
}> {
  const stored = await chrome.storage.local.get('sharedSecret');
  const secret = typeof stored['sharedSecret'] === 'string' ? stored['sharedSecret'] : '';
  if (!secret) {
    return { ok: false, error: 'no shared secret saved — open the Hired popup and paste it' };
  }

  try {
    const res = await fetch(`${SERVER_BASE}/api/jobs/run-via-hired`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hired-Secret': secret,
      },
      body: JSON.stringify(payload),
    });
    const body = (await res.json().catch(() => ({}))) as unknown;
    if (!res.ok) {
      const errMsg =
        (body as { error?: string })?.error ?? `server returned ${res.status}`;
      return { ok: false, status: res.status, body, error: errMsg };
    }
    return { ok: true, status: res.status, body };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    return { ok: false, error: `cannot reach local server: ${message}` };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!isPostMessage(msg)) return false;

  postToServer(msg.payload)
    .then(sendResponse)
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'unknown';
      sendResponse({ ok: false, error: message });
    });

  return true; // async response
});
