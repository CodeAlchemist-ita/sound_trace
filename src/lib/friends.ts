import { SYNC_URL } from './cloudSync';
import { fetchWithTimeout } from './http';
import { msg, t } from './i18n';
import { isValidEmail, loadRegistration, normalizeEmail } from './registration';
import { getValidAccessToken } from './spotify';

/** Supabase "friends" Edge Function, next to "sync". Friends need the online part. */
export const FRIENDS_URL =
  process.env.EXPO_PUBLIC_FRIENDS_URL || (SYNC_URL ? SYNC_URL.replace(/\/sync\/?$/, '/friends') : '');
export const friendsEnabled = FRIENDS_URL.length > 0;

export type Person = { id: string; email: string; name: string | null; avatar: string | null };
export type Friend = Person & { since: string };
export type FriendRequest = { requestId: number; person: Person; at: string };
export type FriendsList = { friends: Friend[]; incoming: FriendRequest[]; outgoing: FriendRequest[] };

export type FriendProfile = {
  summary: { totalMs: number; streams: number; tracks: number; artists: number };
  topArtists: { artist: string; plays: number; totalMs: number; imageUrl: string | null }[];
  topTracks: { trackName: string; artist: string; plays: number; totalMs: number; imageUrl: string | null }[];
  recent: { trackName: string; artist: string; playedAt: number; imageUrl: string | null }[];
};

export class FriendsError extends Error {
  /** The server's error code ('not_friends', 'action'…), '' for network problems. */
  readonly code: string;
  constructor(message: string, code = '') {
    super(message);
    this.code = code;
  }
}

/** Italian keys: shown with t(). */
const MESSAGES: Record<string, string> = {
  not_found: msg('Nessun utente registrato con questa email. Il tuo amico deve prima registrarsi nell’app e collegare Spotify.'),
  self: msg('Questa è la tua email: inserisci quella di un amico.'),
  already_friends: msg('Siete già amici.'),
  already_requested: msg('Hai già inviato una richiesta a questa persona.'),
  not_friends: msg('Non siete (più) amici.'),
  not_registered: msg('Il tuo account non risulta registrato. Esci e accedi di nuovo.'),
  hidden: msg('Il tuo amico ha scelto di non condividere questa parte.'),
  too_many: msg('Hai già inviato molti consigli oggi: riprova domani.'),
  message: msg('Il messaggio è troppo lungo.'),
};

