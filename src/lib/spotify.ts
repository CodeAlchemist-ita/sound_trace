import { fetchWithTimeout } from './http';
import { t } from './i18n';
import { tokenStorage } from './tokenStorage';

export const SPOTIFY_CLIENT_ID = process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID ?? '';

// user-read-email: to check that the Spotify account matches the registered email.
// playlist-read-*: the user's own and collaborative playlists (Playlist tab).
// user-read-currently-playing: the "now playing" card (yours on Home, your friends' in Amici).
export const SPOTIFY_SCOPES = [
  'user-read-recently-played',
  'user-read-currently-playing',
  'user-read-private',
  'user-read-email',
  'playlist-read-private',
  'playlist-read-collaborative',
];

/**
 * Supabase "token" function. When set, a signed-in device hands its refresh token to
 * the server, which then syncs plays on its own every 15 minutes and gives the
 * device short-lived access tokens (see supabase/functions/token).
 */
const SYNC_URL = process.env.EXPO_PUBLIC_SYNC_URL ?? '';
export const TOKEN_URL =
  process.env.EXPO_PUBLIC_TOKEN_URL || (SYNC_URL ? SYNC_URL.replace(/\/sync\/?$/, '/token') : '');

export const spotifyDiscovery = {
  authorizationEndpoint: 'https://accounts.spotify.com/authorize',
  tokenEndpoint: 'https://accounts.spotify.com/api/token',
};

const TOKEN_KEY = 'spotify_tokens';

export type StoredTokens = {
  accessToken: string;
  /** '' once handed over to the server. */
  refreshToken: string;
  expiresAt: number; // epoch ms
  /** Granted permissions, space separated (missing in sessions from older versions). */
  scope?: string;
  /** Set after the handover: the device asks the server for access tokens with it. */
  serverKey?: string;
};

export async function saveTokens(tokens: StoredTokens) {
  await tokenStorage.set(TOKEN_KEY, JSON.stringify(tokens));
}

export async function loadTokens(): Promise<StoredTokens | null> {
  const raw = await tokenStorage.get(TOKEN_KEY);
  return raw ? (JSON.parse(raw) as StoredTokens) : null;
}

export async function clearTokens() {
  await tokenStorage.remove(TOKEN_KEY);
}

/** Exchanges the PKCE authorization code for tokens and stores them. */
export async function exchangeCode(code: string, codeVerifier: string, redirectUri: string) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: SPOTIFY_CLIENT_ID,
    code_verifier: codeVerifier,
  });
  const json = await postToken(body);
  // A new login replaces a session the server was holding for this device.
  await revokeServerToken();
  const tokens: StoredTokens = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + json.expires_in * 1000,
    scope: json.scope,
  };
  await saveTokens(tokens);
  return tokens;
}

async function refresh(tokens: StoredTokens): Promise<StoredTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokens.refreshToken,
    client_id: SPOTIFY_CLIENT_ID,
  });
  const json = await postToken(body);
  const next: StoredTokens = {
    accessToken: json.access_token,
    // Spotify may rotate the refresh token; keep the old one if it doesn't.
    refreshToken: json.refresh_token ?? tokens.refreshToken,
    expiresAt: Date.now() + json.expires_in * 1000,
    scope: json.scope ?? tokens.scope,
  };
  await saveTokens(next);
  return next;
}

async function postToken(body: URLSearchParams) {
  const res = await fetchWithTimeout(spotifyDiscovery.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new SpotifyApiError(res.status, await res.text());
  return res.json();
}

// Every token change (refresh, handover, asking the server) goes through one queue:
// Spotify may rotate the refresh token, and two refreshes with the old one would fail.
let tokenQueue: Promise<unknown> = Promise.resolve();

function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const p = tokenQueue.then(fn);
  tokenQueue = p.catch(() => undefined);
  return p;
}

const fresh = (t: StoredTokens) => Date.now() < t.expiresAt - 60_000;

/** Refresh on this device. A rejected refresh token signs you out; being offline doesn't. */
async function refreshLocal(tokens: StoredTokens) {
  try {
    return await refresh(tokens);
  } catch (e) {
    if (e instanceof SpotifyApiError && (e.status === 400 || e.status === 401)) {
      await signOut();
      throw new NotLoggedInError();
    }
    throw e;
  }
}

async function postTokenServer(body: Record<string, unknown>, accessToken?: string, timeoutMs?: number) {
  return fetchWithTimeout(
    TOKEN_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(accessToken && { Authorization: `Bearer ${accessToken}` }) },
      body: JSON.stringify(body),
    },
    timeoutMs,
  );
}

/** Access token from the server, for devices that handed their session over. */
async function fromServer(tokens: StoredTokens, force: boolean) {
  const res = await postTokenServer({ action: 'token', key: tokens.serverKey, force });
  // Unknown key or the user revoked access on Spotify: log in again.
  if (res.status === 401) {
    await signOut();
    throw new NotLoggedInError();
  }
  if (!res.ok) throw new Error(t('Accesso a Spotify non riuscito ({status}). Riprova tra poco.', { status: res.status }));
  const j = (await res.json()) as { accessToken: string; expiresAt: number; scope: string | null };
  const next: StoredTokens = { ...tokens, accessToken: j.accessToken, expiresAt: j.expiresAt, scope: j.scope ?? tokens.scope };
  await saveTokens(next);
  return next;
}

