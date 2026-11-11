import {
  clearAllData,
  countDiscoveries,
  countSkips,
  getAlbumStats,
  getArtistStats,
  getForgottenTracks,
  getHourBuckets,
  getItemSummary,
  getRecentPlays,
  getSessionStats,
  getSummary,
  getTrackStats,
  insertPlays,
  removeApiPlaysUpTo,
  type Play,
} from './db';
import { getYearRecap, partOfDay } from './recap';
import { resetSettingsForTests } from './settings';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-sqlite', () => require('@/testing/fakeSqlite'));

const MIN = 60_000;
/** Local time, so the tests don't depend on the machine's time zone. */
const at = (month: number, day: number, hour = 12, minute = 0, year = 2026) => new Date(year, month - 1, day, hour, minute).getTime();

function play(playedAt: number, trackName: string, artist: string, msPlayed: number, extra: Partial<Play> = {}): Play {
  return { playedAt, trackUri: null, trackName, artist, album: null, msPlayed, imageUrl: null, source: 'import', ...extra };
}

const ALL = [0, at(12, 31, 23, 59, 2030)] as const;

beforeEach(async () => {
  resetSettingsForTests();
  await clearAllData();
});

describe('insertPlays', () => {
  it('ignores a play that is already saved', async () => {
    const p = play(at(1, 5), 'Song', 'Artist', 3 * MIN);
    expect(await insertPlays([p])).toBe(1);
    expect(await insertPlays([p, play(at(1, 6), 'Song', 'Artist', 3 * MIN)])).toBe(1);
    expect((await getSummary(...ALL)).streams).toBe(2);
  });

  it('handles more rows than one batch', async () => {
    const many = Array.from({ length: 1203 }, (_, i) => play(at(1, 1) + i * 5 * MIN, `Song ${i % 7}`, 'Artist', 3 * MIN));
    expect(await insertPlays(many)).toBe(1203);
    expect((await getSummary(...ALL)).streams).toBe(1203);
  });
});

describe('getSummary', () => {
  it('adds up all the time, but counts as listens only plays of 30 seconds or more', async () => {
    await insertPlays([
      play(at(1, 5, 10), 'A', 'X', 3 * MIN),
      play(at(1, 5, 11), 'A', 'X', 10_000), // skipped
      play(at(1, 6, 10), 'B', 'X', 30_000), // exactly 30 s counts
    ]);
    const s = await getSummary(...ALL);
    expect(s.totalMs).toBe(3 * MIN + 10_000 + 30_000);
    expect(s.streams).toBe(2);
    expect(s.uniqueTracks).toBe(2);
    expect(s.firstPlayAt).toBe(at(1, 5, 10));
    expect(s.lastPlayAt).toBe(at(1, 6, 10));
  });

  it('always counts plays read live from Spotify, whose length is unknown', async () => {
    await insertPlays([play(at(1, 5), 'Interlude', 'X', 12_000, { source: 'api' })]);
    expect((await getSummary(...ALL)).streams).toBe(1);
  });

  it('only looks inside the period', async () => {
    await insertPlays([play(at(1, 5), 'A', 'X', 3 * MIN), play(at(3, 5), 'B', 'X', 3 * MIN)]);
    expect((await getSummary(at(2, 1), at(4, 1))).streams).toBe(1);
  });

  it('returns zeros when there is nothing', async () => {
    expect(await getSummary(...ALL)).toEqual({ totalMs: 0, streams: 0, uniqueTracks: 0, firstPlayAt: null, lastPlayAt: null });
  });
});

describe('the listen threshold chosen in Settings', () => {
  beforeEach(async () => {
    await insertPlays([
      play(at(1, 5, 10), 'Short', 'X', 15_000),
      play(at(1, 5, 11), 'Medium', 'X', 45_000),
      play(at(1, 5, 12), 'Long', 'X', 4 * MIN),
    ]);
  });

  it.each([
    [10, 3],
    [30, 2],
    [60, 1],
  ])('with %i seconds, %i plays count', async (minStreamSec, expected) => {
    resetSettingsForTests({ minStreamSec });
    expect((await getSummary(...ALL)).streams).toBe(expected);
    expect(await getTrackStats(...ALL, 'plays')).toHaveLength(expected);
  });

  it('moves the line between listened and skipped', async () => {
    expect(await countSkips(...ALL)).toEqual({ skipped: 1, total: 3 });
    resetSettingsForTests({ minStreamSec: 60 });
    expect(await countSkips(...ALL)).toEqual({ skipped: 2, total: 3 });
  });
});

