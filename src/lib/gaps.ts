import { getDb, getMeta, setMeta } from './db';

/**
 * Spotify only exposes the last 50 plays. If a sync finds 50 plays that are all newer
 * than the newest one seen before, some plays in between may be lost: we remember that
 * window so the app can suggest importing the Spotify history, which fills it.
 */
export type Gap = { from: number; to: number; detectedAt: number };

const KEY = 'gaps';
const MAX_GAPS = 20;

async function readGaps(): Promise<Gap[]> {
  const raw = await getMeta(KEY);
  try {
    return raw ? (JSON.parse(raw) as Gap[]) : [];
  } catch {
    return [];
  }
}

export async function addGap(from: number, to: number) {
  const gaps = await readGaps();
  gaps.push({ from, to, detectedAt: Date.now() });
  await setMeta(KEY, JSON.stringify(gaps.slice(-MAX_GAPS)));
}

/** Gaps not yet covered by an imported history. */
export async function getOpenGaps(): Promise<Gap[]> {
  const importedUntil = Number((await getMeta('importedUntil')) ?? 0);
  return (await readGaps()).filter((g) => g.to > importedUntil);
}

export async function dismissGaps() {
  await setMeta(KEY, '[]');
}

/**
 * Called by every sync with the timestamps Spotify returned (newest 50 at most).
 * `full` = Spotify returned a full page, so older plays may exist beyond it.
 */
export async function checkForGap(times: number[], full: boolean) {
  if (times.length === 0) return;
  const oldest = Math.min(...times);
  // Newest play we already have before this page: seen by this device, or synced
  // from another device (e.g. the phone's background sync while the PC was off).
  const db = await getDb();
  const stored = await db.getFirstAsync<{ t: number | null }>(`SELECT MAX(played_at) AS t FROM plays WHERE played_at < ?`, [
    oldest,
  ]);
  const seen = Number((await getMeta('lastApiPlayAt')) ?? 0);
  const last = Math.max(seen, stored?.t ?? 0);
  // First sync ever (last = 0): older plays are covered by the "missing history" banner.
  // A few minutes between two plays is normal (pauses), not a sign of lost plays.
  if (seen > 0 && full && oldest - last > 10 * 60_000) await addGap(last, oldest);
  await setMeta('lastApiPlayAt', String(Math.max(seen, ...times)));
}
