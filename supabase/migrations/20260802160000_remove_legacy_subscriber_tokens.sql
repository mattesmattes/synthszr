-- SEC-001 CONTRACT step: remove the legacy subscriber credentials.
--
-- Only safe once the code cutover is live and verified, because it deletes the
-- fallbacks. Preconditions checked against production before writing this:
--   * subscribers with confirmation_token: 0 (and 0 pending), so the dropped
--     column carries no live credential
--   * subscriber_preference_tokens: 338 rows, all 338 present as hashes in
--     subscriber_action_tokens, so links already in inboxes keep resolving
--   * new purpose tokens are being minted in production (verified end-to-end,
--     including a real unsubscribe click)
--
-- The old cleanup function is not referenced by any cron job, so dropping it
-- breaks nothing.

drop function if exists public.cleanup_expired_preference_tokens();
drop function if exists public.generate_preference_token(uuid);
drop table if exists public.subscriber_preference_tokens;

alter table public.subscribers drop column if exists confirmation_token;

-- Every newsletter mints three tokens per recipient, so the table grows by
-- roughly 3x the list size per send. Expired rows and rows consumed over a
-- week ago serve no purpose - the hash cannot be reversed, but there is no
-- reason to retain them. Called daily by /api/cron/scheduled-tasks.
--
-- SECURITY INVOKER: the only caller is the service-role client (BYPASSRLS),
-- so DEFINER would grant privileges without needing them. search_path is
-- pinned so an attacker-controlled schema cannot shadow the table reference.
create or replace function public.cleanup_expired_subscriber_action_tokens()
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  deleted_count integer;
begin
  delete from public.subscriber_action_tokens
  where expires_at < now()
     or consumed_at < now() - interval '7 days';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.cleanup_expired_subscriber_action_tokens() from public;
revoke all on function public.cleanup_expired_subscriber_action_tokens() from anon, authenticated;
grant execute on function public.cleanup_expired_subscriber_action_tokens() to service_role;
