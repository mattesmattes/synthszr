-- Add post_id and locale columns to podcast_jobs for automatic linking to post_podcasts
-- When a job completes, the processor will auto-insert into post_podcasts for all locales

ALTER TABLE podcast_jobs ADD COLUMN IF NOT EXISTS post_id UUID REFERENCES generated_posts(id) ON DELETE SET NULL;
ALTER TABLE podcast_jobs ADD COLUMN IF NOT EXISTS source_locale TEXT DEFAULT 'en';

-- Index for finding jobs by post
CREATE INDEX IF NOT EXISTS idx_podcast_jobs_post_id ON podcast_jobs(post_id) WHERE post_id IS NOT NULL;

COMMENT ON COLUMN podcast_jobs.post_id IS 'The generated_posts.id this podcast is for (optional - null for test podcasts)';
COMMENT ON COLUMN podcast_jobs.source_locale IS 'The locale used for script generation (de, en, cs, nds)';
