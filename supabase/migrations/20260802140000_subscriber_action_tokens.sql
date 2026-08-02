-- SEC-001: purpose-scoped, hashed subscriber access tokens.
--
-- Replaces `subscribers.id` as the credential in newsletter links. Only the
-- SHA-256 hash is stored, so read access to this table yields nothing that
-- can be replayed against the API.
--
-- EXPAND step of expand-migrate-contract: creates the new table and backfills
-- from the legacy sources. Legacy columns and `subscriber_preference_tokens`
-- are deliberately left in place; they are dropped by a separate contract
-- migration only after the code cutover has been verified in production.

create table if not exists public.subscriber_action_tokens (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references public.subscribers(id) on delete cascade,
  purpose text not null check (purpose in ('confirm','preferences','unsubscribe','referral')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Lookup path used by resolveSubscriberToken(): hash + purpose, unconsumed.
create index if not exists subscriber_action_tokens_lookup_idx
  on public.subscriber_action_tokens (token_hash, purpose)
  where consumed_at is null;
create index if not exists subscriber_action_tokens_expiry_idx
  on public.subscriber_action_tokens (expires_at);
create index if not exists subscriber_action_tokens_subscriber_idx
  on public.subscriber_action_tokens (subscriber_id, purpose);

-- Only the service-role client ever touches this table. RLS is enabled as a
-- second line of defence behind the revoked grants, so a future policy added
-- by mistake still cannot expose rows to anon/authenticated.
alter table public.subscriber_action_tokens enable row level security;
revoke all on table public.subscriber_action_tokens from public, anon, authenticated;
grant select, insert, update, delete on table public.subscriber_action_tokens to service_role;

-- Backfill: keep links that are already in someone's inbox working.
-- sha256() is built into Postgres 11+, so this needs no pgcrypto and matches
-- createHash('sha256').update(token,'utf8').digest('hex') in Node exactly.

-- Pending double-opt-in confirmations (currently none, kept for correctness
-- in case a signup lands between writing and applying this migration).
insert into public.subscriber_action_tokens (subscriber_id, purpose, token_hash, expires_at)
select id,
       'confirm',
       encode(sha256(convert_to(confirmation_token, 'utf8')), 'hex'),
       coalesce(confirmation_sent_at, now()) + interval '48 hours'
from public.subscribers
where status = 'pending'
  and confirmation_token is not null
on conflict (token_hash) do nothing;

-- Existing preference links.
insert into public.subscriber_action_tokens (subscriber_id, purpose, token_hash, expires_at, consumed_at)
select subscriber_id,
       'preferences',
       encode(sha256(convert_to(token, 'utf8')), 'hex'),
       expires_at,
       used_at
from public.subscriber_preference_tokens
on conflict (token_hash) do nothing;
