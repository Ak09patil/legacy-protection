-- 007: a lighter check. REVIEW decisions ask the owner to confirm ("Is this right?")
-- and send at once if they say yes. HOLD decisions still pause with a 24-hour wait.
ALTER TABLE payments DROP CONSTRAINT payments_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_status_check
  CHECK (status IN ('CONFIRM_NEEDED','PAUSED','STOPPED_BY_OWNER','WAITING_FOR_CONTACT','RELEASE_SCHEDULED','SENT','RELEASED','FAILED'));
