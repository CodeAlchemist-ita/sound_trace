import { SYNC_URL } from './cloudSync';
import { getValidAccessToken } from './spotify';

// Lyrics and translations are never saved anywhere: they live in React state only.

const LRCLIB = 'https://lrclib.net/api';
const LRCLIB_HEADERS = { 'Lrclib-Client': 'spotify-stats' };

export const TRANSLATE_URL =
  process.env.EXPO_PUBLIC_TRANSLATE_URL || (SYNC_URL ? SYNC_URL.replace(/\/sync\/?$/, '/translate') : '');

export type LyricsMeta = { trackName: string; artist: string; album: string | null; durationMs: number };
export type LyricsResult = { status: 'found'; text: string } | { status: 'instrumental' } | { status: 'not_found' };

const SUFFIXES: RegExp[] = [
  // (feat. X) [ft. X] (with X)
  /\s*[([]\s*(?:feat\.?|featuring|ft\.?|with)\s[^)\]]*[)\]]/gi,
  // (Remastered 2011) (Live at …) (Deluxe Edition) (Radio Edit) (Mono) (… Version)
  /\s*[([][^)\]]*(?:remaster(?:ed)?|live|deluxe|radio edit|mono|stereo|version)[^)\]]*[)\]]/gi,
  // - From "Movie"
  /\s+-\s+from\s+["“].*$/i,
  // - Remastered 2011 / - 2011 Remaster / - Live at … / - Radio Edit / - Mono / - Stereo
  /\s+-\s+(?:\d{4}\s+)?(?:remaster(?:ed)?|live|radio edit|mono|stereo)\b.*$/i,
  // - Single Version / - Album Version / - Something Version
  /\s+-\s+[^-]*\bversion$/i,
];

/** Strips the extras streaming services add to titles, so LRCLIB finds the song. */
export function cleanTitle(title: string): string {
  let out = title;
  for (const re of SUFFIXES) out = out.replace(re, '');
  out = out.trim();
  return out || title.trim() || title;
}

export class LyricsError extends Error {
  /** 'not_configured' | 'quota' | 'too_long' | 'failed' */
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

type LrclibItem = {
  trackName?: string | null;
  artistName?: string | null;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
  instrumental?: boolean;
  duration?: number | null;
};

/** Looser title for the last attempts: drops every bracket and anything after " - ". */
export function looseTitle(title: string): string {
  const out = cleanTitle(title)
    .replace(/\s*[([{][^)\]}]*[)\]}]/g, '')
    .replace(/\s+[-–—]\s+.*$/, '')
    .trim();
  return out || cleanTitle(title);
}

/** Lowercase, no accents, no punctuation: for comparing names. */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Synced lyrics without the [mm:ss.xx] timestamps, for entries that have no plain text. */
export function stripTimestamps(synced: string): string {
  return synced
    .split('\n')
    .map((line) => line.replace(/^(?:\s*\[[^\]]*\])+\s?/, ''))
    .join('\n')
    .trim();
}

function textOf(item: LrclibItem): string {
  const plain = item.plainLyrics?.trim();
  if (plain) return plain;
  return item.syncedLyrics ? stripTimestamps(item.syncedLyrics) : '';
}

function toResult(item: LrclibItem): LyricsResult | null {
  if (item.instrumental) return { status: 'instrumental' };
  const text = textOf(item);
  return text ? { status: 'found', text } : null;
}

/** Picks the search result that best matches artist, title and duration; null if none is plausible. */
function pick(items: LrclibItem[], meta: LyricsMeta, seconds: number, requireArtist: boolean): LrclibItem | null {
  const artist = normalize(meta.artist);
  const title = normalize(looseTitle(meta.trackName));
  let best: { item: LrclibItem; score: number } | null = null;
  for (const item of items) {
    if (!item.instrumental && !textOf(item)) continue;
    const a = normalize(item.artistName ?? '');
    const artistOk = !!artist && !!a && (a.includes(artist) || artist.includes(a));
    if (requireArtist && !artistOk) continue;
    const t = normalize(looseTitle(item.trackName ?? ''));
    const titleOk = !!t && (t === title || t.includes(title) || title.includes(t));
    if (!requireArtist && !titleOk) continue;
    const diff = item.duration != null && seconds > 0 ? Math.abs(item.duration - seconds) : null;
    if (diff != null && diff > 15) continue;
    const score = (artistOk ? 4 : 0) + (titleOk ? 2 : 0) + (diff != null && diff <= 3 ? 3 : 0) + (item.instrumental ? 0 : 1);
    if (!best || score > best.score) best = { item, score };
  }
  return best?.item ?? null;
}

async function lrclib(path: string, params: URLSearchParams, signal: AbortSignal): Promise<unknown | null> {
  const res = await fetch(`${LRCLIB}/${path}?${params}`, { headers: LRCLIB_HEADERS, signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`LRCLIB ${res.status}`);
  return res.json();
}

/**
 * Tries, in order: exact /get, /search by title+artist, /search with a looser title,
 * free-text /search. Stops at the first plausible match.
 */
export async function fetchLyrics(meta: LyricsMeta, signal: AbortSignal): Promise<LyricsResult> {
  const track = cleanTitle(meta.trackName);
  const loose = looseTitle(meta.trackName);
  const seconds = Math.round(meta.durationMs / 1000);

  const get = new URLSearchParams({ track_name: track, artist_name: meta.artist });
  if (meta.album) get.set('album_name', meta.album);
  if (seconds > 0) get.set('duration', String(seconds));
  const exact = (await lrclib('get', get, signal)) as LrclibItem | null;
  const hit = exact && toResult(exact);
  if (hit) return hit;

  const searches: [URLSearchParams, boolean][] = [
    [new URLSearchParams({ track_name: track, artist_name: meta.artist }), false],
  ];
  if (loose !== track) searches.push([new URLSearchParams({ track_name: loose, artist_name: meta.artist }), false]);
  // Free text matches even when LRCLIB spells the artist or title a bit differently.
  searches.push([new URLSearchParams({ q: `${loose} ${meta.artist}` }), true]);

  for (const [params, requireArtist] of searches) {
    const items = ((await lrclib('search', params, signal)) as LrclibItem[] | null) ?? [];
    const best = pick(items, meta, seconds, requireArtist);
    const result = best && toResult(best);
    if (result) return result;
  }
  return { status: 'not_found' };
}

/** Web search for the lyrics, offered when LRCLIB has nothing. Opens in the browser, nothing is fetched here. */
export function lyricsSearchUrl(trackName: string, artist: string): string {
  const q = `${looseTitle(trackName)} ${artist} testo`;
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

/** Asks the translate function (DeepL) for the Italian text. Only called on explicit request. */
export async function translateLyrics(text: string, signal: AbortSignal): Promise<string> {
  if (!TRANSLATE_URL) throw new LyricsError('not_configured');
  const post = async (forceRefresh: boolean) =>
    fetch(TRANSLATE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await getValidAccessToken(forceRefresh)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
      signal,
    });
  let res: Response;
  try {
    res = await post(false);
    if (res.status === 401) res = await post(true);
  } catch (e) {
    if (signal.aborted) throw e;
    throw new LyricsError('failed');
  }
  if (!res.ok) {
    const code = ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? '';
    throw new LyricsError(code === 'quota' || code === 'too_long' ? code : 'failed');
  }
  const body = (await res.json().catch(() => null)) as { text?: string } | null;
  if (!body?.text) throw new LyricsError('failed');
  return body.text;
}
