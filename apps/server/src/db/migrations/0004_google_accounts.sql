-- -----------------------------------------------------------------------------
-- Google accounts connected via OAuth (Gmail).
--
-- Supports MULTIPLE accounts with roles so one install can connect:
--   - 'linkedin_notifications' : the Gmail that receives LinkedIn's
--        "X accepted" / "X messaged you" emails (read-only polling)
--   - 'sending'                : the Gmail used to send referral emails
--        (send + read own replies)
--
-- Tokens are stored ENCRYPTED. The application encrypts access_token and
-- refresh_token with AES-256-GCM (TOKEN_ENCRYPTION_KEY from env) BEFORE
-- insert; the DB only ever holds ciphertext. We do NOT use pgcrypto so the
-- key never leaves the app process and never appears in SQL logs.
--
-- gmail_history_id is the incremental-poll watermark: Gmail's users.history
-- API lets us fetch only changes since this id, so each poll is cheap and we
-- don't re-scan the whole inbox. Null until the first poll establishes it.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS google_accounts (
    id                   SERIAL PRIMARY KEY,
    email                VARCHAR(255) NOT NULL,
    role                 VARCHAR(32)  NOT NULL,   -- 'linkedin_notifications' | 'sending'
    access_token_enc     TEXT         NOT NULL,   -- AES-256-GCM ciphertext (app-encrypted)
    refresh_token_enc    TEXT         NOT NULL,   -- AES-256-GCM ciphertext (app-encrypted)
    token_expiry         TIMESTAMPTZ,             -- when the access token expires
    scopes               TEXT,                    -- space-separated granted scopes (for audit)
    gmail_history_id     VARCHAR(64),             -- incremental poll watermark
    connected_at         TIMESTAMPTZ DEFAULT now(),
    last_polled_at       TIMESTAMPTZ,

    -- One connection per (email, role). Re-connecting the same account in the
    -- same role updates the row (ON CONFLICT) rather than duplicating. The
    -- same inbox could legitimately serve two roles, hence role is part of
    -- the key rather than email alone.
    UNIQUE (email, role)
);

CREATE INDEX IF NOT EXISTS idx_google_accounts_role ON google_accounts(role);
