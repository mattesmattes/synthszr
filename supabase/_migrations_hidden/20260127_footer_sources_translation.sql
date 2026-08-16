-- Add footer.sources translation for all active languages
INSERT INTO ui_translations (key, language_code, value) VALUES
  ('footer.sources', 'de', 'Quellen'),
  ('footer.sources', 'en', 'Sources'),
  ('footer.sources', 'nds', 'Quellen'),
  ('footer.sources', 'cs', 'Zdroje')
ON CONFLICT (key, language_code) DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();
