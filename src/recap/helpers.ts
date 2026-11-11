import type { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Platform } from 'react-native';

import { formatDate, formatDecimal } from '@/lib/format';
import { plural, t } from '@/lib/i18n';
import type { YearRecap } from '@/lib/recap';
import { getSettings } from '@/lib/settings';

export const NATIVE = Platform.OS !== 'web';

export type IconName = keyof typeof Ionicons.glyphMap;

export type Gradient = readonly [string, string, ...string[]];

/** One story of the yearly recap. Each lives in its own file under src/recap/slides. */
export type Slide = {
  id: string;
  colors: Gradient;
  fg: string;
  /** Blurred photo behind the story (song cover / artist). */
  image?: (r: YearRecap) => string | null | undefined;
  show?: (r: YearRecap) => boolean;
  render: (r: YearRecap, fg: string) => ReactNode;
};

/** "3 ore", "1 giorno", "4,5 giorni": a listening time as uninterrupted hours or days. */
export function formatDays(ms: number) {
  const days = Math.round((ms / 86_400_000) * 10) / 10;
  if (days < 1) {
    const hours = Math.max(1, Math.round(ms / 3_600_000));
    return plural(hours, '{n} ora', '{n} ore');
  }
  return days === 1 ? t('1 giorno') : t('{n} giorni', { n: formatDecimal(days) });
}

/**
 * A date with its preposition. Italian: "il 3 mar 2026", but "l’8 nov 2026" / "dall’11 …"
 * (8 and 11 start with a vowel). English: "on 3 Mar 2026", "from …", "to …".
 */
export function onDate(ms: number, prep: 'il' | 'dal' | 'al' = 'il') {
  if (getSettings().language !== 'it') return `${{ il: 'on', dal: 'from', al: 'to' }[prep]} ${formatDate(ms)}`;
  const day = new Date(ms).getDate();
  const elided = { il: 'l’', dal: 'dall’', al: 'all’' }[prep];
  return `${day === 8 || day === 11 ? elided : `${prep} `}${formatDate(ms)}`;
}

/** "9:05" */
export function formatClock(ms: number) {
  const d = new Date(ms);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const pct = (x: number) => `${Math.round(x * 100)}%`;

/** "+12%", "−8%", "=" */
export function signedPct(x: number) {
  const n = Math.round(x * 100);
  return n === 0 ? '=' : `${n > 0 ? '+' : '−'}${Math.abs(n)}%`;
}

/** '#RRGGBB' + alpha → rgba(). */
export function withAlpha(hex: string, alpha: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
