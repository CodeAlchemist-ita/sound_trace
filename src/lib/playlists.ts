import { getDb, getMeta, isStream, setMeta, TRACK_KEY } from './db';
import {
  handOverToServer,
  hasScope,
  pickCover,
  refreshServerPlaylists,
  spotifyGet,
  type SpotifyImage,
} from './spotify';

/**
 * Playlists of the signed-in user. Spotify (Development Mode, since 2026) gives the
 * songs only of playlists the user owns or collaborates on; for the others (saved
 * from other people or Spotify) just name, cover and owner.
 */

const API = 'https://api.spotify.com/v1';
const RESYNC_MS = 6 * 3_600_000;

type ApiPlaylist = {
  id: string;
  name: string;
  owner: { id: string; display_name?: string | null };
  images: SpotifyImage[] | null;
  snapshot_id: string;
  collaborative: boolean;
  // Renamed from "tracks" to "items" in 2026: accept both.
  items?: { total: number };
  tracks?: { total: number };
};

type ApiTrack = {
  type?: string;
  uri: string;
  name: string;
  duration_ms: number;
  artists: { name: string }[];
  album?: { name: string; release_date?: string; images?: SpotifyImage[] };
};

type ApiItem = {
  added_at: string | null;
  added_by: { id: string } | null;
  is_local?: boolean;
  item?: ApiTrack | null;
  track?: ApiTrack | null;
};

type Page<T> = { items: T[]; next: string | null };

async function allPages<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  let next: string | null = path;
  while (next) {
    const page: Page<T> = await spotifyGet<Page<T>>(next.startsWith(API) ? next.slice(API.length) : next);
    out.push(...page.items);
    next = page.next;
  }
  return out;
}

async function myId() {
  const cached = (await getMeta('cloudUser')) ?? (await getMeta('spotifyUserId'));
  if (cached) return cached;
  const me = await spotifyGet<{ id: string }>('/me');
  await setMeta('spotifyUserId', me.id);
  return me.id;
}

export const PLAYLIST_SCOPE = 'playlist-read-private';

export type PlaylistSyncResult = 'ok' | 'no_scope' | 'skipped';

let running: Promise<PlaylistSyncResult> | null = null;

/** Downloads the playlist list, and the songs of the ones that changed (snapshot_id). */
export function syncPlaylists(force = false): Promise<PlaylistSyncResult> {
  running ??= run(force).finally(() => {
    running = null;
  });
  return running;
}

async function run(force: boolean): Promise<PlaylistSyncResult> {
  // Sessions from older versions lack the permission: a new Spotify login is needed.
  if (!(await hasScope(PLAYLIST_SCOPE))) return 'no_scope';
  const last = Number((await getMeta('playlistsSyncedAt')) ?? 0);
  if (!force && Date.now() - last < RESYNC_MS) return 'skipped';

  const me = await myId();
  const db = await getDb();
  const list = await allPages<ApiPlaylist>('/me/playlists?limit=50');
  const stored = new Map(
    (await db.getAllAsync<{ id: string; items_snapshot: string | null }>(`SELECT id, items_snapshot FROM playlists`)).map(
      (r) => [r.id, r.items_snapshot],
    ),
  );

  for (const [position, p] of list.entries()) {
    if (!p?.id) continue;
    const readable = p.owner?.id === me || p.collaborative;
    await db.runAsync(
      `INSERT INTO playlists (id, name, owner_id, owner_name, image_url, snapshot_id, collaborative, readable, total, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, owner_id = excluded.owner_id, owner_name = excluded.owner_name,
         image_url = excluded.image_url, snapshot_id = excluded.snapshot_id, collaborative = excluded.collaborative,
         readable = excluded.readable, total = excluded.total, position = excluded.position`,
      [
        p.id,
        p.name,
        p.owner?.id ?? null,
        p.owner?.display_name ?? null,
        pickCover(p.images ?? undefined) ?? p.images?.[0]?.url ?? null,
        p.snapshot_id,
        p.collaborative ? 1 : 0,
        readable ? 1 : 0,
        p.items?.total ?? p.tracks?.total ?? 0,
        position,
      ],
    );
    // Songs only when the playlist changed since last time: one request per 50 songs.
    if (readable && stored.get(p.id) !== p.snapshot_id) await saveItems(p.id, p.snapshot_id);
  }

  // Playlists removed from the library.
  const ids = list.map((p) => p.id);
  const gone = [...stored.keys()].filter((id) => !ids.includes(id));
  for (const id of gone) {
    await db.runAsync(`DELETE FROM playlist_items WHERE playlist_id = ?`, [id]);
    await db.runAsync(`DELETE FROM playlists WHERE id = ?`, [id]);
  }

  await borrowCovers();
  await setMeta('playlistsSyncedAt', String(Date.now()));
  // On a manual refresh (or right after granting access) the server re-reads them too,
  // so friends don't wait for its next scheduled refresh. Not awaited by the screen.
  if (force) {
    handOverToServer()
      .then(refreshServerPlaylists)
      .catch((e) => console.warn('[playlists] server refresh', e));
  }
  return 'ok';
}

