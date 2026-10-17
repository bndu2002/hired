/**
 * Content script injected into platform.uplers.com (Happy Agent).
 *
 * Stealth model (D1-ish for Happy):
 *   - No DOM injection, no styles, no observers by default.
 *   - On Alt+H → scrape the currently-focused job detail → ask background to
 *     POST to the local server → show a brief Shadow-DOM toast.
 *   - Nothing persists on Happy's page. Toast auto-removes after 2 seconds.
 *
 * See .kiro/specs/hired/design.md § 13 and the session planning conversation.
 */

import type { RunViaHiredPayload, RunViaHiredResponse } from '@hired/types';

const LOG_PREFIX = '[hired]';
const JOB_DETAIL_ANCHOR_ID = 'jobDetailSectionHead';
const JOB_DESCRIPTION_ID = 'hsContent';

// ─── scraper ─────────────────────────────────────────────────────────────────

/** Extract plain text from Happy's rich description HTML, preserving para/list breaks. */
function descriptionToPlainText(descEl: HTMLElement): string {
  const html = descEl.innerHTML
    .replace(/<\/p\s*>/gi, '\n\n')
    .replace(/<\/li\s*>/gi, '\n')
    .replace(/<\/h[1-6]\s*>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n');
  const scratch = document.createElement('div');
  scratch.innerHTML = html;
  return (scratch.textContent ?? '').trim().replace(/\n{3,}/g, '\n\n');
}

type ScrapeResult =
  | { ok: true; payload: RunViaHiredPayload }
  | { ok: false; reason: string };

function scrapeDetailPane(): ScrapeResult {
  const pane = document.getElementById(JOB_DETAIL_ANCHOR_ID);
  if (!pane) {
    return { ok: false, reason: 'no job focused — click a job card first' };
  }

  const titleLink = pane.querySelector<HTMLAnchorElement>('.job-role-title-link');
  const jobTitle =
    titleLink?.querySelector('span')?.textContent?.trim() ??
    titleLink?.textContent?.trim() ??
    '';
  const jobUrl = titleLink?.href || location.href;
  const companyName = pane.querySelector('.companyName')?.textContent?.trim() ?? '';

  if (!jobTitle || !companyName || !jobUrl) {
    return { ok: false, reason: 'detail pane missing title/company/url' };
  }

  const mustHave =
    document.querySelector('.must_have')?.textContent?.trim() ?? '';
  const goodToHave =
    document.querySelector('.good_to_have > div')?.textContent?.trim() ?? '';

  const attribs = Array.from(pane.querySelectorAll('.attrib')).map(
    (el) => el.textContent?.trim() ?? '',
  );

  // Attribs appear in a stable order: [exp, confidential?, location, type]
  // We pick them by content pattern since not every job has all four.
  const experienceRange = attribs.find((t) => /year|yr/i.test(t));
  const locationHint = attribs.find((t) => /remote|hybrid|onsite|office|wfh/i.test(t));

  const earlyNudge = pane.querySelector('.earlyApplicant');
  const postedHint = earlyNudge
    ? Array.from(earlyNudge.querySelectorAll('span'))
        .map((s) => s.textContent?.trim() ?? '')
        .filter(Boolean)
        .join(' · ')
    : undefined;

  const descEl = document.getElementById(JOB_DESCRIPTION_ID);
  const jobDescription = descEl ? descriptionToPlainText(descEl) : undefined;

  const happyJobId =
    new URL(location.href).searchParams.get('activeJob') ?? undefined;

  const payload: RunViaHiredPayload = {
    source: 'happy_agent',
    jobTitle,
    companyName,
    jobUrl,
  };
  if (jobDescription) payload.jobDescription = jobDescription;
  if (mustHave) payload.mustHaveSkills = mustHave;
  if (goodToHave) payload.goodToHaveSkills = goodToHave;
  if (happyJobId) payload.happyJobId = happyJobId;
  if (experienceRange) payload.experienceRange = experienceRange;
  if (locationHint) payload.locationHint = locationHint;
  if (postedHint) payload.postedHint = postedHint;

  return { ok: true, payload };
}

// ─── toast (closed Shadow DOM) ───────────────────────────────────────────────

type ToastKind = 'info' | 'success' | 'warn' | 'error';

function showToast(message: string, kind: ToastKind = 'info'): void {
  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.top = '20px';
  host.style.right = '20px';
  host.style.zIndex = '2147483647';
  host.style.pointerEvents = 'none';

  const shadow = host.attachShadow({ mode: 'closed' });
  const bg: Record<ToastKind, string> = {
    info: '#0d9488',
    success: '#16a34a',
    warn: '#d97706',
    error: '#dc2626',
  };

  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .toast {
        display: inline-block;
        padding: 10px 16px;
        background: ${bg[kind]};
        color: #ffffff;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 0.2px;
        border-radius: 8px;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
        pointer-events: auto;
        animation: fadeIn 180ms ease-out;
        max-width: 320px;
      }
      @keyframes fadeIn {
        from { opacity: 0; transform: translateY(-6px); }
        to   { opacity: 1; transform: translateY(0); }
      }
    </style>
    <div class="toast" role="status" aria-live="polite"></div>
  `;

  const node = shadow.querySelector('.toast');
  if (node) node.textContent = message;
  document.body.appendChild(host);
  setTimeout(() => host.remove(), 3000);
}

// ─── handler ─────────────────────────────────────────────────────────────────

async function handleRunViaHired(): Promise<void> {
  const scrape = scrapeDetailPane();
  if (!scrape.ok) {
    showToast(`Hired: ${scrape.reason}`, 'warn');
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: 'post-run-via-hired',
    payload: scrape.payload,
  });

  if (response?.ok) {
    const body = response.body as RunViaHiredResponse;
    const prefix = body.isNew ? 'Added' : 'Updated';
    showToast(`✓ ${prefix} — Job #${body.jobId}`, 'success');
  } else {
    const reason = response?.error ?? 'unknown error';
    showToast(`✗ Hired: ${reason}`, 'error');
  }
}

// ─── message listener ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
  if (
    typeof msg === 'object' &&
    msg !== null &&
    'type' in msg &&
    (msg as { type: unknown }).type === 'run-via-hired'
  ) {
    handleRunViaHired()
      .then(() => sendResponse({ ok: true }))
      .catch((err: unknown) => {
        const m = err instanceof Error ? err.message : 'unknown';
        showToast(`Hired failed: ${m}`, 'error');
        sendResponse({ ok: false, error: m });
      });
    return true; // async
  }
  return false;
});

// eslint-disable-next-line no-console
console.log(`${LOG_PREFIX} content script armed on ${location.pathname}`);
