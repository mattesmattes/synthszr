-- Übersetzungen für Tip- und Ad-Promos pro Zielsprache.
-- Struktur: { "en": { ...felder }, "cs": {...}, "nds": {...} }; DE = Originalfelder.
-- tip: headline, body, cta_label; ad: eyebrow, title, body, cta_label.
ALTER TABLE tip_promos ADD COLUMN IF NOT EXISTS translations JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE ad_promos ADD COLUMN IF NOT EXISTS translations JSONB NOT NULL DEFAULT '{}'::jsonb;
