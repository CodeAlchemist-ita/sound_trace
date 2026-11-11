import { resetSettingsForTests } from '@/lib/settings';

import { cap, formatClock, formatDays, onDate, pct, signedPct, withAlpha } from './helpers';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

beforeEach(() => resetSettingsForTests({ language: 'it' }));

describe('formatDays', () => {
  it('uses hours below one day', () => {
    expect(formatDays(HOUR)).toBe('1 ora');
    expect(formatDays(5 * HOUR)).toBe('5 ore');
    expect(formatDays(10 * 60_000)).toBe('1 ora'); // never "0 ore"
  });

  it('uses days from one day up, with one decimal', () => {
    expect(formatDays(DAY)).toBe('1 giorno');
    expect(formatDays(4.5 * DAY)).toBe('4,5 giorni');
    expect(formatDays(12 * DAY)).toBe('12 giorni');
  });

  it('speaks English too', () => {
    resetSettingsForTests({ language: 'en' });
    expect(formatDays(5 * HOUR)).toBe('5 hours');
    expect(formatDays(4.5 * DAY)).toBe('4.5 days');
  });
});

describe('onDate', () => {
  const third = new Date(2026, 2, 3).getTime();
  const eighth = new Date(2026, 10, 8).getTime();
  const eleventh = new Date(2026, 10, 11).getTime();

  it('puts the Italian article or preposition before the date', () => {
    expect(onDate(third)).toMatch(/^il 3 /);
    expect(onDate(third, 'dal')).toMatch(/^dal 3 /);
    expect(onDate(third, 'al')).toMatch(/^al 3 /);
  });

  it('elides before 8 and 11, which start with a vowel', () => {
    expect(onDate(eighth)).toMatch(/^l’8 /);
    expect(onDate(eleventh, 'dal')).toMatch(/^dall’11 /);
    expect(onDate(eleventh, 'al')).toMatch(/^all’11 /);
  });

  it('uses on / from / to in English', () => {
    resetSettingsForTests({ language: 'en' });
    expect(onDate(eighth)).toMatch(/^on 8 /);
    expect(onDate(eighth, 'dal')).toMatch(/^from 8 /);
    expect(onDate(eighth, 'al')).toMatch(/^to 8 /);
  });
});

describe('small formatters', () => {
  it('formats a time of day', () => {
    expect(formatClock(new Date(2026, 0, 1, 9, 5).getTime())).toBe('9:05');
    expect(formatClock(new Date(2026, 0, 1, 23, 40).getTime())).toBe('23:40');
  });

  it('capitalises and makes percentages', () => {
    expect(cap('marzo')).toBe('Marzo');
    expect(cap('')).toBe('');
    expect(pct(0.256)).toBe('26%');
  });

  it('signs a change, with "=" for no change', () => {
    expect(signedPct(0.123)).toBe('+12%');
    expect(signedPct(-0.5)).toBe('−50%');
    expect(signedPct(0.004)).toBe('=');
  });

  it('turns a hex color into rgba', () => {
    expect(withAlpha('#FFFFFF', 0.5)).toBe('rgba(255, 255, 255, 0.5)');
    expect(withAlpha('#0E0F12', 1)).toBe('rgba(14, 15, 18, 1)');
  });
});
