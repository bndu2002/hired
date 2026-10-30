/**
 * First-boot seeder for app settings.
 *
 * Writes default values for every setting the orchestrator / inbound poller
 * knows how to use, but ONLY when the key doesn't already exist (via
 * `setIfAbsent`). Running this on every boot is cheap and idempotent —
 * once Vandana edits a template through the Configure UI, re-boots won't
 * stomp her changes.
 *
 * Defaults are chosen to be:
 *   - short (connect requests have a 300-char cap on LinkedIn)
 *   - specific (reference the actual job the orchestrator is targeting)
 *   - honest (D7 — no "big-fan" openers)
 *
 * Variables used (all MUST be supplied by the orchestrator's render context):
 *   - firstName         (split from Contact.name)
 *   - jobTitle          (from Job)
 *   - companyName       (from Job)
 *   - myName            (from `user.display_name` setting below)
 */

import { logger } from '../logger.js';
import * as settingRepo from '../db/repositories/setting.repo.js';

// ─── default values ─────────────────────────────────────────────────────────

const DEFAULT_LINKEDIN_CONNECT_TEMPLATE =
  "Hi {{firstName}}, I'm applying for the {{jobTitle}} role at {{companyName}} and noticed your work there. Would love to connect to learn more about the team.";

const DEFAULT_LINKEDIN_DM_TEMPLATE = `Hi {{firstName}},

Thanks for connecting. I'm applying for the {{jobTitle}} role at {{companyName}} — would you be open to a referral if my profile looks like a fit?

Happy to share my resume and a short pitch of where I'd add value.

Best,
{{myName}}`;

/**
 * Display name used in template signatures. Can be edited from Configure.
 * Defaulting to the user's name rather than a placeholder so a connect
 * request made before the user visits Configure doesn't ship with
 * "{{myName}}" literally in it.
 */
const DEFAULT_USER_DISPLAY_NAME = 'Vandana';

// ─── known keys (export for use elsewhere) ──────────────────────────────────

export const SETTING_KEYS = {
  linkedinConnectTemplate: 'linkedin.connect_template',
  linkedinDmTemplate: 'linkedin.dm_template',
  userDisplayName: 'user.display_name',
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
      key: SETTING_KEYS.userDisplayName,
      value: DEFAULT_USER_DISPLAY_NAME,
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
