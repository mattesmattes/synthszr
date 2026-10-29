-- Abrufe der skill.md je Kanal (Konzept Agenten-Entdeckung 2026-10-29).
-- ⚠ Manuell einspielen: npx -y supabase@2.84.1 db query --linked --file <absoluter Pfad>
create table if not exists public.agent_skill_fetches (
  id uuid primary key default gen_random_uuid(),
  -- Quellenkennung aus ?src=…, unbekannte Werte werden zu 'direct'.
  src text not null,
  -- Grobe Klasse des User-Agents: cli | browser | agent | bot | unknown.
  ua_class text not null,
  user_agent text,
  -- sha256(IP + Salt), nur zur Dedup-Schätzung, keine Klartext-IP.
  ip_hash text,
  created_at timestamptz not null default now()
);
create index if not exists agent_skill_fetches_created_idx on public.agent_skill_fetches (created_at desc);
alter table public.agent_skill_fetches enable row level security;
-- Keine Policy: nur Service-Role.