async function saveItems(playlistId: string, snapshot: string) {
  const items = await allPages<ApiItem>(`/playlists/${playlistId}/items?limit=50&additional_types=track`);
  const rows = items
    .map((it) => ({ it, t: it.item ?? it.track }))
    // Podcast episodes and missing/local files have no usable song.
    .filter(({ it, t }) => t && !it.is_local && (t.type ?? 'track') === 'track' && t.name && t.artists?.length)
    .map(({ it, t }, pos) => [
      playlistId,
      pos,
      t!.uri ?? null,
      t!.name,
      t!.artists[0].name,
      t!.album?.name ?? null,
      t!.album?.release_date ?? null,
      t!.duration_ms ?? 0,
      pickCover(t!.album?.images),
      it.added_at ? Date.parse(it.added_at) : null,
      it.added_by?.id ?? null,
    ]);
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(`DELETE FROM playlist_items WHERE playlist_id = ?`, [playlistId]);
    // 11 columns × 300 rows, well under SQLite's parameter limit.
    for (let i = 0; i < rows.length; i += 300) {
      const chunk = rows.slice(i, i + 300);
      await db.runAsync(
        `INSERT INTO playlist_items (playlist_id, pos, track_uri, track_name, artist, album, release_date, duration_ms,
           image_url, added_at, added_by)
         VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
        chunk.flat() as (string | number | null)[],
      );
    }
    await db.runAsync(`UPDATE playlists SET items_snapshot = ? WHERE id = ?`, [snapshot, playlistId]);
  });
}

/** Free covers: imported plays without artwork take the one of the same song in a playlist. */
async function borrowCovers() {
  const db = await getDb();
  await db.runAsync(
    `UPDATE plays SET image_url = (
       SELECT i.image_url FROM playlist_items i
       WHERE lower(i.track_name) = lower(plays.track_name) AND lower(i.artist) = lower(plays.artist)
         AND i.image_url IS NOT NULL LIMIT 1)
     WHERE (image_url IS NULL OR image_url = '')
       AND EXISTS (SELECT 1 FROM playlist_items i
                   WHERE lower(i.track_name) = lower(plays.track_name) AND lower(i.artist) = lower(plays.artist)
                     AND i.image_url IS NOT NULL)`,
  );
}

// ---------- Stats ----------

const DAY = 86_400_000;
const ITEM_KEY = `lower(i.track_name) || char(0) || lower(i.artist)`;

/** Plays per song (all time), the base of every playlist stat. */
const SONG_PLAYS = (recentFrom: number) => `
  SELECT ${TRACK_KEY} AS k, COUNT(*) AS n, SUM(ms_played) AS ms, MAX(played_at) AS last,
         SUM(CASE WHEN played_at >= ${Math.floor(recentFrom)} THEN 1 ELSE 0 END) AS recent
  FROM plays WHERE ${isStream()} GROUP BY k`;

export type PlaylistSummary = {
  id: string;
  name: string;
  ownerName: string | null;
  imageUrl: string | null;
  readable: boolean;
  collaborative: boolean;
  total: number;
  /** Songs we have (readable playlists). */
  tracks: number;
  /** Songs played at least once. */
  listened: number;
  /** All-time plays of its songs. */
  plays: number;
  /** Plays of its songs in the last 30 days. */
  recentPlays: number;
};

export async function getPlaylistSummaries(): Promise<PlaylistSummary[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Omit<PlaylistSummary, 'readable' | 'collaborative'> & { readable: number; collaborative: number }>(
    `WITH k AS (${SONG_PLAYS(Date.now() - 30 * DAY)})
     SELECT p.id, p.name, p.owner_name AS ownerName, p.image_url AS imageUrl, p.readable, p.collaborative, p.total,
            COUNT(i.pos) AS tracks,
            COALESCE(SUM(CASE WHEN k.n > 0 THEN 1 ELSE 0 END), 0) AS listened,
            COALESCE(SUM(k.n), 0) AS plays,
            COALESCE(SUM(k.recent), 0) AS recentPlays
     FROM playlists p
     LEFT JOIN playlist_items i ON i.playlist_id = p.id
     LEFT JOIN k ON k.k = ${ITEM_KEY}
     GROUP BY p.id
     ORDER BY p.readable DESC, recentPlays DESC, plays DESC, p.position`,
  );
  return rows.map((r) => ({ ...r, readable: !!r.readable, collaborative: !!r.collaborative }));
}

export type PlaylistOverview = {
  /** Share of the last year's plays whose song is in one of your playlists. */
  shareInPlaylists: number;
  /** Songs that appear in two or more of your playlists. */
  inSeveral: { trackName: string; artist: string; imageUrl: string | null; playlists: number }[];
  inSeveralCount: number;
};

export async function getPlaylistOverview(): Promise<PlaylistOverview> {
  const db = await getDb();
  const yearAgo = Date.now() - 365 * DAY;
  const share = await db.getFirstAsync<{ inside: number; total: number }>(
    `WITH keys AS (SELECT DISTINCT ${ITEM_KEY} AS k FROM playlist_items i)
     SELECT COALESCE(SUM(CASE WHEN ${TRACK_KEY} IN (SELECT k FROM keys) THEN 1 ELSE 0 END), 0) AS inside, COUNT(*) AS total
     FROM plays WHERE played_at >= ? AND ${isStream()}`,
    [yearAgo],
  );
  const several = await db.getAllAsync<{ trackName: string; artist: string; imageUrl: string | null; playlists: number }>(
    `SELECT MAX(i.track_name) AS trackName, MAX(i.artist) AS artist, MAX(i.image_url) AS imageUrl,
            COUNT(DISTINCT i.playlist_id) AS playlists
     FROM playlist_items i GROUP BY ${ITEM_KEY} HAVING playlists > 1 ORDER BY playlists DESC, trackName`,
  );
  return {
    shareInPlaylists: share && share.total > 0 ? share.inside / share.total : 0,
    inSeveral: several.slice(0, 5),
    inSeveralCount: several.length,
  };
}

/** Your Spotify id shown as "Tu". */
export async function myNames(): Promise<Record<string, string>> {
  const me = (await getMeta('cloudUser')) ?? (await getMeta('spotifyUserId'));
  return me ? { [me]: 'Tu' } : {};
}

/** "2019-05-01" / "2019" -> 2019. */
export function releaseYear(date: string | null) {
  const y = date ? Number(date.slice(0, 4)) : NaN;
  return Number.isFinite(y) && y > 1900 ? y : null;
}

export type PlaylistTrack = {
  trackName: string;
  artist: string;
  imageUrl: string | null;
  addedAt: number | null;
  addedBy: string | null;
  releaseYear: number | null;
  durationMs: number;
  plays: number;
  ms: number;
  lastPlayed: number | null;
  /** Friend's playlists: your plays of the song (for "in common"). */
  viewerPlays?: number;
};

export type PlaylistDetail = {
  id: string;
  name: string;
  ownerName: string | null;
  imageUrl: string | null;
  readable: boolean;
  collaborative: boolean;
  total: number;
  tracks: PlaylistTrack[];
  /** Spotify id -> name shown in "who added" ("Tu" for yourself). */
  names: Record<string, string>;
  /** A friend's playlist whose owner doesn't share listening statistics: plays are unknown, not zero. */
  statsHidden?: boolean;
};

export async function getPlaylistDetail(id: string): Promise<PlaylistDetail | null> {
  const db = await getDb();
  const p = await db.getFirstAsync<{
    id: string;
    name: string;
    ownerName: string | null;
    imageUrl: string | null;
    readable: number;
    collaborative: number;
    total: number;
  }>(
    `SELECT id, name, owner_name AS ownerName, image_url AS imageUrl, readable, collaborative, total FROM playlists WHERE id = ?`,
    [id],
  );
  if (!p) return null;
  const rows = await db.getAllAsync<Omit<PlaylistTrack, 'releaseYear'> & { releaseDate: string | null }>(
    `WITH k AS (${SONG_PLAYS(0)})
     SELECT i.track_name AS trackName, i.artist, i.image_url AS imageUrl, i.added_at AS addedAt, i.added_by AS addedBy,
            i.release_date AS releaseDate, i.duration_ms AS durationMs,
            COALESCE(k.n, 0) AS plays, COALESCE(k.ms, 0) AS ms, k.last AS lastPlayed
     FROM playlist_items i LEFT JOIN k ON k.k = ${ITEM_KEY}
     WHERE i.playlist_id = ? ORDER BY i.pos`,
    [id],
  );
  const tracks = rows.map(({ releaseDate, ...t }) => ({ ...t, releaseYear: releaseYear(releaseDate) }));
  return {
    ...p,
    readable: !!p.readable,
    collaborative: !!p.collaborative,
    tracks,
    names: await myNames(),
  };
}
