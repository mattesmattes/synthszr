-- QS-Protokoll der Attribution-Cron-Phase (nur intern/service_role).
create table if not exists public.attribution_qa_flags (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null,
  slug text not null,
  current_vendor text not null,
  action text not null check (action in ('merged','flagged','aliased','kept')),
  merged_into_slug text,
  suggested_company text,
  confidence numeric,
  reasoning text,
  created_at timestamptz not null default now()
);
create index if not exists attribution_qa_flags_action_idx
  on public.attribution_qa_flags(action, created_at desc);

alter table public.attribution_qa_flags enable row level security;
-- Keine Policy → nur service_role (bypass RLS). Kein public/anon-Zugriff.
