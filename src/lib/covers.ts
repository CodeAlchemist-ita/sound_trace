import {
  getArtistImages,
  getArtistsMissingImage,
  getSongsMissingCover,
  getArtistTrackUri,
  getTrackUriFor,
  saveArtistImage,
  setCoverForTrack,
} from './db';
import { notifyDataChanged } from './dataEvents';
import { startOfYear } from './format';
import { pickCover, spotifyGet, SpotifyApiError, type SpotifyImage, type SpotifyTrack } from './spotify';

// One lookup at a time (they share Spotify's rate limit); the same range isn't queued twice.
let queue: Promise<unknown> = Promise.resolve();
const pending = new Map<string, Promise<number>>();

/**
 * Imported history has no artwork: look up on Spotify the covers of the period's
 * most-played songs and the photos of its top artists, a few at a time.
 * Defaults to the current year. Returns how many images were added.
 */
export function fillMissingCovers(from = startOfYear(), to = Date.now(), limit = 100): Promise<number> {
  // Rolling periods end "now": round so re-renders of one screen share a run.
  const key = `${Math.floor(from / 60_000)}|${Math.floor(to / 60_000)}|${limit}`;
  let p = pending.get(key);
  if (!p) {
    p = queue.then(() => run(from, to, limit)).finally(() => pending.delete(key));
    queue = p.catch(() => undefined);
    pending.set(key, p);
  }
  return p;
}

const CONCURRENCY = 4;

// After a 429 (rate limit, or the Development Mode quota) wait before asking Spotify again.
let pausedUntil = 0;

/**
 * Runs `fn` on the items a few at a time. Screens refresh as images arrive (at most
 * every 1.5 s), not only at the end. Stops at the first failure (rate limited or offline).
 */
async function inBatches<T>(items: T[], fn: (item: T) => Promise<number>) {
  let added = 0;
  let notified = 0;
  let lastNotify = Date.now();
  for (let i = 0; i < items.length && Date.now() >= pausedUntil; i += CONCURRENCY) {
    const results = await Promise.allSettled(items.slice(i, i + CONCURRENCY).map(fn));
    for (const r of results) if (r.status === 'fulfilled') added += r.value;
    if (added > notified && Date.now() - lastNotify > 1500) {
      notified = added;
      lastNotify = Date.now();
      notifyDataChanged();
    }
    const failed = results.find((r) => r.status === 'rejected');
    if (failed) {
      const e = failed.reason;
      if (e instanceof SpotifyApiError && e.status === 429) {
        pausedUntil = Date.now() + (e.retryAfterMs ?? 10 * 60_000);
      }
      console.warn('[covers] lookup stopped:', e instanceof Error ? e.message : e);
      break;
    }
  }
  if (added > notified) notifyDataChanged();
  return added;
}

async function run(from: number, to: number, limit: number) {
  if (Date.now() < pausedUntil) return 0;
  // Same order as the lists (plays per song), so what's on screen comes first. A song can
  // have several track URIs: one lookup covers all its plays. By track id when known, else by search.
  const songs = await getSongsMissingCover(from, to, limit);
  let added = await inBatches(songs, async (s) => (await ensureTrackCovers([s], { strict: true })).size);
  // Artist photos for the artists list and their pages.
  const artists = await getArtistsMissingImage(from, to, 30);
  added += await inBatches(artists, async (a) => (await ensureArtistImages([a], { strict: true })).size);
  return added;
}

type SongRef = { trackName: string; artist: string; imageUrl: string | null };
type ArtistRef = { id: string; name: string; images?: SpotifyImage[] };

export const songKey = (s: { trackName: string; artist: string }) => `${s.trackName.toLowerCase()}\u0000${s.artist.toLowerCase()}`;

/**
 * Covers for specific songs that still have none, e.g. the ones a recap shows.
 * Unlike fillMissingCovers it works for any year and for plays without a track
 * URI (basic export), falling back to a Spotify search. Returns key → url.
 */
export async function ensureTrackCovers(songs: SongRef[], { strict = false } = {}): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const missing = songs.filter((s, i, all) => !s.imageUrl && all.findIndex((o) => songKey(o) === songKey(s)) === i);
  await settle(
    missing.map(async (s) => {
      const uri = await getTrackUriFor(s.trackName, s.artist);
      let track: SpotifyTrack | undefined;
      try {
        track = uri ? await spotifyGet<SpotifyTrack>(`/tracks/${uri.slice('spotify:track:'.length)}`) : undefined;
      } catch (e) {
        if (!(e instanceof SpotifyApiError && (e.status === 404 || e.status === 400))) throw e;
      }
      track ??= (await search<SpotifyTrack>('track', `track:${s.trackName} artist:${s.artist}`))[0];
      const url = pickCover(track?.album?.images) ?? '';
      await setCoverForTrack(s.trackName, s.artist, url);
      if (url) found.set(songKey(s), url);
    }),
    strict,
  );
  return found;
}

/** Artist photos (largest size, for big hero images), cached locally. Returns lower(artist) → url. */
export async function ensureArtistImages(artists: string[], { strict = false } = {}): Promise<Map<string, string>> {
  const keys = [...new Set(artists.map((a) => a.toLowerCase()))];
  const cached = await getArtistImages(keys);
  const result = new Map([...cached].filter(([, url]) => url));
  await settle(
    artists
      .filter((a) => !cached.has(a.toLowerCase()))
      .map(async (name) => {
        const key = name.toLowerCase();
        let artist: ArtistRef | undefined;
        const uri = await getArtistTrackUri(name);
        if (uri) {
          try {
            const track = await spotifyGet<{ artists: ArtistRef[] }>(`/tracks/${uri.slice('spotify:track:'.length)}`);
            const ref = track.artists.find((a) => a.name.toLowerCase() === key) ?? track.artists[0];
            if (ref) artist = await spotifyGet<ArtistRef>(`/artists/${ref.id}`);
          } catch (e) {
            if (!(e instanceof SpotifyApiError && (e.status === 404 || e.status === 400))) throw e;
          }
        }
        artist ??= (await search<ArtistRef>('artist', name)).find((a) => a.name.toLowerCase() === key);
        const url = artist?.images?.[0]?.url ?? '';
        await saveArtistImage(key, url);
        if (url) result.set(key, url);
      }),
    strict,
  );
  return result;
}

/** Waits for all lookups; with `strict`, then rethrows the first failure. */
async function settle(tasks: Promise<unknown>[], strict: boolean) {
  const results = await Promise.allSettled(tasks);
  const failed = results.find((r) => r.status === 'rejected');
  if (strict && failed) throw failed.reason;
}

async function search<T>(type: 'track' | 'artist', q: string): Promise<T[]> {
  const res = await spotifyGet<Record<string, { items: T[] }>>(
    `/search?type=${type}&limit=5&q=${encodeURIComponent(q)}`,
  );
  return res[`${type}s`]?.items ?? [];
}

