-- Fachbegriff-Lexikon: der News-Block verweist auf EIGENE Blog-Posts statt auf
-- externe Quellen. Sicher wiederholbar ausführbar — KOMPLETTE DATEI ausführen,
-- nicht nur die abschließende Verifikations-Query (Hinweis am Ende).
--
-- WARUM: der Block zeigte bisher daily_repo-Artikel, also fremde Seiten. Auf
-- einer Lexikonseite führt das den Leser aus dem Angebot heraus, und die Titel
-- waren teils Fragmente aus der Newsletter-Link-Extraktion ("only 15-20%",
-- "@steph_palazzolo"). Eigene Artikel sind redaktionell geprüft, tragen echte
-- Schlagzeilen und halten den Leser im Haus.
--
-- KEINE NEUE SUCH-RPC NÖTIG: match_generated_posts existiert bereits (genutzt von
-- lib/posts/historical-retrieval.ts und app/api/search/route.ts) und arbeitet auf
-- generated_posts.content_embedding. Gegen Prod geprüft: mit dem Embedding von
-- "Inferenz" liefert sie als Top-Treffer "Wie es lief und läuft: Block, Design
-- und Inferenz" (0.655), und die Treffer sind published.
--
-- DIE TABELLE IST REINER CACHE: refreshGlossaryNews löscht die Zeilen eines
-- Begriffs und schreibt sie neu (lib/glossary/news.ts). Das `delete` unten
-- verliert daher nichts, was nicht beim nächsten Cron-Lauf wieder entsteht — und
-- es ist nötig, weil post_id NOT NULL in den Primary Key aufgenommen wird.

-- 1) Cache leeren: die bestehenden Zeilen verweisen auf daily_repo-Artikel und
--    haben kein post_id, könnten die neue NOT-NULL-Spalte also nicht erfüllen.
delete from public.glossary_term_news;

-- 2) Schema umstellen. Idempotent über einen Guard-Block, weil PostgreSQL für
--    ADD CONSTRAINT kein IF NOT EXISTS kennt.
alter table public.glossary_term_news
  drop constraint if exists glossary_term_news_pkey;

alter table public.glossary_term_news
  drop column if exists repo_item_id;

alter table public.glossary_term_news
  add column if not exists post_id uuid not null
  references public.generated_posts(id) on delete cascade;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'glossary_term_news_pkey'
      and conrelid = 'public.glossary_term_news'::regclass
  ) then
    alter table public.glossary_term_news
      add constraint glossary_term_news_pkey primary key (term_id, post_id);
  end if;
end $$;

-- source_url bleibt bestehen und trägt künftig den internen Pfad
-- (/<lang>/posts/<slug>). Die Spalte umzubenennen wäre eine Änderung an einer
-- Stelle, die der Loader ohnehin liest — der Gewinn wäre kosmetisch, das Risiko
-- (zwei Deploy-Stände gegen ein Schema) real.

-- Der Index auf (term_id, published_at desc) bleibt gültig und unangetastet.

-- Verifikation — WICHTIG: die ganze Datei oben muss ausgeführt worden sein, nicht
-- nur dieser SELECT. Wird nur er markiert und ausgeführt, zeigt er "false" statt
-- einer leeren, unauffälligen Ergebnismenge — ein Teil-Lauf ist damit SICHTBAR
-- falsch statt scheinbar in Ordnung.
--
-- ERWARTUNG: alle vier Spalten true, zeilen_im_cache = 0 (der Cron füllt sie neu).
select
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'glossary_term_news'
      and column_name = 'post_id' and is_nullable = 'NO'
  ) as post_id_vorhanden,
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'glossary_term_news'
      and column_name = 'repo_item_id'
  ) as repo_item_id_entfernt,
  exists (
    select 1 from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.conname = 'glossary_term_news_pkey' and a.attname = 'post_id'
  ) as pk_enthaelt_post_id,
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.glossary_term_news'::regclass
      and confrelid = 'public.generated_posts'::regclass
  ) as fk_auf_generated_posts,
  (select count(*) from public.glossary_term_news) as zeilen_im_cache;
