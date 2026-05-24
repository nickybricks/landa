-- Atomic usage increment for the proxy's server-side word metering.
-- The proxy (service role) calls this after a successful cloud polish to add the dictated
-- word count to the user's current weekly period. SECURITY DEFINER + a single upsert keeps it
-- atomic under concurrent calls (no read-modify-write race). Returns the new running total.
--
-- Tamper-proofing: execute is granted to the service_role only. anon/authenticated clients
-- cannot call it, so a user can never inflate (or reset) their own counter.

create or replace function public.increment_usage(
  p_user_id uuid,
  p_period  date,
  p_words   integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_total integer;
begin
  insert into public.usage (user_id, period_start, words_used)
  values (p_user_id, p_period, greatest(p_words, 0))
  on conflict (user_id, period_start)
  do update set words_used = public.usage.words_used + greatest(excluded.words_used, 0)
  returning words_used into new_total;
  return new_total;
end;
$$;

revoke execute on function public.increment_usage(uuid, date, integer) from public, anon, authenticated;
grant   execute on function public.increment_usage(uuid, date, integer) to service_role;
