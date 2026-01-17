-- Add English UI translations for company pages
-- Migration: 20260117_companies_ui_translations.sql

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
