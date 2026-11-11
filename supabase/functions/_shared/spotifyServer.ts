// Server-held Spotify tokens and the recently-played poll, shared by the "token" function.
import type { SupabaseClient } from '@supabase/supabase-js';

const CLIENT_ID = Deno.env.get('SPOTIFY_CLIENT_ID') ?? '';

export type TokenRow = {
  user_id: string;
  refresh_token: string;
  access_token: string | null;
  expires_at: number;
  scope: string | null;
  last_played_at: number;
  last_error: string | null;
};

/** The refresh token was rejected: the user has to log in to Spotify again. */
export class RevokedError extends Error {}

type TokenResponse = { access_token: string; refresh_token?: string; expires_in: number; scope?: string };

/** PKCE refresh: no client secret, only the client id. */
export async function refreshWithSpotify(refreshToken: string): Promise<TokenResponse> {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: CLIENT_ID }),
  });
  if (res.status === 400 || res.status === 401) throw new RevokedError(await res.text());
  if (!res.ok) throw new Error(`Spotify token ${res.status}: ${await res.text()}`);
  return res.json();
}

async function readRow(db: SupabaseClient, userId: string) {
  const { data, error } = await db.from('spotify_tokens').select('*').eq('user_id', userId).maybeSingle<TokenRow>();
  if (error) throw new Error(error.message);
  return data;
}

/** A valid access token for the user, refreshing (and saving the rotated refresh token) when needed. */
export async function accessTokenFor(db: SupabaseClient, userId: string, force = false): Promise<TokenRow> {
  const row = await readRow(db, userId);
  if (!row) throw new RevokedError('no token');
  if (row.last_error === 'revoked') throw new RevokedError('revoked');
  if (!force && row.access_token && row.expires_at > Date.now() + 60_000) return row;

  let json: TokenResponse;
  try {
    json = await refreshWithSpotify(row.refresh_token);
  } catch (e) {
    if (!(e instanceof RevokedError)) throw e;
    // Another request may have rotated the token a moment ago: use its result.
    const now = await readRow(db, userId);
    if (now && now.refresh_token !== row.refresh_token && now.access_token && now.expires_at > Date.now()) return now;
    await db.from('spotify_tokens').update({ last_error: 'revoked' }).eq('user_id', userId);
    throw e;
  }
  const next = {
    access_token: json.access_token,
    refresh_token: json.refresh_token ?? row.refresh_token,
    expires_at: Date.now() + json.expires_in * 1000,
    scope: json.scope ?? row.scope,
    last_error: null,
    updated_at: new Date().toISOString(),
  };
  // Only if nobody else refreshed meanwhile (same old refresh token).
  const { data: updated, error } = await db
    .from('spotify_tokens')
    .update(next)
    .eq('user_id', userId)
    .eq('refresh_token', row.refresh_token)
    .select('*');
  if (error) throw new Error(error.message);
  return (updated?.[0] as TokenRow | undefined) ?? (await readRow(db, userId)) ?? { ...row, ...next };
}

type SpotifyImage = { url: string; width: number | null };
type RecentlyPlayed = {
  items: {
    played_at: string;
    track: {
      uri: string;
      name: string;
      duration_ms: number;
      artists: { name: string }[];
      album?: { name: string; images: SpotifyImage[] };
    } | null;
  }[];
};

/** Same choice as the app (pickCover in src/lib/spotify.ts), so rows match. */
function pickCover(images: SpotifyImage[] | undefined): string | null {
  if (!images?.length) return null;
  const sharp = images.filter((i) => (i.width ?? 0) >= 132);
  return (sharp.at(-1) ?? images[0]).url;
}

/**
 * Saves the user's latest plays. Rows are built exactly like the app's sync
 * (src/lib/sync.ts), so the same play from the phone and the server is one row.
 */
