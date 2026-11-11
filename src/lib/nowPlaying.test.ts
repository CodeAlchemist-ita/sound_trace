import { currentProgress, nextPollDelay, parseNowPlaying, type CurrentlyPlayingResponse, type NowPlaying } from './nowPlaying';

const track = {
  id: '1',
  uri: 'spotify:track:1',
  name: 'Song',
  duration_ms: 200_000,
  artists: [{ name: 'Main' }, { name: 'Featured' }],
  album: {
    name: 'Album',
    images: [
      { url: 'big', width: 640, height: 640 },
      { url: 'medium', width: 300, height: 300 },
      { url: 'small', width: 64, height: 64 },
    ],
  },
};

const playing = (over: Partial<NowPlaying> = {}): NowPlaying => ({
  trackId: '1',
  trackName: 'Song',
  artist: 'Main',
  album: 'Album',
  imageUrl: null,
  isPlaying: true,
  progressMs: 60_000,
  durationMs: 200_000,
  fetchedAt: 1_000_000,
  ...over,
});

describe('parseNowPlaying', () => {
  it('reads the song, its main artist and the sharp small cover', () => {
    const body: CurrentlyPlayingResponse = { is_playing: true, progress_ms: 12_345, currently_playing_type: 'track', item: track };
    expect(parseNowPlaying(body, 99)).toEqual({
      trackId: '1',
      trackName: 'Song',
      artist: 'Main',
      album: 'Album',
      imageUrl: 'medium',
      isPlaying: true,
      progressMs: 12_345,
      durationMs: 200_000,
      fetchedAt: 99,
    });
  });

  it('falls back to name|artist when the id is missing (local files)', () => {
    expect(parseNowPlaying({ is_playing: true, item: { ...track, id: '' } })?.trackId).toBe('Song|Main');
  });

  it('keeps a paused song, marked as not playing', () => {
    expect(parseNowPlaying({ is_playing: false, progress_ms: 5, item: track })?.isPlaying).toBe(false);
  });

  it('is null when nothing is playing', () => {
    expect(parseNowPlaying(null)).toBeNull();
    expect(parseNowPlaying(undefined)).toBeNull();
    expect(parseNowPlaying({ is_playing: true, item: null })).toBeNull();
  });

  it('ignores podcasts and ads', () => {
    expect(parseNowPlaying({ is_playing: true, currently_playing_type: 'episode', item: track })).toBeNull();
    expect(parseNowPlaying({ is_playing: true, currently_playing_type: 'ad', item: track })).toBeNull();
  });

  it('copes with missing details', () => {
    const bare = { ...track, artists: [], album: { name: 'Album', images: [] } };
    expect(parseNowPlaying({ is_playing: true, progress_ms: null, item: bare })).toMatchObject({
      artist: '',
      imageUrl: null,
      progressMs: 0,
    });
  });
});

describe('currentProgress', () => {
  it('moves forward with the clock while playing', () => {
    expect(currentProgress(playing(), 1_000_000 + 15_000)).toBe(75_000);
  });

  it('stays still while paused', () => {
    expect(currentProgress(playing({ isPlaying: false }), 1_000_000 + 15_000)).toBe(60_000);
  });

  it('never passes the end of the song or goes below zero', () => {
    expect(currentProgress(playing(), 1_000_000 + 500_000)).toBe(200_000);
    expect(currentProgress(playing({ progressMs: 10 }), 1_000_000 - 5_000)).toBe(0);
  });
});

describe('nextPollDelay', () => {
  it('asks again every 20 seconds in the middle of a song', () => {
    expect(nextPollDelay(playing(), 1_000_000)).toBe(20_000);
  });

  it('asks right after the song ends when that comes sooner', () => {
    expect(nextPollDelay(playing({ progressMs: 190_000 }), 1_000_000)).toBe(11_500);
  });

  it('never asks more often than every 3 seconds', () => {
    expect(nextPollDelay(playing({ progressMs: 199_900 }), 1_000_000)).toBe(3_000);
  });

  it('slows down when paused or silent', () => {
    expect(nextPollDelay(playing({ isPlaying: false }), 1_000_000)).toBe(30_000);
    expect(nextPollDelay(null)).toBe(30_000);
  });
});
