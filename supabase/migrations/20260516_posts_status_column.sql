-- Bring the `posts` (manual posts) table in line with `generated_posts`:
-- a three-state status column instead of a boolean `published` flag.
-- Until now manual posts couldn't be archived because the schema simply
-- had no state for it — clicking "Archivieren" silently no-op'd.
--
-- Strategy: add `status`, backfill from `published`, keep `published`
-- around as a derived column maintained by trigger so the public-facing
-- readers (sitemap, /api/posts/[slug], /api/search) keep working
-- without any code change. Once the new admin code is in production we
-- can drop the trigger + column in a follow-up.

-- 1. New status column with check constraint and default
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'posts_status_check'
  ) THEN
    ALTER TABLE posts
      ADD CONSTRAINT posts_status_check
      CHECK (status IN ('draft', 'published', 'archived'));
  END IF;
END $$;

-- 2. Backfill from the existing boolean. Rows that are already
--    something other than 'draft' (e.g. set by a parallel migration)
--    stay untouched.
UPDATE posts
SET status = CASE WHEN published THEN 'published' ELSE 'draft' END
WHERE status = 'draft';

-- 3. Index so the admin list + status filters stay snappy
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts (status);

-- 4. Keep `published` mirrored from `status` until the column is retired.
--    This is the compatibility bridge: any reader that still filters
--    on `published=true` continues to behave correctly, AND new code
--    writing only `status` keeps `published` in lockstep automatically.
--    Archived posts get published=FALSE, which is the desired effect
--    on every public-facing reader.
CREATE OR REPLACE FUNCTION posts_sync_published_from_status()
RETURNS TRIGGER AS $$
BEGIN
  NEW.published = (NEW.status = 'published');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS posts_sync_published_trg ON posts;
CREATE TRIGGER posts_sync_published_trg
  BEFORE INSERT OR UPDATE ON posts
  FOR EACH ROW
  EXECUTE FUNCTION posts_sync_published_from_status();
