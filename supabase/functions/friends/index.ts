// Friends between registered users.
// Auth: the caller's Spotify access token (like the sync function); only accounts
// linked through the register function may use it.
//
// POST { action: "list" }
//   → { friends: Person[], incoming: Request[], outgoing: Request[] }
// POST { action: "request", email }
//   → { status: "pending" | "accepted" }   (accepted if they had already asked you)
//   404 not_found · 400 self · 409 already_friends | already_requested
// POST { action: "respond", requestId, accept }  → { ok: true }   (only the receiver)
// POST { action: "remove", friendId }            → { ok: true }   (unfriend, or cancel/decline a request)
// POST { action: "profile", friendId, from, to } → { person: Person, profile }  403 not_friends
// POST { action: "playlists", friendId } → { status: "ok" | "no_token" | "no_scope", playlists }
// POST { action: "playlist", friendId, playlistId } → { playlist, tracks } (songs with their plays and yours)
// POST { action: "now" } → { now: { [friendId]: { trackName, artist, imageUrl } } }
//   What each friend is playing right now (only friends who are playing something).
// POST { action: "privacy_get" } → { privacy: { nowPlaying, recent, stats, playlists, recommendations } }
// POST { action: "privacy_set", privacy: { …any of the five… } } → { privacy }
//   What the caller lets friends see (and whether they may recommend songs). Every answer
//   about a friend respects that friend's choices: hidden parts come back empty, and
//   "hidden" says which ones.
// POST { action: "recommend", friendIds, trackName, artist, trackUri?, imageUrl?, message? }
//   → { sent, skipped: { friendId, reason: "not_friends" | "disabled" | "duplicate" }[] }
//   Recommends a song to accepted friends (at most 20 a day). 400 message · 429 too_many
// POST { action: "recommendations" } → { received, sent, unseen }
//   Each item has its "person" (the sender for received, the receiver for sent); sent ones
//   carry "listenedAt" once the friend has played the song.
// POST { action: "recommendations_seen" }        → { ok: true }   (marks the received ones as seen)
// POST { action: "recommendation_delete", id }   → { ok: true }   (sender or receiver)
import { createClient } from '@supabase/supabase-js';

import { bearer, cleanEmail, cors, json, spotifyMe } from '../_shared/http.ts';
import {
  currentlyPlaying,
  NoScopeError,
  pollUser,
  refreshPlaylistItems,
  refreshPlaylists,
  RevokedError,
  type NowPlaying,
} from '../_shared/spotifyServer.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

type Registration = { email: string; spotify_id: string; display_name: string | null; avatar_url: string | null };
type Friendship = {
  id: number;
  requester: string;
  addressee: string;
  status: 'pending' | 'accepted';
  created_at: string;
  accepted_at: string | null;
};

const person = (r: Registration) => ({ id: r.spotify_id, email: r.email, name: r.display_name, avatar: r.avatar_url });

// Spotify ids are letters, digits and a few symbols: anything else could alter the .or() filters below.
const spotifyId = (v: unknown) => (typeof v === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(v) ? v : null);

const RECOMMEND_PER_DAY = 20;
const MAX_FRIENDS_PER_RECOMMENDATION = 20;
const MAX_MESSAGE = 280;

/** A trimmed, non-empty string of at most `max` characters, or null. */
const text = (v: unknown, max: number) => {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length > 0 && s.length <= max ? s : null;
};

type RecommendationItem = { id: number; fromUser: string; toUser: string; seen: boolean };

const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);

// "Now playing" is asked to Spotify at most every 20 seconds per user, however many
// friends have the app open (the cache lives as long as this function instance).
const NOW_TTL_MS = 20_000;
const MAX_FRIENDS_NOW = 50;
const nowCache = new Map<string, { value: NowPlaying | null; until: number }>();

async function nowPlayingOf(userId: string): Promise<NowPlaying | null> {
  const hit = nowCache.get(userId);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = await currentlyPlaying(db, userId);
  if (nowCache.size > 1000) nowCache.clear();
  nowCache.set(userId, { value, until: Date.now() + NOW_TTL_MS });
  return value;
}

