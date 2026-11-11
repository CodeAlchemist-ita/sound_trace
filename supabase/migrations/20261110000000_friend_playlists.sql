-- Friends' playlists. The server reads them from Spotify with the token it already
-- holds for server-side sync (spotify_tokens) when a friend opens the profile, and
-- caches them here. Songs are fetched only when a playlist is opened and changed
-- (snapshot_id). Only the Edge Functions (service role) touch these tables.

create table public.cloud_playlists (
  user_id text not null,             -- owner of the library (Spotify id)
  id text not null,                  -- Spotify playlist id
  name text not null,
  owner_name text,
  image_url text,
  snapshot_id text,
  items_snapshot text,               -- snapshot the cached songs belong to
  collaborative boolean not null default false,
  readable boolean not null default false, -- own or collaborative: songs available
  total integer not null default 0,
  position integer not null default 0,
  primary key (user_id, id)
);

create table public.cloud_playlist_items (
  user_id text not null,
  playlist_id text not null,
  pos integer not null,
  track_name text not null,
  artist text not null,
  image_url text,
  release_date text,
  duration_ms integer not null default 0,
  added_at bigint,                   -- epoch ms
  added_by text,
  primary key (user_id, playlist_id, pos)
);

-- When the playlist list of a user was last refreshed from Spotify.
alter table public.spotify_tokens add column playlists_fetched_at timestamptz;

alter table public.cloud_playlists enable row level security;
alter table public.cloud_playlist_items enable row level security;
revoke all on public.cloud_playlists, public.cloud_playlist_items from anon, authenticated;
grant select, insert, update, delete on public.cloud_playlists, public.cloud_playlist_items to service_role;

-- Songs of a playlist with the owner's plays and the viewer's (for "in common").
create or replace function public.friend_playlist_tracks(p_owner text, p_viewer text, p_playlist text)
returns table (
  "trackName" text, artist text, "imageUrl" text, "addedAt" bigint, "addedBy" text,
  "releaseDate" text, "durationMs" integer, plays bigint, ms bigint, "lastPlayed" bigint, "viewerPlays" bigint
)
language sql
stable
set search_path = public
as $$
  with items as (
    select * from cloud_playlist_items where user_id = p_owner and playlist_id = p_playlist
  ), keys as (
    select distinct lower(track_name) as tn, lower(artist) as ar from items
  ), o as (
    select lower(p.track_name) as tn, lower(p.artist) as ar, count(*) as n, sum(p.ms_played) as ms, max(p.played_at) as last
    from plays p join keys k on lower(p.track_name) = k.tn and lower(p.artist) = k.ar
    where p.user_id = p_owner and (p.source = 'api' or p.ms_played >= 30000)
    group by 1, 2
  ), v as (
    select lower(p.track_name) as tn, lower(p.artist) as ar, count(*) as n
    from plays p join keys k on lower(p.track_name) = k.tn and lower(p.artist) = k.ar
    where p.user_id = p_viewer and (p.source = 'api' or p.ms_played >= 30000)
    group by 1, 2
  )
  select i.track_name, i.artist, i.image_url, i.added_at, i.added_by, i.release_date, i.duration_ms,
         coalesce(o.n, 0), coalesce(o.ms, 0), o.last, coalesce(v.n, 0)
  from items i
  left join o on o.tn = lower(i.track_name) and o.ar = lower(i.artist)
  left join v on v.tn = lower(i.track_name) and v.ar = lower(i.artist)
  order by i.pos;
$$;

revoke all on function public.friend_playlist_tracks(text, text, text) from public, anon, authenticated;
grant execute on function public.friend_playlist_tracks(text, text, text) to service_role;
