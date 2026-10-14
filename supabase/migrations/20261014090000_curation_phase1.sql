-- Phase 1 „Shadow" der Morgenkonferenz (Spec 2026-10-05, Plan 2026-10-14).
-- Einspielen NUR per: cd /Users/mattes/dev/synthszr && npx -y supabase@2.84.1 db query --linked --file <absoluter Pfad>
-- Niemals `supabase db push` (Remote-Registry und Ordner laufen auseinander).

create table if not exists public.curation_runs (
  id uuid primary key default gen_random_uuid(),
  day date not null,                                   -- Berlin-Datum von asof
  mode text not null check (mode in ('shadow','backtest')),
  asof timestamptz not null,                           -- Pool-Stichtag: queued_at < asof
  status text not null default 'pending'
    check (status in ('pending','processing','done','error','cancelled')),
  phase text not null default 'pool'
    check (phase in ('pool','scout','cluster','archive','compose','units','finished')),
  brief_mode text not null default 'full' check (brief_mode in ('none','precedents-only','full')),
  attempts int not null default 0,                     -- Ticks ohne Fortschritt (wie glossary_jobs)
  last_advanced_at timestamptz,                        -- Lease gegen ueberlappende Ticks
  cancel_requested boolean not null default false,
  log jsonb not null default '[]'::jsonb,              -- [{at,text,ok}]
  degraded jsonb not null default '[]'::jsonb,         -- ['pool_embeddings','scout_partial','archive','critic','compose_fallback','budget']
  budget_usd numeric(8,4) not null default 4,
  spend_usd numeric(8,4) not null default 0,
  compose_attempts int not null default 0,
  pool jsonb,                                          -- PoolSnapshot
  cards jsonb,                                         -- ScoutCard[]
  story_keys jsonb,                                    -- ClusterResult
  brief jsonb,                                         -- ArchiveBrief
  baseline jsonb,                                      -- BaselineLists (total_score-Top-K als IDs)
  plan jsonb,                                          -- ComposePlan (validiert)
  critique jsonb,                                      -- Critique
  reconciled_at timestamptz,
  matched_post_id uuid,
  matched_job_id uuid,
  metrics jsonb,                                       -- RunMetrics
  model_scout text, model_editor text, model_critic text,
  error_message text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
-- Hoechstens EIN offener Run je Tag und Modus (Doppelstart auf DB-Ebene verhindert).
create unique index if not exists curation_runs_one_open_per_day
  on public.curation_runs (day, mode) where status in ('pending','processing');
create index if not exists idx_curation_runs_day on public.curation_runs (day desc, created_at desc);
create index if not exists idx_curation_runs_open on public.curation_runs (created_at)
  where status in ('pending','processing');
create index if not exists idx_curation_runs_unreconciled on public.curation_runs (asof)
  where status = 'done' and reconciled_at is null;

create table if not exists public.curation_units (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.curation_runs(id) on delete cascade,
  unit_key text not null,
  member_ids uuid[] not null default '{}',             -- news_queue-IDs, kein FK (Items werden nach Ablauf geloescht)
  story_key text,
  role text check (role is null or role in ('topic','recap','deep_dive','cover_story')),
  rank int,                                            -- null nur bei outcome='added'
  tier text check (tier is null or tier in ('recommended','bench','held')),  -- null nur bei outcome='added'
  reason text,
  alternative text,
  precedent_ids uuid[] not null default '{}',          -- published_units.id
  is_hand boolean not null default false,
  panel_action text check (panel_action is null or panel_action in ('keep','drop','relabel','take_alt','promote')),
  panel_at timestamptz,
  outcome text check (outcome is null or outcome in
    ('kept','relabeled','merged','dropped_after_selection','dropped_never_selected','added')),
  final_role text,
  final_rank int,
  matched_post_id uuid,
  matched_heading text,
  similarity real,
  created_at timestamptz not null default now(),
  unique (run_id, unit_key),
  check ((outcome = 'added') = (tier is null))
);
create index if not exists idx_curation_units_run on public.curation_units (run_id);

-- Caches: Embeddings fuer Items ohne daily_repo-Embedding (Techmeme, manuell) und Scout-Cards je Item.
create table if not exists public.curation_item_embeddings (
  item_id uuid primary key,
  embedding vector(768) not null,
  created_at timestamptz not null default now()
);
create table if not exists public.curation_cards (
  item_id uuid not null,
  model text not null,
  core text not null,
  created_at timestamptz not null default now(),
  primary key (item_id, model)
);

-- RPC 1: Praezedenz-Einheiten je Rolle fuer einen Satz Kandidaten-Embeddings (ein Round-Trip).
create or replace function public.get_precedent_units(
  candidate_embeddings vector(768)[], before timestamptz, per_role int default 8)
returns table (unit_id uuid, post_id uuid, heading text, bundle_type text,
               published_at timestamptz, similarity real, candidate_index int)
language sql stable security invoker
set search_path = pg_catalog, public
as $$
  with cand as (
    select (ord - 1)::int as idx, e from unnest(candidate_embeddings) with ordinality as t(e, ord)
  ),
  scored as (
    select u.id, u.post_id, u.heading, coalesce(u.bundle_type, '') as role, u.published_at,
           max(1 - (u.embedding <=> c.e))::real as sim,
           (array_agg(c.idx order by (u.embedding <=> c.e)))[1] as cidx
    from public.published_units u
    cross join cand c
    where u.embedding is not null and u.published_at < before
    group by u.id, u.post_id, u.heading, u.bundle_type, u.published_at
  ),
  ranked as (
    select *, row_number() over (partition by role order by sim desc) as rn from scored
  )
  select id, post_id, heading, nullif(role, ''), published_at, sim, cidx
  from ranked where rn <= per_role
  order by role, sim desc;
$$;

-- RPC 2: Excerpt je Item, gekappt — spart den Volltext-Egress (BEFUND 2026-10-14: excerpt ist bei ~77 % des Pools NULL).
create or replace function public.get_pool_excerpts(ids uuid[], max_chars int default 1500)
returns table (id uuid, excerpt text)
language sql stable security invoker
set search_path = pg_catalog, public
as $$
  select q.id,
         coalesce(nullif(btrim(q.excerpt), ''), left(regexp_replace(coalesce(q.content, ''), '\s+', ' ', 'g'), max_chars))
  from public.news_queue q where q.id = any(ids);
$$;

alter table public.curation_runs enable row level security;
alter table public.curation_units enable row level security;
alter table public.curation_item_embeddings enable row level security;
alter table public.curation_cards enable row level security;

do $$
declare t text;
begin
  for t in select unnest(array['curation_runs','curation_units','curation_item_embeddings','curation_cards'])
  loop
    execute format('revoke all on table public.%I from public', t);
    execute format('revoke all on table public.%I from anon', t);
    execute format('revoke all on table public.%I from authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end $$;

revoke all on function public.get_precedent_units(vector(768)[], timestamptz, int) from public, anon, authenticated;
grant execute on function public.get_precedent_units(vector(768)[], timestamptz, int) to service_role;
revoke all on function public.get_pool_excerpts(uuid[], int) from public, anon, authenticated;
grant execute on function public.get_pool_excerpts(uuid[], int) to service_role;

-- Verifikation (nur aussagekraeftig, wenn die ganze Datei lief):
select
  (select count(*) from information_schema.tables where table_schema='public'
     and table_name in ('curation_runs','curation_units','curation_item_embeddings','curation_cards')) as neue_tabellen,
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
     and c.relname in ('curation_runs','curation_units','curation_item_embeddings','curation_cards') and c.relrowsecurity) as rls_aktiv,
  not exists (select 1 from pg_policies where schemaname='public'
     and tablename in ('curation_runs','curation_units','curation_item_embeddings','curation_cards')) as keine_policy,
  not exists (select 1 from information_schema.role_table_grants where table_schema='public'
     and table_name in ('curation_runs','curation_units','curation_item_embeddings','curation_cards')
     and grantee in ('anon','authenticated','PUBLIC')) as anon_hat_keinen_zugriff,
  (select count(*) from pg_indexes where schemaname='public' and indexname in
     ('curation_runs_one_open_per_day','idx_curation_runs_day','idx_curation_runs_open','idx_curation_runs_unreconciled','idx_curation_units_run')) as neue_indizes,
  not exists (select 1 from information_schema.routine_privileges where routine_schema='public'
     and routine_name in ('get_precedent_units','get_pool_excerpts') and grantee in ('anon','authenticated','PUBLIC')) as anon_keine_rpc,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
     and p.proname in ('get_precedent_units','get_pool_excerpts')) as rpcs;
