-- 009: the outbox is actually delivered. Failed sends back off and retry;
-- a message's secret link is erased once it has been sent.
ALTER TABLE notifications ADD COLUMN next_attempt_at timestamptz;
DROP INDEX IF EXISTS notifications_unsent;
CREATE INDEX notifications_unsent ON notifications (coalesce(next_attempt_at, created_at)) WHERE sent_at IS NULL;
