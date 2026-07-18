ALTER TABLE news_queue
  ADD COLUMN bundle_type text
  CHECK (bundle_type IN ('topic','recap'));
COMMENT ON COLUMN news_queue.bundle_type IS
  'Manuelle Bündel-Zuordnung: topic=Thema des Tages, recap=Nachlese, NULL=normal';
