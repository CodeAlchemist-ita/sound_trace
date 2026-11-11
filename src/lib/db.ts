import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';

import { getSettings } from './settings';

export type PlaySource = 'api' | 'import';

export type Play = {
  playedAt: number; // epoch ms
  trackUri: string | null;
  trackName: string;
  artist: string;
  album: string | null;
  msPlayed: number;
  imageUrl: string | null;
  source: PlaySource;
};

/**
 * How long a play must last to count as a listen. Spotify counts a "stream" after
 * 30 seconds; the user can choose another threshold in Settings.
 */
export function minStreamMs() {
  return getSettings().minStreamSec * 1000;
}

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('spotify-stats.db');
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS plays (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          played_at INTEGER NOT NULL,
          track_uri TEXT,
          track_name TEXT NOT NULL,
          artist TEXT NOT NULL,
          album TEXT,
          ms_played INTEGER NOT NULL,
          image_url TEXT,
          source TEXT NOT NULL,
          uploaded INTEGER NOT NULL DEFAULT 0,
          UNIQUE (played_at, track_name, artist)
        );
        CREATE INDEX IF NOT EXISTS idx_plays_played_at ON plays (played_at);
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS artist_genres (
          artist_key TEXT PRIMARY KEY,  -- lower(artist)
          genres TEXT NOT NULL,         -- JSON array, [] = Spotify has none
          fetched_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS artist_images (
          artist_key TEXT PRIMARY KEY,  -- lower(artist)
          image_url TEXT NOT NULL,      -- '' = Spotify has none
          fetched_at INTEGER NOT NULL
        );
      `);
      // Databases created before cloud sync have no "uploaded" column yet.
      const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(plays)`);
      if (!cols.some((c) => c.name === 'uploaded')) {
        await db.execAsync(`ALTER TABLE plays ADD COLUMN uploaded INTEGER NOT NULL DEFAULT 0`);
      }
      await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_plays_pending ON plays (id) WHERE uploaded = 0`);
      // The user's playlists (Playlist tab). Items only for own/collaborative ones:
      // Spotify gives only name and cover for playlists made by others.
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS playlists (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          owner_id TEXT,
          owner_name TEXT,
          image_url TEXT,
          snapshot_id TEXT,
          items_snapshot TEXT,           -- snapshot the items below belong to
          collaborative INTEGER NOT NULL DEFAULT 0,
          readable INTEGER NOT NULL DEFAULT 0, -- own or collaborative: items available
          total INTEGER NOT NULL DEFAULT 0,
          position INTEGER NOT NULL DEFAULT 0  -- order in the user's library
        );
        CREATE TABLE IF NOT EXISTS playlist_items (
          playlist_id TEXT NOT NULL,
          pos INTEGER NOT NULL,
          track_uri TEXT,
          track_name TEXT NOT NULL,
          artist TEXT NOT NULL,
          album TEXT,
          release_date TEXT,
          duration_ms INTEGER NOT NULL DEFAULT 0,
          image_url TEXT,
          added_at INTEGER,              -- epoch ms
          added_by TEXT,                 -- Spotify id
          PRIMARY KEY (playlist_id, pos)
        );
        CREATE INDEX IF NOT EXISTS idx_playlist_items_key ON playlist_items (lower(track_name), lower(artist));
      `);
      return db;
    })();
  }
  return dbPromise;
}

// 9 columns × 500 rows = 4500 bound parameters, well under SQLite's limit.
const INSERT_BATCH = 500;

/**
 * Inserts in multi-row batches: one native call per 500 plays instead of one per play.
 * `uploaded` marks rows that came from the cloud, so they aren't sent back.
 */
