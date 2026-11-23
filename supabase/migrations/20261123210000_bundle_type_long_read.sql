-- „Long Read" als fünfte Bündel-Aufschrift (Betreiber-Wunsch 2026-11-23).
-- Gleiche Bündel-Mechanik wie „Thema des Tages", aber die Zusammenfassung
-- hat eine Ziellänge und Obergrenze von 5.000 Zeichen (s. BUNDLE_LENGTH_RULES
-- in ghostwriter-pipeline.ts). Der Synthszr Take bleibt unverändert kurz.
ALTER TABLE news_queue DROP CONSTRAINT IF EXISTS news_queue_bundle_type_check;
ALTER TABLE news_queue
  ADD CONSTRAINT news_queue_bundle_type_check
  CHECK (bundle_type IN ('topic','recap','deep_dive','cover_story','long_read'));

COMMENT ON COLUMN news_queue.bundle_type IS
  'Bündel-Zuordnung: cover_story=Cover Story (doppelte Länge), topic=Thema des Tages, deep_dive=Deep Dive, long_read=Long Read (5.000 Zeichen), recap=Nachlese, NULL=normal';
