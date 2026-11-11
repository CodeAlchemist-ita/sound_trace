import { insertPlays, setMeta, type Play } from './db';
import { checkForGap } from './gaps';
import { pickCover, spotifyGet, type RecentlyPlayedResponse } from './spotify';

/**
 * Spotify's API only exposes the last 50 played tracks, so we pull them often
 * and accumulate them in the local database. Duplicates are ignored by the
 * UNIQUE (played_at, track_name, artist) constraint.
 */
export async function syncRecentlyPlayed(): Promise<number> {
  const data = await spotifyGet<RecentlyPlayedResponse>('/me/player/recently-played?limit=50');
  const plays: Play[] = data.items
    .filter((i) => i.track) // local files / unavailable tracks can be null
    .map((i) => ({
      playedAt: Date.parse(i.played_at),
      trackUri: i.track.uri,
      trackName: i.track.name,
      // Main artist only, to match the export files and count the song once.
      artist: i.track.artists[0]?.name ?? 'Sconosciuto',
      album: i.track.album?.name ?? null,
      // The API does not say how long you listened: assume the whole track.
      msPlayed: i.track.duration_ms,
      imageUrl: pickCover(i.track.album?.images),
      source: 'api',
    }));
  const inserted = await insertPlays(plays);
  // A full page of 50 plays all newer than the last seen one = some plays may be lost.
  await checkForGap(
    plays.map((p) => p.playedAt),
    data.items.length >= 50,
  );
  await setMeta('lastSyncAt', String(Date.now()));
  return inserted;
}
