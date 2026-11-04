-- 006: one-time email codes, the fallback for people who can't use passkeys.
-- Codes are stored only as HMACs keyed by APP_SECRET; each code works once,
-- for 10 minutes, with at most 5 wrong guesses.
CREATE TABLE email_codes (
  id          uuid PRIMARY KEY,
  email       text NOT NULL,
  purpose     text NOT NULL CHECK (purpose IN ('signup', 'signin', 'confirm')),
  code_hmac   text NOT NULL,
  pending     jsonb,
  attempts    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE INDEX email_codes_email_recent ON email_codes (lower(email), created_at DESC);

GRANT SELECT, INSERT, UPDATE ON email_codes TO lp_app;
