import { aggregate, indexOfMax, lastDays, lastMonths, longestStreak, topDay } from './timeStats';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-sqlite', () => require('@/testing/fakeSqlite'));

const HOUR = 3_600_000;
/** An hourly bucket as the database returns it: hours since the epoch, ms listened, plays. */
const bucket = (date: Date, ms: number, n = 1) => ({ h: Math.floor(date.getTime() / HOUR), ms, n });
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();

describe('aggregate', () => {
  const stats = aggregate([
    bucket(new Date(2026, 0, 5, 9), 100, 2), // Monday 5 Jan, 9:00
    bucket(new Date(2026, 0, 5, 22), 50), // same day, 22:00
    bucket(new Date(2026, 0, 11, 9), 30), // Sunday 11 Jan
    bucket(new Date(2026, 2, 1, 0), 20), // Sunday 1 Mar, midnight
    bucket(new Date(2025, 11, 31, 23), 10), // Wednesday 31 Dec 2025
  ]);

  it('splits listening time by month, hour and weekday in local time', () => {
    expect(stats.months[0]).toBe(180);
    expect(stats.months[2]).toBe(20);
    expect(stats.months[11]).toBe(10);
    expect(stats.hours[9]).toBe(130);
    expect(stats.hours[22]).toBe(50);
    expect(stats.hours[0]).toBe(20);
  });

  it('puts Monday first and Sunday last', () => {
    expect(stats.weekdays[0]).toBe(150); // Monday
    expect(stats.weekdays[6]).toBe(50); // the two Sundays
    expect(stats.weekdays[2]).toBe(10); // Wednesday
  });

  it('totals each day, month and year', () => {
    expect(stats.days.get(day(2026, 1, 5))).toEqual({ ms: 150, plays: 3 });
    expect(stats.days.size).toBe(4);
    expect(stats.yearMonths.get('2026-0')).toEqual({ ms: 180, plays: 4 });
    expect(stats.years.get(2025)).toEqual({ ms: 10, plays: 1 });
    expect(stats.years.get(2026)).toEqual({ ms: 200, plays: 5 });
  });

  it('is empty without plays', () => {
    const empty = aggregate([]);
    expect(empty.days.size).toBe(0);
    expect(empty.months.every((m) => m === 0)).toBe(true);
  });
});

describe('longestStreak', () => {
  it('finds the longest run of consecutive days', () => {
    const days = [day(2026, 1, 1), day(2026, 1, 2), day(2026, 1, 4), day(2026, 1, 5), day(2026, 1, 6), day(2026, 1, 9)];
    expect(longestStreak(days)).toEqual({ days: 3, start: day(2026, 1, 4), end: day(2026, 1, 6) });
  });

  it('does not care about the order of the days', () => {
    expect(longestStreak([day(2026, 1, 3), day(2026, 1, 1), day(2026, 1, 2)])?.days).toBe(3);
  });

  it('continues across months, years and the clock change', () => {
    expect(longestStreak([day(2025, 12, 31), day(2026, 1, 1)])?.days).toBe(2);
    // Last weekend of March: a 23-hour day in Europe.
    expect(longestStreak([day(2026, 3, 28), day(2026, 3, 29), day(2026, 3, 30)])?.days).toBe(3);
    // Last weekend of October: a 25-hour day.
    expect(longestStreak([day(2026, 10, 24), day(2026, 10, 25), day(2026, 10, 26)])?.days).toBe(3);
  });

  it('keeps the first of two equal streaks', () => {
    expect(longestStreak([day(2026, 1, 1), day(2026, 1, 2), day(2026, 1, 10), day(2026, 1, 11)])?.start).toBe(day(2026, 1, 1));
  });

  it('is null without days and 1 with a single day', () => {
    expect(longestStreak([])).toBeNull();
    expect(longestStreak([day(2026, 5, 5)])).toEqual({ days: 1, start: day(2026, 5, 5), end: day(2026, 5, 5) });
  });
});

describe('topDay and indexOfMax', () => {
  it('finds the day with the most listening', () => {
    const days = new Map([
      [day(2026, 1, 1), { ms: 10, plays: 1 }],
      [day(2026, 1, 2), { ms: 90, plays: 4 }],
      [day(2026, 1, 3), { ms: 40, plays: 2 }],
    ]);
    expect(topDay(days)).toEqual({ date: day(2026, 1, 2), ms: 90 });
    expect(topDay(new Map())).toBeNull();
  });

  it('returns the first index of the highest value', () => {
    expect(indexOfMax([1, 5, 3, 5])).toBe(1);
    expect(indexOfMax([0, 0, 0])).toBe(0);
  });
});

describe('lastMonths and lastDays', () => {
  const stats = aggregate([bucket(new Date(2026, 0, 15, 10), 70, 2), bucket(new Date(2025, 10, 3, 10), 30, 1)]);

  it('lists the last months oldest first, with zeros for silent ones', () => {
    const months = lastMonths(stats, 4, new Date(2026, 1, 10));
    expect(months).toEqual([
      { year: 2025, month: 10, ms: 30, plays: 1 },
      { year: 2025, month: 11, ms: 0, plays: 0 },
      { year: 2026, month: 0, ms: 70, plays: 2 },
      { year: 2026, month: 1, ms: 0, plays: 0 },
    ]);
  });

  it('lists the last days up to today', () => {
    const days = lastDays(stats, 3, new Date(2026, 0, 16, 18));
    expect(days).toEqual([
      { date: day(2026, 1, 14), ms: 0, plays: 0 },
      { date: day(2026, 1, 15), ms: 70, plays: 2 },
      { date: day(2026, 1, 16), ms: 0, plays: 0 },
    ]);
  });
});
