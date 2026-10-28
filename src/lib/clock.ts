// The demo runs on its own clock: it starts on Tuesday 3 November 2026 at 10:15 am
// in Kuala Lumpur, four days before October's consolidated e-invoices are due,
// and then moves forward in real time so countdowns tick.
// The live workspace runs on the real clock, because MyInvois checks issue times against its own.

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

/** Kuala Lumpur wall-clock time (UTC+8) to a timestamp. Month is 1-based. */
export function myt(y: number, m: number, d: number, hh = 0, mm = 0, ss = 0): number {
  return Date.UTC(y, m - 1, d, hh - 8, mm, ss);
}

export const DEMO_START = myt(2026, 11, 3, 10, 15);
export const CANCEL_WINDOW = 72 * HOUR;

// The month being closed and when its consolidated e-invoices are due. These are `let` so that
// switching clocks updates every importer (ES module bindings are live).
export let PERIOD = '2026-10';
export let PERIOD_DUE = myt(2026, 11, 7, 23, 59);

let realStart = Date.now();
let real = false;

export function startClock(at?: number) {
  realStart = at ?? Date.now();
}

export function realStartOf(): number {
  return realStart;
}

/** Real time for the live workspace; the demo clock otherwise. Last month is the one to close. */
export function setRealClock(on: boolean) {
  real = on;
  if (!on) {
    PERIOD = '2026-10';
    PERIOD_DUE = myt(2026, 11, 7, 23, 59);
    return;
  }
  const kl = new Date(Date.now() + 8 * HOUR);
  const y = kl.getUTCFullYear();
  const m = kl.getUTCMonth() + 1;
  PERIOD = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  PERIOD_DUE = myt(y, m, 7, 23, 59);
}

export const isRealClock = () => real;

export function now(): number {
  return real ? Date.now() : DEMO_START + Math.max(0, Date.now() - realStart);
}
