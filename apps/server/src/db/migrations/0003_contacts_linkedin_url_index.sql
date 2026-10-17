-- Migration 0003: partial index on contacts.linkedin_url for cross-run dedup lookups.
--
-- The orchestrator queries previous outreach by linkedin_url before every
-- Run Agent dispatch (to surface "already contacted" in the modal). This
-- needs to be a fast lookup even as the contacts table grows.
--
-- Partial index: excludes rows where linkedin_url IS NULL. Those contacts
-- (hypothetical — all v1 discovery produces linkedin_url) are not candidates
-- for dedup anyway, so no reason to index them.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_contacts_linkedin_url
  ON contacts(linkedin_url)
  WHERE linkedin_url IS NOT NULL;

COMMIT;
