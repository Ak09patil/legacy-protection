-- 003_product: the plan's live state, payments and their decisions, check-ins,
-- outgoing notifications, and the executor's steps.

-- Current lifecycle state per plan. Every change also writes an audit event
-- in the same transaction; `version` gives optimistic concurrency so two
-- writers can never both move the plan forward from the same state.
CREATE TABLE plan_state (
  plan_id             uuid PRIMARY KEY REFERENCES plans(id),
  phase               text NOT NULL CHECK (phase IN ('DRAFT','MONITORING','WAITING','ACTIVATED','EXECUTING','COMPLETED','CANCELLED')),
  plan_version_id     uuid REFERENCES plan_versions(id),
  waiting_period_ms   bigint NOT NULL CHECK (waiting_period_ms >= 259200000),   -- 72h minimum (INV-06)
  checkins_missed     boolean NOT NULL DEFAULT false,
  contact_confirmed   boolean NOT NULL DEFAULT false,
  waiting_started_at  timestamptz,
  last_checkin_at     timestamptz,
  version             integer NOT NULL DEFAULT 1,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE checkins (
  id       bigserial PRIMARY KEY,
  plan_id  uuid NOT NULL REFERENCES plans(id),
  user_id  uuid NOT NULL REFERENCES users(id),
  at       timestamptz NOT NULL DEFAULT now(),
  channel  text NOT NULL CHECK (channel IN ('app', 'email_link', 'activity'))
);
CREATE INDEX checkins_plan_at ON checkins (plan_id, at DESC);

-- Payments the owner starts. Money moves only for status SENT or RELEASED.
CREATE TABLE payments (
  id                 uuid PRIMARY KEY,
  plan_id            uuid NOT NULL REFERENCES plans(id),
  payee_name         text NOT NULL,
  payee_email        text NOT NULL,
  amount_minor       bigint NOT NULL CHECK (amount_minor > 0),
  currency           char(3) NOT NULL,
  method             text NOT NULL,
  note               text NOT NULL DEFAULT '',
  status             text NOT NULL CHECK (status IN ('PAUSED','STOPPED_BY_OWNER','WAITING_FOR_CONTACT','RELEASE_SCHEDULED','SENT','RELEASED','FAILED')),
  release_at         timestamptz,
  paypal_request_id  text UNIQUE,              -- idempotency key, set before any money call (INV-03)
  paypal_reference   text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_plan_created ON payments (plan_id, created_at DESC);

-- Each decision is immutable: a re-check writes a new row.
CREATE TABLE payment_decisions (
  id              bigserial PRIMARY KEY,
  payment_id      uuid NOT NULL REFERENCES payments(id),
  level           text NOT NULL CHECK (level IN ('PASS','REVIEW','HOLD')),
  reasons         jsonb NOT NULL,
  policy_version  text NOT NULL,
  model_version   text,
  model_status    text NOT NULL,                -- OK | UNAVAILABLE | TIMEOUT (fail-closed, INV-11)
  decided_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER payment_decisions_immutable
  BEFORE UPDATE OR DELETE ON payment_decisions
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- Transactional outbox: written in the same transaction as the change that
-- caused it, delivered by a worker, so no notification is lost or sent twice.
CREATE TABLE notifications (
  id            uuid PRIMARY KEY,
  plan_id       uuid NOT NULL REFERENCES plans(id),
  recipient_id  uuid REFERENCES users(id),
  to_email      text NOT NULL,
  kind          text NOT NULL,
  subject       text NOT NULL,
  body          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz,
  attempts      integer NOT NULL DEFAULT 0,
  last_error    text,
  read_at       timestamptz
);
CREATE INDEX notifications_unsent ON notifications (created_at) WHERE sent_at IS NULL;
CREATE INDEX notifications_recipient ON notifications (recipient_id, created_at DESC);

-- Steps the executor runs after activation, generated only from the confirmed plan version (INV-02).
CREATE TABLE execution_steps (
  id                 text NOT NULL,
  plan_id            uuid NOT NULL REFERENCES plans(id),
  plan_version_id    uuid NOT NULL REFERENCES plan_versions(id),
  step               jsonb NOT NULL,
  label              text NOT NULL,
  due_at             timestamptz NOT NULL,
  status             text NOT NULL CHECK (status IN ('SCHEDULED','RUNNING','DONE','FAILED','SKIPPED')),
  paypal_request_id  text NOT NULL UNIQUE,
  result             jsonb,
  done_at            timestamptz,
  PRIMARY KEY (plan_id, id)
);

GRANT SELECT, INSERT, UPDATE ON plan_state, payments, notifications, execution_steps TO lp_app;
GRANT SELECT, INSERT         ON checkins, payment_decisions TO lp_app;
GRANT USAGE ON SEQUENCE checkins_id_seq, payment_decisions_id_seq TO lp_app;
