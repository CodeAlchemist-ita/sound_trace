import { en } from './locales/en';
import { getSettings } from './settings';

// The app is written in Italian: the Italian sentence is the key, and other languages
// are looked up in src/lib/locales. A missing translation falls back to Italian.
// src/lib/i18n.test.ts checks that every sentence used in the code has one.

type Vars = Record<string, string | number>;

const DICTIONARIES: Record<string, Record<string, string>> = { en };

/** Translates a sentence; `{name}` placeholders are filled from `vars`. */
export function t(text: string, vars?: Vars): string {
  const lang = getSettings().language;
  const out = lang === 'it' ? text : (DICTIONARIES[lang]?.[text] ?? text);
  return vars ? out.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole)) : out;
}

/**
 * Marks a sentence for translation where `t()` can't run yet (module-level constants):
 * `{ label: msg('7 giorni') }`, then `t(item.label)` when rendering.
 */
export const msg = (text: string) => text;

/** `plural(3, '{n} brano', '{n} brani')` → "3 brani". `{n}` is the formatted number. */
export function plural(n: number, one: string, other: string, vars?: Vars): string {
  return t(n === 1 ? one : other, { n: Math.round(n).toLocaleString(locale()), ...vars });
}

/** BCP 47 tag for dates and numbers. */
export function locale() {
  return getSettings().language === 'it' ? 'it-IT' : 'en-GB';
}

const NAMES = {
  it: {
    monthsShort: ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'],
    monthsLong: [
      'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
      'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
    ],
    weekdaysShort: ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'],
    weekdaysLong: ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica'],
  },
  en: {
    monthsShort: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    monthsLong: [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ],
    weekdaysShort: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    weekdaysLong: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  },
};

const names = () => NAMES[getSettings().language];

/** Index 0 = January. */
export const monthsShort = () => names().monthsShort;
export const monthsLong = () => names().monthsLong;
/** Index 0 = Monday, like TimeStats.weekdays. */
export const weekdaysShort = () => names().weekdaysShort;
export const weekdaysLong = () => names().weekdaysLong;

/** "il lunedì", "la domenica" in Italian; just the name elsewhere. Index 0 = Monday. */
export function weekdayWithArticle(index: number) {
  const name = weekdaysLong()[index];
  return getSettings().language === 'it' ? `${index === 6 ? 'la' : 'il'} ${name}` : name;
}

/**
 * Weekday indexes (0 = Monday) in the order the user wants to see them:
 * Monday…Sunday, or Sunday…Saturday.
 */
export function weekdayOrder(): number[] {
  return getSettings().weekStart === 'sunday' ? [6, 0, 1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6];
}

/** Position (0–6) of a JS `Date.getDay()` value in the user's week. */
export function weekdayPosition(jsDay: number): number {
  return getSettings().weekStart === 'sunday' ? jsDay : (jsDay + 6) % 7;
}
