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

const DEFAULT_LINKEDIN_DM_TEMPLATE = `Hi {{outreachEmployeeName}},

Thanks for connecting. I'm applying for the {{jobTitle}} role at {{companyName}} ({{jobLink}}) — would you be open to a referral if my profile looks like a fit?

Happy to share my resume and a short pitch of where I'd add value.

Best,
Vandana`;

// ─── known keys (export for use elsewhere) ──────────────────────────────────

export const SETTING_KEYS = {
  linkedinConnectTemplate: 'linkedin.connect_template',
  linkedinDmTemplate: 'linkedin.dm_template',
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