describe('getTrackStats', () => {
  beforeEach(async () => {
    await insertPlays([
      play(at(1, 1, 10), 'Alpha', 'Band', 5 * MIN, { album: 'First' }),
      play(at(1, 2, 10), 'alpha', 'BAND', 5 * MIN, { album: 'First' }), // same song, different capitals
      play(at(1, 3, 10), 'Beta', 'Band', 2 * MIN, { album: 'First' }),
      play(at(1, 4, 10), 'Beta', 'Band', 2 * MIN, { album: 'First' }),
      play(at(1, 5, 10), 'Beta', 'Band', 2 * MIN, { album: 'First' }),
      play(at(1, 6, 10), 'Gamma', 'Solo', 1 * MIN, { album: 'Other' }),
      play(at(1, 7, 10), 'Skipped', 'Solo', 5_000),
    ]);
  });

  it('groups a song by title and artist, whatever the capitals', async () => {
    const alpha = (await getTrackStats(...ALL, 'plays')).find((t) => t.trackName.toLowerCase() === 'alpha');
    expect(alpha?.plays).toBe(2);
    expect(alpha?.totalMs).toBe(10 * MIN);
  });

  it('sorts by listens or by time', async () => {
    expect((await getTrackStats(...ALL, 'plays')).map((t) => t.trackName)[0]).toBe('Beta');
    expect((await getTrackStats(...ALL, 'time')).map((t) => t.trackName.toLowerCase())[0]).toBe('alpha');
  });

  it('leaves out songs that were only skipped', async () => {
    expect((await getTrackStats(...ALL, 'plays')).map((t) => t.trackName)).not.toContain('Skipped');
  });

  it('searches title, artist and album, and respects the limit', async () => {
    expect(await getTrackStats(...ALL, 'plays', { search: 'solo' })).toHaveLength(1);
    expect(await getTrackStats(...ALL, 'plays', { search: 'first' })).toHaveLength(2);
    expect(await getTrackStats(...ALL, 'plays', { limit: 1 })).toHaveLength(1);
  });

  it('narrows to one artist or one album', async () => {
    expect(await getTrackStats(...ALL, 'plays', { artist: 'band' })).toHaveLength(2);
    expect(await getTrackStats(...ALL, 'plays', { artist: 'Solo', album: 'Other' })).toHaveLength(1);
  });

  it('counts artists and albums the same way', async () => {
    const artists = await getArtistStats(...ALL, 'plays');
    expect(artists.map((a) => [a.artist.toLowerCase(), a.plays, a.tracks])).toEqual([
      ['band', 5, 2],
      ['solo', 1, 1],
    ]);
    const albums = await getAlbumStats(...ALL, 'plays');
    expect(albums.map((a) => [a.album, a.plays])).toEqual([
      ['First', 5],
      ['Other', 1],
    ]);
  });

  it('summarises one song or one artist', async () => {
    const song = await getItemSummary({ artist: 'Band', trackName: 'Beta' });
    expect(song).toMatchObject({ plays: 3, totalMs: 6 * MIN, firstAt: at(1, 3, 10), lastAt: at(1, 5, 10) });
    expect((await getItemSummary({ artist: 'Band' })).uniqueTracks).toBe(2);
    expect((await getItemSummary({ artist: 'Nobody' })).plays).toBe(0);
  });

  it('lists the latest plays first, skips included', async () => {
    const recent = await getRecentPlays(3);
    expect(recent.map((p) => p.trackName)).toEqual(['Skipped', 'Gamma', 'Beta']);
    expect(await getRecentPlays(10, 0, { artist: 'Solo' })).toHaveLength(2);
  });
});

describe('importing the Spotify history over plays read live', () => {
  it('replaces the estimates of the imported period and keeps the later ones', async () => {
    await insertPlays([
      play(at(1, 5), 'A', 'X', 3 * MIN, { source: 'api' }),
      play(at(1, 20), 'B', 'X', 3 * MIN, { source: 'api' }),
    ]);
    await insertPlays([play(at(1, 5, 12, 1), 'A', 'X', 95_000)]);
    expect(await removeApiPlaysUpTo(at(1, 10))).toBe(1);
    const s = await getSummary(...ALL);
    expect(s.streams).toBe(2);
    expect(s.totalMs).toBe(95_000 + 3 * MIN);
  });
});

