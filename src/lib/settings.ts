import { useSyncExternalStore } from 'react';

import { tokenStorage } from './tokenStorage';

/** Preferences of this device (not synced, kept when the listening data is wiped). */
export type ThemePref = 'system' | 'dark' | 'light';
export type Language = 'it' | 'en';
export type WeekStart = 'monday' | 'sunday';

export type Settings = {
  theme: ThemePref;
  language: Language;
  /** Seconds a play must last to count as a listen. Spotify uses 30. */
  minStreamSec: number;
  weekStart: WeekStart;
  haptics: boolean;
};

export const MIN_STREAM_CHOICES = [10, 30, 60];

const KEY = 'settings';

function deviceLanguage(): Language {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith('it') ? 'it' : 'en';
  } catch {
    return 'it';
  }
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  language: 'it',
  minStreamSec: 30,
  weekStart: 'monday',
  haptics: true,
};

let current: Settings = { ...DEFAULT_SETTINGS, language: deviceLanguage() };
const listeners = new Set<() => void>();

/** Keeps only known keys with valid values, so an old or damaged file can't break the app. */
export function sanitizeSettings(raw: unknown, fallback: Settings): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pick = <T,>(value: unknown, allowed: readonly T[], or: T) => (allowed.includes(value as T) ? (value as T) : or);
  return {
    theme: pick<ThemePref>(r.theme, ['system', 'dark', 'light'], fallback.theme),
    language: pick<Language>(r.language, ['it', 'en'], fallback.language),
    minStreamSec: pick(r.minStreamSec, MIN_STREAM_CHOICES, fallback.minStreamSec),
    weekStart: pick<WeekStart>(r.weekStart, ['monday', 'sunday'], fallback.weekStart),
    haptics: typeof r.haptics === 'boolean' ? r.haptics : fallback.haptics,
  };
}

export function getSettings(): Settings {
  return current;
}

/** Reads the saved preferences. Call once at startup, before the first screen. */
export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await tokenStorage.get(KEY);
    if (raw) setCurrent(sanitizeSettings(JSON.parse(raw), current));
  } catch (e) {
    console.warn('[settings] load failed', e);
  }
  return current;
}

export async function updateSettings(patch: Partial<Settings>) {
  setCurrent(sanitizeSettings({ ...current, ...patch }, current));
  await tokenStorage.set(KEY, JSON.stringify(current)).catch((e) => console.warn('[settings] save failed', e));
}

function setCurrent(next: Settings) {
  current = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Re-renders the component whenever a preference changes. */
export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings, getSettings);
}

/** Tests only. */
export function resetSettingsForTests(patch: Partial<Settings> = {}) {
  setCurrent({ ...DEFAULT_SETTINGS, ...patch });
}
