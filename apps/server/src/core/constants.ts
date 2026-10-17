/**
 * System-wide hard constants from the decision record.
 *
 * These are code constants, not env vars — they encode design decisions,
 * not deployment config. See `.kiro/specs/hired/requirements.md § 6`.
 */

/** D6 — server-enforced per-day run cap. */
export const DAILY_RUN_CAP = 4;

/** D6 — max contacts the orchestrator will discover + show in the modal. */
export const MAX_CONTACTS_PER_RUN = 8;
