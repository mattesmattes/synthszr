-- supabase/migrations/20260808140000_glossary_jobs_extract_kind.sql
--
-- Siebter servergetriebener Lexikonlauf: ARTIKEL LESEN (Kandidaten sammeln).
--
-- Bisher lief die Extraktion synchron in der Admin-Route: ein Klick auf
-- "Naechste 10 Artikel lesen" las genau POSTS_PER_EXTRACTION=10 Artikel in
-- EINEM Request. Die 10 sind nicht willkuerlich, sie sind das Zeitlimit —
-- identifyCandidates macht einen Modellaufruf JE ARTIKEL, und die Route hat
-- maxDuration=300.
--
-- Betreiber-Wunsch 2026-08-08: 10 bis 100 Artikel in Zehnerschritten waehlbar,
-- "damit man auch mal ueber Nacht 50 Artikel nachgenerieren kann". Beides
-- schliesst den synchronen Weg aus — 100 Modellaufrufe reissen das
-- Function-Limit um ein Vielfaches, und "ueber Nacht" heisst ohne offenen
-- Browser.
--
-- Deshalb dieselbe Bauart wie die uebrigen Laeufe: die Route legt nur den Job
-- an, der Minutentakt-Cron (/api/cron/glossary-jobs) liest je Tick 10 Artikel,
-- bis params.targetPosts erreicht ist oder der Bestand durch ist.
--
-- Idempotent: Constraint droppen, falls vorhanden, und neu anlegen.
alter table glossary_jobs drop constraint if exists glossary_jobs_kind_check;
alter table glossary_jobs add constraint glossary_jobs_kind_check
  check (kind in ('generate', 'images', 'relink', 'pending', 'translations', 'term-translations', 'extract'));

-- Der partielle Unique-Index (glossary_jobs_one_open_per_kind) bleibt
-- unveraendert: 'extract' ist global wie die uebrigen Arten ausser 'pending',
-- hat also kein params.postId. Ein zweiter offener Lesejob scheitert damit mit
-- 23505 und createOrGetJob liefert stattdessen den laufenden zurueck — genau
-- das soll passieren, denn zwei gleichzeitige Leselaeufe wuerden denselben
-- Cursor gegeneinander vorschieben.
