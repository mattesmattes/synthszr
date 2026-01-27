-- Add email_received_at to news_queue for clustering by newsletter date
-- instead of queue date

ALTER TABLE news_queue ADD COLUMN IF NOT EXISTS email_received_at TIMESTAMPTZ;

-- Backfill from daily_repo where we have the link
UPDATE news_queue nq
SET email_received_at = dr.email_received_at
FROM daily_repo dr
WHERE nq.daily_repo_id = dr.id
  AND nq.email_received_at IS NULL
  AND dr.email_received_at IS NOT NULL;

-- For items without daily_repo link, use queued_at as fallback
UPDATE news_queue
SET email_received_at = queued_at
WHERE email_received_at IS NULL;

-- Add index for efficient clustering queries
CREATE INDEX IF NOT EXISTS idx_news_queue_email_received ON news_queue(email_received_at DESC);
