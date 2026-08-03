-- Task 18: UI-Übersetzungen fürs Fachbegriff-Lexikon.
--
-- Die Schlüssel glossary.* (related_terms, products, news, not_found,
-- index_title, index_intro, index_empty) sowie nav.glossary und
-- glossary.explained_here existieren bereits in defaultTranslations
-- (lib/i18n/get-translations.ts), hatten aber KEINE Zeile in ui_translations —
-- getTranslations() liefert für locale !== 'de' den DE-Fallback, solange die
-- DB-Zeile fehlt. Ergebnis: die Lexikon-Seiten (app/[lang]/glossary/*) und der
-- neue Footer-Link (components/site-footer.tsx) rendern für /en/* bislang
-- deutschen Text, obwohl der Code schon lokalisierungsfähig ist.
--
-- Sprachen wie in den bisherigen ui_translations-Migrationen für dieses
-- Projekt (companies, footer.sources, sources page): en/nds/cs. Kein `fr` —
-- kein einziges bestehendes ui_translations-Seed in diesem Repo führt `fr`,
-- und Design-Spec §H hält fest, dass cs/nds/fr für den Lexikon-INHALT
-- (glossary_term_translations, nur `en`) ohnehin auf den DE-Fallback laufen.

INSERT INTO ui_translations (key, language_code, value) VALUES
  ('nav.glossary', 'en', 'Glossary'),
  ('glossary.related_terms', 'en', 'Related Terms'),
  ('glossary.products', 'en', 'Related Products'),
  ('glossary.news', 'en', 'Latest News'),
  ('glossary.not_found', 'en', 'Term not found'),
  ('glossary.index_title', 'en', 'Synthszr Glossary'),
  ('glossary.index_intro', 'en', 'Terms from our articles, explained briefly and clearly.'),
  ('glossary.index_empty', 'en', 'No terms published yet.'),
  ('glossary.explained_here', 'en', 'Explained in the glossary')
ON CONFLICT (key, language_code) DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();

-- Plattdüütsch (Low German)
INSERT INTO ui_translations (key, language_code, value) VALUES
  ('nav.glossary', 'nds', 'Lexikon'),
  ('glossary.related_terms', 'nds', 'Verwandte Begreep'),
  ('glossary.products', 'nds', 'Produkten dorto'),
  ('glossary.news', 'nds', 'Aktuelle Narichten'),
  ('glossary.not_found', 'nds', 'Begreep nich funnen'),
  ('glossary.index_title', 'nds', 'Synthszr Lexikon'),
  ('glossary.index_intro', 'nds', 'Fackbegreep ut uns Artikels, kort un verständlich verklaart.'),
  ('glossary.index_empty', 'nds', 'Noch keen Begreep apenbaart.'),
  ('glossary.explained_here', 'nds', 'Im Lexikon verklaart')
ON CONFLICT (key, language_code) DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();

-- Czech
INSERT INTO ui_translations (key, language_code, value) VALUES
  ('nav.glossary', 'cs', 'Slovník'),
  ('glossary.related_terms', 'cs', 'Související pojmy'),
  ('glossary.products', 'cs', 'Související produkty'),
  ('glossary.news', 'cs', 'Aktuální zprávy'),
  ('glossary.not_found', 'cs', 'Pojem nenalezen'),
  ('glossary.index_title', 'cs', 'Synthszr Slovník'),
  ('glossary.index_intro', 'cs', 'Odborné pojmy z našich článků, stručně a srozumitelně vysvětlené.'),
  ('glossary.index_empty', 'cs', 'Zatím nebyly publikovány žádné pojmy.'),
  ('glossary.explained_here', 'cs', 'Vysvětleno ve slovníku')
ON CONFLICT (key, language_code) DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();
