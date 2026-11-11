-- Plays shared between phone and PC. Rows are keyed by the Spotify user id.
-- Only the "sync" Edge Function (service role) touches these tables: it checks
-- the caller's Spotify token first. RLS is on with no policies, so the public
-- API keys can't read or write anything.

create table public.plays (
  id bigint generated always as identity primary key,
  user_id text not null,
  played_at bigint not null,          -- epoch ms
  track_uri text,
  track_name text not null,
  artist text not null,
  album text,
  ms_played integer not null,
  image_url text,
  source text not null check (source in ('api', 'import')),
  unique (user_id, played_at, track_name, artist)
);

-- Pull = "rows of this user after cursor id".
create index plays_user_id_id on public.plays (user_id, id);

create table public.sync_meta (
  user_id text primary key,
  imported_until bigint not null default 0  -- latest play covered by an imported export
);

alter table public.plays enable row level security;
alter table public.sync_meta enable row level security;
revoke all on public.plays, public.sync_meta from anon, authenticated;

-- The Edge Function uses the service role. Grant it explicitly, so this works
-- even if the project doesn't expose new tables to the Data API automatically.
grant usage on schema public to service_role;
grant select, insert, update, delete on public.plays, public.sync_meta to service_role;
grant usage, select on all sequences in schema public to service_role;
