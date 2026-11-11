import { makeRedirectUri, useAuthRequest, ResponseType } from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

import { wipeCloudData } from './cloudSync';
import { clearAllData } from './db';
import { t } from './i18n';
import {
  RegistrationError,
  clearRegistration,
  linkSpotify,
  loadRegistration,
  registerEmail,
  type Registration,
} from './registration';
import {
  SPOTIFY_CLIENT_ID,
  SPOTIFY_SCOPES,
  clearTokens,
  exchangeCode,
  handOverToServer,
  loadTokens,
  revokeServerToken,
  setSignedOutListener,
  spotifyDiscovery,
} from './spotify';
import { registerBackgroundSync, unregisterBackgroundSync } from './backgroundSync';

WebBrowser.maybeCompleteAuthSession();

/**
 * Must be added exactly like this in the Spotify Developer Dashboard:
 * phone → spotifystats://callback, PC → http://127.0.0.1:8081/callback
 * (Spotify rejects "localhost": open the PC version on 127.0.0.1).
 */
export const redirectUri = makeRedirectUri({ scheme: 'spotifystats', path: 'callback' });

const WEB_PKCE_KEY = 'spotify_pkce';

type AuthState = {
  status: 'loading' | 'signedOut' | 'signedIn';
  /** null = not registered yet. */
  registration: Registration | null;
  /** True while checking the Spotify account against the registered email. */
  linking: boolean;
  error: string | null;
  canLogin: boolean;
  register: (email: string) => Promise<void>;
  /** Forget the registered email (only from the login screen). */
  changeEmail: () => Promise<void>;
  /** Retry the email check after a network error. */
  retryLink: () => Promise<void>;
  login: () => void;
  logout: (wipeData: boolean) => Promise<void>;
  /** Web only: finishes the redirect login on /callback. */
  completeWebLogin: (params: { code?: string; state?: string; error?: string }) => Promise<void>;
  setError: (error: string | null) => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [registration, setRegistration] = useState<Registration | null>(null);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const registrationRef = useRef<Registration | null>(null);

  const [request, , promptAsync] = useAuthRequest(
    {
      clientId: SPOTIFY_CLIENT_ID,
      scopes: SPOTIFY_SCOPES,
      redirectUri,
      responseType: ResponseType.Code,
      usePKCE: true,
    },
    spotifyDiscovery,
  );

  const updateRegistration = useCallback((r: Registration | null) => {
    registrationRef.current = r;
    setRegistration(r);
  }, []);

  /** After a Spotify login: the account must have the registered email. */
  const link = useCallback(async () => {
    const reg = registrationRef.current;
    if (!reg) return;
    setLinking(true);
    try {
      updateRegistration(await linkSpotify(reg));
      setError(null);
      registerBackgroundSync().catch(console.warn);
      // From now on the server syncs this account even with the app closed.
      handOverToServer().catch(console.warn);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // Wrong account, account not enabled, or old session without email: sign out
      // so the user can log in again. Network problems keep the session for a retry.
      if (e instanceof RegistrationError && e.code !== 'server') {
        await clearTokens();
        setStatus('signedOut');
      }
      setError(message);
    } finally {
      setLinking(false);
    }
  }, [updateRegistration]);

  useEffect(() => {
    setSignedOutListener(() => setStatus('signedOut'));
    return () => setSignedOutListener(null);
  }, []);

  useEffect(() => {
    Promise.all([loadTokens(), loadRegistration()]).then(([tokens, reg]) => {
      updateRegistration(reg);
      setStatus(tokens ? 'signedIn' : 'signedOut');
      if (tokens && reg?.linked) {
        registerBackgroundSync().catch(console.warn);
        // Sessions from before server sync: hand them over now.
        handOverToServer().catch(console.warn);
      }
      // Signed in from before registration existed, or the last check failed: check now.
      if (tokens && reg && !reg.linked) link();
    });
  }, [link, updateRegistration]);

  const register = useCallback(
    async (email: string) => {
      setError(null);
      updateRegistration(await registerEmail(email));
      if (status === 'signedIn') await link();
    },
    [link, status, updateRegistration],
  );

  const changeEmail = useCallback(async () => {
    await clearRegistration();
    updateRegistration(null);
    setError(null);
  }, [updateRegistration]);

  const login = useCallback(async () => {
    setError(null);
    if (Platform.OS === 'web') {
      // The headers SQLite needs on web (COOP) break popups, so redirect the whole
      // page to Spotify; it comes back on /callback (see completeWebLogin).
      if (!request?.url || !request.codeVerifier) return;
      window.sessionStorage.setItem(
        WEB_PKCE_KEY,
        JSON.stringify({ verifier: request.codeVerifier, state: request.state }),
      );
      window.location.assign(request.url);
      return;
    }
    const result = await promptAsync();
    if (result.type === 'error') {
      setError(result.params.error_description ?? result.params.error ?? t('Accesso non riuscito'));
      return;
    }
    if (result.type !== 'success' || !request?.codeVerifier) return;
    try {
      await exchangeCode(result.params.code, request.codeVerifier, redirectUri);
      setStatus('signedIn');
      await link();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [link, promptAsync, request]);

  const completeWebLogin = useCallback(
    async (params: { code?: string; state?: string; error?: string }) => {
      const saved = window.sessionStorage.getItem(WEB_PKCE_KEY);
      window.sessionStorage.removeItem(WEB_PKCE_KEY);
      if (params.error) throw new Error(params.error === 'access_denied' ? t('Accesso annullato') : params.error);
      const pkce = saved ? (JSON.parse(saved) as { verifier: string; state: string }) : null;
      if (!params.code || !pkce || pkce.state !== params.state) {
        throw new Error(t('Accesso non valido o scaduto, riprova.'));
      }
      await exchangeCode(params.code, pkce.verifier, redirectUri);
      setStatus('signedIn');
      await link();
    },
    [link],
  );

  const logout = useCallback(async (wipeData: boolean) => {
    // Needs the Spotify token, so before signing out. If it fails (offline) we stop
    // here: otherwise the data would come back from the cloud at the next login.
    if (wipeData) await wipeCloudData();
    await unregisterBackgroundSync().catch(console.warn);
    await revokeServerToken();
    await clearTokens();
    if (wipeData) await clearAllData();
    setStatus('signedOut');
  }, []);

  return (
    <AuthContext.Provider
      value={{
        status,
        registration,
        linking,
        error,
        canLogin: !!request && !!SPOTIFY_CLIENT_ID,
        register,
        changeEmail,
        retryLink: link,
        login,
        logout,
        completeWebLogin,
        setError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
