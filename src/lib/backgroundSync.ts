import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { cloudSync } from './cloudSync';
import { getMeta, setMeta } from './db';
import { loadTokens } from './spotify';
import { syncRecentlyPlayed } from './sync';

export const SYNC_TASK = 'spotify-recently-played-sync';

/** Minutes. 15 is the minimum Android/iOS accept; the OS still decides the real cadence. */
const INTERVAL = 15;

// Must be defined at module scope so the OS can run it while the app is closed.
TaskManager.defineTask(SYNC_TASK, async () => {
  try {
    if (!(await loadTokens())) return BackgroundTask.BackgroundTaskResult.Success;
    await cloudSync().catch(() => 0); // other devices first (see useSync)
    await syncRecentlyPlayed();
    await cloudSync();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (e) {
    console.warn('Background sync failed', e);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerBackgroundSync() {
  const status = await BackgroundTask.getStatusAsync();
  if (status !== BackgroundTask.BackgroundTaskStatus.Available) return;
  const registered = await TaskManager.isTaskRegisteredAsync(SYNC_TASK);
  // Re-register only when the interval changed (e.g. 30 → 15 min after an update),
  // otherwise every app start would reset the OS schedule.
  if (registered && (await getMeta('backgroundInterval')) === String(INTERVAL)) return;
  if (registered) await BackgroundTask.unregisterTaskAsync(SYNC_TASK);
  // 50 tracks ≈ 2.5h of music, so even a late run rarely misses anything.
  await BackgroundTask.registerTaskAsync(SYNC_TASK, { minimumInterval: INTERVAL });
  await setMeta('backgroundInterval', String(INTERVAL));
}

export async function unregisterBackgroundSync() {
  if (await TaskManager.isTaskRegisteredAsync(SYNC_TASK)) {
    await BackgroundTask.unregisterTaskAsync(SYNC_TASK);
  }
}
