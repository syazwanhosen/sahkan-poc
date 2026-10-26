// The demo runs on its own clock: it starts on Tuesday 3 November 2026 at 10:15 am
// in Kuala Lumpur, four days before October's consolidated e-invoices are due,
// and then moves forward in real time so countdowns tick.

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

/** Kuala Lumpur wall-clock time (UTC+8) to a timestamp. Month is 1-based. */
export function myt(y: number, m: number, d: number, hh = 0, mm = 0, ss = 0): number {
  return Date.UTC(y, m - 1, d, hh - 8, mm, ss);
}

export const DEMO_START = myt(2026, 11, 3, 10, 15);
export const PERIOD = '2026-10';
export const PERIOD_DUE = myt(2026, 11, 7, 23, 59);
export const CANCEL_WINDOW = 72 * HOUR;

let realStart = Date.now();

export function startClock(at?: number) {
  realStart = at ?? Date.now();
}

export function realStartOf(): number {
  return realStart;
}

export function now(): number {
  return DEMO_START + Math.max(0, Date.now() - realStart);
}
