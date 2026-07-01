-- Hash der DE-Quellfelder, damit der Auto-Übersetzungs-Cron nur neu übersetzt,
-- wenn sich der Originaltext geändert hat (idempotent, keine Endlosschleife).
ALTER TABLE tip_promos ADD COLUMN IF NOT EXISTS translations_hash TEXT;
ALTER TABLE ad_promos ADD COLUMN IF NOT EXISTS translations_hash TEXT;
