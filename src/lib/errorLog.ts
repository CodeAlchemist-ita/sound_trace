import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { errorStore } from './errorStore';

/**
 * A local diary of the app's errors: crashes, unhandled promise rejections and failed
 * syncs. Nothing is sent anywhere; from Settings the user can read it, share it (for
 * example with whoever maintains the app) or clear it.
 */
export type ErrorEntry = {
  at: number; // epoch ms
  /** Where it happened: 'crash', 'promise', 'screen', 'sync'… */
  source: string;
  message: string;
  stack: string | null;
  /** How many times in a row the same error occurred. */
  count: number;
};

export const MAX_ENTRIES = 50;
const MAX_MESSAGE = 500;
const MAX_STACK = 1500;

/** Spotify and server tokens must never end up in a log someone may share. */
export function redact(text: string) {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer ***')
    .replace(/\b(access_token|refresh_token|refreshToken|accessToken|key|code)(["']?\s*[:=]\s*["']?)[A-Za-z0-9._~+/=-]{8,}/g, '$1$2***')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '***@***');
}

export function toEntry(error: unknown, source: string, at = Date.now()): ErrorEntry {
  const e = error instanceof Error ? error : null;
  const message = e ? `${e.name}: ${e.message}` : typeof error === 'string' ? error : safeJson(error);
  return {
    at,
    source,
    message: redact(message).slice(0, MAX_MESSAGE),
    stack: e?.stack ? redact(e.stack).slice(0, MAX_STACK) : null,
    count: 1,
  };
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Newest last. The same error repeated in a row is counted, not duplicated. */
export function appendEntry(entries: ErrorEntry[], entry: ErrorEntry): ErrorEntry[] {
  const last = entries[entries.length - 1];
  if (last && last.message === entry.message && last.source === entry.source) {
    return [...entries.slice(0, -1), { ...last, at: entry.at, count: last.count + 1 }];
  }
  return [...entries, entry].slice(-MAX_ENTRIES);
}

export function parseLog(raw: string | null): ErrorEntry[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? (list.filter((e) => e && typeof e.message === 'string') as ErrorEntry[]) : [];
  } catch {
    return [];
  }
}

// Writes go through one queue so two errors at the same moment don't overwrite each other.
let queue: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();

export function onErrorLogged(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Never throws: logging an error must not cause another one. */
export function logError(error: unknown, source: string) {
  const entry = toEntry(error, source);
  queue = queue
    .then(async () => {
      await errorStore.write(JSON.stringify(appendEntry(parseLog(await errorStore.read()), entry)));
      listeners.forEach((l) => l());
    })
    .catch(() => undefined);
  return queue;
}

export async function getErrorLog(): Promise<ErrorEntry[]> {
  try {
    return parseLog(await errorStore.read());
  } catch {
    return [];
  }
}

export async function clearErrorLog() {
  queue = queue.then(() => errorStore.clear()).catch(() => undefined);
  await queue;
  listeners.forEach((l) => l());
}

/** Plain text to share or copy: app version and device first, then newest errors first. */
export function formatErrorLog(entries: ErrorEntry[]) {
  const header = [
    `Spotify Stats ${Constants.expoConfig?.version ?? '?'}`,
    `${Platform.OS} ${String(Platform.Version ?? '')}`.trim(),
    new Date().toISOString(),
  ].join(' · ');
  const body = [...entries]
    .reverse()
    .map((e) => {
      const times = e.count > 1 ? ` (×${e.count})` : '';
      return `[${new Date(e.at).toISOString()}] ${e.source}${times}\n${e.message}${e.stack ? `\n${e.stack}` : ''}`;
    })
    .join('\n\n');
  return `${header}\n\n${body || '—'}\n`;
}

type GlobalErrorUtils = {
  getGlobalHandler: () => (error: unknown, isFatal?: boolean) => void;
  setGlobalHandler: (handler: (error: unknown, isFatal?: boolean) => void) => void;
};

let installed = false;

/** Catches what no screen catches. Call once at startup. */
export function installErrorHandlers() {
  if (installed) return;
  installed = true;
  if (Platform.OS === 'web') {
    window.addEventListener('error', (e) => logError(e.error ?? e.message, 'crash'));
    window.addEventListener('unhandledrejection', (e) => logError(e.reason, 'promise'));
    return;
  }
  // React Native's global handler: log, then let the default one do its job (red screen / close).
  const utils = (globalThis as { ErrorUtils?: GlobalErrorUtils }).ErrorUtils;
  if (!utils) return;
  const previous = utils.getGlobalHandler();
  utils.setGlobalHandler((error, isFatal) => {
    logError(error, isFatal ? 'crash' : 'error');
    previous(error, isFatal);
  });
}
