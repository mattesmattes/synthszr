-- „Cover Story" als vierte Bündel-Aufschrift (Betreiber-Wunsch 2026-09-13).
-- Gleiche Mechanik wie „Thema des Tages", aber die Zusammenfassung darf
-- doppelt so lang werden (s. BUNDLE_MAX_SENTENCES in ghostwriter-pipeline.ts).
-- Der Synthszr Take bleibt unverändert kurz.
ALTER TABLE news_queue DROP CONSTRAINT IF EXISTS news_queue_bundle_type_check;
ALTER TABLE news_queue
  ADD CONSTRAINT news_queue_bundle_type_check
  CHECK (bundle_type IN ('topic','recap','deep_dive','cover_story'));

COMMENT ON COLUMN news_queue.bundle_type IS
  'Bündel-Zuordnung: cover_story=Cover Story (doppelte Länge), topic=Thema des Tages, deep_dive=Deep Dive, recap=Nachlese, NULL=normal';
