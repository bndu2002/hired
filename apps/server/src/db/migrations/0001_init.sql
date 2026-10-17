-- Migration 0001: initial schema.
-- Creates the six core tables + indexes.
-- See src/db/schema.sql for the full annotated DDL.

BEGIN;

CREATE TABLE IF NOT EXISTS jobs (
    id                   SERIAL PRIMARY KEY,
    source               VARCHAR(32) NOT NULL,
    company_name         VARCHAR(255) NOT NULL,
    job_title            VARCHAR(255) NOT NULL,
    job_url              TEXT NOT NULL,
    job_description      TEXT,
    must_have_skills     TEXT,
    good_to_have_skills  TEXT,
    created_at           TIMESTAMPTZ DEFAULT now(),
    UNIQUE (job_url)
);

CREATE TABLE IF NOT EXISTS runs (
    id                   SERIAL PRIMARY KEY,
    job_id               INT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    channels             VARCHAR(16) NOT NULL,
    status               VARCHAR(16) NOT NULL DEFAULT 'IN_PROGRESS',
    marked_as_interview  BOOLEAN DEFAULT false,
    created_at           TIMESTAMPTZ DEFAULT now(),
    completed_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_runs_job ON runs(job_id);

CREATE TABLE IF NOT EXISTS contacts (
    id                       SERIAL PRIMARY KEY,
    run_id                   INT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    name                     VARCHAR(255) NOT NULL,
    title                    VARCHAR(255),
    tenure_hint              VARCHAR(128),
    email                    VARCHAR(255),
    email_verified           BOOLEAN DEFAULT false,
    linkedin_url             TEXT,
    selected_for_gmail       BOOLEAN DEFAULT false,
    selected_for_linkedin    BOOLEAN DEFAULT false,
    gmail_status             VARCHAR(32) DEFAULT 'PENDING',
    linkedin_status          VARCHAR(32) DEFAULT 'PENDING',
    gmail_thread_id          VARCHAR(255),
    linkedin_dm_draft        TEXT,
    discovered_via           VARCHAR(32),
    email_found_via          VARCHAR(32),
    email_verified_via       VARCHAR(32),
    intent_label             VARCHAR(255),
    sentiment                VARCHAR(16),
    created_at               TIMESTAMPTZ DEFAULT now(),
    last_activity            TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contacts_run ON contacts(run_id);
CREATE INDEX IF NOT EXISTS idx_contacts_gmail_thread ON contacts(gmail_thread_id);
CREATE INDEX IF NOT EXISTS idx_contacts_linkedin_status ON contacts(linkedin_status);

CREATE TABLE IF NOT EXISTS events (
    id          BIGSERIAL PRIMARY KEY,
    contact_id  INT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    event_type  VARCHAR(64) NOT NULL,
    payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_contact ON events(contact_id);
CREATE INDEX IF NOT EXISTS idx_events_type_time ON events(event_type, created_at);

CREATE TABLE IF NOT EXISTS daily_logs (
    run_date    DATE PRIMARY KEY DEFAULT CURRENT_DATE,
    runs_count  INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS provider_credits (
    provider_name       VARCHAR(64) PRIMARY KEY,
    provider_kind       VARCHAR(32) NOT NULL,
    free_quota_monthly  INT,
    estimated_used      INT DEFAULT 0,
    last_reset          DATE DEFAULT (date_trunc('month', now()))::DATE,
    last_call_at        TIMESTAMPTZ
);

COMMIT;
