-- Englische Feature-Spalten: nicht-DE Locales zeigen EN (analog __description_en).
-- dimension_key_en = übersetzter Row-Label; value_text_en = übersetzter Wert.
-- Beide nullable — Fallback im Code auf die deutschen Spalten.
ALTER TABLE product_features_current
  ADD COLUMN IF NOT EXISTS dimension_key_en text,
  ADD COLUMN IF NOT EXISTS value_text_en text;
