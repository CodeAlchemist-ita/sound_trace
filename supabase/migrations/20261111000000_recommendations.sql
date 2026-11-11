-- Songs a user recommends to a friend, with an optional short message. Like the other
-- tables, only the "friends" Edge Function (service role) reads and writes it: it checks
-- that the two users are friends and that the receiver accepts recommendations.

create table public.recommendations (
  id bigint generated always as identity primary key,
  from_user text not null,  -- Spotify id of who recommends
  to_user text not null,    -- Spotify id of who receives
  track_name text not null,
  artist text not null,
  track_uri text,           -- spotify:track:<id>, to open the exact song
  image_url text,
  message text check (message is null or char_length(message) <= 280),
  created_at timestamptz not null default now(),
  seen_at timestamptz,      -- when the receiver opened the list
  check (from_user <> to_user)
);

-- The same song can't be recommended twice to the same friend.
create unique index recommendations_once
  on public.recommendations (from_user, to_user, lower(track_name), lower(artist));
create index recommendations_to_user on public.recommendations (to_user, created_at desc);
create index recommendations_from_user on public.recommendations (from_user, created_at desc);

alter table public.recommendations enable row level security;
revoke all on public.recommendations from anon, authenticated;
grant select, insert, update, delete on public.recommendations to service_role;
grant usage, select on all sequences in schema public to service_role;

-- A fifth privacy choice: whether friends may recommend songs to this user.
alter table public.privacy_settings add column receive_recommendations boolean not null default true;

-- Recommendations received and sent by a user, newest first (at most 50 each).
-- "listenedAt" is the first time the receiver played that song after the recommendation,
-- counted like a stream elsewhere: API rows, or imported rows of 30 s or more.
create or replace function public.recommendations_of(p_user text)
returns jsonb
language sql
stable
set search_path = public
as $$
  with r as (
    (select * from recommendations where to_user = p_user order by created_at desc limit 50)
    union all
    (select * from recommendations where from_user = p_user order by created_at desc limit 50)
  ), item as (
    select r.*,
      (select min(p.played_at) from plays p
        where p.user_id = r.to_user
          and lower(p.track_name) = lower(r.track_name)
          and lower(p.artist) = lower(r.artist)
          and p.played_at >= (extract(epoch from r.created_at) * 1000)::bigint
          and (p.source = 'api' or p.ms_played >= 30000)) as listened_at
    from r
  ), shaped as (
    select item.to_user, item.from_user, item.created_at, jsonb_build_object(
      'id', item.id,
      'fromUser', item.from_user,
      'toUser', item.to_user,
      'trackName', item.track_name,
      'artist', item.artist,
      'trackUri', item.track_uri,
      'imageUrl', item.image_url,
      'message', item.message,
      'createdAt', (extract(epoch from item.created_at) * 1000)::bigint,
      'seen', item.seen_at is not null,
      'listenedAt', item.listened_at
    ) as j
    from item
  )
  select jsonb_build_object(
    'received', coalesce((select jsonb_agg(j order by created_at desc) from shaped where to_user = p_user), '[]'::jsonb),
    'sent', coalesce((select jsonb_agg(j order by created_at desc) from shaped where from_user = p_user), '[]'::jsonb)
  );
$$;

revoke all on function public.recommendations_of(text) from public, anon, authenticated;
grant execute on function public.recommendations_of(text) to service_role;
