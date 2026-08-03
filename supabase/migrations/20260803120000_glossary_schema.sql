-- Fachbegriff-Lexikon: Begriffe, Übersetzungen, Produkt- und News-Zuordnung.
-- Alle vier Tabellen sind service_role-only: die Lexikonseiten rendern
-- serverseitig mit createAdminClient(), anon braucht keinen Zugriff.

create table if not exists public.glossary_terms (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  canonical_name text not null,
  aliases text[] not null default '{}',
  status text not null default 'draft'
    check (status in ('draft', 'published', 'hidden')),
  summary text not null default '',
  body jsonb,
  illustration_url text,
  illustration_alt text,
  embedding vector(768),
  readability_score numeric,
  review_state text not null default 'ok'
    check (review_state in ('ok', 'flagged', 'revision_pending')),
  pending_body jsonb,
  last_reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists glossary_terms_status_idx
  on public.glossary_terms (status);
create index if not exists glossary_terms_review_idx
  on public.glossary_terms (last_reviewed_at nulls first);

create table if not exists public.glossary_term_translations (
  term_id uuid not null references public.glossary_terms(id) on delete cascade,
  language text not null,
  canonical_name text not null,
  aliases text[] not null default '{}',
  summary text not null default '',
  body jsonb,
  updated_at timestamptz not null default now(),
  primary key (term_id, language)
);

create table if not exists public.glossary_term_products (
  term_id uuid not null references public.glossary_terms(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  relevance numeric not null default 0,
  source text not null default 'llm' check (source in ('llm', 'manual')),
  confirmed_at timestamptz,
  primary key (term_id, product_id)
);

-- Cache-Tabelle: ohne sie würde jede Lexikonseite bei jedem ISR-Revalidate
-- eine pgvector-Suche über daily_repo auslösen. Der Cron rechnet, die Seite
-- liest nur.
create table if not exists public.glossary_term_news (
  term_id uuid not null references public.glossary_terms(id) on delete cascade,
  repo_item_id uuid not null references public.daily_repo(id) on delete cascade,
  title text not null,
  source_name text,
  source_url text not null,
  published_at timestamptz,
  context_sentence text,
  similarity numeric,
  refreshed_at timestamptz not null default now(),
  primary key (term_id, repo_item_id)
);

create index if not exists glossary_term_news_term_idx
  on public.glossary_term_news (term_id, published_at desc);

-- Spalte für die Kandidatenliste bis zur redaktionellen Freigabe.
alter table public.generated_posts
  add column if not exists pending_glossary_terms jsonb;

-- RLS + Grants nach dem Muster aus docs/security/security-runbook.md § 5.
do $$
declare t text;
begin
  for t in select unnest(array[
    'glossary_terms', 'glossary_term_translations',
    'glossary_term_products', 'glossary_term_news'
  ])
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public', t);
    execute format('revoke all on table public.%I from anon', t);
    execute format('revoke all on table public.%I from authenticated', t);
    execute format(
      'grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end $$;
