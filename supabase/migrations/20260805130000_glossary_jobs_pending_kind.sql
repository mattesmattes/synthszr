-- supabase/migrations/20260805130000_glossary_jobs_pending_kind.sql
--
-- Vierter servergetriebener Lexikonlauf: die Vormerklisten-Erzeugung eines
-- Artikels (bisher /api/admin/glossary-pending, vom Browser in einer
-- for(;;)-Schleife getrieben, s. components/admin/glossary-approval-panel.tsx)
-- bekommt denselben Job-Antrieb wie generate/images/relink. Der
-- CHECK-Constraint auf `kind` erlaubte bisher nur die drei bestehenden Arten.
--
-- Idempotent: Constraint droppen, falls vorhanden, und neu anlegen — der
-- Name folgt Postgres' Standardbenennung fuer einen Column-Check ohne
-- expliziten Namen (<tabelle>_<spalte>_check).
alter table glossary_jobs drop constraint if exists glossary_jobs_kind_check;
alter table glossary_jobs add constraint glossary_jobs_kind_check
  check (kind in ('generate', 'images', 'relink', 'pending'));

-- Review-Fund (2026-08-05, Fix-Runde): der bisherige Index liess nur EINEN
-- offenen Job je 'kind' zu — richtig fuer generate/images/relink (die sind
-- global), falsch fuer 'pending': das ist artikelbezogen (params.postId).
-- Ohne den Artikel im Index wuerde ein zweiter Artikel mit offenen
-- Kandidaten denselben Job-Slot wie der erste beanspruchen: createOrGetJob
-- liefe in den unique_violation-Pfad und gaebe den offenen Job des ERSTEN
-- (fremden) Artikels zurueck — fremdes "Fertig" im eigenen Panel, ein still
-- verlorener Auto-Start nach dem Speichern, ein 200 auf einen fremden Job.
--
-- In DERSELBEN, noch unangewendeten Migration erweitert statt in einer
-- dritten Datei: beide Aenderungen gehoeren zum selben, noch nicht
-- ausgerollten Feature (Job-Art 'pending'), niemand hat je auf dem
-- Zwischenstand ohne den Index gearbeitet.
--
-- coalesce(...,'') ist Pflicht: params->>'postId' ist bei generate/images/
-- relink NULL, und in einem Unique-Index sind zwei NULLs nie gleich — ohne
-- coalesce waeren fuer diese drei Arten beliebig viele offene Jobs
-- gleichzeitig erlaubt, der Doppelstart-Schutz waere fuer sie STILL
-- aufgehoben (in Prod bereits verifiziert: ein zweiter offener generate-Job
-- scheitert heute mit 23505 — das muss so bleiben, s. Testfall in
-- glossary-jobs-service.test.ts).
drop index if exists glossary_jobs_one_open_per_kind;
create unique index glossary_jobs_one_open_per_kind
  on glossary_jobs (kind, coalesce(params->>'postId', ''))
  where status in ('pending', 'processing');
