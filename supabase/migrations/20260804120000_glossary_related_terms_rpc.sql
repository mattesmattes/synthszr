-- Fachbegriff-Lexikon: RPC für semantisch verwandte Begriffe.
-- Sicher wiederholbar ausführbar (create or replace / if not exists) —
-- KOMPLETTE DATEI ausführen, nicht nur die abschließende Verifikations-Query
-- (siehe Hinweis am Ende).
--
-- WARUM: "Verwandte Begriffe" entstand bisher ausschließlich per Text-Matching
-- über den eigenen Erklärtext (lib/glossary/detail.ts, linkRelatedTerms). Das
-- findet nur Begriffe, die im Text WÖRTLICH vorkommen — bei einem jungen Lexikon
-- mit thematisch verstreuten Einträgen bleibt der Block dadurch meist leer
-- (gemessen 2026-08-04: 1 von 5 veröffentlichten Begriffen hatte einen Treffer).
-- Die Embeddings liegen bereits vor (glossary_terms.embedding, befüllt von
-- lib/glossary/news.ts), also kostet die semantische Nachbarschaft keine neuen
-- Daten — nur diese Funktion.
--
-- WARUM ALS RPC UND NICHT IN JS: die Ähnlichkeit über vector(768) zu rechnen
-- würde bedeuten, für JEDEN Seiten-Render die Embeddings aller veröffentlichten
-- Begriffe zu laden. Bei 100 Begriffen sind das ~300 KB pro Render; mit
-- revalidate=900 über 100 Seiten ergibt das ~86 GB/Monat allein dafür. Das
-- Projekt liegt beim Supabase-Egress bereits in der Overage. Postgres rechnet
-- hier und liefert nur die Treffer zurück.
--
-- WARUM source_slug STATT query_embedding: so verlässt der Vektor die Datenbank
-- überhaupt nicht. Der Aufrufer kennt nur den Slug, den er ohnehin hat.
create or replace function public.match_glossary_related_terms(
  source_slug text,
  match_threshold numeric default 0.6,
  match_count int default 6
)
returns table (slug text, canonical_name text, summary text, similarity numeric)
language sql
security invoker
set search_path = pg_catalog, public
as $$
  with source as (
    select embedding
    from public.glossary_terms
    where slug = source_slug
      and embedding is not null
    limit 1
  )
  select t.slug, t.canonical_name, t.summary,
         1 - (t.embedding <=> s.embedding) as similarity
  from public.glossary_terms t
  cross join source s
  where t.embedding is not null
    -- status IM SQL, nicht im Code: ein draft- oder hidden-Begriff hat keine
    -- öffentliche Seite, ein Link darauf landet auf notFound(). Die Regel darf
    -- nicht davon abhängen, dass jeder künftige Aufrufer sie kennt.
    and t.status = 'published'
    and t.slug <> source_slug
    and 1 - (t.embedding <=> s.embedding) >= match_threshold
  order by t.embedding <=> s.embedding
  limit match_count;
$$;

revoke all on function public.match_glossary_related_terms(text, numeric, int) from public;
revoke all on function public.match_glossary_related_terms(text, numeric, int) from anon;
revoke all on function public.match_glossary_related_terms(text, numeric, int) from authenticated;
grant execute on function public.match_glossary_related_terms(text, numeric, int) to service_role;

-- Verifikation — WICHTIG: die ganze Datei oben (CREATE FUNCTION, REVOKE/GRANT)
-- muss ausgeführt worden sein, nicht nur dieser SELECT. Wird nur er markiert
-- und ausgeführt, zeigt er unten "false" statt einer leeren, unauffälligen
-- Ergebnismenge — ein Teil-Lauf ist damit SICHTBAR falsch statt scheinbar in
-- Ordnung. Genau dieser Fehler ist in diesem Vorhaben schon einmal passiert.
--
-- ERWARTUNG: alle vier Spalten true, und begriffe_mit_embedding >= 2 (sonst hat
-- die Funktion nichts zu vergleichen — der News-Cron befüllt die Embeddings).
select
  exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'match_glossary_related_terms'
  ) as rpc_existiert,
  exists (
    select 1 from information_schema.routine_privileges
    where routine_name = 'match_glossary_related_terms' and grantee = 'service_role'
      and privilege_type = 'EXECUTE'
  ) as service_role_hat_execute,
  not exists (
    select 1 from information_schema.routine_privileges
    where routine_name = 'match_glossary_related_terms'
      and grantee in ('anon', 'authenticated', 'PUBLIC')
  ) as anon_hat_keinen_zugriff,
  (select count(*) >= 2 from public.glossary_terms
    where status = 'published' and embedding is not null) as genug_embeddings,
  (select count(*) from public.glossary_terms
    where status = 'published' and embedding is not null) as begriffe_mit_embedding;
