import { DAY, HOUR, MIN } from './clock';

const TZ = 'Asia/Kuala_Lumpur';
const clean = (s: string) => s.replace(/[  ]/g, ' ');

const money = new Intl.NumberFormat('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const whole = new Intl.NumberFormat('en-MY');
const fDayMon = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'short' });
const fDate = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' });
const fTime = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true });
const fWeekday = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'long' });
const fLong = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' });
const fMonthYear = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, month: 'long', year: 'numeric' });
const fMonth = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, month: 'long' });

/** 12,480.00 (no currency), with a true minus sign for negatives. */
export const rm = (n: number) => (n < 0 ? '−' : '') + money.format(Math.abs(n));
/** RM 12,480.00 */
export const rmx = (n: number) => (n < 0 ? '−' : '') + 'RM ' + money.format(Math.abs(n));
export const int = (n: number) => whole.format(n);
export const cents = (c: number) => rm(c / 100);
export const centsx = (c: number) => rmx(c / 100);

export const dayMon = (t: number) => clean(fDayMon.format(t));
export const date = (t: number) => clean(fDate.format(t));
export const time = (t: number) => clean(fTime.format(t)).replace(/^0/, '');
export const dateTime = (t: number) => `${date(t)}, ${time(t)}`;
export const longDay = (t: number) => `${fWeekday.format(t)}, ${clean(fLong.format(t))}`;
export const monthYear = (t: number) => fMonthYear.format(t);
export const monthName = (t: number) => fMonth.format(t);

export function periodLabel(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return fMonthYear.format(Date.UTC(y, m - 1, 15));
}

export function periodMonth(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return fMonth.format(Date.UTC(y, m - 1, 15));
}

export function ago(t: number, nowT: number): string {
  const d = nowT - t;
  if (d < 45_000) return 'just now';
  if (d < HOUR) return `${Math.max(1, Math.round(d / MIN))} min ago`;
  if (d < DAY) return `${Math.floor(d / HOUR)} h ago`;
  if (d < 2 * DAY) return 'yesterday';
  if (d < 7 * DAY) return `${Math.floor(d / DAY)} days ago`;
  return date(t);
}

/** 71 h 12 m */
export function left(ms: number): string {
  if (ms <= 0) return 'closed';
  const h = Math.floor(ms / HOUR);
  const m = Math.floor((ms % HOUR) / MIN);
  if (h > 0) return `${h} h ${m} m`;
  if (m > 0) return `${m} m`;
  return 'under a minute';
}

/** 71 h, or 45 min */
export function leftShort(ms: number): string {
  if (ms <= 0) return 'closed';
  const h = Math.floor(ms / HOUR);
  if (h > 0) return `${h} h`;
  return `${Math.max(1, Math.floor(ms / MIN))} min`;
}

/** Whole days left before a deadline: "4 days left", "due today". */
export function daysLeft(ms: number): string {
  if (ms <= 0) return 'overdue';
  const d = Math.floor(ms / DAY);
  if (d === 0) return 'due today';
  return d === 1 ? '1 day left' : `${d} days left`;
}

/** Value for <input type="datetime-local">, in Kuala Lumpur time. */
export function toLocalInput(t: number): string {
  return new Date(t + 8 * HOUR).toISOString().slice(0, 16);
}

export function fromLocalInput(v: string): number | null {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  return Date.UTC(y, mo - 1, d, h - 8, mi);
}

export const plural = (n: number, one: string, many = one + 's') => `${int(n)} ${n === 1 ? one : many}`;

export function maskId(v: string): string {
  if (!v || v === 'NA') return v;
  const tail = v.slice(-4);
  return '•'.repeat(Math.max(4, v.length - 4)) + ' ' + tail;
}

export function initials(name: string): string {
  const words = name
    .replace(/\b(sdn|bhd|bin|binti|a\/l|a\/p)\b/gi, '')
    .split(/\s+/)
    .filter(Boolean);
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase() || '?';
}
