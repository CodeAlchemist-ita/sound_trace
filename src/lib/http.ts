import { t } from './i18n';

/**
 * fetch with a time limit. React Native's fetch has none on Android: when a connection
 * dies silently (e.g. switching Wi-Fi ↔ mobile) a request can hang forever, leaving a
 * spinner on screen and blocking whatever waits for it. Rejects with an Error instead.
 */
export async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 20_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    if (controller.signal.aborted) throw new Error(t('La connessione non risponde: riprova tra poco.'));
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
