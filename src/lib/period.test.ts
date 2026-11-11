import { periodRange, periodYear, previousRange, yearPeriod } from './period';
import { resetSettingsForTests } from './settings';

const DAY = 86_400_000;
// 10 November 2026, 15:30 local time.
const NOW = new Date(2026, 10, 10, 15, 30).getTime();

beforeEach(() => resetSettingsForTests({ language: 'it' }));

describe('periodRange', () => {
  it('covers the last 7 and 30 days up to now', () => {
    expect(periodRange('week', NOW)).toEqual({ from: NOW - 7 * DAY, to: NOW });
    expect(periodRange('month', NOW)).toEqual({ from: NOW - 30 * DAY, to: NOW });
  });

  it('starts the current year on 1 January at midnight', () => {
    expect(periodRange('year', NOW)).toEqual({ from: new Date(2026, 0, 1).getTime(), to: NOW });
  });

  it('starts "all time" at zero', () => {
    expect(periodRange('all', NOW)).toEqual({ from: 0, to: NOW });
  });

  it('covers a whole past year, to its last millisecond', () => {
    expect(periodRange('y2024', NOW)).toEqual({
      from: new Date(2024, 0, 1).getTime(),
      to: new Date(2025, 0, 1).getTime() - 1,
    });
  });

  it('never goes past now', () => {
    expect(periodRange(yearPeriod(2026), NOW).to).toBe(NOW);
  });
});

describe('previousRange', () => {
  it('is the period of the same length just before', () => {
    expect(previousRange('week', NOW)).toMatchObject({ from: NOW - 14 * DAY, to: NOW - 7 * DAY });
    expect(previousRange('month', NOW)).toMatchObject({ from: NOW - 60 * DAY, to: NOW - 30 * DAY });
  });

  it('compares the current year with the same stretch of last year', () => {
    expect(previousRange('year', NOW)).toEqual({
      from: new Date(2025, 0, 1).getTime(),
      to: new Date(2025, 10, 10, 15, 30).getTime(),
      label: 'rispetto allo stesso periodo del 2025',
    });
  });

  it('compares a past year with the whole year before', () => {
    expect(previousRange('y2025', NOW)).toEqual({
      from: new Date(2024, 0, 1).getTime(),
      to: new Date(2025, 0, 1).getTime() - 1,
      label: 'rispetto al 2024',
    });
  });

  it('has nothing to compare "all time" with', () => {
    expect(previousRange('all', NOW)).toBeNull();
  });

  it('translates the label', () => {
    resetSettingsForTests({ language: 'en' });
    expect(previousRange('week', NOW)?.label).toBe('compared with the 7 days before');
  });
});

describe('periodYear', () => {
  it('reads the year of a past-year period, and nothing for rolling ones', () => {
    expect(periodYear('y2023')).toBe(2023);
    expect(periodYear('week')).toBeNull();
    expect(periodYear('all')).toBeNull();
    expect(periodYear('year')).toBe(new Date().getFullYear());
  });
});