export async function getValidAccessToken(forceRefresh = false): Promise<string> {
  const tokens = await loadTokens();
  if (!tokens) throw new NotLoggedInError();
  if (!forceRefresh && fresh(tokens)) return tokens.accessToken;
  const next = await serialized(async () => {
    const cur = await loadTokens();
    if (!cur) throw new NotLoggedInError();
    if (!forceRefresh && fresh(cur)) return cur; // refreshed while we waited
    return cur.serverKey ? fromServer(cur, forceRefresh) : refreshLocal(cur);
  });
  return next.accessToken;
}

/**
 * Gives this device's refresh token to the server, which from then on syncs plays
 * every 15 minutes even with the phone off. Does nothing without the server, or if
 * already done; on failure the device simply keeps refreshing on its own.
 */
export async function handOverToServer() {
  if (!TOKEN_URL) return;
  await serialized(async () => {
    let cur = await loadTokens();
    if (!cur || cur.serverKey || !cur.refreshToken) return;
    if (!fresh(cur)) cur = await refreshLocal(cur); // the server checks who we are with it
    const res = await postTokenServer({ action: 'handover', refreshToken: cur.refreshToken }, cur.accessToken);
    if (!res.ok) {
      console.warn('[token] handover failed', res.status, (await res.text()).slice(0, 200));
      return;
    }
    const j = (await res.json()) as { key: string; accessToken: string; expiresAt: number; scope: string | null };
    await saveTokens({
      accessToken: j.accessToken,
      refreshToken: '',
      expiresAt: j.expiresAt,
      scope: j.scope ?? cur.scope,
      serverKey: j.key,
    });
  });
}

/** Asks the server to re-read your playlists now, so friends see changes at once. Best effort. */
export async function refreshServerPlaylists() {
  const tokens = await loadTokens();
  if (!TOKEN_URL || !tokens?.serverKey) return;
  const res = await postTokenServer({ action: 'playlists', key: tokens.serverKey }, undefined, 45_000);
  if (!res.ok) console.warn('[playlists] server refresh failed', res.status);
}

/** Logout: the server forgets this device (and stops syncing if it was the last one). Best effort. */
export async function revokeServerToken() {
  const tokens = await loadTokens();
  if (!TOKEN_URL || !tokens?.serverKey) return;
  await postTokenServer({ action: 'revoke', key: tokens.serverKey }).catch(() => undefined);
}

/** Whether the session includes a permission (sessions from older versions need a new login). */
export async function hasScope(scope: string) {
  return !!(await loadTokens())?.scope?.split(' ').includes(scope);
}

// The auth context subscribes here to return to the login screen immediately.
let onSignedOut: (() => void) | null = null;
export function setSignedOutListener(listener: (() => void) | null) {
  onSignedOut = listener;
}

async function signOut() {
  await clearTokens();
  onSignedOut?.();
}

export class NotLoggedInError extends Error {
  constructor() {
    super(t('Non hai effettuato l’accesso a Spotify'));
  }
}

export async function spotifyGet<T>(path: string): Promise<T> {
  const get = async (forceRefresh: boolean) =>
    fetchWithTimeout(`https://api.spotify.com/v1${path}`, {
      headers: { Authorization: `Bearer ${await getValidAccessToken(forceRefresh)}` },
    });
  let res = await get(false);
  // Token rejected before its expiry: try one refresh, then give up and sign out.
  if (res.status === 401) res = await get(true);
  if (res.status === 401) {
    await signOut();
    throw new NotLoggedInError();
  }
  // Rate limited for a moment: wait once and retry. Longer waits (or the daily quota) are left to the caller.
  if (res.status === 429) {
    const wait = retryAfterMs(res);
    if (wait !== null && wait <= 5_000) {
      await new Promise((r) => setTimeout(r, wait));
      res = await get(false);
    }
  }
  if (!res.ok) throw new SpotifyApiError(res.status, await res.text(), retryAfterMs(res));
  // 204 No Content (e.g. nothing is playing): callers that can get it use a `T | null` type.
  if (res.status === 204) return null as T;
  return res.json() as Promise<T>;
}

function retryAfterMs(res: Response): number | null {
  const s = Number(res.headers.get('Retry-After'));
  return res.headers.has('Retry-After') && Number.isFinite(s) ? s * 1000 : null;
}

export class SpotifyApiError extends Error {
  readonly status: number;
  /** From the Retry-After header of a 429. */
  readonly retryAfterMs: number | null;
  constructor(status: number, body: string, retryAfterMs: number | null = null) {
    super(`Spotify API ${status}: ${body.slice(0, 300)}`);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export type SpotifyImage = { url: string; width: number | null; height: number | null };

export type SpotifyTrack = {
  id: string;
  uri: string;
  name: string;
  duration_ms: number;
  artists: { name: string }[];
  album: { name: string; images: SpotifyImage[] };
};

export type RecentlyPlayedResponse = {
  items: { played_at: string; track: SpotifyTrack }[];
};

/** Smallest cover that is still sharp at 44pt on a 3x screen (Spotify lists images largest first). */
export function pickCover(images: SpotifyImage[] | undefined): string | null {
  if (!images?.length) return null;
  const sharp = images.filter((i) => (i.width ?? 0) >= 132);
  return (sharp.at(-1) ?? images[0]).url;
}

/** Spotify serves the same album art in 64/300/640 px under different id prefixes: ask for the 640 one. */
export function largeCover(url: string | null): string | null {
  if (!url) return null;
  return url.replace('/image/ab67616d00001e02', '/image/ab67616d0000b273').replace('/image/ab67616d00004851', '/image/ab67616d0000b273');
}