export async function insertPlays(plays: Play[], { uploaded = false } = {}): Promise<number> {
  if (plays.length === 0) return 0;
  const db = await getDb();
  let inserted = 0;
  const work = async (tx: SQLite.SQLiteDatabase) => {
    for (let i = 0; i < plays.length; i += INSERT_BATCH) {
      const chunk = plays.slice(i, i + INSERT_BATCH);
      const params: (string | number | null)[] = [];
      for (const p of chunk) {
        params.push(
          p.playedAt, p.trackUri, p.trackName, p.artist, p.album, p.msPlayed, p.imageUrl, p.source,
          uploaded ? 1 : 0,
        );
      }
      const r = await tx.runAsync(
        `INSERT OR IGNORE INTO plays
          (played_at, track_uri, track_name, artist, album, ms_played, image_url, source, uploaded)
         VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
        params,
      );
      inserted += r.changes;
    }
  };
  // Exclusive transactions are not available on web.
  if (Platform.OS === 'web') await db.withTransactionAsync(() => work(db));
  else await db.withExclusiveTransactionAsync(work);
  return inserted;
}

// ---------- Cloud sync ----------

/** Plays this device hasn't sent to the cloud yet. */
export async function getPlaysToUpload(limit: number): Promise<(Play & { id: number })[]> {
  const db = await getDb();
  return db.getAllAsync<Play & { id: number }>(
    `SELECT id, played_at AS playedAt, track_uri AS trackUri, track_name AS trackName, artist,
            album, ms_played AS msPlayed, image_url AS imageUrl, source
     FROM plays WHERE uploaded = 0 ORDER BY id LIMIT ?`,
    [limit],
  );
}

export async function markUploaded(ids: number[]) {
  if (ids.length === 0) return;
  const db = await getDb();
  for (let i = 0; i < ids.length; i += INSERT_BATCH) {
    const chunk = ids.slice(i, i + INSERT_BATCH);
    await db.runAsync(`UPDATE plays SET uploaded = 1 WHERE id IN (${chunk.map(() => '?').join(',')})`, chunk);
  }
}

// ---------- Covers ----------

/** Most-played songs of the period with no cover yet (NULL = never looked up, '' = Spotify has none). */
export async function getSongsMissingCover(from: number, to: number, limit: number) {
  const db = await getDb();
  return db.getAllAsync<{ trackName: string; artist: string; imageUrl: null }>(
    `SELECT MAX(track_name) AS trackName, MAX(artist) AS artist, NULL AS imageUrl FROM plays
     WHERE played_at >= ? AND played_at <= ?
     GROUP BY ${TRACK_KEY}
     HAVING MAX(image_url) IS NULL
     ORDER BY COUNT(*) DESC
     LIMIT ?`,
    [from, to, limit],
  );
}

/** Most listened artists of the period whose photo was never looked up. */
export async function getArtistsMissingImage(from: number, to: number, limit: number): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ artist: string }>(
    `SELECT MAX(p.artist) AS artist FROM plays p
     WHERE p.played_at >= ? AND p.played_at <= ?
       AND NOT EXISTS (SELECT 1 FROM artist_images a WHERE a.artist_key = lower(p.artist))
     GROUP BY lower(p.artist)
     ORDER BY SUM(p.ms_played) DESC
     LIMIT ?`,
    [from, to, limit],
  );
  return rows.map((r) => r.artist);
}

/** A Spotify track URI for this song (title + main artist), if any play has one. */
export async function getTrackUriFor(trackName: string, artist: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ uri: string | null }>(
    `SELECT MAX(track_uri) AS uri FROM plays
     WHERE lower(track_name) = lower(?) AND lower(artist) = lower(?) AND track_uri LIKE 'spotify:track:%'`,
    [trackName, artist],
  );
  return row?.uri ?? null;
}

/** Sets the cover on every play of a song still without one ('' = looked up, none found). */
export async function setCoverForTrack(trackName: string, artist: string, imageUrl: string) {
  const db = await getDb();
  await db.runAsync(
    `UPDATE plays SET image_url = ?
     WHERE lower(track_name) = lower(?) AND lower(artist) = lower(?) AND (image_url IS NULL OR image_url = '')`,
    [imageUrl, trackName, artist],
  );
}

/** Cached artist photos by lower(artist); '' = looked up, Spotify has none. */
export async function getArtistImages(artistKeys: string[]): Promise<Map<string, string>> {
  if (artistKeys.length === 0) return new Map();
  const db = await getDb();
  const rows = await db.getAllAsync<{ k: string; url: string }>(
    `SELECT artist_key AS k, image_url AS url FROM artist_images WHERE artist_key IN (${artistKeys.map(() => '?').join(',')})`,
    artistKeys,
  );
  return new Map(rows.map((r) => [r.k, r.url]));
}

export async function saveArtistImage(artistKey: string, imageUrl: string) {
  const db = await getDb();
  await db.runAsync(`INSERT OR REPLACE INTO artist_images (artist_key, image_url, fetched_at) VALUES (?, ?, ?)`, [
    artistKey,
    imageUrl,
    Date.now(),
  ]);
}

/** Any Spotify track URI of this artist (to find the artist id). */
export async function getArtistTrackUri(artist: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ uri: string | null }>(
    `SELECT MAX(track_uri) AS uri FROM plays WHERE lower(artist) = lower(?) AND track_uri LIKE 'spotify:track:%'`,
    [artist],
  );
  return row?.uri ?? null;
}

/**
 * Imported history is the ground truth (real ms played). API rows that fall
 * inside the imported period are duplicates with estimated durations: drop them.
 */
export async function removeApiPlaysUpTo(timestamp: number): Promise<number> {
  const db = await getDb();
  const r = await db.runAsync(`DELETE FROM plays WHERE source = 'api' AND played_at <= ?`, [timestamp]);
  return r.changes;
}

export async function getMeta(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(`SELECT value FROM meta WHERE key = ?`, [key]);
  return row?.value ?? null;
}

export async function setMeta(key: string, value: string) {
  const db = await getDb();
  await db.runAsync(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`, [key, value]);
}

export async function clearAllData() {
  const db = await getDb();
  await db.execAsync(`DELETE FROM plays; DELETE FROM meta; DELETE FROM artist_genres; DELETE FROM artist_images; DELETE FROM playlists; DELETE FROM playlist_items;`);
}

// ---------- Stats ----------

export type Summary = {
  totalMs: number;
  streams: number;
  uniqueTracks: number;
  firstPlayAt: number | null;
  lastPlayAt: number | null;
};

export type TrackStat = {
  trackName: string;
  artist: string;
  album: string | null;
  imageUrl: string | null;
  plays: number;
  totalMs: number;
};

/**
 * SQL condition: the row counts as a play. API rows always do (Spotify only logs them
 * after 30 s and doesn't say how long they lasted); imported rows must reach the threshold.
 * A function, not a constant, because the threshold can change while the app runs.
 */
export function isStream() {
  return `(source = 'api' OR ms_played >= ${minStreamMs()})`;
}

/**
 * Same song = same title + main artist, case-insensitive. Track URIs can't be used:
 * the basic export has none, and singles/album versions of one song have different URIs.
 */
export const TRACK_KEY = `lower(track_name) || char(0) || lower(artist)`;

export async function getSummary(from: number, to: number): Promise<Summary> {
  const db = await getDb();
  const row = await db.getFirstAsync<{
    totalMs: number | null;
    streams: number;
    uniqueTracks: number;
    firstPlayAt: number | null;
    lastPlayAt: number | null;
  }>(
    `SELECT
       SUM(ms_played) AS totalMs,
       SUM(CASE WHEN ${isStream()} THEN 1 ELSE 0 END) AS streams,
       COUNT(DISTINCT CASE WHEN ${isStream()} THEN ${TRACK_KEY} END) AS uniqueTracks,
       MIN(played_at) AS firstPlayAt,
       MAX(played_at) AS lastPlayAt
     FROM plays WHERE played_at >= ? AND played_at <= ?`,
    [from, to],
  );
  return {
    totalMs: row?.totalMs ?? 0,
    streams: row?.streams ?? 0,
    uniqueTracks: row?.uniqueTracks ?? 0,
    firstPlayAt: row?.firstPlayAt ?? null,
    lastPlayAt: row?.lastPlayAt ?? null,
  };
}

export type TrackSort = 'plays' | 'time';

/** Narrows a query to one song (title + artist) or one artist, case-insensitive like TRACK_KEY. */
export type ItemFilter = { artist: string; trackName?: string; album?: string };

function filterSql(f?: ItemFilter) {
  if (!f) return { sql: '', params: [] as string[] };
  const parts = ['lower(artist) = lower(?)'];
  const params = [f.artist];
  if (f.trackName !== undefined) {
    parts.push('lower(track_name) = lower(?)');
    params.push(f.trackName);
  }
  if (f.album !== undefined) {
    parts.push('lower(album) = lower(?)');
    params.push(f.album);
  }
  return { sql: ` AND ${parts.join(' AND ')}`, params };
}

export async function getTrackStats(
  from: number,
  to: number,
  sort: TrackSort,
  options: { search?: string; limit?: number; artist?: string; album?: string } = {},
): Promise<TrackStat[]> {
  const db = await getDb();
  const order = sort === 'plays' ? 'plays DESC, totalMs DESC' : 'totalMs DESC, plays DESC';
  const search = options.search?.trim() ?? '';
  const params: (string | number)[] = [from, to];
  let where = '';
  if (search) {
    where += ' AND (track_name LIKE ? OR artist LIKE ? OR album LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (options.artist) {
    const f = filterSql({ artist: options.artist, album: options.album });
    where += f.sql;
    params.push(...f.params);
  }
  params.push(options.limit ?? -1); // LIMIT -1 = no limit
  return db.getAllAsync<TrackStat>(
    `SELECT
       MAX(track_name) AS trackName,
       MAX(artist) AS artist,
       MAX(album) AS album,
       NULLIF(MAX(image_url), '') AS imageUrl,
       SUM(CASE WHEN ${isStream()} THEN 1 ELSE 0 END) AS plays,
       SUM(ms_played) AS totalMs
     FROM plays
     WHERE played_at >= ? AND played_at <= ?${where}
     GROUP BY ${TRACK_KEY}
     HAVING plays > 0
     ORDER BY ${order}
     LIMIT ?`,
    params,
  );
}

export type ArtistStat = {
  artist: string;
  plays: number;
  totalMs: number;
  /** Distinct songs listened (≥ 30 s). */
  tracks: number;
  imageUrl: string | null;
};

export async function getArtistStats(
  from: number,
  to: number,
  sort: TrackSort,
  options: { search?: string; limit?: number } = {},
): Promise<ArtistStat[]> {
  const db = await getDb();
  const order = sort === 'plays' ? 'plays DESC, totalMs DESC' : 'totalMs DESC, plays DESC';
  const search = options.search?.trim() ?? '';
  const params: (string | number)[] = [from, to];
  let where = '';
  if (search) {
    where = ' AND artist LIKE ?';
    params.push(`%${search}%`);
  }
  params.push(options.limit ?? -1);
  return db.getAllAsync<ArtistStat>(
    `SELECT
       MAX(artist) AS artist,
       SUM(CASE WHEN ${isStream()} THEN 1 ELSE 0 END) AS plays,
       SUM(ms_played) AS totalMs,
       COUNT(DISTINCT CASE WHEN ${isStream()} THEN ${TRACK_KEY} END) AS tracks,
       ${ARTIST_IMAGE} AS imageUrl
     FROM plays ${ARTIST_IMAGE_JOIN}
     WHERE played_at >= ? AND played_at <= ?${where}
     GROUP BY lower(artist)
     HAVING plays > 0
     ORDER BY ${order}
     LIMIT ?`,
    params,
  );
}

/**
 * Artist photo if cached, else one of their covers. Needs ARTIST_IMAGE_JOIN after FROM plays.
 * (A correlated subquery on MAX(artist) would be neater, but SQLite rejects it as "misuse of aggregate".)
 */
const ARTIST_IMAGE = `COALESCE(NULLIF(MAX(ai.image_url), ''), NULLIF(MAX(plays.image_url), ''))`;
const ARTIST_IMAGE_JOIN = `LEFT JOIN artist_images ai ON ai.artist_key = lower(plays.artist)`;

export type PlayRow = Play & { id: number };

/** Newest first, including skips (the UI marks them), optionally for one song/artist. */
export async function getRecentPlays(limit = 50, offset = 0, filter?: ItemFilter): Promise<PlayRow[]> {
  const db = await getDb();
  const f = filterSql(filter);
  return db.getAllAsync<PlayRow>(
    `SELECT id, played_at AS playedAt, track_uri AS trackUri, track_name AS trackName, artist,
            album, ms_played AS msPlayed, NULLIF(image_url, '') AS imageUrl, source
     FROM plays WHERE 1 = 1${f.sql}
     ORDER BY played_at DESC LIMIT ? OFFSET ?`,
    [...f.params, limit, offset],
  );
}

export type ItemSummary = {
  plays: number;
  totalMs: number;
  uniqueTracks: number;
  firstAt: number | null;
  lastAt: number | null;
  imageUrl: string | null;
  album: string | null;
};

/** All-time totals for one song or artist. */
export async function getItemSummary(filter: ItemFilter): Promise<ItemSummary> {
  const db = await getDb();
  const f = filterSql(filter);
  const artistOnly = filter.trackName === undefined && filter.album === undefined;
  const row = await db.getFirstAsync<ItemSummary>(
    `SELECT
       COALESCE(SUM(CASE WHEN ${isStream()} THEN 1 ELSE 0 END), 0) AS plays,
       COALESCE(SUM(ms_played), 0) AS totalMs,
       COUNT(DISTINCT CASE WHEN ${isStream()} THEN ${TRACK_KEY} END) AS uniqueTracks,
       MIN(CASE WHEN ${isStream()} THEN played_at END) AS firstAt,
       MAX(CASE WHEN ${isStream()} THEN played_at END) AS lastAt,
       ${artistOnly ? ARTIST_IMAGE : `NULLIF(MAX(image_url), '')`} AS imageUrl,
       MAX(album) AS album
     FROM plays ${artistOnly ? ARTIST_IMAGE_JOIN : ''} WHERE 1 = 1${f.sql}`,
    f.params,
  );
  return row ?? { plays: 0, totalMs: 0, uniqueTracks: 0, firstAt: null, lastAt: null, imageUrl: null, album: null };
}

export const HOUR_MS = 3_600_000;

/**
 * Hourly totals (ms listened, plays). Local month/weekday/hour/day are worked out
 * in JS, because SQLite's "localtime" isn't reliable in the browser build.
 */
export async function getHourBuckets(from: number, to: number, filter?: ItemFilter) {
  const db = await getDb();
  const f = filterSql(filter);
  return db.getAllAsync<{ h: number; ms: number; n: number }>(
    `SELECT played_at / ${HOUR_MS} AS h, SUM(ms_played) AS ms,
            SUM(CASE WHEN ${isStream()} THEN 1 ELSE 0 END) AS n
     FROM plays WHERE played_at >= ? AND played_at <= ?${f.sql} GROUP BY h`,
    [from, to, ...f.params],
  );
}

/** Songs and artists whose first-ever play falls in the period. */
export async function countDiscoveries(from: number, to: number) {
  const db = await getDb();
  const count = async (key: string) =>
    (
      await db.getFirstAsync<{ n: number }>(
        `SELECT COUNT(*) AS n FROM (
           SELECT MIN(played_at) AS first FROM plays WHERE ${isStream()} GROUP BY ${key}
         ) WHERE first >= ? AND first <= ?`,
        [from, to],
      )
    )?.n ?? 0;
  const [tracks, artists] = await Promise.all([count(TRACK_KEY), count('lower(artist)')]);
  return { tracks, artists };
}

/** Skips are only known for imported history (the API reports finished plays only). */
export async function countSkips(from: number, to: number) {
  const db = await getDb();
  const row = await db.getFirstAsync<{ skipped: number; total: number }>(
    `SELECT COALESCE(SUM(CASE WHEN ms_played < ${minStreamMs()} THEN 1 ELSE 0 END), 0) AS skipped,
            COUNT(*) AS total
     FROM plays WHERE source = 'import' AND played_at >= ? AND played_at <= ?`,
    [from, to],
  );
  return { skipped: row?.skipped ?? 0, total: row?.total ?? 0 };
}

// ---------- Albums ----------

export type AlbumStat = {
  album: string;
  artist: string;
  plays: number;
  totalMs: number;
  tracks: number;
  imageUrl: string | null;
};

/** Albums (name + album artist). Plays without album info (basic export) are left out. */
export async function getAlbumStats(
  from: number,
  to: number,
  sort: TrackSort,
  options: { search?: string; limit?: number } = {},
): Promise<AlbumStat[]> {
  const db = await getDb();
  const order = sort === 'plays' ? 'plays DESC, totalMs DESC' : 'totalMs DESC, plays DESC';
  const search = options.search?.trim() ?? '';
  const params: (string | number)[] = [from, to];
  let where = '';
  if (search) {
    where = ' AND (album LIKE ? OR artist LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  params.push(options.limit ?? -1);
  return db.getAllAsync<AlbumStat>(
    `SELECT
       MAX(album) AS album,
       MAX(artist) AS artist,
       SUM(CASE WHEN ${isStream()} THEN 1 ELSE 0 END) AS plays,
       SUM(ms_played) AS totalMs,
       COUNT(DISTINCT CASE WHEN ${isStream()} THEN ${TRACK_KEY} END) AS tracks,
       NULLIF(MAX(image_url), '') AS imageUrl
     FROM plays
     WHERE played_at >= ? AND played_at <= ? AND album IS NOT NULL AND album <> ''${where}
     GROUP BY lower(album), lower(artist)
     HAVING plays > 0
     ORDER BY ${order}
     LIMIT ?`,
    params,
  );
}

// ---------- Sessions, days, forgotten songs ----------

export type SessionStats = {
  sessions: number;
  avgTracks: number;
  avgMs: number;
  longest: { start: number; end: number; tracks: number; ms: number } | null;
};

/** A session = plays less than 30 minutes apart. */
export async function getSessionStats(from: number, to: number): Promise<SessionStats> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ start: number; end: number; tracks: number; ms: number }>(
    `WITH p AS (
       SELECT played_at, ms_played,
              played_at - LAG(played_at) OVER (ORDER BY played_at) AS gap
       FROM plays WHERE played_at >= ? AND played_at <= ? AND ${isStream()}
     ), s AS (
       SELECT played_at, ms_played,
              SUM(CASE WHEN gap IS NULL OR gap > 1800000 THEN 1 ELSE 0 END) OVER (ORDER BY played_at) AS sid
       FROM p
     )
     SELECT MIN(played_at) AS start, MAX(played_at) AS "end", COUNT(*) AS tracks, SUM(ms_played) AS ms
     FROM s GROUP BY sid`,
    [from, to],
  );
  if (rows.length === 0) return { sessions: 0, avgTracks: 0, avgMs: 0, longest: null };
  let longest = rows[0];
  let tracks = 0;
  let ms = 0;
  for (const r of rows) {
    tracks += r.tracks;
    ms += r.ms;
    if (r.ms > longest.ms) longest = r;
  }
  return { sessions: rows.length, avgTracks: tracks / rows.length, avgMs: ms / rows.length, longest };
}

/** All plays in a time range (e.g. one day), newest first. */
export async function getPlaysInRange(from: number, to: number): Promise<PlayRow[]> {
  const db = await getDb();
  return db.getAllAsync<PlayRow>(
    `SELECT id, played_at AS playedAt, track_uri AS trackUri, track_name AS trackName, artist,
            album, ms_played AS msPlayed, NULLIF(image_url, '') AS imageUrl, source
     FROM plays WHERE played_at >= ? AND played_at <= ? ORDER BY played_at DESC`,
    [from, to],
  );
}

export type ForgottenTrack = TrackStat & { lastAt: number };

/** Songs you played a lot and haven't played for a while. */
export async function getForgottenTracks(minPlays: number, notSince: number, limit: number): Promise<ForgottenTrack[]> {
  const db = await getDb();
  return db.getAllAsync<ForgottenTrack>(
    `SELECT
       MAX(track_name) AS trackName, MAX(artist) AS artist, MAX(album) AS album,
       NULLIF(MAX(image_url), '') AS imageUrl,
       SUM(CASE WHEN ${isStream()} THEN 1 ELSE 0 END) AS plays,
       SUM(ms_played) AS totalMs,
       MAX(played_at) AS lastAt
     FROM plays
     GROUP BY ${TRACK_KEY}
     HAVING plays >= ? AND lastAt < ?
     ORDER BY plays DESC
     LIMIT ?`,
    [minPlays, notSince, limit],
  );
}

// ---------- Genres ----------

/** Most listened artists of the period without cached genres, with one track URI each. */
export async function getArtistsMissingGenres(from: number, to: number, limit: number) {
  const db = await getDb();
  return db.getAllAsync<{ artistKey: string; artist: string; uri: string }>(
    `SELECT lower(p.artist) AS artistKey, MAX(p.artist) AS artist,
            MAX(CASE WHEN p.track_uri LIKE 'spotify:track:%' THEN p.track_uri END) AS uri
     FROM plays p
     WHERE p.played_at >= ? AND p.played_at <= ?
       AND NOT EXISTS (SELECT 1 FROM artist_genres g WHERE g.artist_key = lower(p.artist))
     GROUP BY lower(p.artist)
     HAVING uri IS NOT NULL
     ORDER BY SUM(p.ms_played) DESC
     LIMIT ?`,
    [from, to, limit],
  );
}

export async function saveArtistGenres(artistKey: string, genres: string[]) {
  const db = await getDb();
  await db.runAsync(`INSERT OR REPLACE INTO artist_genres (artist_key, genres, fetched_at) VALUES (?, ?, ?)`, [
    artistKey,
    JSON.stringify(genres),
    Date.now(),
  ]);
}

/** Minutes per genre in the period (an artist's minutes count for each of its genres). */
export async function getGenreStats(from: number, to: number) {
  const db = await getDb();
  const rows = await db.getAllAsync<{ genres: string; ms: number }>(
    `SELECT g.genres, SUM(p.ms_played) AS ms
     FROM plays p JOIN artist_genres g ON g.artist_key = lower(p.artist)
     WHERE p.played_at >= ? AND p.played_at <= ?
     GROUP BY g.artist_key`,
    [from, to],
  );
  const totals = new Map<string, number>();
  let covered = 0;
  for (const r of rows) {
    const genres = JSON.parse(r.genres) as string[];
    if (genres.length > 0) covered += r.ms;
    for (const g of genres) totals.set(g, (totals.get(g) ?? 0) + r.ms);
  }
  const list = [...totals.entries()].map(([genre, ms]) => ({ genre, ms })).sort((a, b) => b.ms - a.ms);
  return { genres: list, coveredMs: covered };
}
