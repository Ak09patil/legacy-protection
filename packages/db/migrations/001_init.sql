-- 001_init: core tables, the tamper-evident audit log, and least-privilege grants.
--
-- Roles (created by the migration runner if missing, cluster-wide):
--   lp_app   the application role. Can never UPDATE or DELETE audit rows or
--            confirmed plan versions. (INV-09, INV-15)
-- Migrations run as the database owner.

-- ---------------------------------------------------------------------------
-- Plans
-- ---------------------------------------------------------------------------

CREATE TABLE plans (
  id          uuid PRIMARY KEY,
  owner_id    text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Confirmed plan versions are immutable (INV-09). Drafts live elsewhere.
CREATE TABLE plan_versions (
  id            uuid PRIMARY KEY,
  plan_id       uuid NOT NULL REFERENCES plans(id),
  version       integer NOT NULL CHECK (version > 0),
  document      jsonb NOT NULL,
  confirmed_at  timestamptz NOT NULL,
  confirmed_by  text NOT NULL,
  UNIQUE (plan_id, version)
);

CREATE TABLE plan_drafts (
  plan_id     uuid PRIMARY KEY REFERENCES plans(id),
  document    jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Audit log: append-only, hash-chained per plan (INV-15, ADR-0003)
-- ---------------------------------------------------------------------------

CREATE TABLE audit_events (
  id          bigserial PRIMARY KEY,
  plan_id     uuid NOT NULL REFERENCES plans(id),
  seq         integer NOT NULL CHECK (seq > 0),
  at          timestamptz NOT NULL,
  kind        text NOT NULL,
  actor       text NOT NULL,
  payload     jsonb NOT NULL,
  prev_hash   text NOT NULL,           -- hex; 64 zeros for the first event
  hash        text NOT NULL,           -- hex sha256 of prev_hash + canonical content
  UNIQUE (plan_id, seq)
);

-- Defence in depth: the chain link and immutability are checked by the
-- database itself, not only by application code.
CREATE FUNCTION audit_events_check_link() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  last_seq  integer;
  last_hash text;
BEGIN
  SELECT seq, hash INTO last_seq, last_hash
    FROM audit_events WHERE plan_id = NEW.plan_id
    ORDER BY seq DESC LIMIT 1;

  IF last_seq IS NULL THEN
    IF NEW.seq <> 1 OR NEW.prev_hash <> repeat('0', 64) THEN
      RAISE EXCEPTION 'audit chain: first event must have seq 1 and a zero prev_hash';
    END IF;
  ELSIF NEW.seq <> last_seq + 1 OR NEW.prev_hash <> last_hash THEN
    RAISE EXCEPTION 'audit chain: event does not link to the previous event';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER audit_events_link
  BEFORE INSERT ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_check_link();

CREATE FUNCTION reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$;

CREATE TRIGGER audit_events_immutable
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE TRIGGER plan_versions_immutable
  BEFORE UPDATE OR DELETE ON plan_versions
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- ---------------------------------------------------------------------------
-- Webhook de-duplication and rate limits (ADR-0006)
-- ---------------------------------------------------------------------------

CREATE TABLE processed_webhook_events (
  event_id      text PRIMARY KEY,
  event_type    text NOT NULL,
  processed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rate_limits (
  key         text PRIMARY KEY,
  tokens      double precision NOT NULL,
  updated_at  timestamptz NOT NULL,
  expires_at  timestamptz NOT NULL
);

-- ---------------------------------------------------------------------------
-- Grants: least privilege for the application role
-- ---------------------------------------------------------------------------

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;

GRANT SELECT, INSERT          ON plans, plan_versions, audit_events, processed_webhook_events TO lp_app;
GRANT SELECT, INSERT, UPDATE  ON plan_drafts TO lp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON rate_limits TO lp_app;
GRANT USAGE ON SEQUENCE audit_events_id_seq TO lp_app;
