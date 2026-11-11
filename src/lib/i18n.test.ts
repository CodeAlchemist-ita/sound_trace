import fs from 'node:fs';
import path from 'node:path';

import { formatDate, formatDuration, formatNumber } from './format';
import { locale, monthsShort, plural, t, weekdayOrder, weekdayPosition, weekdaysShort, weekdayWithArticle } from './i18n';
import { extractKeys, placeholders } from './i18nKeys';
import { en } from './locales/en';
import { resetSettingsForTests } from './settings';

const SRC = path.join(__dirname, '..');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'locales' || entry.name === 'testing' ? [] : sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !/^i18n(Keys)?\.ts$/.test(entry.name) ? [full] : [];
  });
}

/** Sentence → the files that use it. */
function usedSentences() {
  const used = new Map<string, string[]>();
  for (const file of sourceFiles(SRC)) {
    for (const key of extractKeys(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'))) {
      used.set(key, [...(used.get(key) ?? []), path.relative(SRC, file)]);
    }
  }
  return used;
}

beforeEach(() => resetSettingsForTests({ language: 'it' }));

describe('the English dictionary', () => {
  const used = usedSentences();

  it('finds the sentences in the source', () => {
    // Guards the test itself: if the extraction broke, the checks below would pass on nothing.
    expect(used.size).toBeGreaterThan(300);
    expect(used.has('Impostazioni')).toBe(true);
    expect(used.has('{n} brani')).toBe(true);
  });

  it('translates every sentence the app uses', () => {
    const missing = [...used.entries()].filter(([key]) => !(key in en)).map(([key, files]) => `${key}  (${files[0]})`);
    expect(missing).toEqual([]);
  });

  it('has no leftovers the app no longer uses', () => {
    expect(Object.keys(en).filter((key) => !used.has(key))).toEqual([]);
  });

  it('keeps the same placeholders as the Italian sentence', () => {
    const different = Object.entries(en)
      .filter(([it, english]) => placeholders(it).join() !== placeholders(english).join())
      .map(([it]) => it);
    expect(different).toEqual([]);
  });

  it('has no empty translations', () => {
    expect(Object.entries(en).filter(([, english]) => english.trim() === '')).toEqual([]);
  });
});

describe('extractKeys', () => {
  it('reads t(), msg() and both forms of plural(), on one or more lines', () => {
    const source = `
      t('Ciao');
      t("Con 'apici'", { n: 1 });
      msg('Etichetta');
      plural(count, '{n} cosa', '{n} cose');
      plural(
        items.length,
        'una riga',
        'più righe',
        { extra: 1 },
      );
      t(
        'Su una riga a parte',
      );
      t(variable);
      split('non una traduzione');
    `;
    expect(extractKeys(source).sort()).toEqual(
      ["Con 'apici'", 'Ciao', 'Etichetta', 'Su una riga a parte', 'più righe', 'una riga', '{n} cosa', '{n} cose'].sort(),
    );
  });
});

describe('t and plural', () => {
  it('returns the Italian sentence as it is', () => {
    expect(t('Impostazioni')).toBe('Impostazioni');
  });

  it('translates into English and fills the placeholders', () => {
    resetSettingsForTests({ language: 'en' });
    expect(t('Impostazioni')).toBe('Settings');
    expect(t('Obiettivo {year}', { year: 2026 })).toBe('2026 goal');
  });

  it('falls back to Italian for a sentence without translation', () => {
    resetSettingsForTests({ language: 'en' });
    expect(t('Frase mai tradotta {n}', { n: 3 })).toBe('Frase mai tradotta 3');
  });

  it('leaves a placeholder it has no value for', () => {
    expect(t('Ciao {name}', {})).toBe('Ciao {name}');
  });

  it('chooses singular or plural and formats the number', () => {
    expect(plural(1, '{n} brano', '{n} brani')).toBe('1 brano');
    expect(plural(0, '{n} brano', '{n} brani')).toBe('0 brani');
    expect(plural(1234, '{n} brano', '{n} brani')).toBe(`${(1234).toLocaleString('it-IT')} brani`);
    resetSettingsForTests({ language: 'en' });
    expect(plural(2, '{n} brano', '{n} brani')).toBe('2 songs');
  });
});

describe('dates, numbers and the week', () => {
  it('follows the language', () => {
    expect(locale()).toBe('it-IT');
    expect(monthsShort()[0]).toBe('Gen');
    expect(weekdaysShort()[0]).toBe('Lun');
    expect(weekdayWithArticle(0)).toBe('il lunedì');
    expect(weekdayWithArticle(6)).toBe('la domenica');
    resetSettingsForTests({ language: 'en' });
    expect(locale()).toBe('en-GB');
    expect(monthsShort()[0]).toBe('Jan');
    expect(weekdayWithArticle(6)).toBe('Sunday');
  });

  it('formats durations the same in every language', () => {
    expect(formatDuration(59 * 60_000)).toBe('59 min');
    expect(formatDuration(125 * 60_000)).toBe('2 h 05 min');
    expect(formatDuration(0)).toBe('0 min');
  });

  it('formats numbers and dates in the chosen language', () => {
    const date = new Date(2026, 2, 3).getTime();
    expect(formatNumber(12.6)).toBe('13');
    expect(formatDate(date)).toBe(new Date(date).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' }));
    resetSettingsForTests({ language: 'en' });
    expect(formatDate(date)).toBe(new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }));
  });

  it('orders the week from Monday or from Sunday', () => {
    expect(weekdayOrder()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(weekdayPosition(1)).toBe(0); // Monday (JS day 1) comes first
    expect(weekdayPosition(0)).toBe(6); // Sunday last
    resetSettingsForTests({ weekStart: 'sunday' });
    expect(weekdayOrder()).toEqual([6, 0, 1, 2, 3, 4, 5]);
    expect(weekdayPosition(0)).toBe(0); // Sunday first
    expect(weekdayPosition(6)).toBe(6); // Saturday last
  });
});
