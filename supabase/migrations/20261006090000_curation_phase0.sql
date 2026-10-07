-- Phase 0 „Messgrundlage" des Kurationsteams (Spec 2026-10-05, Abschnitt
-- „Rollout in Phasen", Absatz „Phase 0 — Messgrundlage"; Betreiber-Vorgabe
-- 2026-10-05). Vier Schemateile:
--
--   1. generated_posts.published_at — es gab keinen Freigabe-Zeitstempel
--      (BEFUND 2026-10-06: lib/glossary/crawl.ts:278 sagt es ausdrücklich;
--      created_at ist bei Ghostwriter-Posts der gewählte Veröffentlichungstag
--      07:00 MEZ aus create-article/page.tsx:709; updated_at hat DEFAULT NOW()
--      beim Insert (002_ghostwriter.sql:89) und wird danach nur vom
--      Editor-PATCH gesetzt (generated-posts/route.ts:251), nicht vom
--      Status-Button PUT).
--   2. published_units — eine Zeile je veröffentlichtem H2-Abschnitt mit den
--      Queue-IDs seiner Mitglieder. Ground Truth für Recall/Precision und
--      Präzedenz-Quelle für den Archivbrief.
--   3. curation_precedents — je Tag und Item eine Stufe (veröffentlicht,
--      nach Auswahl gestrichen, nie gewählt, zusammengelegt). Quelle der
--      Negativmenge „Gewählt, aber gestrichen".
--   4. queue_item_events — Protokoll jeder Statusänderung an news_queue mit
--      Akteur. Heute setzen vier Akteure status='selected' und die Zeile kennt
--      keinen davon (BEFUND 2026-10-06: route.ts:406, ranking-feedback/
--      route.ts:23, techmeme/job.ts:209, queue-article.ts:245-322). Aus den
--      Events wird die Herkunft je Item abgeleitet (Hand-Begriff der Spec).
--
-- Wiederholbar ausführbar (if not exists, Backfill nur auf NULL). Von Hand
-- einspielen: npx supabase db query --linked --file <diese Datei>
-- — NICHT db push (Remote-Registry und Ordner sind auseinander, s.
-- docs/superpowers/specs/2026-08-05-servergetriebener-lexikonlauf-design.md).

-- 1) Freigabe-Zeitstempel. Backfill aus updated_at (Vertrag 2.1). updated_at
--    ist nie NULL (DEFAULT NOW(), 002_ghostwriter.sql:89) — der created_at-
--    Fallback im coalesce greift praktisch nie. Näherung: bei Editor-Publishes
--    = letzter Editor-Save, bei Button-Publishes = Zeilenerzeugung (meist der
--    Vorabend), NICHT der gewählte Veröffentlichungstag 07:00 MEZ in
--    created_at. Die Post-Reihenfolge im Backfill scripts/build-published-units.ts
--    (order by published_at) muss mit dieser Näherung leben. Für neue Posts
--    setzt app/api/admin/generated-posts/route.ts (PATCH und PUT) den Wert
--    beim Übergang auf 'published'.
alter table public.generated_posts add column if not exists published_at timestamptz;
update public.generated_posts set published_at = coalesce(updated_at, created_at)
  where status = 'published' and published_at is null;

-- 2) Veröffentlichte Einheiten (Ground Truth).
create table if not exists public.published_units (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.generated_posts(id) on delete cascade,
  -- 0-basierter Index unter den Top-Level-H2-Einheiten des Posts
  -- (extractPublishedUnits in scripts/lib/taste-ground-truth.ts), NICHT der
  -- Heading-Ordinal von extractBundleMarkers/applyBundleMarkers — der zählt
  -- alle Headings H1–H6 und weicht ab, sobald ein Post H1/H3 auf Top-Level hat.
  position integer not null,
  heading text not null,
  -- Frei, kein CHECK: 'story' kommt erst in Phase 2 dazu, und ein CHECK
  -- hier müsste dann parallel zu news_queue_bundle_type_check gepflegt werden.
  bundle_type text,
  -- news_queue.id aller Items des Abschnitts (Einzel: eine ID, Bündel: alle).
  member_ids uuid[] not null default '{}',
  -- Kopie von generated_posts.published_at zum Zeitpunkt des Backfills
  -- (scripts/build-published-units.ts). Absicht: zeitliche Filter auf
  -- Einheiten ohne Join auf generated_posts; bei Einführung filtert noch keine
  -- Abfrage darauf.
  published_at timestamptz,
  -- Embedding aus prepareTextForEmbedding(heading, firstParagraph), 768 dim
  -- wie daily_repo.embedding, damit Similarities vergleichbar bleiben.
  embedding vector(768),
  created_at timestamptz not null default now(),
  unique (post_id, position)
);

