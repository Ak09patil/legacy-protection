-- 011: payments really move through PayPal (INV-29).
-- SENDING: approved (passed the check, or the owner said yes), not yet confirmed by PayPal.
ALTER TABLE payments DROP CONSTRAINT payments_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_status_check
  CHECK (status IN ('CONFIRM_NEEDED','PAUSED','STOPPED_BY_OWNER','WAITING_FOR_CONTACT','RELEASE_SCHEDULED','SENDING','SENT','RELEASED','FAILED'));
ALTER TABLE payments ADD COLUMN paypal_ref text;
ALTER TABLE payments ADD COLUMN sent_at timestamptz;
ALTER TABLE payments ADD COLUMN send_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE payments ADD COLUMN next_send_at timestamptz;
ALTER TABLE payments ADD COLUMN send_error text;
CREATE INDEX payments_to_send ON payments (coalesce(next_send_at, release_at, created_at)) WHERE status IN ('SENDING', 'RELEASE_SCHEDULED');
