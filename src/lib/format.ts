import { locale } from './i18n';

export function startOfYear(now = new Date()) {
  return new Date(now.getFullYear(), 0, 1).getTime();
}

export function formatNumber(n: number) {
  return Math.round(n).toLocaleString(locale());
}

/** One decimal at most: "4,5". */
export function formatDecimal(n: number) {
  return n.toLocaleString(locale(), { maximumFractionDigits: 1 });
}

export function msToMinutes(ms: number) {
  return Math.round(ms / 60_000);
}

/** "12 h 05 min" */
export function formatDuration(ms: number) {
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} min`;
  return `${formatNumber(h)} h ${String(m).padStart(2, '0')} min`;
}

/** "3 gen 2026" */
export function formatDate(ms: number) {
  return new Date(ms).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "sabato 3 gennaio 2026" */
export function formatLongDate(ms: number) {
  return new Date(ms).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/** "20:13" */
export function formatTime(ms: number) {
  return new Date(ms).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
}

/** "3 gen, 20:13" */
export function formatDateTime(ms: number) {
  return new Date(ms).toLocaleString(locale(), {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
