import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { cloudSync } from './cloudSync';
import { fillMissingCovers } from './covers';
import { startOfYear } from './format';
import { fillMissingGenres } from './genres';
import { notifyDataChanged } from './dataEvents';
import { getMeta } from './db';
import { logError } from './errorLog';
import { syncRecentlyPlayed } from './sync';

/** Syncs on mount and whenever the app returns to the foreground. */
export function useSync() {
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const running = useRef(false);

  const sync = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setSyncing(true);
    try {
      // Other devices first, so plays they already saved don't look like a gap here;
      // then Spotify; then upload what Spotify gave us. Only re-render if data changed.
      let changed = (await cloudSync().catch(() => 0)) > 0;
      changed = (await syncRecentlyPlayed()) > 0 || changed;
      changed = (await cloudSync()) > 0 || changed;
      if (changed) notifyDataChanged();
      setError(null);
      // Covers first (visible everywhere), then genres for the year's top artists.
      fillMissingCovers()
        .then((added) => added > 0 && notifyDataChanged())
        .then(() => fillMissingGenres(startOfYear(), Date.now()))
        .then((saved) => saved > 0 && notifyDataChanged())
        .catch(console.warn);
    } catch (e) {
      logError(e, 'sync');
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      const last = await getMeta('lastSyncAt');
      setLastSyncAt(last ? Number(last) : null);
      running.current = false;
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    // Kick off the first sync asynchronously (it's an external fetch, not derived state).
    Promise.resolve().then(sync);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') sync();
    });
    // While the app is open (e.g. a PC tab left open), keep syncing every 10 minutes.
    const timer = setInterval(sync, 10 * 60_000);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [sync]);

  return { sync, syncing, error, lastSyncAt };
}
