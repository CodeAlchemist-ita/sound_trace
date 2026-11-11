import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { hasScope, pickCover, SpotifyApiError, spotifyGet, type SpotifyTrack } from './spotify';

/** Spotify permission to read the track playing right now (asked at login since this feature exists). */
export const NOW_PLAYING_SCOPE = 'user-read-currently-playing';

export type NowPlaying = {
  /** Spotify track id (name|artist for local files, which have none). */
  trackId: string;
  trackName: string;
  artist: string;
  album: string | null;
  imageUrl: string | null;
  isPlaying: boolean;
  progressMs: number;
  durationMs: number;
  /** When Spotify gave this answer (epoch ms), to move the progress bar between two requests. */
  fetchedAt: number;
};

/** Body of GET /me/player/currently-playing (only the fields we use). */
export type CurrentlyPlayingResponse = {
  is_playing?: boolean;
  progress_ms?: number | null;
  currently_playing_type?: string;
  item?: SpotifyTrack | null;
};

/** null for podcasts, ads, local files without data, or nothing at all. */
export function parseNowPlaying(body: CurrentlyPlayingResponse | null | undefined, now = Date.now()): NowPlaying | null {
  const item = body?.item;
  if (!body || !item || (body.currently_playing_type ?? 'track') !== 'track' || !item.name) return null;
  const artist = item.artists?.[0]?.name ?? '';
  return {
    trackId: item.id || `${item.name}|${artist}`,
    trackName: item.name,
    // Main artist only, like the saved plays, so the detail screen finds the song.
    artist,
    album: item.album?.name ?? null,
    imageUrl: pickCover(item.album?.images),
    isPlaying: body.is_playing === true,
    progressMs: Math.max(0, body.progress_ms ?? 0),
    durationMs: item.duration_ms ?? 0,
    fetchedAt: now,
  };
}

/** Where the song is now: Spotify's position plus the time passed since, if it's playing. */
export function currentProgress(np: NowPlaying, now = Date.now()) {
  const ms = np.isPlaying ? np.progressMs + (now - np.fetchedAt) : np.progressMs;
  return Math.min(np.durationMs, Math.max(0, ms));
}

/**
 * When to ask Spotify again: every 20 s, or right after the song ends if that comes
 * first (never more often than every 3 s); every 30 s while nothing is playing.
 */
export function nextPollDelay(np: NowPlaying | null, now = Date.now()) {
  if (!np || !np.isPlaying) return 30_000;
  const remaining = np.durationMs - currentProgress(np, now);
  return Math.min(20_000, Math.max(3_000, remaining + 1_500));
}

export type NowPlayingState =
  | { status: 'loading' }
  /** Session from before this feature: a new Spotify login is needed. */
  | { status: 'no_scope' }
  | { status: 'idle' }
  | { status: 'playing'; track: NowPlaying };

export async function fetchNowPlaying(): Promise<NowPlayingState> {
  if (!(await hasScope(NOW_PLAYING_SCOPE))) return { status: 'no_scope' };
  try {
    // 204 (nothing playing) comes back as null.
    const body = await spotifyGet<CurrentlyPlayingResponse | null>('/me/player/currently-playing');
    const track = parseNowPlaying(body);
    return track ? { status: 'playing', track } : { status: 'idle' };
  } catch (e) {
    // The server-side token may still have the old permissions for a moment.
    if (e instanceof SpotifyApiError && (e.status === 401 || e.status === 403)) return { status: 'no_scope' };
    throw e;
  }
}

/**
 * The track playing right now, refreshed while the screen is in front and the app is
 * open. `refresh` asks again at once (e.g. after granting the permission).
 */
export function useNowPlaying(): NowPlayingState & { refresh: () => void } {
  const [state, setState] = useState<NowPlayingState>({ status: 'loading' });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = useRef(false);
  // The poll re-arms itself: it reaches its own latest version through this ref.
  const pollRef = useRef<() => void>(() => undefined);

  const poll = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!active.current) return;
    let next: NowPlayingState | null = null;
    try {
      next = await fetchNowPlaying();
      if (active.current) setState(next);
    } catch {
      // Offline or Spotify busy: keep what's on screen and try again later.
    }
    if (!active.current || next?.status === 'no_scope') return;
    timer.current = setTimeout(() => pollRef.current(), nextPollDelay(next?.status === 'playing' ? next.track : null));
  }, []);

  useEffect(() => {
    pollRef.current = poll;
  }, [poll]);

  useFocusEffect(
    useCallback(() => {
      active.current = true;
      poll();
      const sub = AppState.addEventListener('change', (s) => {
        active.current = s === 'active';
        if (active.current) poll();
        else if (timer.current) clearTimeout(timer.current);
      });
      return () => {
        active.current = false;
        sub.remove();
        if (timer.current) clearTimeout(timer.current);
      };
    }, [poll]),
  );

  return { ...state, refresh: poll };
}

/** Re-renders every second while a song is playing, for the progress bar. */
export function useProgress(np: NowPlaying | null) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!np?.isPlaying) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [np]);
  return np ? currentProgress(np) : 0;
}
