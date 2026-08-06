-- supabase/migrations/20260806120000_glossary_jobs_translations_kind.sql
--
-- Fuenfter servergetriebener Lexikonlauf: Nachverlinkung UEBERSETZTER Artikel
-- (content_translations). Der CHECK-Constraint auf `kind` erlaubte bisher nur
-- generate/images/relink/pending.
--
-- BEFUND, der den Lauf noetig macht (2026-08-06, an Prod gemessen): von 743
-- Uebersetzungszeilen (en/cs/nds/fr) traegt KEINE eine glossaryLink-Mark,
-- waehrend die deutschen Artikel durchgehend verlinkt sind. Kein Fehler in der
-- Uebersetzungspipeline, sondern eine Reihenfolge:
-- reinjectGlossaryMarksForTranslation nimmt die Slugs aus dem QUELLTEXT, und
-- jede bisherige Uebersetzung lief, bevor ihr deutscher Artikel verlinkt war.
-- backfillGlossaryLinks (der relink-Lauf) fasst ausschliesslich
-- generated_posts an, also holen die Uebersetzungen es nie nach — alle
-- nicht-deutschen Leser sehen dadurch keine Lexikon-Links.
--
-- Idempotent: Constraint droppen, falls vorhanden, und neu anlegen.
alter table glossary_jobs drop constraint if exists glossary_jobs_kind_check;
alter table glossary_jobs add constraint glossary_jobs_kind_check
  check (kind in ('generate', 'images', 'relink', 'pending', 'translations'));

-- Der partielle Unique-Index (glossary_jobs_one_open_per_kind) bleibt
-- unveraendert: 'translations' ist global wie generate/images/relink, hat also
-- kein params.postId, und coalesce(...,'') deckt den Fall bereits ab. Ein
-- zweiter offener translations-Job scheitert damit wie gewuenscht mit 23505.
