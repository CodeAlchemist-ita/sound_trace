import { parseHistory } from './importHistory';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-sqlite', () => require('@/testing/fakeSqlite'));

describe('parseHistory', () => {
  it('reads the extended streaming history', () => {
    const plays = parseHistory([
      {
        ts: '2026-01-03T20:13:45Z',
        ms_played: 187_000,
        master_metadata_track_name: 'Song',
        master_metadata_album_artist_name: 'Artist',
        master_metadata_album_album_name: 'Album',
        spotify_track_uri: 'spotify:track:abc',
      },
    ]);
    expect(plays).toEqual([
      {
        playedAt: Date.UTC(2026, 0, 3, 20, 13, 45),
        trackUri: 'spotify:track:abc',
        trackName: 'Song',
        artist: 'Artist',
        album: 'Album',
        msPlayed: 187_000,
        imageUrl: null,
        source: 'import',
      },
    ]);
  });

  it('reads the basic account-data export, whose times are UTC', () => {
    const plays = parseHistory([{ endTime: '2026-01-03 20:13', artistName: 'Artist', trackName: 'Song', msPlayed: 42_000 }]);
    expect(plays).toEqual([
      {
        playedAt: Date.UTC(2026, 0, 3, 20, 13),
        trackUri: null,
        trackName: 'Song',
        artist: 'Artist',
        album: null,
        msPlayed: 42_000,
        imageUrl: null,
        source: 'import',
      },
    ]);
  });

  it('skips podcasts and audiobooks, which have no track name', () => {
    const plays = parseHistory([
      { ts: '2026-01-03T20:13:45Z', ms_played: 600_000, master_metadata_track_name: null, master_metadata_album_artist_name: null },
      { ts: '2026-01-03T21:00:00Z', ms_played: 60_000, master_metadata_track_name: 'Song', master_metadata_album_artist_name: null },
    ]);
    expect(plays).toEqual([]);
  });

  it('drops rows with a date it cannot read and ignores unknown shapes', () => {
    const plays = parseHistory([
      { ts: 'not a date', ms_played: 1, master_metadata_track_name: 'A', master_metadata_album_artist_name: 'B' },
      { something: 'else' },
      { endTime: '2026-02-01 08:00', artistName: 'Artist', trackName: 'Kept', msPlayed: 1 },
    ]);
    expect(plays.map((p) => p.trackName)).toEqual(['Kept']);
  });

  it('keeps skipped plays: the threshold is applied when counting, not when importing', () => {
    const [p] = parseHistory([{ endTime: '2026-02-01 08:00', artistName: 'Artist', trackName: 'Skipped', msPlayed: 900 }]);
    expect(p.msPlayed).toBe(900);
  });

  it('refuses a file that is not a list', () => {
    expect(() => parseHistory({ items: [] })).toThrow();
    expect(() => parseHistory(null)).toThrow();
  });

  it('accepts an empty history', () => {
    expect(parseHistory([])).toEqual([]);
  });
});
