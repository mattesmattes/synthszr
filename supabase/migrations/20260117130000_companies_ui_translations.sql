-- Add UI translations for company pages (en, nds, cs)
-- Migration: 20260117_companies_ui_translations.sql

-- English
INSERT INTO ui_translations (key, language_code, value) VALUES
  ('companies.title', 'en', 'Companies'),
  ('companies.description', 'en', '{count} companies mentioned in our articles. Click the badge for AI analysis.'),
  ('companies.empty', 'en', 'No companies found yet. Publish articles with company mentions.'),
  ('companies.back', 'en', 'Back'),
  ('companies.back_home', 'en', 'Back to Synthszr'),
  ('companies.all_companies', 'en', 'All Companies'),
  ('companies.back_to_companies', 'en', 'Back to Companies'),
  ('companies.articles_count_singular', 'en', '{count} article mentions {company}'),
  ('companies.articles_count_plural', 'en', '{count} articles mention {company}'),
  ('companies.premarket_label', 'en', 'Pre-IPO Company'),
  ('companies.article', 'en', 'Article'),
  ('companies.articles', 'en', 'Articles'),
  ('companies.analyse', 'en', 'Analyse'),
  ('companies.premarket', 'en', 'Premarket')
ON CONFLICT (key, language_code) DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();

-- Plattdüütsch (Low German)
INSERT INTO ui_translations (key, language_code, value) VALUES
  ('companies.title', 'nds', 'Ünnernehmen'),
  ('companies.description', 'nds', '{count} Ünnernehmen in uns Artikels nöömt. Klick op dat Badge för de KI-Analyse.'),
  ('companies.empty', 'nds', 'Noch keen Ünnernehmen funnen. Publizeer Artikels mit Ünnernehmen-Nöömungen.'),
  ('companies.back', 'nds', 'Trüch'),
  ('companies.back_home', 'nds', 'Trüch na Synthszr'),
  ('companies.all_companies', 'nds', 'All Ünnernehmen'),
  ('companies.back_to_companies', 'nds', 'Trüch na Ünnernehmen'),
  ('companies.articles_count_singular', 'nds', '{count} Artikel nöömt {company}'),
  ('companies.articles_count_plural', 'nds', '{count} Artikels nöömt {company}'),
  ('companies.premarket_label', 'nds', 'Pre-IPO Ünnernehmen'),
  ('companies.article', 'nds', 'Artikel'),
  ('companies.articles', 'nds', 'Artikels'),
  ('companies.analyse', 'nds', 'Analyse'),
  ('companies.premarket', 'nds', 'Premarket')
ON CONFLICT (key, language_code) DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();

-- Czech
INSERT INTO ui_translations (key, language_code, value) VALUES
  ('companies.title', 'cs', 'Společnosti'),
  ('companies.description', 'cs', '{count} společností zmíněno v našich článcích. Klikněte na odznáček pro AI analýzu.'),
  ('companies.empty', 'cs', 'Zatím nebyly nalezeny žádné společnosti. Publikujte články se zmínkami o společnostech.'),
  ('companies.back', 'cs', 'Zpět'),
  ('companies.back_home', 'cs', 'Zpět na Synthszr'),
  ('companies.all_companies', 'cs', 'Všechny společnosti'),
  ('companies.back_to_companies', 'cs', 'Zpět na společnosti'),
  ('companies.articles_count_singular', 'cs', '{count} článek zmiňuje {company}'),
  ('companies.articles_count_plural', 'cs', '{count} článků zmiňuje {company}'),
  ('companies.premarket_label', 'cs', 'Pre-IPO společnost'),
  ('companies.article', 'cs', 'Článek'),
  ('companies.articles', 'cs', 'Článků'),
  ('companies.analyse', 'cs', 'Analýza'),
  ('companies.premarket', 'cs', 'Premarket')
ON CONFLICT (key, language_code) DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();
