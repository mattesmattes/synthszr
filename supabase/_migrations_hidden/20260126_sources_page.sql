-- Add URL field to newsletter_sources for direct links
ALTER TABLE newsletter_sources ADD COLUMN IF NOT EXISTS url TEXT;

-- Add UI translations for sources page
-- German
INSERT INTO ui_translations (key, language_code, value) VALUES
  ('sources.title', 'de', 'Newsletter-Quellen'),
  ('sources.description', 'de', '{count} Newsletter-Quellen für die tägliche Analyse.'),
  ('sources.empty', 'de', 'Keine Newsletter-Quellen konfiguriert.'),
  ('sources.back', 'de', 'Zurück'),
  ('sources.back_home', 'de', 'Zurück zu Synthszr'),
  ('sources.name', 'de', 'Newsletter'),
  ('sources.link', 'de', 'Website')
ON CONFLICT (key, language_code) DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();

-- English
INSERT INTO ui_translations (key, language_code, value) VALUES
  ('sources.title', 'en', 'Newsletter Sources'),
  ('sources.description', 'en', '{count} newsletter sources for daily analysis.'),
  ('sources.empty', 'en', 'No newsletter sources configured.'),
  ('sources.back', 'en', 'Back'),
  ('sources.back_home', 'en', 'Back to Synthszr'),
  ('sources.name', 'en', 'Newsletter'),
  ('sources.link', 'en', 'Website')
ON CONFLICT (key, language_code) DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();

-- Plattdüütsch
INSERT INTO ui_translations (key, language_code, value) VALUES
  ('sources.title', 'nds', 'Neeigkeitenbreef-Quellen'),
  ('sources.description', 'nds', '{count} Neeigkeitenbreef-Quellen för de dägliche Analyse.'),
  ('sources.empty', 'nds', 'Keen Neeigkeitenbreef-Quellen inricht.'),
  ('sources.back', 'nds', 'Trüch'),
  ('sources.back_home', 'nds', 'Trüch na Synthszr'),
  ('sources.name', 'nds', 'Neeigkeitenbreef'),
  ('sources.link', 'nds', 'Websteed')
ON CONFLICT (key, language_code) DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();

-- Czech
INSERT INTO ui_translations (key, language_code, value) VALUES
  ('sources.title', 'cs', 'Zdroje newsletterů'),
  ('sources.description', 'cs', '{count} zdrojů newsletterů pro denní analýzu.'),
  ('sources.empty', 'cs', 'Žádné zdroje newsletterů nejsou nakonfigurovány.'),
  ('sources.back', 'cs', 'Zpět'),
  ('sources.back_home', 'cs', 'Zpět na Synthszr'),
  ('sources.name', 'cs', 'Newsletter'),
  ('sources.link', 'cs', 'Web')
ON CONFLICT (key, language_code) DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();