describe('discoveries, sessions and forgotten songs', () => {
  it('counts songs and artists first heard in the period', async () => {
    await insertPlays([
      play(at(1, 5, 12, 0, 2025), 'Old', 'Veteran', 3 * MIN),
      play(at(2, 1), 'Old', 'Veteran', 3 * MIN),
      play(at(2, 2), 'New', 'Veteran', 3 * MIN),
      play(at(2, 3), 'Fresh', 'Newcomer', 3 * MIN),
    ]);
    expect(await countDiscoveries(at(1, 1), at(12, 31))).toEqual({ tracks: 2, artists: 1 });
  });

  it('splits sessions after 30 minutes without music', async () => {
    const start = at(3, 1, 9);
    await insertPlays([
      play(start, 'A', 'X', 3 * MIN),
      play(start + 4 * MIN, 'B', 'X', 3 * MIN),
      play(start + 8 * MIN, 'C', 'X', 3 * MIN),
      // 31 minutes later: a new session.
      play(start + 39 * MIN, 'D', 'X', 4 * MIN),
    ]);
    const s = await getSessionStats(...ALL);
    expect(s.sessions).toBe(2);
    expect(s.avgTracks).toBe(2);
    expect(s.longest).toMatchObject({ tracks: 3, ms: 9 * MIN, start });
  });

  it('has no sessions without plays', async () => {
    expect(await getSessionStats(...ALL)).toEqual({ sessions: 0, avgTracks: 0, avgMs: 0, longest: null });
  });

  it('finds songs played a lot and then abandoned', async () => {
    const often = Array.from({ length: 5 }, (_, i) => play(at(1, 1 + i), 'Anthem', 'X', 3 * MIN));
    const stillPlayed = Array.from({ length: 5 }, (_, i) => play(at(6, 1 + i), 'Current', 'X', 3 * MIN));
    await insertPlays([...often, ...stillPlayed, play(at(1, 2, 15), 'Once', 'X', 3 * MIN)]);
    const forgotten = await getForgottenTracks(5, at(4, 1), 10);
    expect(forgotten.map((t) => t.trackName)).toEqual(['Anthem']);
    expect(forgotten[0].lastAt).toBe(at(1, 5));
  });

  it('groups listening time by hour', async () => {
    await insertPlays([play(at(1, 5, 10, 5), 'A', 'X', 3 * MIN), play(at(1, 5, 10, 40), 'B', 'X', 2 * MIN), play(at(1, 5, 12), 'C', 'X', MIN)]);
    const buckets = await getHourBuckets(...ALL);
    expect(buckets.map((b) => [b.ms, b.n]).sort()).toEqual([
      [5 * MIN, 2],
      [MIN, 1],
    ].sort());
  });
});

describe('the yearly recap', () => {
  it('describes a finished year', async () => {
    const plays: Play[] = [];
    // January: 3 plays of the top song in the morning. March: a longer month, in the evening.
    for (let d = 1; d <= 3; d++) plays.push(play(at(1, d, 8, 0, 2025), 'Opener', 'Main', 4 * MIN));
    for (let d = 1; d <= 6; d++) plays.push(play(at(3, d, 21, 0, 2025), 'Hit', 'Main', 5 * MIN));
    plays.push(play(at(3, 10, 21, 0, 2025), 'Side', 'Guest', 2 * MIN));
    await insertPlays(plays);

    const r = await getYearRecap(2025, at(6, 1, 12, 0, 2026));
    expect(r.partial).toBe(false);
    expect(r.streams).toBe(10);
    expect(r.totalMs).toBe(3 * 4 * MIN + 6 * 5 * MIN + 2 * MIN);
    expect(r.uniqueArtists).toBe(2);
    expect(r.firstPlay?.trackName).toBe('Opener');
    expect(r.topTracks[0].trackName).toBe('Hit');
    expect(r.topArtists[0].artist).toBe('Main');
    expect(r.topMonth).toBe(2); // March
    expect(r.topMonthTrack?.trackName).toBe('Hit');
    expect(r.partOfDay.name).toBe('sera');
    expect(r.daysListened).toBe(10);
    expect(r.longestStreak?.days).toBe(6);
    expect(r.previous).toBeNull();
    expect(r.hasEarlierHistory).toBe(false);
  });

  it('compares a year in progress with the same stretch of the year before', async () => {
    await insertPlays([
      play(at(2, 1, 12, 0, 2025), 'A', 'X', 10 * MIN),
      // After "today's date" one year earlier: must not be compared.
      play(at(11, 1, 12, 0, 2025), 'A', 'X', 50 * MIN),
      play(at(2, 1, 12, 0, 2026), 'A', 'X', 20 * MIN),
    ]);
    const r = await getYearRecap(2026, at(6, 1, 12, 0, 2026));
    expect(r.partial).toBe(true);
    expect(r.previous).toMatchObject({ year: 2025, totalMs: 10 * MIN, streams: 1 });
    expect(r.hasEarlierHistory).toBe(true);
    expect(r.newArtists).toBe(0);
  });
});

describe('partOfDay', () => {
  it('picks the part of the day with the most listening and its share', () => {
    const hours = new Array<number>(24).fill(0);
    hours[7] = 30;
    hours[22] = 60;
    hours[23] = 10;
    expect(partOfDay(hours)).toEqual({ name: 'sera', share: 0.7 });
  });

  it('does not divide by zero on an empty day', () => {
    expect(partOfDay(new Array<number>(24).fill(0)).share).toBe(0);
  });
});