-- 3) Präzedenzfälle je Tag und Item.
create table if not exists public.curation_precedents (
  id uuid primary key default gen_random_uuid(),
  -- Berlin-Datum von article_jobs.created_at.
  day date not null,
  -- news_queue.id ohne FK: Items werden nach Ablauf gelöscht, der
  -- Präzedenzfall soll stehen bleiben.
  item_id uuid not null,
  story_key text,
  stage text not null check (stage in ('published','dropped_after_selection','pending_never_selected','merged')),
  bundle_type_selected text,
  bundle_type_published text,
  job_id uuid,
  post_id uuid,
  -- Nur bei stage='merged': Heading der veröffentlichten Einheit, der das
  -- gestrichene Item mit Similarity >= 0,8 entspricht.
  matched_heading text,
  similarity real,
  created_at timestamptz not null default now(),
  unique (day, item_id)
);

-- 4) Statusereignisse an news_queue.
create table if not exists public.queue_item_events (
  id bigserial primary key,
  -- Kein FK auf news_queue: Events überleben das Löschen abgelaufener Items.
  queue_item_id uuid not null,
  -- ranking_runs.id beim Panel (panel_accept/panel_reject), sonst NULL.
  run_id uuid,
  -- Ereignisname ohne CHECK: die Liste (select, use, skip, expire, reset,
  -- stuck_reset, remove, relabel, panel_accept, panel_reject, dedup_drop,
  -- techmeme_promote, merged_into) lebt als QueueEventName in
  -- lib/news-queue/events.ts und wächst mit Phase 1/2.
  event text not null,
  actor text not null check (actor in ('operator','techmeme','agent','pipeline')),
  from_status text, to_status text, from_role text, to_role text,
  reason text,
  at timestamptz not null default now()
);

create index if not exists idx_queue_item_events_item_at on public.queue_item_events(queue_item_id, at);
create index if not exists idx_published_units_post on public.published_units(post_id);
create index if not exists idx_curation_precedents_day on public.curation_precedents(day);

-- RLS ohne Policy (Klasse ADMIN-ONLY des RLS-Umbaus 20260801130000): nur der
-- Service-Role-Schlüssel liest und schreibt hier, anon bleibt außen vor.
alter table public.published_units enable row level security;
alter table public.curation_precedents enable row level security;
alter table public.queue_item_events enable row level security;

-- Grants nach docs/security/security-runbook.md § 5 (Muster
-- 20260803120000_glossary_schema.sql:74-90) — Zusatz über Vertrag 2.1 hinaus:
-- Supabase grantet neuen public-Tabellen per Default Rechte an
-- anon/authenticated — ohne REVOKE wären die Tabellen per PostgREST
-- erreichbar (RLS liefert dann 0 Zeilen statt permission denied; strenger
-- ist besser).
do $$
declare t text;
begin
  for t in select unnest(array[
    'published_units', 'curation_precedents', 'queue_item_events'
  ])
  loop
    execute format('revoke all on table public.%I from public', t);
    execute format('revoke all on table public.%I from anon', t);
    execute format('revoke all on table public.%I from authenticated', t);
    execute format(
      'grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end $$;

-- bigserial legt eine Sequenz an. Die Default-Privilegien von Supabase gelten
-- auch für Sequenzen (USAGE an anon/authenticated; vgl. für Funktionen
-- 20260628170000_rankings_claim_rpc_revoke_anon.sql) — also erst entziehen,
-- dann service_role geben, das sie für INSERT braucht.
revoke all on sequence public.queue_item_events_id_seq from public, anon, authenticated;
grant usage, select on sequence public.queue_item_events_id_seq to service_role;

-- Verifikation — WICHTIG: die ganze Datei oben muss ausgeführt worden sein,
-- nicht nur diese letzte SELECT-Anweisung. Ein Teil-Lauf zeigt unten "false"
-- statt einer leeren, unauffälligen Ergebnismenge.
select
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'generated_posts'
      and column_name = 'published_at'
  ) as published_at_existiert,
  (select count(*) from public.generated_posts
    where status = 'published' and published_at is null) as published_ohne_zeitstempel,
  (select count(*) from information_schema.tables
    where table_schema = 'public'
      and table_name in ('published_units', 'curation_precedents', 'queue_item_events')
  ) as neue_tabellen,
  (select count(*) from pg_indexes
    where schemaname = 'public'
      and indexname in ('idx_queue_item_events_item_at', 'idx_published_units_post', 'idx_curation_precedents_day')
  ) as neue_indizes,
  (select count(*) from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('published_units', 'curation_precedents', 'queue_item_events')
      and c.relrowsecurity
  ) as rls_aktiv,
  not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename in ('published_units', 'curation_precedents', 'queue_item_events')
  ) as keine_policy,
  not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('published_units', 'curation_precedents', 'queue_item_events')
      and grantee in ('anon', 'authenticated', 'PUBLIC')
  ) as anon_hat_keinen_zugriff,
  not exists (
    select 1 from information_schema.role_usage_grants
    where object_schema = 'public' and object_name = 'queue_item_events_id_seq'
      and grantee in ('anon', 'authenticated', 'PUBLIC')
  ) as anon_hat_keine_sequenz,
  exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'queue_item_events'
      and grantee = 'service_role' and privilege_type = 'INSERT'
  ) as service_role_hat_insert;
