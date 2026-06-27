-- Manual article generation reuses the resumable article-jobs queue (instead of
-- one 300s inline stream that aborts past ~20 news items). Manual jobs have no
-- digest, and are browser-driven (with the 15-min cron as fallback).
ALTER TABLE article_jobs ALTER COLUMN digest_id DROP NOT NULL;
ALTER TABLE article_jobs ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'auto';
