-- 008: each person's language, so emails and reminders reach them in it too.
ALTER TABLE users ADD COLUMN locale text NOT NULL DEFAULT 'en' CHECK (locale IN ('en','de','es'));
