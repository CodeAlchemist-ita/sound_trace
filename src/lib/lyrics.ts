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

type LrclibItem = { plainLyrics?: string | null; instrumental?: boolean; duration?: number | null };

function toResult(item: LrclibItem): LyricsResult | null {
  if (item.instrumental) return { status: 'instrumental' };
  const text = item.plainLyrics?.trim();
  return text ? { status: 'found', text } : null;
}

export async function fetchLyrics(meta: LyricsMeta, signal: AbortSignal): Promise<LyricsResult> {
  const track = cleanTitle(meta.trackName);
  const seconds = Math.round(meta.durationMs / 1000);

  const get = new URLSearchParams({ track_name: track, artist_name: meta.artist });
  if (meta.album) get.set('album_name', meta.album);
  if (seconds > 0) get.set('duration', String(seconds));
  const res = await fetch(`${LRCLIB}/get?${get}`, { headers: LRCLIB_HEADERS, signal });
  if (res.ok) {
    const hit = toResult((await res.json()) as LrclibItem);
    if (hit) return hit;
  } else if (res.status !== 404) {
    throw new Error(`LRCLIB ${res.status}`);
  }

  const search = new URLSearchParams({ track_name: track, artist_name: meta.artist });
  const res2 = await fetch(`${LRCLIB}/search?${search}`, { headers: LRCLIB_HEADERS, signal });
  if (res2.status === 404) return { status: 'not_found' };
  if (!res2.ok) throw new Error(`LRCLIB ${res2.status}`);
  const items = ((await res2.json()) as LrclibItem[]).filter((i) => i.plainLyrics?.trim());
  const close = items.find((i) => i.duration != null && seconds > 0 && Math.abs(i.duration - seconds) <= 3);
  const best = close ?? items[0];
  return (best && toResult(best)) || { status: 'not_found' };
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
