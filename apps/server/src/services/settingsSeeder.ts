/**
 * First-boot seeder for app settings.
 *
 * Writes default values for every setting the orchestrator / inbound poller
 * knows how to use, but ONLY when the key doesn't already exist (via
 * `setIfAbsent`). Running this on every boot is cheap and idempotent —
 * once Vandana edits a template through the Configure UI, re-boots won't
 * stomp her changes.
 *
 * Template variables (requirements.md § 4.6 is authoritative):
 *   - {{outreachEmployeeName}}  — the contact's first name (from splitName)
 *   - {{jobTitle}}              — from Job.jobTitle
 *   - {{companyName}}           — from Job.companyName
 *   - {{jobLink}}               — from Job.jobUrl (LinkedIn posting URL)
 *
 * There is no {{myName}} / {{yourName}} variable. The user's signature is
 * literal text in the template body — if Vandana changes her name she edits
 * the template, same as any other authored copy.
 */

import { logger } from '../logger.js';
import * as settingRepo from '../db/repositories/setting.repo.js';

// ─── default values ─────────────────────────────────────────────────────────

/**
 * ⚠ FLOW B INVARIANT ⚠
 *
 * This template is SEEDED into app_settings but intentionally NOT RENDERED
 * anywhere in the current pipeline. `orchestrator.runSendPhase` emits
 * `linkedin_connect_drafted` with an empty payload — LinkedIn connect
 * requests under Flow B (design.md § 11, D1-adjacent) are BARE, no custom
 * note. The user clicks LinkedIn's default Connect flow with no "Add a note"
 * text.
 *
 * The row exists so a future Configure Templates UI (Phase 4.3) can expose
 * it as a user-editable text alongside the DM template — but any code that
 * READS this value to render it on connect would silently violate Flow B.
 * If you need custom connect notes, that's a new design decision requiring
 * a spec update, not just a code wire-up.
 */
const DEFAULT_LINKEDIN_CONNECT_TEMPLATE =
  "Hi {{outreachEmployeeName}}, I'm applying for the {{jobTitle}} role at {{companyName}} ({{jobLink}}) and noticed your work there. Would love to connect to learn more about the team.";

/**
 * LinkedIn DM template — Vandana's own copy, pasted Nov 3 2026.
 *
 * The authoritative source is `.kiro/specs/hired/templates.md`. If you need
 * to change this, edit the spec file FIRST, then sync here (and PUT the new
 * value via /api/settings for already-booted servers so they pick up the
 * change without a reseed).
 *
 * Rule for the agent: never invent template text. Never guess. If this
 * constant is empty or missing, ASK VANDANA to paste it rather than filling
 * in your own copy.
 */
const DEFAULT_LINKEDIN_DM_TEMPLATE = `Hi {{outreachEmployeeName}},

I'm a full-stack developer (3+ yrs, Node.js/TypeScript/React/GraphQL) who ships production apps used by 7,000+ users, plus some hands-on AI work (agentic tools + RAG). I'm applying for {{jobTitle}} at {{companyName}} and it looks like a strong fit.

If you'd be open to referring me, I'd genuinely appreciate it — happy to share my resume too.

Here's the job link: {{jobLink}}

Thanks! Vandana`;

/**
 * Gmail body template — Vandana's own copy, pasted Nov 3 2026.
 *
 * Not yet wired: Gmail dispatch is Phase 4.4. Seeded now so that when the
 * send path lands, the template is already there. Same variables as the
 * LinkedIn DM.
 *
 * Open: Gmail subject line (`gmail.subject_template`) is NOT seeded —
 * Vandana hasn't given one yet and we must not guess. The Phase 4.4 build
 * will fail-closed if the subject setting is missing.
 */
const DEFAULT_GMAIL_BODY_TEMPLATE = `Hi {{outreachEmployeeName}},

I'm reaching out personally rather than sending a generic note. I'm a full-stack developer with 3+ years of experience building and shipping production web apps used by 7,000+ users — mostly with Node.js, TypeScript, React, GraphQL, and PostgreSQL. I've also built AI features like an agentic assistant and a RAG-powered Q&A bot, and I love learning fast and working alongside strong engineers.

I'm applying for {{jobTitle}} at {{companyName}}, and it looks like a genuinely great fit for my background. If you'd be comfortable referring me, I'd truly appreciate it — I know a referral carries your name, and I'd be glad to share my resume or answer anything to make it an easy call.

Here's the link to the job: {{jobLink}}

Thanks so much for considering it!

Best, Vandana`;

// ─── known keys (export for use elsewhere) ──────────────────────────────────

export const SETTING_KEYS = {
  linkedinConnectTemplate: 'linkedin.connect_template',
  linkedinDmTemplate: 'linkedin.dm_template',
  gmailBodyTemplate: 'gmail.body_template',
  // Note: gmail.subject_template is NOT in this map yet — Vandana hasn't
  // provided a subject line. Phase 4.4 (Gmail dispatch) will add this and
  // the orchestrator should fail-closed on a missing subject.
} as const;

// ─── seeder ─────────────────────────────────────────────────────────────────

/**
 * Insert defaults for any missing settings. Call once at boot, after the DB
 * client is ready and migrations have been applied. Safe to call repeatedly;
 * each call that lands on an existing key is a no-op.
 */
export async function seedDefaultSettings(): Promise<void> {
  const defaults: readonly { key: string; value: string }[] = [
    {
      key: SETTING_KEYS.linkedinConnectTemplate,
      value: DEFAULT_LINKEDIN_CONNECT_TEMPLATE,
    },
    {
      key: SETTING_KEYS.linkedinDmTemplate,
      value: DEFAULT_LINKEDIN_DM_TEMPLATE,
    },
    {
      key: SETTING_KEYS.gmailBodyTemplate,
      value: DEFAULT_GMAIL_BODY_TEMPLATE,
    },
  ];

  let insertedCount = 0;
  for (const { key, value } of defaults) {
    const { inserted } = await settingRepo.setIfAbsent(key, value);
    if (inserted) {
      insertedCount += 1;
      logger.info({ key }, 'seeded default setting');
    }
  }

  if (insertedCount === 0) {
    logger.debug('settings seeder: nothing to seed (all keys already present)');
  } else {
    logger.info(
      { insertedCount, totalKeys: defaults.length },
      'settings seeder: inserted missing defaults',
    );
  }
}
