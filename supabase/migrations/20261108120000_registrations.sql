-- People who registered in the app with the email of their Spotify account.
-- The owner adds these emails to the Spotify Developer Dashboard (User Management):
-- Spotify has no API for that. spotify_id is set once the person connects the
-- Spotify account with the same email; only linked users may use the sync function.

create table public.registrations (
  email text primary key check (email = lower(email) and length(email) between 3 and 254),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  spotify_id text unique,
  linked_at timestamptz
);

alter table public.registrations enable row level security;
revoke all on public.registrations from anon, authenticated;
grant select, insert, update, delete on public.registrations to service_role;
