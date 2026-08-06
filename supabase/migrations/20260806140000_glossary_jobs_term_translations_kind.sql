-- supabase/migrations/20260806140000_glossary_jobs_term_translations_kind.sql
--
-- Sechster servergetriebener Lexikonlauf: fehlende UEBERSETZUNGEN VON
-- BEGRIFFEN nachziehen (glossary_term_translations).
--
-- BEFUND 2026-08-06 (Betreiber, an Prod gemessen): 559 veroeffentlichte
-- Begriffe, 428 EN-Uebersetzungen — 134 fehlen, /en/glossary/git-worktree
-- zeigt deutschen Text. Eine Uebersetzung entsteht ausschliesslich bei der
-- FREIGABE eines Begriffs (applyGlossaryConfirmation -> translatePublishedTerms);
-- ein Begriff, bei dem dieser Aufruf einmal gescheitert ist, bleibt dauerhaft
-- deutsch, weil ihn nichts erneut anfasst.
--
-- Nicht zu verwechseln mit 'translations' (Migration 20260806120000): das
-- verlinkt uebersetzte ARTIKEL nach und macht keinen Modellaufruf. Diese Art
-- hier kostet einen Modellaufruf je Begriff.
--
-- Idempotent: Constraint droppen, falls vorhanden, und neu anlegen.
alter table glossary_jobs drop constraint if exists glossary_jobs_kind_check;
alter table glossary_jobs add constraint glossary_jobs_kind_check
  check (kind in ('generate', 'images', 'relink', 'pending', 'translations', 'term-translations'));

-- Der partielle Unique-Index (glossary_jobs_one_open_per_kind) bleibt
-- unveraendert: 'term-translations' ist global wie die uebrigen Arten ausser
-- 'pending', hat also kein params.postId, und coalesce(...,'') deckt den Fall
-- bereits ab. Ein zweiter offener Lauf dieser Art scheitert damit mit 23505.
