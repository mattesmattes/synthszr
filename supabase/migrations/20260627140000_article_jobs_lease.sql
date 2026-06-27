-- Lease timestamp to stop the 15-min fallback cron from advancing a job that a
-- browser is actively driving (the cron's getNextOpenJob picks the oldest open
-- job; without this it raced the manual browser polling on the same row).
-- advanceArticleJob stamps this every tick; the cron path skips jobs stamped
-- within the last few minutes. Tab closed → stamp goes stale → cron takes over.
ALTER TABLE article_jobs ADD COLUMN IF NOT EXISTS last_advanced_at TIMESTAMPTZ;
