import type { Business, ClientMeta, Doc, MonthEndRun, Receipt, State } from '../types';
import { CANCEL_WINDOW, DAY, HOUR, PERIOD } from '../lib/clock';
import { signedTotal, totals } from '../lib/rules';
import { computeSplit, type Split } from '../lib/split';
import { SPECS, makeReceipts } from '../data/receipts';

export const bizById = (s: State, id: string | null | undefined): Business | undefined =>
  id ? s.businesses.find((b) => b.id === id) : undefined;

export const activeBiz = (s: State) => bizById(s, s.activeBizId);

export const docsOf = (s: State, bizId: string) => s.docs.filter((d) => d.bizId === bizId);

export const byNewest = (a: Doc, b: Doc) => b.issuedAt - a.issuedAt;

export const docTotal = (d: Doc) => signedTotal(d.type, d.lines);
export const docAmount = (d: Doc) => totals(d.lines).total;

export function windowLeft(d: Doc, t: number): number {
  if (d.status !== 'valid' || !d.validatedAt || d.consolidated) return 0;
  return d.validatedAt + CANCEL_WINDOW - t;
}

export const branchName = (b: Business | undefined, id: string) => b?.branches.find((x) => x.id === id)?.name ?? id;

export function attention(s: State, bizId: string, t: number) {
  const docs = docsOf(s, bizId);
  const invalid = docs.filter((d) => d.status === 'invalid').sort(byNewest);
  const closing = docs.filter((d) => {
    const left = windowLeft(d, t);
    return left > 0 && left < 24 * HOUR;
  });
  const pending = s.requests.filter((r) => r.bizId === bizId && r.status === 'pending');
  const drafts = docs.filter((d) => d.status === 'draft');
  return { invalid, closing, pending, drafts };
}

export function stats(s: State, bizId: string, t: number) {
  const since = t - 30 * DAY;
  const sent = docsOf(s, bizId).filter((d) => d.submittedAt && d.submittedAt >= since);
  const firstTry = sent.filter((d) => d.attempts === 1 && (d.status === 'valid' || d.status === 'cancelled')).length;
  const done = sent.filter((d) => d.status !== 'submitted').length;
  const invoiced = sent.filter((d) => d.status === 'valid').reduce((a, d) => a + docTotal(d), 0);
  return { count: sent.length, firstTry: done ? firstTry / done : 1, invoiced };
}

export function runsOf(s: State, bizId: string, period = PERIOD): MonthEndRun[] {
  return s.runs.filter((r) => r.bizId === bizId && r.period === period);
}

export function receiptsOf(run: MonthEndRun): Receipt[] {
  if (run.file?.rows) return run.file.rows;
  const key = run.file?.spec;
  return key && SPECS[key] ? makeReceipts(SPECS[key]) : [];
}

export function splitOf(s: State, run: MonthEndRun): Split {
  const mine = s.requests.filter((r) => r.bizId === run.bizId && r.branchId === run.branchId);
  return computeSplit(
    receiptsOf(run),
    new Set(mine.filter((r) => r.status === 'issued').map((r) => r.receiptNo)),
    new Set(mine.filter((r) => r.status === 'pending').map((r) => r.receiptNo)),
  );
}

export type ClientStatus = 'invited' | 'invalid' | 'sending' | 'waiting' | 'ready' | 'done';

export interface ClientState {
  status: ClientStatus;
  invalid: Doc[];
  runs: MonthEndRun[];
  progress: number;
  filedAt?: number;
  rank: number;
}

const RANK: Record<ClientStatus, number> = { invalid: 0, waiting: 1, ready: 2, sending: 3, invited: 4, done: 5 };

export function clientState(s: State, c: ClientMeta): ClientState {
  if (!c.bizId) return { status: 'invited', invalid: [], runs: [], progress: 0, rank: RANK.invited };
  const runs = runsOf(s, c.bizId);
  const invalid = docsOf(s, c.bizId).filter((d) => d.status === 'invalid');
  const stage = (r: MonthEndRun) => (r.stage === 'no-file' ? 0 : r.stage === 'imported' ? 2 : r.stage === 'submitting' ? 3 : 4);
  const progress = runs.length ? Math.min(...runs.map(stage)) : 0;
  let status: ClientStatus = 'done';
  if (invalid.length) status = 'invalid';
  else if (runs.some((r) => r.stage === 'submitting')) status = 'sending';
  else if (runs.some((r) => r.stage === 'no-file')) status = 'waiting';
  else if (runs.some((r) => r.stage === 'imported')) status = 'ready';
  const filedAt = status === 'done' ? Math.max(...runs.map((r) => r.doneAt ?? 0)) : undefined;
  return { status, invalid, runs, progress, filedAt, rank: RANK[status] };
}
