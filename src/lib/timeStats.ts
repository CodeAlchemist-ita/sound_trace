import { HOUR_MS } from './db';

/** Turns hourly buckets (UTC hours since epoch) into local-time breakdowns. */
export type TimeStats = {
  months: number[]; // ms per calendar month, 0 = January
  hours: number[]; // ms per hour of day
  weekdays: number[]; // ms per weekday, 0 = Monday
  /** Local midnight → { ms, plays }. */
  days: Map<number, { ms: number; plays: number }>;
  /** "2026-0" (year-month) → { ms, plays }. */
  yearMonths: Map<string, { ms: number; plays: number }>;
  years: Map<number, { ms: number; plays: number }>;
};

export function aggregate(buckets: { h: number; ms: number; n: number }[]): TimeStats {
  const t: TimeStats = {
    months: new Array<number>(12).fill(0),
    hours: new Array<number>(24).fill(0),
    weekdays: new Array<number>(7).fill(0),
    days: new Map(),
    yearMonths: new Map(),
    years: new Map(),
  };
  const add = <K>(map: Map<K, { ms: number; plays: number }>, key: K, ms: number, n: number) => {
    const cur = map.get(key) ?? { ms: 0, plays: 0 };
    cur.ms += ms;
    cur.plays += n;
    map.set(key, cur);
  };
  for (const { h, ms, n } of buckets) {
    const d = new Date(h * HOUR_MS);
    t.months[d.getMonth()] += ms;
    t.hours[d.getHours()] += ms;
    t.weekdays[(d.getDay() + 6) % 7] += ms;
    add(t.days, new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), ms, n);
    add(t.yearMonths, `${d.getFullYear()}-${d.getMonth()}`, ms, n);
    add(t.years, d.getFullYear(), ms, n);
  }
  return t;
}

export function indexOfMax(values: number[]) {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (values[i] > values[best]) best = i;
  return best;
}

/** Days are local midnights; DST makes some days 23/25h long, so step by calendar day. */
export function longestStreak(days: Iterable<number>): { days: number; start: number; end: number } | null {
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  let best = { days: 1, start: sorted[0], end: sorted[0] };
  let cur = { ...best };
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1]);
    const next = new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + 1).getTime();
    cur = sorted[i] === next ? { days: cur.days + 1, start: cur.start, end: sorted[i] } : { days: 1, start: sorted[i], end: sorted[i] };
    if (cur.days > best.days) best = cur;
  }
  return best;
}

export function topDay(days: TimeStats['days']): { date: number; ms: number } | null {
  let best: { date: number; ms: number } | null = null;
  for (const [date, { ms }] of days) if (!best || ms > best.ms) best = { date, ms };
  return best;
}

/** The last `count` calendar months up to `now`, oldest first, with their totals. */
export function lastMonths(t: TimeStats, count: number, now = new Date()) {
  const out: { year: number; month: number; ms: number; plays: number }[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const v = t.yearMonths.get(`${d.getFullYear()}-${d.getMonth()}`) ?? { ms: 0, plays: 0 };
    out.push({ year: d.getFullYear(), month: d.getMonth(), ...v });
  }
  return out;
}

/** The last `count` days up to `now`, oldest first. */
export function lastDays(t: TimeStats, count: number, now = new Date()) {
  const out: { date: number; ms: number; plays: number }[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i).getTime();
    out.push({ date, ...(t.days.get(date) ?? { ms: 0, plays: 0 }) });
  }
  return out;
}
