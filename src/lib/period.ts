import { startOfYear } from './format';
import { msg, t } from './i18n';

/** Rolling periods, the current year, all time, or a past calendar year ("y2025"). */
export type Period = 'week' | 'month' | 'year' | 'all' | `y${number}`;

/** Labels are Italian keys: show them with `t(p.label)`. */
export const PERIODS: { key: Period; label: string }[] = [
  { key: 'week', label: msg('7 giorni') },
  { key: 'month', label: msg('30 giorni') },
  { key: 'year', label: msg('Quest’anno') },
  { key: 'all', label: msg('Sempre') },
];

const DAY = 86_400_000;

export const yearPeriod = (year: number): Period => `y${year}`;

export function periodYear(period: Period): number | null {
  if (period === 'year') return new Date().getFullYear();
  return period.startsWith('y') ? Number(period.slice(1)) : null;
}

export function periodRange(period: Period, now = Date.now()) {
  if (period === 'week') return { from: now - 7 * DAY, to: now };
  if (period === 'month') return { from: now - 30 * DAY, to: now };
  if (period === 'year') return { from: startOfYear(new Date(now)), to: now };
  if (period === 'all') return { from: 0, to: now };
  const y = Number(period.slice(1));
  return { from: new Date(y, 0, 1).getTime(), to: Math.min(now, new Date(y + 1, 0, 1).getTime() - 1) };
}

/** The period just before, of the same length, for "+12% vs before" comparisons. `label` reads "rispetto a…". */
export function previousRange(period: Period, now = Date.now()): { from: number; to: number; label: string } | null {
  if (period === 'week') return { from: now - 14 * DAY, to: now - 7 * DAY, label: t('rispetto ai 7 giorni prima') };
  if (period === 'month') return { from: now - 60 * DAY, to: now - 30 * DAY, label: t('rispetto ai 30 giorni prima') };
  if (period === 'year') {
    // Same stretch of last year: Jan 1st → today's date one year ago.
    const d = new Date(now);
    const from = new Date(d.getFullYear() - 1, 0, 1).getTime();
    const to = new Date(d.getFullYear() - 1, d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()).getTime();
    return { from, to, label: t('rispetto allo stesso periodo del {year}', { year: d.getFullYear() - 1 }) };
  }
  if (period === 'all') return null;
  const y = Number(period.slice(1));
  return { from: new Date(y - 1, 0, 1).getTime(), to: new Date(y, 0, 1).getTime() - 1, label: t('rispetto al {year}', { year: y - 1 }) };
}

/** "da inizio anno", "negli ultimi 7 giorni"… for sentences under the charts. */
export function periodPhrase(period: Period) {
  if (period === 'week') return t('negli ultimi 7 giorni');
  if (period === 'month') return t('negli ultimi 30 giorni');
  if (period === 'year') return t('da inizio anno');
  if (period === 'all') return t('in tutta la cronologia');
  return t('nel {year}', { year: period.slice(1) });
}
