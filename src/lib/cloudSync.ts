import { getMeta, getPlaysToUpload, insertPlays, markUploaded, removeApiPlaysUpTo, setMeta, type Play } from './db';
import { fetchWithTimeout } from './http';
import { t } from './i18n';
import { getValidAccessToken } from './spotify';

/**
 * Optional: URL of the Supabase "sync" Edge Function (see supabase/ and the README).
 * Without it the app works as before, with data only on this device.
 */
export const SYNC_URL = process.env.EXPO_PUBLIC_SYNC_URL ?? '';
export const cloudEnabled = SYNC_URL.length > 0;

const PAGE = 1000; // must match the Edge Function

type Row = {
  played_at: number;
  track_uri: string | null;
  track_name: string;
  artist: string;
  album: string | null;
  ms_played: number;
  image_url: string | null;
  source: Play['source'];
};

type SyncResponse = { user: string; rows: (Row & { id: number })[]; more: boolean; importedUntil: number };

export class CloudSyncError extends Error {}

const toRow = (p: Play): Row => ({
  played_at: p.playedAt,
  track_uri: p.trackUri,
  track_name: p.trackName,
  artist: p.artist,
  album: p.album,
  ms_played: p.msPlayed,
  // '' means "no cover found" locally; let the other device look it up itself.
  image_url: p.imageUrl || null,
  source: p.source,
});

const fromRow = (r: Row): Play => ({
  playedAt: r.played_at,
  trackUri: r.track_uri,
  trackName: r.track_name,
  artist: r.artist,
  album: r.album,
  msPlayed: r.ms_played,
  imageUrl: r.image_url,
  source: r.source,
});

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const expectUser = await getMeta('cloudUser');
  const post = async (forceRefresh: boolean) =>
    fetchWithTimeout(SYNC_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await getValidAccessToken(forceRefresh)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...body, ...(expectUser ? { expectUser } : {}) }),
    }, 60_000); // pages of up to 1000 plays each way
  let res = await post(false);
  if (res.status === 401) res = await post(true);
  if (res.status === 409) {
    throw new CloudSyncError(
      t('I dati su questo dispositivo sono di un altro account Spotify. Esci scegliendo «Esci ed elimina dati» e poi accedi di nuovo.'),
    );
  }
  if (res.status === 403) {
    throw new CloudSyncError(t('Sincronizzazione online non attiva: l’account non risulta registrato. Esci e accedi di nuovo.'));
  }
  if (!res.ok) throw new CloudSyncError(t('Sincronizzazione online non riuscita ({status})', { status: res.status }));
  return res.json() as Promise<T>;
}

/**
 * Sends the plays this device hasn't uploaded yet and downloads the ones added
 * by other devices. Returns how many local rows changed.
 */
async function run(): Promise<number> {
  if (!cloudEnabled) return 0;
  let changed = 0;
  let cursor = Number((await getMeta('cloudCursor')) ?? 0);
  const localImported = Number((await getMeta('importedUntil')) ?? 0);
  let remoteImported = 0;

  for (;;) {
    const pending = await getPlaysToUpload(PAGE);
    const res = await call<SyncResponse>({
      action: 'sync',
      push: pending.map(toRow),
      importedUntil: localImported,
      since: cursor,
    });
    if (!(await getMeta('cloudUser'))) await setMeta('cloudUser', res.user);
    await markUploaded(pending.map((p) => p.id));
    changed += await insertPlays(res.rows.map(fromRow), { uploaded: true });
    if (res.rows.length > 0) {
      cursor = res.rows[res.rows.length - 1].id;
      await setMeta('cloudCursor', String(cursor));
    }
    remoteImported = res.importedUntil;
    if (pending.length < PAGE && !res.more) break;
  }

  // Another device imported a newer export: its real data replaces our API estimates.
  if (remoteImported > localImported) {
    changed += await removeApiPlaysUpTo(remoteImported);
    await setMeta('importedUntil', String(remoteImported));
  }
  await setMeta('lastCloudSyncAt', String(Date.now()));
  return changed;
}

// The foreground timer, the Settings button and an import can overlap: share one run.
let running: Promise<number> | null = null;

export function cloudSync(): Promise<number> {
  running ??= run().finally(() => {
    running = null;
  });
  return running;
}

/** Deletes this account's plays from the cloud (used by "Esci ed elimina dati"). */
export async function wipeCloudData() {
  if (!cloudEnabled) return;
  await running?.catch(() => {});
  await call({ action: 'wipe' });
}
