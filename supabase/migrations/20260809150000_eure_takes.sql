-- „Eure Takes": Leser-Kommentare + Take-Barometer.
-- Design: docs/superpowers/specs/2026-08-09-eure-takes-design.md
--
-- ⚠ Wie alle Migrationen seit 2026-08: manuell im SQL-Editor ausführen —
-- die CLI-Migrations-Historie ist nicht synchron (s. Session 2026-08-08).

-- ---------------------------------------------------------------------------
-- Kommentare. An die Post-ID gebunden, NICHT an den Slug: Artikel haben pro
-- Sprache verschiedene Slugs (content_translations), und es gibt zwei
-- Quelltabellen (posts, generated_posts) — daher der source-Diskriminator.
-- ---------------------------------------------------------------------------
create table if not exists public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_source text not null check (post_source in ('posts', 'generated_posts')),
  post_id uuid not null,
  subscriber_id uuid not null references public.subscribers(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  -- Plain-Text, KEIN HTML. Die CSP erlaubt unsafe-inline; Escaping beim
  -- Rendern ist die einzige XSS-Linie — deshalb wird hier gar kein Markup
  -- gespeichert, das man falsch rendern könnte.
  body text not null check (char_length(body) between 1 and 4000),
  -- Abschnitts-Bezug („zu: …"). Headline denormalisiert, damit der Chip
  -- Content-Edits überlebt.
  section_anchor text,
  section_headline text check (section_headline is null or char_length(section_headline) <= 200),
  -- pending_verify: wartet auf den Magic-Link (Web-Flow).
  -- pending: wartet auf Admin-Freigabe (Moderations-Verdict 'review').
  status text not null default 'pending_verify'
    check (status in ('pending_verify', 'pending', 'published', 'rejected', 'deleted')),
  moderation_verdict text check (moderation_verdict in ('publish', 'review', 'reject')),
  moderation_reason text,
  created_at timestamptz not null default now(),
  published_at timestamptz
);

-- Lesepfad der Artikelseite: veröffentlichte Kommentare eines Posts, neueste zuerst.
create index if not exists post_comments_post_idx
  on public.post_comments (post_source, post_id, status, published_at desc);
-- Moderations-Queue im Admin.
create index if not exists post_comments_status_idx
  on public.post_comments (status, created_at desc);

alter table public.post_comments enable row level security;

-- anon liest NUR Veröffentlichtes (SSR der Artikelseite nutzt den anon-Client).
-- Kein anon-Write: alle Schreibpfade laufen über API-Routen mit Service-Role,
-- wie überall seit dem RLS-Umbau.
drop policy if exists post_comments_public_read on public.post_comments;
create policy post_comments_public_read on public.post_comments
  for select to anon using (status = 'published');

-- ---------------------------------------------------------------------------
-- Take-Barometer. Bewusst OHNE Identität (ein Klick, anonym) — dieses Signal
-- wandert nie ins Schema-Markup, weiche Dedup über voter_hash genügt.
-- ---------------------------------------------------------------------------
create table if not exists public.take_feedback (
  id uuid primary key default gen_random_uuid(),
  post_source text not null check (post_source in ('posts', 'generated_posts')),
  post_id uuid not null,
  -- queueItemId der Abschnitts-H2; bei Altbestand ohne queueItemId der
  -- Abschnitts-Index als "idx:N".
  section_anchor text not null,
  vote text not null check (vote in ('agree', 'disagree')),
  -- sha256(cookie-id) — weiche Dedup, kein Sicherheitsanker.
  voter_hash text not null,
  created_at timestamptz not null default now()
);

-- Ein Votum je Take und Voter. Beim Umstimmen wird per Upsert überschrieben.
create unique index if not exists take_feedback_dedup
  on public.take_feedback (post_source, post_id, section_anchor, voter_hash);
-- Aggregations-Lesepfad (Zähler je Take).
create index if not exists take_feedback_agg
  on public.take_feedback (post_source, post_id, section_anchor, vote);

alter table public.take_feedback enable row level security;
-- Kein anon-Zugriff: Aggregate liefert die API, Rohvoten sind nie öffentlich.

-- ---------------------------------------------------------------------------
-- Token-Purpose 'comment': Newsletter-Links und Magic-Links zur
-- Kommentar-Verifizierung. Mehrfach nutzbar (consume: false), TTL 7 Tage.
-- ---------------------------------------------------------------------------
alter table public.subscriber_action_tokens
  drop constraint if exists subscriber_action_tokens_purpose_check;
alter table public.subscriber_action_tokens
  add constraint subscriber_action_tokens_purpose_check
  check (purpose in ('confirm', 'preferences', 'unsubscribe', 'referral', 'comment'));
