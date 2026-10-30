-- -----------------------------------------------------------------------------
-- Application settings — key/value store.
--
-- Used in v1 for:
--   - linkedin.connect_template   : {{var}}-templated connect-request text
--   - linkedin.dm_template        : {{var}}-templated DM-after-accept text
--
-- A generic KV table (rather than a column per setting) because:
--   - the set grows over time (gmail.subject_template, user.display_name,
--     etc.) and we don't want a migration per toggle
--   - every setting is a short string that the user edits in the Configure
--     UI; typed columns would be dead ceremony
--   - reads happen a handful of times per run — a hash-indexed PK is plenty
--
-- Keys are hierarchical (`linkedin.connect_template`) so a future
-- /api/settings endpoint can scope-list ("return everything under
-- `linkedin.*`"). Not enforced in schema — just a convention.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS app_settings (
    key         TEXT         PRIMARY KEY,
    value       TEXT         NOT NULL,
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
