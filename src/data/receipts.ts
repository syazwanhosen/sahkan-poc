// Generates a month of point-of-sale receipts that add up to exact totals,
// so the month-end split always reconciles to the cent.
import type { Receipt } from '../types';
import { DAY, HOUR } from '../lib/clock';
import { rng } from '../lib/ids';

export interface ReceiptSpec {
  key: string;
  fileName: string;
  prefix: string;
  pad: number;
  start: number;
  count: number;
  /** Midnight (Kuala Lumpur) on the first day of the month. */
  from: number;
  days: number;
  /** Total of every receipt that is neither above RM10,000 nor already issued on request. */
  consolidatedCents: number;
  big: number[];
  requested: { no: string; cents: number }[];
  /** Receipts with a known amount that stay in the consolidated group (open buyer requests). */
  fixed: { no: string; cents: number }[];
  seed: number;
}

export const SPECS: Record<string, ReceiptSpec> = {};

export function registerSpec(s: ReceiptSpec): ReceiptSpec {
  SPECS[s.key] = s;
  return s;
}

export const receiptNo = (s: ReceiptSpec, seq: number) => s.prefix + String(seq).padStart(s.pad, '0');

/** Receipts spread through the month, during opening hours (10 am to 10 pm). */
export function receiptAt(s: ReceiptSpec, idx: number): number {
  const r = rng(s.seed * 31 + idx * 7 + 1)();
  const pos = (idx + 0.1 + r * 0.8) / s.count;
  const dayF = pos * s.days;
  const day = Math.floor(dayF);
  return Math.round(s.from + day * DAY + 10 * HOUR + (dayF - day) * 12 * HOUR);
}

export function receiptAtNo(s: ReceiptSpec, no: string): number {
  return receiptAt(s, parseInt(no.slice(s.prefix.length), 10) - s.start);
}

function gauss(rand: () => number): number {
  const u = Math.max(1e-9, rand());
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const cache = new Map<string, Receipt[]>();

export function makeReceipts(s: ReceiptSpec): Receipt[] {
  const hit = cache.get(s.key);
  if (hit) return hit;
  const rand = rng(s.seed);
  const n = s.count;
  const cents = new Array<number>(n).fill(-1);
  const kind = new Array<'c' | 'r' | 'f' | 'b'>(n).fill('c');
  const idxOf = (no: string) => parseInt(no.slice(s.prefix.length), 10) - s.start;

  for (const r of s.requested) {
    const i = idxOf(r.no);
    cents[i] = r.cents;
    kind[i] = 'r';
  }
  for (const r of s.fixed) {
    const i = idxOf(r.no);
    cents[i] = r.cents;
    kind[i] = 'f';
  }
  const sep = (i: number) => kind[i] === 'r' || kind[i] === 'b';
  const blocked = (i: number) => i < 2 || i > n - 3 || kind[i] !== 'c' || sep(i - 1) || sep(i + 1);
  for (const b of s.big) {
    let i = 0;
    let tries = 0;
    do {
      i = Math.floor(rand() * n);
      tries++;
    } while (blocked(i) && tries < 10_000);
    cents[i] = b;
    kind[i] = 'b';
  }

  const free: number[] = [];
  for (let i = 0; i < n; i++) if (cents[i] < 0) free.push(i);
  const target = s.consolidatedCents - s.fixed.reduce((a, r) => a + r.cents, 0);
  const weights = free.map(() => Math.exp(gauss(rand) * 0.85));
  const W = weights.reduce((a, b) => a + b, 0);
  let sum = 0;
  free.forEach((i, k) => {
    const c = Math.min(990_000, Math.max(590, Math.round(((weights[k] / W) * target) / 10) * 10));
    cents[i] = c;
    sum += c;
  });
  let maxI = free[0];
  for (const i of free) if (cents[i] > cents[maxI]) maxI = i;
  cents[maxI] += target - sum;

  const out: Receipt[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ no: receiptNo(s, s.start + i), seq: s.start + i, at: receiptAt(s, i), cents: cents[i] });
  }
  cache.set(s.key, out);
  return out;
}
