-- Podcast-Tip-Promo: neuer Promo-Typ + Show-Notes-Persistenz

ALTER TABLE tip_promos
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'static';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tip_promos_type_check'
  ) THEN
    ALTER TABLE tip_promos
      ADD CONSTRAINT tip_promos_type_check CHECK (type IN ('static', 'podcast'));
  END IF;
END $$;

ALTER TABLE post_podcasts
  ADD COLUMN IF NOT EXISTS episode_title    TEXT,
  ADD COLUMN IF NOT EXISTS episode_subtitle TEXT,
  ADD COLUMN IF NOT EXISTS show_notes       TEXT,
  ADD COLUMN IF NOT EXISTS show_notes_short TEXT;

-- Schnell die neueste veröffentlichte Episode mit Show Notes finden (Render-Pfad).
CREATE INDEX IF NOT EXISTS idx_post_podcasts_published_shownotes
  ON post_podcasts (podigee_published_at DESC)
  WHERE podigee_episode_url IS NOT NULL AND show_notes_short IS NOT NULL;
