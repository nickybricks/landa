-- Landa auth foundation: entitlements + usage metering.
-- profiles: 1:1 with auth.users, created by a trigger on signup, default plan 'free'.
-- usage:    word metering per period. Authoritative writer is the proxy (service role,
--           next session); the app only READS these tables. RLS forbids client writes so
--           a client can never make itself Pro or zero its own usage counter.

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  plan        text not null default 'free' check (plan in ('free','pro','team')),
  team_id     uuid,                 -- reserved for the future team tier; no teams table yet
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.usage (
  user_id       uuid not null references auth.users(id) on delete cascade,
  period_start  date not null,
  words_used    integer not null default 0,
  primary key (user_id, period_start)
);

-- Row-level security: a user may READ only their own rows. No client write policies,
-- so inserts/updates require the service role (proxy) — plan and usage are tamper-proof.
alter table public.profiles enable row level security;
alter table public.usage    enable row level security;

create policy "own profile read" on public.profiles
  for select using (auth.uid() = id);

create policy "own usage read" on public.usage
  for select using (auth.uid() = user_id);

-- Auto-create a free profile when a new user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
