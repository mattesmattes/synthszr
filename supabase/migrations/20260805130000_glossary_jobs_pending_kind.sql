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
