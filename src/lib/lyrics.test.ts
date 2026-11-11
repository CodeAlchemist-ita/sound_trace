import { cleanTitle, fetchLyrics } from './lyrics';

jest.mock('./cloudSync', () => ({ SYNC_URL: '' }));
jest.mock('./spotify', () => ({ getValidAccessToken: jest.fn() }));

describe('cleanTitle', () => {
  it.each([
    ['Song (feat. Someone)', 'Song'],
    ['Song [ft. Someone Else]', 'Song'],
    ['Song (with Band)', 'Song'],
    ['Song - Remastered 2011', 'Song'],
    ['Song - 2011 Remaster', 'Song'],
    ['Song (Remastered)', 'Song'],
    ['Song - Live at Wembley', 'Song'],
    ['Song (Live)', 'Song'],
    ['Song - Radio Edit', 'Song'],
    ['Song - Single Version', 'Song'],
    ['Song - Mono', 'Song'],
    ['Song (Deluxe Edition)', 'Song'],
    ['Song - From "Movie"', 'Song'],
    ['Song (feat. A) - Remastered 2009', 'Song'],
    ['Plain Title', 'Plain Title'],
    ['Hello - Goodbye', 'Hello - Goodbye'],
  ])('%s -> %s', (input, expected) => {
    expect(cleanTitle(input)).toBe(expected);
  });

  it('never returns an empty title', () => {
    expect(cleanTitle('(feat. X)')).toBe('(feat. X)');
    expect(cleanTitle('   ')).not.toBeUndefined();
  });
});

const meta = { trackName: 'Song (Remastered)', artist: 'Main', album: 'Album', durationMs: 200_400 };
const signal = new AbortController().signal;

const reply = (status: number, body?: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

describe('fetchLyrics', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('finds the lyrics with /get, using the cleaned title and whole seconds', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { plainLyrics: ' la la\nla ', syncedLyrics: '[00:01.00] x' }));
    expect(await fetchLyrics(meta, signal)).toEqual({ status: 'found', text: 'la la\nla' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/get?');
    expect(url).toContain('track_name=Song');
    expect(url).not.toContain('Remastered');
    expect(url).toContain('album_name=Album');
    expect(url).toContain('duration=200');
    expect(init.headers['Lrclib-Client']).toBe('spotify-stats');
  });

  it('omits the album when there is none', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { plainLyrics: 'x' }));
    await fetchLyrics({ ...meta, album: null }, signal);
    expect(fetchMock.mock.calls[0][0]).not.toContain('album_name');
  });

  it('falls back to /search on 404, preferring a close duration', async () => {
    fetchMock.mockResolvedValueOnce(reply(404));
    fetchMock.mockResolvedValueOnce(
      reply(200, [
        { plainLyrics: '', duration: 200 },
        { plainLyrics: 'far', duration: 300 },
        { plainLyrics: 'near', duration: 202 },
      ]),
    );
    expect(await fetchLyrics(meta, signal)).toEqual({ status: 'found', text: 'near' });
    expect(fetchMock.mock.calls[1][0]).toContain('/api/search?');
  });

  it('reports instrumental songs', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { instrumental: true, plainLyrics: null }));
    expect(await fetchLyrics(meta, signal)).toEqual({ status: 'instrumental' });
  });

  it('reports not_found when search has nothing usable', async () => {
    fetchMock.mockResolvedValueOnce(reply(404));
    fetchMock.mockResolvedValueOnce(reply(200, [{ plainLyrics: '' }]));
    expect(await fetchLyrics(meta, signal)).toEqual({ status: 'not_found' });
  });

  it('throws on other HTTP errors', async () => {
    fetchMock.mockResolvedValueOnce(reply(500));
    await expect(fetchLyrics(meta, signal)).rejects.toThrow('LRCLIB 500');
  });
});
