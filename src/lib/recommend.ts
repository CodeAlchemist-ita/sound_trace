import { useSyncExternalStore } from 'react';

import { getRecommendations } from './friends';

/** Longest message that can go with a recommendation (the server enforces it too). */
export const MAX_MESSAGE = 280;

/**
 * Where to open a recommended song in Spotify: the song itself when we have its id,
 * otherwise a search, so a song imported from the history (no uri) still opens something useful.
 */
export function spotifyTrackUrl(trackUri: string | null, trackName: string, artist: string): string {
  const id = trackUri?.match(/^spotify:track:([A-Za-z0-9]+)$/)?.[1];
  if (id) return `https://open.spotify.com/track/${id}`;
  return `https://open.spotify.com/search/${encodeURIComponent(`${trackName} ${artist}`)}`;
}

// How many received recommendations the user hasn't seen yet: shown as a badge on the
// Friends tab. Memory only: the server is the source of truth, and it is read again at startup.
let unseen = 0;
const listeners = new Set<() => void>();

export function getUnseen() {
  return unseen;
}

export function setUnseen(n: number) {
  const next = Math.max(0, Math.round(n) || 0);
  if (next === unseen) return;
  unseen = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Re-renders the component whenever the unseen count changes. */
export function useUnseenRecommendations(): number {
  return useSyncExternalStore(subscribe, getUnseen, getUnseen);
}

/** Reads the count from the server. Never throws: a badge must not break the screen it sits on. */
export async function refreshUnseen() {
  try {
    setUnseen((await getRecommendations()).unseen);
  } catch {
    // Offline or server unavailable: keep the last count.
  }
}
