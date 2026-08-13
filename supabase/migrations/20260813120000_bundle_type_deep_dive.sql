-- „Deep Dive" als dritte Bündel-Aufschrift (Betreiber-Wunsch 2026-08-13).
-- Gleiche Mechanik und Länge wie „Thema des Tages", nur eine andere Aufschrift,
-- die im TipTap-Editor an einer Quell-News umgestellt werden kann.
ALTER TABLE news_queue DROP CONSTRAINT IF EXISTS news_queue_bundle_type_check;
ALTER TABLE news_queue
  ADD CONSTRAINT news_queue_bundle_type_check
  CHECK (bundle_type IN ('topic','recap','deep_dive'));

COMMENT ON COLUMN news_queue.bundle_type IS
  'Bündel-Zuordnung: topic=Thema des Tages, deep_dive=Deep Dive, recap=Nachlese, NULL=normal';