// ---------- Privacy: what a user lets friends see ----------

type Privacy = { nowPlaying: boolean; recent: boolean; stats: boolean; playlists: boolean; recommendations: boolean };
type PrivacyRow = {
  user_id: string;
  show_now_playing: boolean;
  show_recent: boolean;
  show_stats: boolean;
  show_playlists: boolean;
  receive_recommendations: boolean;
};

/** No saved row = everything visible. */
const VISIBLE: Privacy = { nowPlaying: true, recent: true, stats: true, playlists: true, recommendations: true };

const toPrivacy = (r: PrivacyRow): Privacy => ({
  nowPlaying: r.show_now_playing,
  recent: r.show_recent,
  stats: r.show_stats,
  playlists: r.show_playlists,
  recommendations: r.receive_recommendations,
});

/**
 * The choices of some users. Throws if they can't be read: answering "everything
 * visible" on a database error would show what someone chose to hide.
 */
async function privacyOf(userIds: string[]): Promise<Map<string, Privacy>> {
  const out = new Map(userIds.map((id) => [id, VISIBLE]));
  if (userIds.length === 0) return out;
  const { data, error } = await db
    .from('privacy_settings')
    .select('user_id, show_now_playing, show_recent, show_stats, show_playlists, receive_recommendations')
    .in('user_id', userIds)
    .returns<PrivacyRow[]>();
  if (error) throw new Error(error.message);
  for (const r of data ?? []) out.set(r.user_id, toPrivacy(r));
  return out;
}

/**
 * A friend's latest plays are saved by the 15-minute poll: when someone opens their
 * profile, fetch them now (at most once a minute) so "recently played" isn't that old.
 */
async function refreshPlays(userId: string) {
  try {
    const { data } = await db.from('spotify_tokens').select('last_poll_at, last_error').eq('user_id', userId).maybeSingle();
    if (!data || data.last_error === 'revoked') return;
    if (data.last_poll_at && Date.now() - Date.parse(data.last_poll_at) < 60_000) return;
    await pollUser(db, userId);
  } catch (e) {
    console.warn('refresh plays', e);
  }
}

