-- SEC-015: server-side, revocable admin sessions.
--
-- Replaces the self-contained 7-day JWT. Only the SHA-256 hash of a session
-- token is stored, so reading this table yields nothing that can be replayed,
-- and revocation is a single UPDATE rather than a secret rotation that logs
-- everyone out.
--
-- Additive: applying this does not invalidate anything. Existing JWT cookies
-- stop working when the code that verifies against this table ships, at which
-- point admins log in once more.

create table if not exists public.admin_sessions (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  is_admin boolean not null default true,
  email text,
  name text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create index if not exists admin_sessions_expiry_idx on public.admin_sessions (expires_at);

-- Only the service-role client touches this table. RLS is enabled behind the
-- revoked grants so a policy added later by mistake still exposes nothing.
alter table public.admin_sessions enable row level security;
revoke all on table public.admin_sessions from public, anon, authenticated;
grant select, insert, update, delete on public.admin_sessions to service_role;

-- Housekeeping: expired rows and rows revoked over a week ago carry no value.
create or replace function public.cleanup_expired_admin_sessions()
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  deleted_count integer;
begin
  delete from public.admin_sessions
  where expires_at < now() - interval '7 days'
     or revoked_at < now() - interval '7 days';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.cleanup_expired_admin_sessions() from public;
revoke all on function public.cleanup_expired_admin_sessions() from anon, authenticated;
grant execute on function public.cleanup_expired_admin_sessions() to service_role;
