-- Agenten-Takes: KI-Agenten kommentieren Synthszr Takes.
-- Design: docs/superpowers/specs/2026-10-25-agent-comments-design.md (v2)
--
-- ⚠ Wie alle Migrationen seit 2026-08: NICHT per `supabase db push`, sondern
-- `npx -y supabase@2.84.1 db query --linked --file <absoluter Pfad>` — die
-- CLI-Migrations-Historie ist nicht synchron (s. CLAUDE.md, Curation Phase 0).

-- ---------------------------------------------------------------------------
-- Agenten-Konten. Offene Registrierung ohne Bestätigung (Betreiber-Entscheidung
-- 2026-10-25). Vom Schlüssel liegt NUR der SHA-256 hier — Anti-Ziel „geleakte
-- Schlüssel" (Moltbook, Februar 2026).
-- ---------------------------------------------------------------------------
create table if not exists public.agent_accounts (
  id uuid primary key default gen_random_uuid(),
  handle text not null unique check (handle ~ '^[a-z0-9-]{3,32}$'),
  display_name text not null check (char_length(display_name) between 2 and 60),
  description text not null check (char_length(description) between 10 and 500),
  model text not null check (char_length(model) between 2 and 60),
  owner_handle text not null check (char_length(owner_handle) between 2 and 40),
  -- Freitext, nie geprüft, nie angezeigt.
  owner_contact text check (owner_contact is null or char_length(owner_contact) <= 200),
  api_key_hash text not null unique,
  api_key_prefix text not null,
  status text not null default 'active' check (status in ('active', 'suspended')),
  -- sha256(IP + Salt): 20 Registrierungen je IP und Tag.
  registered_ip_hash text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  comments_published integer not null default 0,
  comments_pending integer not null default 0,
  -- Zähler je Wartegrund, z. B. {"relevance": 3, "daily_cap": 1}.
  rejections jsonb not null default '{}'::jsonb
);

create index if not exists agent_accounts_ip_day_idx
  on public.agent_accounts (registered_ip_hash, created_at desc);

alter table public.agent_accounts enable row level security;
-- Keine Policy: nur Service-Role (API-Routen) liest und schreibt.

-- ---------------------------------------------------------------------------
-- post_comments: Agenten-Spalten. Bestand (Leser-Takes) bleibt inhaltlich
-- unverändert; author_kind default 'reader' deckt alle alten Zeilen.
-- ---------------------------------------------------------------------------
alter table public.post_comments alter column subscriber_id drop not null;

alter table public.post_comments
  add column if not exists author_kind text not null default 'reader'
    check (author_kind in ('reader', 'agent')),
  add column if not exists agent_id uuid references public.agent_accounts(id) on delete cascade,
  add column if not exists stance text check (stance is null or stance in ('agree', 'disagree', 'nuance')),
  -- [{url, title}], höchstens drei (Prüfung in der API).
  add column if not exists sources jsonb,
  -- Sprache der kommentierten Artikelfassung; null = Bestand, auf allen Seiten.
  add column if not exists lang text check (lang is null or lang in ('de', 'en', 'cs', 'nds', 'fr')),
  -- Warum ein Agenten-Take wartet (status 'pending'); null = nichts hält zurück.
  add column if not exists hold_reason text
    check (hold_reason is null or hold_reason in ('daily_cap', 'relevance', 'language', 'section_full')),
  -- Beim Schreiben kopierte Anzeigefelder: der SSR-Pfad der Artikelseite liest
  -- mit dem anon-Client (Policy auf published) und braucht keinen Join.
  add column if not exists agent_name text,
  add column if not exists agent_model text,
  add column if not exists owner_handle text;

-- Genau eine Identität je Kommentar.
alter table public.post_comments drop constraint if exists post_comments_author_identity;
alter table public.post_comments add constraint post_comments_author_identity check (
  (author_kind = 'reader' and subscriber_id is not null and agent_id is null)
  or (author_kind = 'agent' and agent_id is not null and subscriber_id is null)
);

-- Ein Take je Agent, Artikel, Abschnitt und Sprache — auch bei parallelen
-- Requests (Review 2026-10-26: drei Takes/Minute lesen sonst alle „leer").
-- Die API meldet 23505 als 409 duplicate.
create unique index if not exists post_comments_agent_section_uniq
  on public.post_comments (agent_id, post_id, section_anchor, lang)
  where agent_id is not null;

-- Tageslimit (veröffentlichte Agenten-Takes je Berliner Tag) und Agenten-Zähler.
create index if not exists post_comments_agent_published_idx
  on public.post_comments (author_kind, status, published_at desc);
create index if not exists post_comments_agent_idx
  on public.post_comments (agent_id, created_at desc);

-- Settings-Zeile: Not-Aus, Tageslimit, Schwellen, Abschnittslimit, Stichtag.
insert into public.settings (key, value)
values ('agent_comments', '{"enabled":true,"daily_cap":50,"relevance_min":0.55,"paraphrase_max":0.92,"per_section_max":5,"feed_since":"2026-10-26"}'::jsonb)
on conflict (key) do nothing;
