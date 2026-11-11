import { SYNC_URL } from './cloudSync';
import { fetchWithTimeout } from './http';
import { t } from './i18n';
import { SpotifyApiError, getValidAccessToken, spotifyGet } from './spotify';
import { tokenStorage } from './tokenStorage';

/**
 * Registration: the user gives the email of their Spotify account, then connects
 * Spotify; the account must have that same email. With cloud sync configured the
 * email is saved online (Supabase "register" function), so the owner knows whom to
 * enable in the Spotify dashboard, and only linked accounts may sync.
 */
export const REGISTER_URL =
  process.env.EXPO_PUBLIC_REGISTER_URL || (SYNC_URL ? SYNC_URL.replace(/\/sync\/?$/, '/register') : '');

export type Registration = { email: string; linked: boolean };

const KEY = 'registration';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type RegistrationErrorCode = 'invalid' | 'mismatch' | 'not_allowed' | 'no_email' | 'server';

export class RegistrationError extends Error {
  readonly code: RegistrationErrorCode;
  constructor(code: RegistrationErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string) {
  const e = normalizeEmail(email);
  return e.length <= 254 && EMAIL.test(e);
}

export async function loadRegistration(): Promise<Registration | null> {
  const raw = await tokenStorage.get(KEY);
  return raw ? (JSON.parse(raw) as Registration) : null;
}

async function saveRegistration(r: Registration) {
  await tokenStorage.set(KEY, JSON.stringify(r));
}

export async function clearRegistration() {
  await tokenStorage.remove(KEY);
}

async function post(body: Record<string, unknown>, token?: string) {
  return fetchWithTimeout(REGISTER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: JSON.stringify(body),
  });
}

/** Step 1: save the email (online too when cloud sync is configured). */
export async function registerEmail(input: string): Promise<Registration> {
  const email = normalizeEmail(input);
  if (!isValidEmail(email)) throw new RegistrationError('invalid', t('Inserisci un indirizzo email valido.'));
  if (REGISTER_URL) {
    let res: Response;
    try {
      res = await post({ action: 'register', email });
    } catch {
      throw new RegistrationError('server', t('Registrazione non riuscita: controlla la connessione e riprova.'));
    }
    if (!res.ok) {
      throw new RegistrationError('server', t('Registrazione non riuscita ({status}). Riprova più tardi.', { status: res.status }));
    }
  }
  const reg = { email, linked: false };
  await saveRegistration(reg);
  return reg;
}

const MISMATCH = (spotifyEmail: string, email: string) =>
  t(
    'L’account Spotify con cui hai fatto l’accesso ({spotifyEmail}) non ha l’email con cui ti sei registrato ({email}). Accedi con l’account giusto oppure cambia email.',
    { spotifyEmail, email },
  );

const NOT_ALLOWED = () =>
  t(
    'Il tuo account Spotify non è ancora abilitato per questa app. Chi gestisce l’app deve aggiungere la tua email nel Spotify Developer Dashboard (User Management); poi riprova.',
  );

/** Step 2, after the Spotify login: the account must have the registered email. */
export async function linkSpotify(reg: Registration): Promise<Registration> {
  let me: { id: string; email?: string };
  try {
    me = await spotifyGet<{ id: string; email?: string }>('/me');
  } catch (e) {
    if (e instanceof SpotifyApiError && e.status === 403) throw new RegistrationError('not_allowed', NOT_ALLOWED());
    throw e;
  }
  // Sessions from before registration existed lack the user-read-email permission.
  if (!me.email) {
    throw new RegistrationError('no_email', t('Accedi di nuovo a Spotify per confermare la tua email.'));
  }
  const spotifyEmail = normalizeEmail(me.email);
  if (spotifyEmail !== reg.email) throw new RegistrationError('mismatch', MISMATCH(spotifyEmail, reg.email));

  if (REGISTER_URL) {
    let res: Response;
    try {
      res = await post({ action: 'link', email: reg.email }, await getValidAccessToken());
    } catch {
      throw new RegistrationError('server', t('Collegamento non riuscito: controlla la connessione e riprova.'));
    }
    if (res.status === 409) throw new RegistrationError('mismatch', MISMATCH(spotifyEmail, reg.email));
    if (res.status === 403) throw new RegistrationError('not_allowed', NOT_ALLOWED());
    if (!res.ok) {
      throw new RegistrationError('server', t('Collegamento non riuscito ({status}). Riprova più tardi.', { status: res.status }));
    }
  }
  const linked = { ...reg, linked: true };
  await saveRegistration(linked);
  return linked;
}
