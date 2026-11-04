-- 002_accounts: people, passkeys, sessions, and who may act for whom.
--
-- Design notes
-- * No passwords anywhere. Every person signs in with a passkey (WebAuthn).
-- * Session and invite tokens are stored only as SHA-256 hashes, so a copy of
--   the database cannot be used to sign in or accept an invite.
-- * A person's role on a plan comes from `memberships`, written only by the
--   owner's invite flow. Roles never come from the request. (INV-08, INV-17)

CREATE TABLE users (
  id            uuid PRIMARY KEY,
  email         text NOT NULL,
  display_name  text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower ON users (lower(email));

-- WebAuthn credentials. public_key is the COSE key; counter detects cloned authenticators.
CREATE TABLE passkeys (
  id            text PRIMARY KEY,                 -- credential ID, base64url
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key    bytea NOT NULL,
  counter       bigint NOT NULL DEFAULT 0 CHECK (counter >= 0),
  transports    text[] NOT NULL DEFAULT '{}',
  device_type   text NOT NULL,
  backed_up     boolean NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz
);
CREATE INDEX passkeys_user ON passkeys (user_id);

-- One-time WebAuthn challenges. Consumed (deleted) on first use; expire after 5 minutes.
CREATE TABLE auth_challenges (
  id          uuid PRIMARY KEY,
  challenge   text NOT NULL,
  purpose     text NOT NULL CHECK (purpose IN ('register', 'authenticate', 'confirm')),
  user_id     uuid REFERENCES users(id) ON DELETE CASCADE,
  pending     jsonb,                              -- e.g. sign-up details held until the passkey is verified
  expires_at  timestamptz NOT NULL
);

CREATE TABLE sessions (
  token_hash    text PRIMARY KEY,                 -- sha256 hex of the cookie value
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  user_agent    text
);
CREATE INDEX sessions_user ON sessions (user_id);

-- plans.owner_id becomes a real reference.
ALTER TABLE plans ALTER COLUMN owner_id TYPE uuid USING owner_id::uuid;
ALTER TABLE plans ADD CONSTRAINT plans_owner_fk FOREIGN KEY (owner_id) REFERENCES users(id);
CREATE UNIQUE INDEX plans_one_per_owner ON plans (owner_id);

CREATE TABLE memberships (
  plan_id     uuid NOT NULL REFERENCES plans(id),
  user_id     uuid NOT NULL REFERENCES users(id),
  role        text NOT NULL CHECK (role IN ('OWNER', 'TRUSTED_CONTACT', 'EXECUTOR')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz,
  PRIMARY KEY (plan_id, user_id, role)
);
-- At most one active trusted contact and one active executor per plan.
CREATE UNIQUE INDEX memberships_one_active_role ON memberships (plan_id, role) WHERE revoked_at IS NULL AND role <> 'OWNER';

CREATE TABLE invites (
  token_hash   text PRIMARY KEY,
  plan_id      uuid NOT NULL REFERENCES plans(id),
  role         text NOT NULL CHECK (role IN ('TRUSTED_CONTACT', 'EXECUTOR')),
  email        text NOT NULL,
  name         text NOT NULL,
  invited_by   uuid NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  accepted_at  timestamptz,
  accepted_by  uuid REFERENCES users(id),
  revoked_at   timestamptz
);
CREATE INDEX invites_plan ON invites (plan_id);

GRANT SELECT, INSERT, UPDATE         ON users, passkeys, sessions, memberships, invites TO lp_app;
GRANT SELECT, INSERT, DELETE         ON auth_challenges TO lp_app;
GRANT DELETE                         ON sessions TO lp_app;