export async function pollUser(db: SupabaseClient, userId: string): Promise<number> {
  let row = await accessTokenFor(db, userId);
  const url = 'https://api.spotify.com/v1/me/player/recently-played?limit=50';
  let res = await fetch(url, { headers: { Authorization: `Bearer ${row.access_token}` } });
  if (res.status === 401) {
    row = await accessTokenFor(db, userId, true);
    res = await fetch(url, { headers: { Authorization: `Bearer ${row.access_token}` } });
  }
  if (!res.ok) throw new Error(`recently-played ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as RecentlyPlayed;

  // Plays covered by an imported export are real data already: skip API estimates there.
  const { data: meta } = await db.from('sync_meta').select('imported_until').eq('user_id', userId).maybeSingle();
  const importedUntil = Number(meta?.imported_until ?? 0);

  const rows = body.items
    .filter((i) => i.track)
    .map((i) => ({
      user_id: userId,
      played_at: Date.parse(i.played_at),
      track_uri: i.track!.uri,
      track_name: i.track!.name.slice(0, 500),
      artist: (i.track!.artists[0]?.name ?? 'Sconosciuto').slice(0, 500),
      album: i.track!.album?.name?.slice(0, 500) ?? null,
      ms_played: i.track!.duration_ms,
      image_url: pickCover(i.track!.album?.images),
      source: 'api' as const,
    }))
    .filter((r) => Number.isFinite(r.played_at) && r.played_at > importedUntil && r.played_at > row.last_played_at);

  if (rows.length > 0) {
    const { error } = await db
      .from('plays')
      .upsert(rows, { onConflict: 'user_id,played_at,track_name,artist', ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }
  const newest = Math.max(row.last_played_at, ...rows.map((r) => r.played_at));
  await db
    .from('spotify_tokens')
    .update({ last_played_at: newest, last_poll_at: new Date().toISOString(), last_error: null })
    .eq('user_id', userId);
  return rows.length;
}

// ---------- Now playing (for friends' lists) ----------

export type NowPlaying = { trackName: string; artist: string; imageUrl: string | null };

type CurrentlyPlaying = {
  is_playing?: boolean;
  currently_playing_type?: string;
  item?: { name?: string; artists?: { name: string }[]; album?: { images?: SpotifyImage[] } } | null;
};

/**
 * The song the user is playing at this moment, or null: nothing playing, paused, a
 * podcast, no server-held token, or a session from before the app asked for the
 * "user-read-currently-playing" permission. Never throws: it only decorates a list.
 */
export async function currentlyPlaying(db: SupabaseClient, userId: string): Promise<NowPlaying | null> {
  try {
    let row = await accessTokenFor(db, userId);
    if (!row.scope?.split(' ').includes('user-read-currently-playing')) return null;
    const url = 'https://api.spotify.com/v1/me/player/currently-playing';
    let res = await fetch(url, { headers: { Authorization: `Bearer ${row.access_token}` } });
    if (res.status === 401) {
      row = await accessTokenFor(db, userId, true);
      res = await fetch(url, { headers: { Authorization: `Bearer ${row.access_token}` } });
    }
    // 204: nothing is playing.
    if (res.status !== 200) return null;
    const body = (await res.json()) as CurrentlyPlaying;
    const item = body.item;
    if (!body.is_playing || !item?.name || (body.currently_playing_type ?? 'track') !== 'track') return null;
    return {
      trackName: item.name.slice(0, 500),
      artist: (item.artists?.[0]?.name ?? '').slice(0, 500),
      imageUrl: pickCover(item.album?.images),
    };
  } catch {
    return null;
  }
}

// ---------- Playlists (for friends' profiles) ----------

/** The user's session lacks the playlist permission (app not updated / access not granted). */
export class NoScopeError extends Error {}

const API = 'https://api.spotify.com/v1';
const PLAYLISTS_TTL_MS = 6 * 3_600_000;

/** GET on the Spotify API as the user, retrying once with a fresh token on 401. */
async function apiGet<T>(db: SupabaseClient, userId: string, path: string): Promise<T> {
  let row = await accessTokenFor(db, userId);
  const url = path.startsWith(API) ? path : `${API}${path}`;
  let res = await fetch(url, { headers: { Authorization: `Bearer ${row.access_token}` } });
  if (res.status === 401) {
    row = await accessTokenFor(db, userId, true);
    res = await fetch(url, { headers: { Authorization: `Bearer ${row.access_token}` } });
  }
  if (res.status === 403) throw new NoScopeError(await res.text());
  if (!res.ok) throw new Error(`Spotify ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function allPages<T>(db: SupabaseClient, userId: string, path: string): Promise<T[]> {
  const out: T[] = [];
  let next: string | null = path;
  while (next) {
    const page: { items: T[]; next: string | null } = await apiGet(db, userId, next);
    out.push(...page.items);
    next = page.next;
  }
  return out;
}

type ApiPlaylist = {
  id: string;
  name: string;
  owner: { id: string; display_name?: string | null };
  images: SpotifyImage[] | null;
  snapshot_id: string;
  collaborative: boolean;
  items?: { total: number };
  tracks?: { total: number };
};

type ApiTrack = {
  type?: string;
  name: string;
  duration_ms: number;
  artists: { name: string }[];
  album?: { release_date?: string; images?: SpotifyImage[] };
};

type ApiItem = { added_at: string | null; added_by: { id: string } | null; is_local?: boolean; item?: ApiTrack | null; track?: ApiTrack | null };

/** Refreshes the user's playlist list from Spotify if older than 6 hours (or now, with force). */
export async function refreshPlaylists(db: SupabaseClient, userId: string, force = false) {
  const row = await accessTokenFor(db, userId);
  if (!row.scope?.split(' ').includes('playlist-read-private')) throw new NoScopeError('scope');
  const { data: meta } = await db.from('spotify_tokens').select('playlists_fetched_at').eq('user_id', userId).maybeSingle();
  const fetched = meta?.playlists_fetched_at ? Date.parse(meta.playlists_fetched_at) : 0;
  if (!force && Date.now() - fetched < PLAYLISTS_TTL_MS) return;

  const list = (await allPages<ApiPlaylist>(db, userId, '/me/playlists?limit=50')).filter((p) => p?.id);
  const rows = list.map((p, position) => ({
    user_id: userId,
    id: p.id,
    name: p.name,
    owner_name: p.owner?.display_name ?? null,
    image_url: pickCover(p.images ?? undefined) ?? p.images?.[0]?.url ?? null,
    snapshot_id: p.snapshot_id,
    collaborative: p.collaborative,
    readable: p.owner?.id === userId || p.collaborative,
    total: p.items?.total ?? p.tracks?.total ?? 0,
    position,
  }));
  if (rows.length) {
    const { error } = await db.from('cloud_playlists').upsert(rows, { onConflict: 'user_id,id' });
    if (error) throw new Error(error.message);
  }
  // Playlists no longer in the library.
  const { data: stored } = await db.from('cloud_playlists').select('id').eq('user_id', userId);
  const gone = (stored ?? []).map((r) => r.id as string).filter((id) => !rows.some((r) => r.id === id));
  if (gone.length) {
    await db.from('cloud_playlist_items').delete().eq('user_id', userId).in('playlist_id', gone);
    await db.from('cloud_playlists').delete().eq('user_id', userId).in('id', gone);
  }
  await db.from('spotify_tokens').update({ playlists_fetched_at: new Date().toISOString() }).eq('user_id', userId);
}

/** Caches the songs of one playlist if it changed since last time (one request per 50 songs). */
export async function refreshPlaylistItems(db: SupabaseClient, userId: string, playlistId: string) {
  const { data: p, error } = await db
    .from('cloud_playlists')
    .select('snapshot_id, items_snapshot, readable')
    .eq('user_id', userId)
    .eq('id', playlistId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!p?.readable || p.items_snapshot === p.snapshot_id) return;

  const items = await allPages<ApiItem>(db, userId, `/playlists/${encodeURIComponent(playlistId)}/items?limit=50&additional_types=track`);
  const rows = items
    .map((it) => ({ it, t: it.item ?? it.track }))
    .filter(({ it, t }) => t && !it.is_local && (t.type ?? 'track') === 'track' && t.name && t.artists?.length)
    .map(({ it, t }, pos) => ({
      user_id: userId,
      playlist_id: playlistId,
      pos,
      track_name: t!.name.slice(0, 500),
      artist: t!.artists[0].name.slice(0, 500),
      image_url: pickCover(t!.album?.images),
      release_date: t!.album?.release_date ?? null,
      duration_ms: t!.duration_ms ?? 0,
      added_at: it.added_at ? Date.parse(it.added_at) : null,
      added_by: it.added_by?.id ?? null,
    }));
  await db.from('cloud_playlist_items').delete().eq('user_id', userId).eq('playlist_id', playlistId);
  for (let i = 0; i < rows.length; i += 500) {
    const { error: insertError } = await db.from('cloud_playlist_items').insert(rows.slice(i, i + 500));
    if (insertError) throw new Error(insertError.message);
  }
  await db.from('cloud_playlists').update({ items_snapshot: p.snapshot_id }).eq('user_id', userId).eq('id', playlistId);
}
