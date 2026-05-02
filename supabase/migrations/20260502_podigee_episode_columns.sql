-- Persist Podigee publication state on post_podcasts so the
-- newsletter-send page can answer "is this published?" with a single
-- DB read instead of a Podigee API round-trip (which was returning
-- 404 in production for unrelated reasons).
ALTER TABLE post_podcasts
  ADD COLUMN IF NOT EXISTS podigee_episode_id BIGINT,
  ADD COLUMN IF NOT EXISTS podigee_episode_url TEXT,
  ADD COLUMN IF NOT EXISTS podigee_published_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_post_podcasts_podigee_published
  ON post_podcasts(post_id)
  WHERE podigee_episode_id IS NOT NULL;
