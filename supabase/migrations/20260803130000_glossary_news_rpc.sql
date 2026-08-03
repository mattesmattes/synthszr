-- Fachbegriff-Lexikon: News-RPC (Design-Spec §F) + Staleness-Spalte für den
-- wöchentlichen Refresh-Cron (Task 14). Sicher wiederholbar ausführbar
-- (create or replace / if not exists) — komplette Datei ausführen, nicht nur
-- die abschließende Verifikations-Query (siehe Hinweis am Ende der Datei).

-- match_glossary_news: findet aktuelle daily_repo-Artikel, die semantisch zu
-- einem Begriffs-Embedding passen. Nur 'article'/'webcrawl': Newsletter-Rows
-- enthalten den gesamten Newsletter-Plaintext über mehrere Themen, ein
-- Embedding-Treffer sagt dort nichts über den Begriff aus, und source_url ist
-- dort unzuverlässig (lib/newsletter/fetcher.ts:473-478). source_type kennt
-- außerdem 'newsletter' und 'email_note' — beide sind hier ungeeignet.
create or replace function public.match_glossary_news(
  query_embedding vector(768),
  since timestamptz,
  match_limit int default 5
)
returns table (id uuid, title text, source_url text,
               published_at timestamptz, similarity numeric)
language sql
security invoker
set search_path = pg_catalog, public
as $$
  select r.id, r.title, r.source_url, r.collected_at,
         1 - (r.embedding <=> query_embedding) as similarity
  from public.daily_repo r
  where r.embedding is not null
    and r.source_type in ('article', 'webcrawl')
    and r.collected_at >= since
  order by r.embedding <=> query_embedding
  limit match_limit;
$$;

revoke all on function public.match_glossary_news(vector, timestamptz, int) from public;
revoke all on function public.match_glossary_news(vector, timestamptz, int) from anon;
revoke all on function public.match_glossary_news(vector, timestamptz, int) from authenticated;
grant execute on function public.match_glossary_news(vector, timestamptz, int) to service_role;

-- Staleness-Marker für den Cron: Begriffe werden nach "am längsten nicht
-- aktualisiert" sortiert abgearbeitet (NULL = noch nie), begrenzt durch ein
-- Zeitbudget pro Lauf (300s Vercel-Cap). Ein Begriff ohne News-Treffer
-- braucht trotzdem einen Marker, sonst würde er ohne diese Spalte bei jedem
-- Lauf erneut ganz vorne stehen, weil glossary_term_news für ihn leer bleibt.
alter table public.glossary_terms
  add column if not exists news_refreshed_at timestamptz;

create index if not exists glossary_terms_news_refreshed_idx
  on public.glossary_terms (news_refreshed_at nulls first)
  where status = 'published';

-- Verifikation — WICHTIG: die ganze Datei oben (CREATE FUNCTION, REVOKE/
-- GRANT, ALTER TABLE, CREATE INDEX) muss ausgeführt worden sein, nicht nur
-- diese letzte SELECT-Anweisung. Wird nur dieser SELECT markiert und
-- ausgeführt, zeigt er unten "false" für rpc_existiert/spalte_existiert statt
-- eine leere, unauffällige Ergebnismenge — ein Teil-Lauf ist damit sichtbar
-- falsch statt scheinbar in Ordnung (das war der Fehler beim letzten Mal).
select
  exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'match_glossary_news'
  ) as rpc_existiert,
  exists (
    select 1 from information_schema.routine_privileges
    where routine_name = 'match_glossary_news' and grantee = 'service_role'
      and privilege_type = 'EXECUTE'
  ) as service_role_hat_execute,
  not exists (
    select 1 from information_schema.routine_privileges
    where routine_name = 'match_glossary_news'
      and grantee in ('anon', 'authenticated', 'PUBLIC')
  ) as anon_hat_keinen_zugriff,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'glossary_terms'
      and column_name = 'news_refreshed_at'
  ) as spalte_existiert;
