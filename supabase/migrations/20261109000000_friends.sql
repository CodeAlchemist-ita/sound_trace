-- Friends: a user sends a request to the email another registered user signed up
-- with; once accepted, both can see each other's listening profile.
-- Like the other tables, only the "friends" Edge Function (service role) reads
-- and writes these; it identifies the caller by their Spotify token.

-- Shown to friends instead of a bare Spotify id. Refreshed from Spotify by the function.
alter table public.registrations
  add column display_name text,
  add column avatar_url text;

create table public.friendships (
  id bigint generated always as identity primary key,
  requester text not null,  -- Spotify id of who sent the request
  addressee text not null,  -- Spotify id of who received it
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  check (requester <> addressee)
);

-- One row per pair, whoever asked first.
create unique index friendships_pair on public.friendships (least(requester, addressee), greatest(requester, addressee));
create index friendships_addressee on public.friendships (addressee);
create index friendships_requester on public.friendships (requester);

alter table public.friendships enable row level security;
revoke all on public.friendships from anon, authenticated;
grant select, insert, update, delete on public.friendships to service_role;
grant usage, select on all sequences in schema public to service_role;

-- What a friend sees: totals, top artists and songs of a period, latest plays.
-- Aggregated in Postgres so the function doesn't download every play.
-- A play counts as a stream like in the app: API rows, or imported rows of 30 s or more.
create or replace function public.friend_profile(p_user text, p_from bigint, p_to bigint)
returns jsonb
language sql
stable
set search_path = public
as $$
  with p as (
    select * from plays
    where user_id = p_user and played_at between p_from and p_to
  ), s as (
    select * from p where source = 'api' or ms_played >= 30000
  )
  select jsonb_build_object(
    'summary', (
      select jsonb_build_object(
        'totalMs', coalesce((select sum(ms_played) from p), 0),
        'streams', count(*),
        'tracks', count(distinct lower(track_name) || chr(1) || lower(artist)),
        'artists', count(distinct lower(artist))
      ) from s
    ),
    'topArtists', coalesce((
      select jsonb_agg(a order by a."totalMs" desc) from (
        select max(artist) as artist, count(*) as plays, sum(ms_played) as "totalMs",
               nullif(max(image_url), '') as "imageUrl"
        from s group by lower(artist)
        order by sum(ms_played) desc limit 10
      ) a
    ), '[]'::jsonb),
    'topTracks', coalesce((
      select jsonb_agg(t order by t.plays desc, t."totalMs" desc) from (
        select max(track_name) as "trackName", max(artist) as artist, count(*) as plays,
               sum(ms_played) as "totalMs", nullif(max(image_url), '') as "imageUrl"
        from s group by lower(track_name), lower(artist)
        order by count(*) desc, sum(ms_played) desc limit 10
      ) t
    ), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(r order by r."playedAt" desc) from (
        select track_name as "trackName", artist, played_at as "playedAt", nullif(image_url, '') as "imageUrl"
        from plays
        where user_id = p_user and (source = 'api' or ms_played >= 30000)
        order by played_at desc limit 15
      ) r
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.friend_profile(text, bigint, bigint) from public, anon, authenticated;
grant execute on function public.friend_profile(text, bigint, bigint) to service_role;

-- The "recent" part reads the latest plays of a user without a period.
create index if not exists plays_user_played_at on public.plays (user_id, played_at);
