/**
 * Popup logic — one-time entry of the shared secret from the user's .env.
 * Stored in chrome.storage.local; content script reads it before every POST.
 */

const SERVER_HEALTH_URL = 'http://127.0.0.1:4000/api/health';

const secretInput = document.getElementById('secret') as HTMLInputElement;
const saveBtn = document.getElementById('save') as HTMLButtonElement;
const testBtn = document.getElementById('test') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLSpanElement;

function setStatus(message: string, kind: 'ok' | 'err' | 'neutral' = 'neutral'): void {
  statusEl.textContent = message;
  statusEl.className = 'status' + (kind === 'ok' ? ' ok' : kind === 'err' ? ' err' : '');
}

// Prefill if already stored.
chrome.storage.local.get('sharedSecret').then((data) => {
  if (typeof data['sharedSecret'] === 'string') {
    secretInput.value = data['sharedSecret'];
    setStatus('secret loaded', 'ok');
  }
});

saveBtn.addEventListener('click', async () => {
  const value = secretInput.value.trim();
  if (value.length < 32) {
    setStatus('secret must be at least 32 chars', 'err');
    return;
  }
  await chrome.storage.local.set({ sharedSecret: value });
  setStatus('saved', 'ok');
});

testBtn.addEventListener('click', async () => {
  setStatus('testing…');
  try {
    const res = await fetch(SERVER_HEALTH_URL);
    if (res.ok) {
      const body = (await res.json()) as { ok?: boolean; version?: string };
      setStatus(`server ok · v${body.version ?? '?'}`, 'ok');
    } else {
      setStatus(`server responded ${res.status}`, 'err');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    setStatus(`cannot reach server: ${message}`, 'err');
  }
});
