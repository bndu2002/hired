-- Migration 0002: capture extra signals from Happy Agent that help with
-- UX (modal display) and Gemini reply-intent classification context.
-- All nullable — older rows from before this migration remain valid.

BEGIN;

ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS happy_job_id      VARCHAR(64),     -- e.g. 'HR1179201265621853'
    ADD COLUMN IF NOT EXISTS experience_range  VARCHAR(64),     -- e.g. '2 - 6 Years Exp'
    ADD COLUMN IF NOT EXISTS location_hint     VARCHAR(128),    -- e.g. 'Remote'
    ADD COLUMN IF NOT EXISTS posted_hint       VARCHAR(128);    -- e.g. 'Within 1 day · Be an early applicant'

CREATE INDEX IF NOT EXISTS idx_jobs_happy_job_id ON jobs(happy_job_id);

COMMIT;
