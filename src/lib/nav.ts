import { router } from 'expo-router';

/** Opens the detail screen of a song (title + artist), an album or an artist. */
export function openTrack(t: { trackName: string; artist: string }) {
  router.push({ pathname: '/detail', params: { artist: t.artist, track: t.trackName } });
}

export function openArtist(a: { artist: string }) {
  router.push({ pathname: '/detail', params: { artist: a.artist } });
}

export function openAlbum(a: { album: string; artist: string }) {
  router.push({ pathname: '/detail', params: { artist: a.artist, album: a.album } });
}

/** Everything listened on one day (local midnight in ms). */
export function openDay(date: number) {
  router.push({ pathname: '/day', params: { date: String(date) } });
}

/** Lyrics of the song playing right now. */
export function openLyrics() {
  router.push('/lyrics');
}
