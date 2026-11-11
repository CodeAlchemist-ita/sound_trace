-- What each user lets their friends see. One row per user, created the first time
-- they change something in Settings; no row = everything visible (the behaviour
-- before this table existed). Enforced by the "friends" Edge Function, the only
-- reader and writer (service role), so an old or modified app can't get around it.

create table public.privacy_settings (
  user_id text primary key,                         -- Spotify id
  show_now_playing boolean not null default true,   -- the song playing right now
  show_recent boolean not null default true,        -- latest plays
  show_stats boolean not null default true,         -- totals, top artists and songs, plays of playlist songs
  show_playlists boolean not null default true,     -- playlists and their songs
  updated_at timestamptz not null default now()
);

alter table public.privacy_settings enable row level security;
revoke all on public.privacy_settings from anon, authenticated;
grant select, insert, update, delete on public.privacy_settings to service_role;