/** The friendship row between two users, whoever sent the request. */
async function pairOf(a: string, b: string) {
  return db
    .from('friendships')
    .select('*')
    .or(`and(requester.eq.${a},addressee.eq.${b}),and(requester.eq.${b},addressee.eq.${a})`)
    .maybeSingle<Friendship>();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  const token = bearer(req);
  const me = token ? await spotifyMe(token) : null;
  if (!me?.ok) return json({ error: 'spotify_token' }, 401);
  if (!spotifyId(me.id)) return json({ error: 'spotify_id' }, 400);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'body' }, 400);
  }

  const { data: self, error: selfError } = await db
    .from('registrations')
    .select('email, spotify_id, display_name, avatar_url')
    .eq('spotify_id', me.id)
    .maybeSingle<Registration>();
  if (selfError) return json({ error: selfError.message }, 500);
  if (!self) return json({ error: 'not_registered' }, 403);

  if (body.action === 'list') {
    // Keep the name and picture friends see up to date with Spotify.
    if (self.display_name !== me.name || self.avatar_url !== me.avatar) {
      await db.from('registrations').update({ display_name: me.name, avatar_url: me.avatar }).eq('spotify_id', me.id);
    }
    const { data: rows, error } = await db
      .from('friendships')
      .select('*')
      .or(`requester.eq.${me.id},addressee.eq.${me.id}`)
      .returns<Friendship[]>();
    if (error) return json({ error: error.message }, 500);

    const otherIds = [...new Set(rows.map((f) => (f.requester === me.id ? f.addressee : f.requester)))];
    const { data: people, error: peopleError } = otherIds.length
      ? await db
          .from('registrations')
          .select('email, spotify_id, display_name, avatar_url')
          .in('spotify_id', otherIds)
          .returns<Registration[]>()
      : { data: [] as Registration[], error: null };
    if (peopleError) return json({ error: peopleError.message }, 500);
    const byId = new Map(people.map((p) => [p.spotify_id, person(p)]));

    const friends = [];
    const incoming = [];
    const outgoing = [];
    for (const f of rows) {
      const other = byId.get(f.requester === me.id ? f.addressee : f.requester);
      if (!other) continue; // that account unregistered
      if (f.status === 'accepted') friends.push({ ...other, since: f.accepted_at ?? f.created_at });
      else if (f.addressee === me.id) incoming.push({ requestId: f.id, person: other, at: f.created_at });
      else outgoing.push({ requestId: f.id, person: other, at: f.created_at });
    }
    friends.sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));
    return json({ friends, incoming, outgoing });
  }

  if (body.action === 'privacy_get' || body.action === 'privacy_set') {
    try {
      if (body.action === 'privacy_set') {
        const input = (body.privacy && typeof body.privacy === 'object' ? body.privacy : {}) as Record<string, unknown>;
        const current = (await privacyOf([me.id])).get(me.id)!;
        // Only real booleans change something; anything else keeps the current choice.
        const pick = (key: keyof Privacy) => (typeof input[key] === 'boolean' ? (input[key] as boolean) : current[key]);
        const { error } = await db.from('privacy_settings').upsert({
          user_id: me.id,
          show_now_playing: pick('nowPlaying'),
          show_recent: pick('recent'),
          show_stats: pick('stats'),
          show_playlists: pick('playlists'),
          receive_recommendations: pick('recommendations'),
          updated_at: new Date().toISOString(),
        });
        if (error) return json({ error: error.message }, 500);
        // Stop showing the current song at once, not when the 20-second cache expires.
        nowCache.delete(me.id);
      }
      return json({ privacy: (await privacyOf([me.id])).get(me.id) });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : 'privacy' }, 500);
    }
  }

  if (body.action === 'now') {
    // Only accepted friends: the same people who can already see your latest plays.
    const { data: rows, error } = await db
      .from('friendships')
      .select('requester, addressee')
      .eq('status', 'accepted')
      .or(`requester.eq.${me.id},addressee.eq.${me.id}`)
      .returns<Pick<Friendship, 'requester' | 'addressee'>[]>();
    if (error) return json({ error: error.message }, 500);
    const allFriends = [...new Set(rows.map((f) => (f.requester === me.id ? f.addressee : f.requester)))].slice(0, MAX_FRIENDS_NOW);
    let privacy: Map<string, Privacy>;
    try {
      privacy = await privacyOf(allFriends);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : 'privacy' }, 500);
    }
    // Friends who hide it aren't even asked to Spotify.
    const friendIds = allFriends.filter((id) => privacy.get(id)!.nowPlaying);
    const playing = await Promise.all(friendIds.map((id) => nowPlayingOf(id)));
    const now: Record<string, NowPlaying> = {};
    friendIds.forEach((id, i) => {
      const p = playing[i];
      if (p) now[id] = p;
    });
    return json({ now });
  }

  if (body.action === 'request') {
    const email = cleanEmail(body.email);
    if (!email) return json({ error: 'email' }, 400);
    if (email === self.email) return json({ error: 'self' }, 400);
    const { data: target, error } = await db
      .from('registrations')
      .select('spotify_id')
      .eq('email', email)
      .not('spotify_id', 'is', null)
      .maybeSingle<{ spotify_id: string }>();
    if (error) return json({ error: error.message }, 500);
    if (!target) return json({ error: 'not_found' }, 404);

    const { data: existing, error: pairError } = await pairOf(me.id, target.spotify_id);
    if (pairError) return json({ error: pairError.message }, 500);
    if (existing?.status === 'accepted') return json({ error: 'already_friends' }, 409);
    if (existing?.requester === me.id) return json({ error: 'already_requested' }, 409);
    if (existing) {
      // They had already asked you: asking back means yes.
      const { error: acceptError } = await db
        .from('friendships')
        .update({ status: 'accepted', accepted_at: new Date().toISOString() })
        .eq('id', existing.id);
      if (acceptError) return json({ error: acceptError.message }, 500);
      return json({ status: 'accepted' });
    }
    const { error: insertError } = await db.from('friendships').insert({ requester: me.id, addressee: target.spotify_id });
    if (insertError) {
      // 23505: the other person sent theirs at the same moment.
      if (insertError.code === '23505') return json({ error: 'already_requested' }, 409);
      return json({ error: insertError.message }, 500);
    }
    return json({ status: 'pending' });
  }

  if (body.action === 'respond') {
    const id = int(body.requestId);
    if (id === null) return json({ error: 'requestId' }, 400);
    // Only the person who received the request may answer it.
    const { data, error } =
      body.accept === true
        ? await db
            .from('friendships')
            .update({ status: 'accepted', accepted_at: new Date().toISOString() })
            .eq('id', id)
            .eq('addressee', me.id)
            .eq('status', 'pending')
            .select('id')
        : await db
            .from('friendships')
            .delete()
            .eq('id', id)
            .eq('addressee', me.id)
            .eq('status', 'pending')
            .select('id');
    if (error) return json({ error: error.message }, 500);
    if (!data?.length) return json({ error: 'not_found' }, 404);
    return json({ ok: true });
  }

  if (body.action === 'remove') {
    const friendId = spotifyId(body.friendId);
    if (!friendId) return json({ error: 'friendId' }, 400);
    const { data: f, error } = await pairOf(me.id, friendId);
    if (error) return json({ error: error.message }, 500);
    if (f) {
      const { error: delError } = await db.from('friendships').delete().eq('id', f.id);
      if (delError) return json({ error: delError.message }, 500);
    }
    return json({ ok: true });
  }

  if (body.action === 'profile') {
    const friendId = spotifyId(body.friendId);
    if (!friendId) return json({ error: 'friendId' }, 400);
    const { data: f, error } = await pairOf(me.id, friendId);
    if (error) return json({ error: error.message }, 500);
    if (f?.status !== 'accepted') return json({ error: 'not_friends' }, 403);

    const { data: reg, error: regError } = await db
      .from('registrations')
      .select('email, spotify_id, display_name, avatar_url')
      .eq('spotify_id', friendId)
      .maybeSingle<Registration>();
    if (regError) return json({ error: regError.message }, 500);
    if (!reg) return json({ error: 'not_found' }, 404);

    let privacy: Privacy;
    try {
      privacy = (await privacyOf([friendId])).get(friendId)!;
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : 'privacy' }, 500);
    }
    const hidden = { stats: !privacy.stats, recent: !privacy.recent, playlists: !privacy.playlists, nowPlaying: !privacy.nowPlaying };
    const empty = { summary: { totalMs: 0, streams: 0, tracks: 0, artists: 0 }, topArtists: [], topTracks: [], recent: [] };
    // Nothing to show: don't even read their plays.
    if (hidden.stats && hidden.recent) return json({ person: person(reg), profile: empty, hidden });

    await refreshPlays(friendId);
    const from = int(body.from) ?? 0;
    const to = int(body.to) ?? Date.now();
    const { data: profile, error: rpcError } = await db.rpc('friend_profile', {
      p_user: friendId,
      p_from: from,
      p_to: to,
    });
    if (rpcError) return json({ error: rpcError.message }, 500);
    // Hidden parts keep their shape (zeros, empty lists) so older apps don't break.
    const visible = {
      ...(hidden.stats ? empty : profile),
      recent: hidden.recent ? [] : (profile?.recent ?? []),
    };
    return json({ person: person(reg), profile: visible, hidden });
  }

  if (body.action === 'playlists' || body.action === 'playlist') {
    const friendId = spotifyId(body.friendId);
    if (!friendId) return json({ error: 'friendId' }, 400);
    const { data: f, error } = await pairOf(me.id, friendId);
    if (error) return json({ error: error.message }, 500);
    if (f?.status !== 'accepted') return json({ error: 'not_friends' }, 403);

    let privacy: Privacy;
    try {
      privacy = (await privacyOf([friendId])).get(friendId)!;
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : 'privacy' }, 500);
    }
    if (!privacy.playlists) {
      return body.action === 'playlists' ? json({ status: 'hidden', playlists: [] }) : json({ error: 'hidden' }, 403);
    }

    // Read from Spotify with the friend's server-held token (refreshed at most every 6 hours).
    // Without it (old app version) or without the playlist permission, show what's cached.
    let status: 'ok' | 'no_token' | 'no_scope' = 'ok';
    try {
      await refreshPlaylists(db, friendId);
    } catch (e) {
      if (e instanceof RevokedError) status = 'no_token';
      else if (e instanceof NoScopeError) status = 'no_scope';
      else console.warn('playlists refresh', e);
    }

    if (body.action === 'playlists') {
      const { data: playlists, error: listError } = await db
        .from('cloud_playlists')
        .select('id, name, ownerName:owner_name, imageUrl:image_url, collaborative, readable, total')
        .eq('user_id', friendId)
        .order('readable', { ascending: false })
        .order('position');
      if (listError) return json({ error: listError.message }, 500);
      return json({ status, playlists });
    }

    const playlistId = typeof body.playlistId === 'string' && /^[A-Za-z0-9]{1,64}$/.test(body.playlistId) ? body.playlistId : null;
    if (!playlistId) return json({ error: 'playlistId' }, 400);
    if (status === 'ok') {
      try {
        await refreshPlaylistItems(db, friendId, playlistId);
      } catch (e) {
        console.warn('playlist items refresh', e);
      }
    }
    const { data: playlist, error: pError } = await db
      .from('cloud_playlists')
      .select('id, name, ownerName:owner_name, imageUrl:image_url, collaborative, readable, total')
      .eq('user_id', friendId)
      .eq('id', playlistId)
      .maybeSingle();
    if (pError) return json({ error: pError.message }, 500);
    if (!playlist) return json({ error: 'not_found' }, 404);
    const { data: tracks, error: tError } = await db.rpc('friend_playlist_tracks', {
      p_owner: friendId,
      p_viewer: me.id,
      p_playlist: playlistId,
    });
    if (tError) return json({ error: tError.message }, 500);
    // Playlists visible but statistics hidden: the songs, without how much the friend plays them.
    if (!privacy.stats) {
      const bare = (tracks ?? []).map((t: Record<string, unknown>) => ({ ...t, plays: 0, ms: 0, lastPlayed: null }));
      return json({ playlist, tracks: bare, statsHidden: true });
    }
    return json({ playlist, tracks, statsHidden: false });
  }

  if (body.action === 'recommend') {
    const ids = Array.isArray(body.friendIds) ? body.friendIds.map(spotifyId) : [];
    if (ids.length < 1 || ids.length > MAX_FRIENDS_PER_RECOMMENDATION || ids.some((id) => id === null)) {
      return json({ error: 'friendIds' }, 400);
    }
    const friendIds = [...new Set(ids as string[])];
    const trackName = text(body.trackName, 500);
    const artist = text(body.artist, 500);
    if (!trackName) return json({ error: 'trackName' }, 400);
    if (!artist) return json({ error: 'artist' }, 400);
    const trackUri =
      typeof body.trackUri === 'string' && /^spotify:track:[A-Za-z0-9]{1,64}$/.test(body.trackUri) ? body.trackUri : null;
    const imageUrl =
      typeof body.imageUrl === 'string' && body.imageUrl.startsWith('https://') && body.imageUrl.length <= 500
        ? body.imageUrl
        : null;
    const rawMessage = typeof body.message === 'string' ? body.message.trim() : '';
    if (rawMessage.length > MAX_MESSAGE) return json({ error: 'message' }, 400);
    const message = rawMessage || null;

    // A daily cap, so nobody can flood a friend's list.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count, error: countError } = await db
      .from('recommendations')
      .select('id', { count: 'exact', head: true })
      .eq('from_user', me.id)
      .gte('created_at', since);
    if (countError) return json({ error: countError.message }, 500);
    if ((count ?? 0) + friendIds.length > RECOMMEND_PER_DAY) return json({ error: 'too_many' }, 429);

    // Only accepted friends, like "now".
    const { data: rows, error } = await db
      .from('friendships')
      .select('requester, addressee')
      .eq('status', 'accepted')
      .or(`requester.eq.${me.id},addressee.eq.${me.id}`)
      .returns<Pick<Friendship, 'requester' | 'addressee'>[]>();
    if (error) return json({ error: error.message }, 500);
    const accepted = new Set(rows.map((f) => (f.requester === me.id ? f.addressee : f.requester)));
    let privacy: Map<string, Privacy>;
    try {
      privacy = await privacyOf(friendIds.filter((id) => accepted.has(id)));
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : 'privacy' }, 500);
    }

    const skipped: { friendId: string; reason: 'not_friends' | 'disabled' | 'duplicate' }[] = [];
    let sent = 0;
    for (const friendId of friendIds) {
      if (!accepted.has(friendId)) {
        skipped.push({ friendId, reason: 'not_friends' });
        continue;
      }
      if (!privacy.get(friendId)!.recommendations) {
        skipped.push({ friendId, reason: 'disabled' });
        continue;
      }
      const { error: insertError } = await db.from('recommendations').insert({
        from_user: me.id,
        to_user: friendId,
        track_name: trackName,
        artist,
        track_uri: trackUri,
        image_url: imageUrl,
        message,
      });
      if (insertError) {
        // 23505: this song was already recommended to this friend.
        if (insertError.code === '23505') {
          skipped.push({ friendId, reason: 'duplicate' });
          continue;
        }
        return json({ error: insertError.message }, 500);
      }
      sent++;
    }
    return json({ sent, skipped });
  }

  if (body.action === 'recommendations') {
    const { data, error } = await db.rpc('recommendations_of', { p_user: me.id });
    if (error) return json({ error: error.message }, 500);
    const received = (data?.received ?? []) as RecommendationItem[];
    const sent = (data?.sent ?? []) as RecommendationItem[];

    const ids = [...new Set([...received.map((r) => r.fromUser), ...sent.map((r) => r.toUser)])];
    const { data: people, error: peopleError } = ids.length
      ? await db
          .from('registrations')
          .select('email, spotify_id, display_name, avatar_url')
          .in('spotify_id', ids)
          .returns<Registration[]>()
      : { data: [] as Registration[], error: null };
    if (peopleError) return json({ error: peopleError.message }, 500);
    const byId = new Map(people.map((p) => [p.spotify_id, person(p)]));

    // Items whose other person unregistered are dropped.
    const withPerson = (items: RecommendationItem[], key: 'fromUser' | 'toUser') =>
      items.flatMap((item) => {
        const other = byId.get(item[key]);
        return other ? [{ ...item, person: other }] : [];
      });
    const receivedOut = withPerson(received, 'fromUser');
    return json({
      received: receivedOut,
      sent: withPerson(sent, 'toUser'),
      unseen: receivedOut.filter((r) => r.seen === false).length,
    });
  }

  if (body.action === 'recommendations_seen') {
    const { error } = await db
      .from('recommendations')
      .update({ seen_at: new Date().toISOString() })
      .eq('to_user', me.id)
      .is('seen_at', null);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  if (body.action === 'recommendation_delete') {
    const id = int(body.id);
    if (id === null) return json({ error: 'id' }, 400);
    // Either side may remove it; me.id was validated by spotifyId above.
    const { error } = await db
      .from('recommendations')
      .delete()
      .eq('id', id)
      .or(`from_user.eq.${me.id},to_user.eq.${me.id}`);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  return json({ error: 'action' }, 400);
});
