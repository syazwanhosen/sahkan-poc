import type { Receipt } from '../types';

/** RM10,000.00 in cents. A single sale above this needs its own e-invoice. */
export const BIG_CENTS = 1_000_000;

export interface RunLine {
  from: string;
  to: string;
  fromSeq: number;
  toSeq: number;
  count: number;
  cents: number;
}

export interface Split {
  receipts: number;
  totalCents: number;
  consolidated: Receipt[];
  individual: Receipt[];
  requested: Receipt[];
  pending: Receipt[];
  lines: RunLine[];
  cCents: number;
  iCents: number;
  rCents: number;
}

/**
 * Splits a month of receipts the way LHDN's rules require:
 * receipts a buyer already got an e-invoice for are left out, single sales above
 * RM10,000 get their own e-invoice, and the rest go into one consolidated e-invoice,
 * one line per unbroken run of receipt numbers.
 */
export function computeSplit(receipts: Receipt[], issued: Set<string>, pendingNos: Set<string>): Split {
  const consolidated: Receipt[] = [];
  const individual: Receipt[] = [];
  const requested: Receipt[] = [];
  let cCents = 0;
  let iCents = 0;
  let rCents = 0;
  for (const r of receipts) {
    if (issued.has(r.no)) {
      requested.push(r);
      rCents += r.cents;
    } else if (r.cents > BIG_CENTS) {
      individual.push(r);
      iCents += r.cents;
    } else {
      consolidated.push(r);
      cCents += r.cents;
    }
  }
  const lines: RunLine[] = [];
  let cur: RunLine | null = null;
  for (const r of consolidated) {
    if (cur && r.seq === cur.toSeq + 1) {
      cur.toSeq = r.seq;
      cur.to = r.no;
      cur.count += 1;
      cur.cents += r.cents;
    } else {
      cur = { from: r.no, to: r.no, fromSeq: r.seq, toSeq: r.seq, count: 1, cents: r.cents };
      lines.push(cur);
    }
  }
  return {
    receipts: receipts.length,
    totalCents: cCents + iCents + rCents,
    consolidated,
    individual,
    requested,
    pending: consolidated.filter((r) => pendingNos.has(r.no)),
    lines,
    cCents,
    iCents,
    rCents,
  };
}
