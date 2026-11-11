import { getArtistsMissingGenres, saveArtistGenres, saveArtistImage } from './db';
import { spotifyGet, SpotifyApiError, type SpotifyTrack } from './spotify';

type TrackWithArtistIds = Omit<SpotifyTrack, 'artists'> & { artists: { id: string; name: string }[] };

let running: Promise<number> | null = null;

/**
 * Spotify gives genres per artist, not per song. For the period's most listened
 * artists without cached genres: track → artist id → genres, a few at a time.
 * Results (even "no genres") are cached locally, so each artist is asked once.
 */
export function fillMissingGenres(from: number, to: number, limit = 30): Promise<number> {
  running ??= run(from, to, limit).finally(() => {
    running = null;
  });
  return running;
}

async function run(from: number, to: number, limit: number) {
  const artists = await getArtistsMissingGenres(from, to, limit);
  let saved = 0;
  const CONCURRENCY = 4;
  for (let i = 0; i < artists.length; i += CONCURRENCY) {
    const results = await Promise.allSettled(
      artists.slice(i, i + CONCURRENCY).map(async ({ artistKey, uri }) => {
        try {
          const track = await spotifyGet<TrackWithArtistIds>(`/tracks/${uri.slice('spotify:track:'.length)}`);
          const artist = track.artists.find((a) => a.name.toLowerCase() === artistKey) ?? track.artists[0];
          const info = artist
            ? await spotifyGet<{ genres?: string[]; images?: { url: string }[] }>(`/artists/${artist.id}`)
            : null;
          await saveArtistGenres(artistKey, info?.genres ?? []);
          // Same response has the artist photo: cache it too, saving a request later.
          if (info) await saveArtistImage(artistKey, info.images?.[0]?.url ?? '');
          return 1;
        } catch (e) {
          // Track/artist gone from Spotify: remember "no genres" so we don't ask again.
          if (e instanceof SpotifyApiError && (e.status === 404 || e.status === 400)) {
            await saveArtistGenres(artistKey, []);
            return 0;
          }
          throw e;
        }
      }),
    );
    for (const r of results) if (r.status === 'fulfilled') saved += r.value;
    // Rate limited or offline: stop, the rest is fetched next time.
    if (results.some((r) => r.status === 'rejected')) break;
  }
  return saved;
}
