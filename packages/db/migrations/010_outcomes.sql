-- 010: what really happened to a payment, so protection can learn (INV-28).
-- Only the owner, their trusted person or our operations team can say; never a payee.
-- Append-only: a later answer is a new row, and the latest one counts.
CREATE TABLE payment_outcomes (
  id           bigserial PRIMARY KEY,
  payment_id   uuid NOT NULL REFERENCES payments(id),
  plan_id      uuid NOT NULL REFERENCES plans(id),
  payee_email  text NOT NULL,
  outcome      text NOT NULL CHECK (outcome IN ('SCAM', 'NOT_SCAM')),
  reported_by  uuid REFERENCES users(id),
  role         text NOT NULL CHECK (role IN ('OWNER', 'TRUSTED_CONTACT', 'OPS')),
  at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_outcomes_payee ON payment_outcomes (lower(payee_email), at DESC);
CREATE INDEX payment_outcomes_payment ON payment_outcomes (payment_id, at DESC);
CREATE TRIGGER payment_outcomes_immutable BEFORE UPDATE OR DELETE ON payment_outcomes FOR EACH ROW EXECUTE FUNCTION reject_mutation();
GRANT SELECT, INSERT ON payment_outcomes TO lp_app;
GRANT USAGE ON SEQUENCE payment_outcomes_id_seq TO lp_app;

-- The scam words found on each payment, kept as labels (never the message itself) so they can be learned from.
ALTER TABLE payment_decisions ADD COLUMN text_labels text[] NOT NULL DEFAULT '{}';
-- The owner's local hour when the payment was checked: a model feature, kept for retraining.
ALTER TABLE payment_decisions ADD COLUMN hour_local smallint CHECK (hour_local BETWEEN 0 AND 23);