async function call<T>(body: Record<string, unknown>): Promise<T> {
  if (!friendsEnabled) throw new FriendsError(t('Gli amici richiedono la sincronizzazione online (vedi README).'));
  const post = async (forceRefresh: boolean) =>
    fetchWithTimeout(FRIENDS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await getValidAccessToken(forceRefresh)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  let res: Response;
  try {
    res = await post(false);
    if (res.status === 401) res = await post(true);
  } catch {
    throw new FriendsError(t('Connessione non riuscita: controlla internet e riprova.'));
  }
  if (!res.ok) {
    const code = ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? '';
    throw new FriendsError(
      MESSAGES[code] ? t(MESSAGES[code]) : t('Operazione non riuscita ({status}). Riprova più tardi.', { status: res.status }),
      code,
    );
  }
  return res.json() as Promise<T>;
}

export const listFriends = () => call<FriendsList>({ action: 'list' });

/** Sends a request; 'accepted' if that person had already asked you. */
export async function sendFriendRequest(input: string) {
  const email = normalizeEmail(input);
  if (!isValidEmail(email)) throw new FriendsError(t('Inserisci un indirizzo email valido.'));
  if (email === (await loadRegistration())?.email) throw new FriendsError(t(MESSAGES.self));
  return (await call<{ status: 'pending' | 'accepted' }>({ action: 'request', email })).status;
}

export const respondToRequest = (requestId: number, accept: boolean) =>
  call<{ ok: true }>({ action: 'respond', requestId, accept });

/** Unfriend, or cancel a request you sent. */
export const removeFriend = (friendId: string) => call<{ ok: true }>({ action: 'remove', friendId });

/**
 * What a user lets friends see. Saved and enforced on the server: an old or modified
 * app can't get around it. Everything is visible until the user changes it.
 */
export type Privacy = {
  /** The song playing right now. */
  nowPlaying: boolean;
  /** Latest plays. */
  recent: boolean;
  /** Totals, top artists and songs, and how much they play the songs of their playlists. */
  stats: boolean;
  /** Playlists and their songs. */
  playlists: boolean;
  /** Whether friends may recommend songs to you. */
  recommendations: boolean;
};

export const PRIVACY_KEYS: (keyof Privacy)[] = ['nowPlaying', 'recent', 'stats', 'playlists', 'recommendations'];

export const getPrivacy = async () => (await call<{ privacy: Privacy }>({ action: 'privacy_get' })).privacy;

/** Changes some choices; returns all of them as the server saved them. */
export const setPrivacy = async (changes: Partial<Privacy>) =>
  (await call<{ privacy: Privacy }>({ action: 'privacy_set', privacy: changes })).privacy;

/** Which parts of a profile the friend chose not to share (missing from servers older than this feature). */
export type HiddenParts = { stats: boolean; recent: boolean; playlists: boolean; nowPlaying: boolean };

export const NOTHING_HIDDEN: HiddenParts = { stats: false, recent: false, playlists: false, nowPlaying: false };

export const getFriendProfile = (friendId: string, from: number, to: number) =>
  call<{ person: Person; profile: FriendProfile; hidden?: HiddenParts }>({ action: 'profile', friendId, from, to });

export type FriendPlaylist = {
  id: string;
  name: string;
  ownerName: string | null;
  imageUrl: string | null;
  collaborative: boolean;
  /** Own or collaborative: songs available. */
  readable: boolean;
  total: number;
};

/**
 * 'no_token': the friend's app hasn't handed its session to the server yet (old version);
 * 'no_scope': they haven't granted the playlist permission. Cached playlists are still returned.
 * 'hidden': they chose not to share their playlists.
 */
export type FriendPlaylistsStatus = 'ok' | 'no_token' | 'no_scope' | 'hidden';

export const getFriendPlaylists = (friendId: string) =>
  call<{ status: FriendPlaylistsStatus; playlists: FriendPlaylist[] }>({ action: 'playlists', friendId });

export type FriendPlaylistTrack = {
  trackName: string;
  artist: string;
  imageUrl: string | null;
  addedAt: number | null;
  addedBy: string | null;
  releaseDate: string | null;
  durationMs: number;
  /** The friend's plays of this song. */
  plays: number;
  ms: number;
  lastPlayed: number | null;
  /** Your plays of this song. */
  viewerPlays: number;
};

/** `statsHidden`: the friend shares the playlist but not how much they play its songs (plays are all 0). */
export const getFriendPlaylist = (friendId: string, playlistId: string) =>
  call<{ playlist: FriendPlaylist; tracks: FriendPlaylistTrack[]; statsHidden?: boolean }>({
    action: 'playlist',
    friendId,
    playlistId,
  });

export const displayName = (p: Pick<Person, 'name' | 'email'>) => p.name || p.email.split('@')[0];

/** What a friend is listening to right now. */
export type FriendNowPlaying = { trackName: string; artist: string; imageUrl: string | null };

/**
 * Friends who are playing something at this moment, by friend id. Friends whose app is
 * older than this feature (or who haven't logged in again since) are simply missing.
 * Never throws: it decorates the list, it must not break it (a server not yet updated
 * answers "unknown action").
 */
export async function getFriendsNowPlaying(): Promise<Record<string, FriendNowPlaying>> {
  try {
    return (await call<{ now: Record<string, FriendNowPlaying> }>({ action: 'now' })).now ?? {};
  } catch {
    return {};
  }
}

// ---------- Recommendations: songs friends suggest to each other ----------

/** `person` is the sender for received items and the receiver for sent ones. */
export type Recommendation = {
  id: number;
  fromUser: string;
  toUser: string;
  trackName: string;
  artist: string;
  trackUri: string | null;
  imageUrl: string | null;
  message: string | null;
  /** Epoch ms. */
  createdAt: number;
  /** The receiver has opened the list since it arrived. */
  seen: boolean;
  /** Epoch ms of the receiver's first play of the song after the recommendation, if any. */
  listenedAt: number | null;
  person: Person;
};

export type RecommendationsList = { received: Recommendation[]; sent: Recommendation[]; unseen: number };

export type RecommendInput = {
  friendIds: string[];
  trackName: string;
  artist: string;
  trackUri?: string | null;
  imageUrl?: string | null;
  message?: string;
};

export type RecommendResult = {
  sent: number;
  skipped: { friendId: string; reason: 'not_friends' | 'disabled' | 'duplicate' }[];
};

export const sendRecommendation = (input: RecommendInput) =>
  call<RecommendResult>({ action: 'recommend', ...input });

/**
 * Received and sent recommendations. A server not yet updated answers "unknown action":
 * that means no recommendations, not an error that breaks the Friends tab.
 */
export async function getRecommendations(): Promise<RecommendationsList> {
  try {
    const data = await call<Partial<RecommendationsList>>({ action: 'recommendations' });
    return { received: data.received ?? [], sent: data.sent ?? [], unseen: data.unseen ?? 0 };
  } catch (e) {
    if (e instanceof FriendsError && e.code === 'action') return { received: [], sent: [], unseen: 0 };
    throw e;
  }
}

export const markRecommendationsSeen = () => call<{ ok: true }>({ action: 'recommendations_seen' });

export const deleteRecommendation = (id: number) => call<{ ok: true }>({ action: 'recommendation_delete', id });
