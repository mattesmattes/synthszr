-- Add email_received_at column to track the actual email receipt time
-- This is used for timestamp calculations instead of collected_at
-- which represents when the item was added to the database

ALTER TABLE daily_repo ADD COLUMN IF NOT EXISTS email_received_at TIMESTAMPTZ;

-- Backfill existing data: use newsletter_date at midnight as approximation
UPDATE daily_repo
SET email_received_at = (newsletter_date || 'T00:00:00Z')::timestamptz
WHERE email_received_at IS NULL;
