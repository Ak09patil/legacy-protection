-- 005: links in outgoing messages (e.g. invite links) are stored encrypted
-- with a key that lives outside the database, so a copy of the database
-- cannot be used to accept an invitation (INV-22).
ALTER TABLE notifications ADD COLUMN secret bytea;
