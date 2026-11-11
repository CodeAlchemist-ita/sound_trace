import { cleanTitle, fetchLyrics, looseTitle, lyricsSearchUrl, normalize, stripTimestamps } from './lyrics';

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
    expect(init.headers['Lrclib-Client']).toBe('soundtrace');
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
        { trackName: 'Song', artistName: 'Main', plainLyrics: '', duration: 200 },
        { trackName: 'Song', artistName: 'Main', plainLyrics: 'far', duration: 210 },
        { trackName: 'Song', artistName: 'Main', plainLyrics: 'near', duration: 202 },
      ]),
    );
    expect(await fetchLyrics(meta, signal)).toEqual({ status: 'found', text: 'near' });
    expect(fetchMock.mock.calls[1][0]).toContain('/api/search?');
  });

  it('uses synced lyrics without timestamps when there is no plain text', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { plainLyrics: null, syncedLyrics: '[00:01.00] one\n[00:02.50]two' }));
    expect(await fetchLyrics(meta, signal)).toEqual({ status: 'found', text: 'one\ntwo' });
  });

  it('retries with a looser title, then free text matching the artist', async () => {
    const m = { ...meta, trackName: 'Song - Acoustic Session' };
    fetchMock.mockResolvedValueOnce(reply(404)); // get
    fetchMock.mockResolvedValueOnce(reply(200, [])); // search full title
    fetchMock.mockResolvedValueOnce(reply(200, [])); // search loose title
    fetchMock.mockResolvedValueOnce(
      reply(200, [
        { trackName: 'Other', artistName: 'Someone Else', plainLyrics: 'wrong' },
        { trackName: 'Sóng', artistName: 'MAIN & Friends', plainLyrics: 'right', duration: 199 },
      ]),
    );
    expect(await fetchLyrics(m, signal)).toEqual({ status: 'found', text: 'right' });
    expect(fetchMock.mock.calls[2][0]).toContain('track_name=Song&');
    expect(fetchMock.mock.calls[3][0]).toContain('q=Song+Main');
  });

  it('ignores results with a very different duration', async () => {
    fetchMock.mockResolvedValueOnce(reply(404));
    fetchMock.mockResolvedValue(reply(200, [{ trackName: 'Song', artistName: 'Main', plainLyrics: 'x', duration: 400 }]));
    expect(await fetchLyrics(meta, signal)).toEqual({ status: 'not_found' });
  });

  it('reports instrumental songs', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { instrumental: true, plainLyrics: null }));
    expect(await fetchLyrics(meta, signal)).toEqual({ status: 'instrumental' });
  });

  it('reports not_found when search has nothing usable', async () => {
    fetchMock.mockResolvedValueOnce(reply(404));
    fetchMock.mockResolvedValue(reply(200, [{ trackName: 'Song', artistName: 'Main', plainLyrics: '' }]));
    expect(await fetchLyrics(meta, signal)).toEqual({ status: 'not_found' });
  });

  it('throws on other HTTP errors', async () => {
    fetchMock.mockResolvedValueOnce(reply(500));
    await expect(fetchLyrics(meta, signal)).rejects.toThrow('LRCLIB 500');
  });
});

describe('helpers', () => {
  it('looseTitle drops brackets and dash suffixes', () => {
    expect(looseTitle('Song (Acoustic) - Session 3')).toBe('Song');
    expect(looseTitle('(Intro)')).toBe('(Intro)');
  });
  it('normalize ignores accents, case and punctuation', () => {
    expect(normalize('Beyoncé & JAY-Z')).toBe('beyonce and jay z');
  });
  it('stripTimestamps removes every leading tag', () => {
    expect(stripTimestamps('[ar:x]\n[00:01.00][00:30.00] hi')).toBe('hi');
  });
  it('lyricsSearchUrl builds an encoded web search', () => {
    expect(lyricsSearchUrl('Song (feat. X)', 'A & B')).toBe('https://www.google.com/search?q=Song%20A%20%26%20B%20testo');
  });
});
