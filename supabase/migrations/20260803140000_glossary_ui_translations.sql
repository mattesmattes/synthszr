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
-- Fix-Runde 1 (Review, Minor 7): 'Im' war deutsch stehen geblieben (nds
-- kennt keine verschmolzene Präposition „im" — 'in't'/'in dat' für neutrale
-- Substantive wie „Lexikon"), und 'apenbaart' traf „veröffentlicht" nicht.
-- Jetzt 'publizeert' wie im bestehenden companies-Seed ('Publizeer Artikels
-- ...', 20260117130000_companies_ui_translations.sql) — dieselbe Stamm-Wahl
-- statt einer zweiten, abweichenden Übersetzung für denselben Begriff.
-- 'verständlich' ebenfalls ersetzt (deutsches Wort ohne nds-Entsprechung
-- hier) durch 'kloor' (klar/verständlich).
INSERT INTO ui_translations (key, language_code, value) VALUES
  ('nav.glossary', 'nds', 'Lexikon'),
  ('glossary.related_terms', 'nds', 'Verwandte Begreep'),
  ('glossary.products', 'nds', 'Produkten dorto'),
  ('glossary.news', 'nds', 'Aktuelle Narichten'),
  ('glossary.not_found', 'nds', 'Begreep nich funnen'),
  ('glossary.index_title', 'nds', 'Synthszr Lexikon'),
  ('glossary.index_intro', 'nds', 'Fackbegreep ut uns Artikels, kort un kloor verklaart.'),
  ('glossary.index_empty', 'nds', 'Noch keen Begreep publizeert.'),
  ('glossary.explained_here', 'nds', 'In''t Lexikon verklaart')
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

-- Verifikation (Review Important 1, Fix-Runde 2): ein INSERT ohne RETURNING
-- quittiert der SQL-Editor mit „Success. No rows returned" — identisch für
-- einen Volltreffer, einen halb eingefügten Paste oder einen nur teilweise
-- markierten/ausgeführten Block. `language_code in (...)` grenzt auf die drei
-- Sprachen dieser Migration ein — ohne diesen Filter zählt der Query auch
-- eine `fr`-Zeile mit, falls scripts/_translate_fr.ts (iteriert über jeden
-- Schlüssel in defaultTranslations) seit Task 15/17 einmal gelaufen ist.
select language_code, count(*) as zeilen
from ui_translations
where language_code in ('en', 'nds', 'cs')
  and (key = 'nav.glossary' or key like 'glossary.%')
group by language_code order by language_code;
-- Erwartet: genau 3 Zeilen (cs/en/nds), je 9 — zusammen die 27 Zeilen dieser Migration.
