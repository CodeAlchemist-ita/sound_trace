import {
  isStream,
  getArtistStats,
  getDb,
  getHourBuckets,
  getSummary,
  getTrackStats,
  type ArtistStat,
  type TrackStat,
} from './db';
import { aggregate, indexOfMax, longestStreak, topDay } from './timeStats';

/** Data behind the yearly "story" recap (the app's take on a year-in-music review). */

export type PartOfDay = 'mattina' | 'pomeriggio' | 'sera' | 'notte';

export type YearRecap = {
  year: number;
  /** True while the year isn't over: numbers are "so far". */
  partial: boolean;
  totalMs: number;
  streams: number;
  uniqueTracks: number;
  uniqueArtists: number;
  topTracks: TrackStat[];
  topArtists: ArtistStat[];
  firstPlay: { trackName: string; artist: string; playedAt: number; imageUrl: string | null } | null;
  /** Most listened song of the record month. */
  topMonthTrack: TrackStat | null;
  /** Milliseconds listened per month (0 = January) and per hour of the day, local time. */
  months: number[];
  hours: number[];
  topMonth: number;
  partOfDay: { name: PartOfDay; share: number };
  daysListened: number;
  daysInPeriod: number;
  longestStreak: { days: number; start: number; end: number } | null;
  topDay: { date: number; ms: number } | null;
  /** Artists played for the first time ever this year (meaningful only if hasEarlierHistory). */
  newArtists: number;
  hasEarlierHistory: boolean;
  /** Share of minutes that went to the top 5 artists. */
  top5Share: number;
  /** Same stretch of the year before (Jan 1st → today's date, or the whole year). */
  previous: { year: number; totalMs: number; streams: number; uniqueArtists: number } | null;
  personality: Personality;
};

export type Personality = 'repeat' | 'fedele' | 'esploratore' | 'eclettico';

const DAY = 86_400_000;

/** Years that have at least one play, newest first. */
export async function getRecapYears(): Promise<number[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ t: number }>(
    // One representative timestamp per quarter keeps this cheap on big histories.
    `SELECT MIN(played_at) AS t FROM plays GROUP BY played_at / ${(365 * DAY) / 4}`,
  );
  const years = new Set(rows.map((r) => new Date(r.t).getFullYear()));
  return [...years].sort((a, b) => b - a);
}

export async function getYearRecap(year: number, now = Date.now()): Promise<YearRecap> {
  const db = await getDb();
  const from = new Date(year, 0, 1).getTime();
  const endOfYear = new Date(year + 1, 0, 1).getTime() - 1;
  const to = Math.min(endOfYear, now);

  // Same stretch of last year, for "+12% vs 2025".
  const prevFrom = new Date(year - 1, 0, 1).getTime();
  const nowDate = new Date(to);
  const prevTo =
    to === endOfYear
      ? from - 1
      : new Date(year - 1, nowDate.getMonth(), nowDate.getDate(), nowDate.getHours(), nowDate.getMinutes()).getTime();

  const countArtists = (a: number, b: number) =>
    db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(DISTINCT lower(artist)) AS n FROM plays
       WHERE played_at >= ? AND played_at <= ? AND ${isStream()}`,
      [a, b],
    );

  const [summary, topTracks, topArtists, artistsCount, first, buckets, firstEver, newArtists, prevSummary, prevArtists] =
    await Promise.all([
    getSummary(from, to),
    getTrackStats(from, to, 'time', { limit: 5 }),
    getArtistStats(from, to, 'time', { limit: 5 }),
    countArtists(from, to),
    db.getFirstAsync<{ trackName: string; artist: string; playedAt: number; imageUrl: string | null }>(
      `SELECT track_name AS trackName, artist, played_at AS playedAt, NULLIF(image_url, '') AS imageUrl FROM plays
       WHERE played_at >= ? AND played_at <= ? AND ${isStream()}
       ORDER BY played_at LIMIT 1`,
      [from, to],
    ),
    getHourBuckets(from, to),
    db.getFirstAsync<{ t: number | null }>(`SELECT MIN(played_at) AS t FROM plays`),
    db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM (
         SELECT MIN(played_at) AS first FROM plays WHERE ${isStream()} GROUP BY lower(artist)
       ) WHERE first >= ? AND first <= ?`,
      [from, to],
    ),
    getSummary(prevFrom, prevTo),
    countArtists(prevFrom, prevTo),
  ]);

  const t = aggregate(buckets);
  const topMonth = indexOfMax(t.months);
  const [topMonthTrack] = await getTrackStats(
    new Date(year, topMonth, 1).getTime(),
    Math.min(to, new Date(year, topMonth + 1, 1).getTime() - 1),
    'time',
    { limit: 1 },
  );

  const top5Ms = topArtists.reduce((sum, x) => sum + x.totalMs, 0);
  const top5Share = summary.totalMs > 0 ? top5Ms / summary.totalMs : 0;
  const uniqueArtists = artistsCount?.n ?? 0;
  const hasEarlierHistory = (firstEver?.t ?? from) < from;
  const repeat = summary.uniqueTracks > 0 ? summary.streams / summary.uniqueTracks : 0;
  const discovery = uniqueArtists > 0 ? (newArtists?.n ?? 0) / uniqueArtists : 0;

  return {
    year,
    partial: now < endOfYear,
    totalMs: summary.totalMs,
    streams: summary.streams,
    uniqueTracks: summary.uniqueTracks,
    uniqueArtists,
    topTracks,
    topArtists,
    firstPlay: first ?? null,
    topMonthTrack: topMonthTrack ?? null,
    months: t.months,
    hours: t.hours,
    topMonth,
    partOfDay: partOfDay(t.hours),
    daysListened: t.days.size,
    daysInPeriod: Math.max(1, Math.round((to - from) / DAY)),
    longestStreak: longestStreak(t.days.keys()),
    topDay: topDay(t.days),
    newArtists: newArtists?.n ?? 0,
    hasEarlierHistory,
    top5Share,
    previous:
      prevSummary.totalMs > 0
        ? { year: year - 1, totalMs: prevSummary.totalMs, streams: prevSummary.streams, uniqueArtists: prevArtists?.n ?? 0 }
        : null,
    personality:
      repeat >= 8 ? 'repeat' : top5Share >= 0.5 ? 'fedele' : hasEarlierHistory && discovery >= 0.4 ? 'esploratore' : 'eclettico',
  };
}

const PARTS: { name: PartOfDay; hours: number[] }[] = [
  { name: 'mattina', hours: [6, 7, 8, 9, 10, 11] },
  { name: 'pomeriggio', hours: [12, 13, 14, 15, 16, 17] },
  { name: 'sera', hours: [18, 19, 20, 21, 22, 23] },
  { name: 'notte', hours: [0, 1, 2, 3, 4, 5] },
];

export function partOfDay(hours: number[]) {
  const total = hours.reduce((a, b) => a + b, 0) || 1;
  const scored = PARTS.map((p) => ({ name: p.name, share: p.hours.reduce((a, h) => a + hours[h], 0) / total }));
  return scored.reduce((a, b) => (b.share > a.share ? b : a));
}
