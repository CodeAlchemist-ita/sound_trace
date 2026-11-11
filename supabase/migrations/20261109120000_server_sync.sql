-- Server-side sync: the server polls Spotify's "recently played" for every user
-- every 15 minutes, so plays are saved (and friends see them) even when the
-- phone is off or the app is asleep.
--
-- The server becomes the only holder of each user's Spotify refresh token:
-- a device hands its token over once ("token" function, action "handover") and
-- from then on asks the server for short-lived access tokens with a random
-- device key. One refresher avoids two parties rotating the same refresh token.
-- Only the Edge Functions (service role) touch these tables.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create table public.spotify_tokens (
  user_id text primary key,                 -- Spotify id
  refresh_token text not null,
  access_token text,
  expires_at bigint not null default 0,     -- epoch ms
  scope text,
  last_played_at bigint not null default 0, -- newest play the server has fetched
  last_poll_at timestamptz,
  last_error text,                          -- 'revoked' = the user must log in again
  updated_at timestamptz not null default now()
);

-- A device proves who it is with a random key; only its SHA-256 is stored.
create table public.device_keys (
  key_hash text primary key,
  user_id text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);
create index device_keys_user on public.device_keys (user_id);

alter table public.spotify_tokens enable row level security;
alter table public.device_keys enable row level security;
revoke all on public.spotify_tokens, public.device_keys from anon, authenticated;
grant select, insert, update, delete on public.spotify_tokens, public.device_keys to service_role;

-- The cron job itself is created outside migrations (it holds the project URL and
-- reads the shared secret from Vault): see "Sincronizzazione sul server" in the README.
