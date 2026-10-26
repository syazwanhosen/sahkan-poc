// Everything the demo can do. MyInvois is simulated here: submissions are
// accepted at once, then validated a moment later by the same field rules
// the real system applies, exactly as the asynchronous API behaves.
import type {
  Buyer,
  Doc,
  DocError,
  DocEvent,
  DocType,
  EventKind,
  Item,
  Line,
  Party,
  RequestItem,
  Receipt,
  Settings,
  State,
  TinStatus,
} from '../types';
import { CANCEL_WINDOW, PERIOD, now } from '../lib/clock';
import { lhdnId, uid } from '../lib/ids';
import { DOC_PREFIX, RM10K, checkTin, partyProblems, totals } from '../lib/rules';
import { periodMonth } from '../lib/format';
import { GENERAL_PUBLIC, partyOf } from '../data/seed';
import { SPECS } from '../data/receipts';
import { getState, resetState, setState } from './store';
import { navigate, type Route } from './nav';
import { splitOf, branchName, bizById } from './select';
import { toast } from './toast';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const quick = () => getState().settings.speed === 'quick';
const ev = (t: number, kind: EventKind, label: string): DocEvent => ({ t, kind, label });
const pad4 = (n: number) => String(n).padStart(4, '0');

function mapDocs(s: State, ids: Set<string>, f: (d: Doc) => Doc): Doc[] {
  return s.docs.map((d) => (ids.has(d.id) ? f(d) : d));
}

export function peekNumber(s: State, bizId: string, type: DocType): string {
  return DOC_PREFIX[type] + pad4((s.counters[bizId]?.[type] ?? 0) + 1);
}

function takeNumber(bizId: string, type: DocType): string {
  let out = '';
  setState((s) => {
    const cur = s.counters[bizId] ?? { '01': 0, '02': 0, '03': 0, '04': 0 };
    const next = cur[type] + 1;
    out = DOC_PREFIX[type] + pad4(next);
    return { ...s, counters: { ...s.counters, [bizId]: { ...cur, [type]: next } } };
  });
  return out;
}

// ---------------------------------------------------------------------------
// Drafts and submission

export interface Draft {
  id?: string;
  type: DocType;
  number: string;
  numberTouched: boolean;
  branchId: string;
  issuedAt: number;
  issuedAuto: boolean;
  buyerId?: string;
  buyer?: Party;
  tinStatus: TinStatus;
  checkedAt?: number;
  lines: Line[];
  refId?: string;
  saveBuyer: boolean;
}

export const EMPTY_PARTY: Party = {
  kind: 'company',
  name: '',
  tin: '',
  idType: 'BRN',
  idValue: '',
  email: '',
  phone: '',
  address: { line1: '', postcode: '', city: '', state: '14' },
};

export function saveDoc(bizId: string, d: Draft): string {
  const t = now();
  const s0 = getState();
  const existing = d.id ? s0.docs.find((x) => x.id === d.id) : undefined;
  let number = d.number;
  if (!existing && (!d.numberTouched || number === peekNumber(s0, bizId, d.type))) number = takeNumber(bizId, d.type);
  const buyer = partyOf(d.buyer ?? EMPTY_PARTY);
  const id = existing?.id ?? uid('doc');
  setState((s) => {
    const buyers =
      d.saveBuyer && d.buyerId
        ? s.buyers.map((b) => (b.id === d.buyerId ? { ...b, ...buyer, tinStatus: d.tinStatus, checkedAt: d.checkedAt ?? b.checkedAt } : b))
        : s.buyers;
    const fields = {
      type: d.type,
      number,
      branchId: d.branchId,
      issuedAt: d.issuedAt,
      buyerId: d.buyerId,
      buyer,
      tinStatus: d.tinStatus,
      lines: d.lines,
      refId: d.type === '01' ? undefined : d.refId,
    };
    const doc: Doc = existing
      ? { ...existing, ...fields }
      : { id, bizId, ...fields, status: 'draft', attempts: 0, source: 'manual', events: [ev(t, 'draft', 'Draft saved')] };
    return { ...s, buyers, docs: existing ? s.docs.map((x) => (x.id === id ? doc : x)) : [doc, ...s.docs] };
  });
  return id;
}

export function submitDocs(ids: string[]) {
  const t = now();
  const submissionUid = lhdnId();
  const set = new Set(ids);
  setState((s) => ({
    ...s,
    docs: mapDocs(s, set, (d) => ({
      ...d,
      status: 'submitted',
      submissionUid,
      uuid: lhdnId(),
      longId: undefined,
      submittedAt: t,
      validatedAt: undefined,
      errors: undefined,
      attempts: d.attempts + 1,
      events: [...d.events, d.attempts > 0 ? ev(t, 'resubmitted', 'Sent to LHDN again') : ev(t, 'submitted', 'Sent to LHDN')],
    })),
  }));
  scheduleValidation(ids);
}

function scheduleValidation(ids: string[]) {
  const base = quick() ? 650 : 2000;
  const step = ids.length > 3 ? 240 : 380;
  ids.forEach((id, i) => setTimeout(() => validateOne(id), base + i * step + Math.random() * 200));
}

/** Docs left in "submitted" (a reload mid-submission) get their answer again. */
export function resumePending() {
  const ids = getState()
    .docs.filter((d) => d.status === 'submitted')
    .map((d) => d.id);
  if (ids.length) scheduleValidation(ids);
}

function fieldPath(field: string): string {
  switch (field) {
    case 'tin':
      return 'Invoice › AccountingCustomerParty › PartyIdentification (TIN)';
    case 'phone':
      return 'Invoice › AccountingCustomerParty › Contact › Telephone';
    case 'email':
      return 'Invoice › AccountingCustomerParty › Contact › ElectronicMail';
    case 'postcode':
      return 'Invoice › AccountingCustomerParty › PostalAddress › PostalZone';
    case 'address':
      return 'Invoice › AccountingCustomerParty › PostalAddress › AddressLine';
    default:
      return 'Invoice › AccountingCustomerParty › PartyLegalEntity';
  }
}

/** What MyInvois would say about a document, in plain words. */
function serverCheck(d: Doc, t: number): DocError[] {
  const out: DocError[] = [];
  for (const p of partyProblems(d.buyer)) {
    const message = p.field === 'tin' ? `LHDN couldn't match the buyer's TIN ${d.buyer.tin}. ${p.message}` : p.message;
    out.push({ path: fieldPath(p.field), message, field: p.field });
  }
  if (d.buyer.kind !== 'general' && d.tinStatus === 'not-found' && !out.some((e) => e.field === 'tin')) {
    out.push({ path: fieldPath('tin'), message: `LHDN has no record of the TIN ${d.buyer.tin}.`, field: 'tin' });
  }
  d.lines.forEach((l, i) => {
    if (!l.cls) {
      out.push({
        path: `Invoice › InvoiceLine[${i + 1}] › Item › CommodityClassification`,
        message: `Line ${i + 1}, ${l.desc || 'with no description'}, has no classification code.`,
        field: `line-${i + 1}`,
      });
    }
  });
  if (t - d.issuedAt > CANCEL_WINDOW) {
    out.push({ path: 'Invoice › IssueDate', message: 'The issue date is more than 72 hours before submission.', field: 'issued' });
  }
  return out;
}

function validateOne(id: string) {
  const s = getState();
  const d = s.docs.find((x) => x.id === id);
  if (!d || d.status !== 'submitted') return;
  const t = now();
  const errors = serverCheck(d, t);
  let consumed = false;
  if (!errors.length && s.settings.rejectNext && d.source !== 'month-end') {
    consumed = true;
    errors.push({
      path: 'Invoice › AccountingCustomerParty › PartyIdentification (BRN)',
      message: "The buyer's registration or ID number doesn't match their TIN. Check it with the buyer, then submit again.",
      field: 'idValue',
    });
  }
  const one = new Set([id]);
  if (errors.length) {
    setState((s2) => ({
      ...s2,
      settings: consumed ? { ...s2.settings, rejectNext: false } : s2.settings,
      docs: mapDocs(s2, one, (x) => ({ ...x, status: 'invalid', errors, wasInvalid: true, events: [...x.events, ev(t, 'invalid', 'Rejected by LHDN')] })),
    }));
    if (d.source !== 'month-end') {
      toast(`LHDN rejected ${d.number}`, { tone: 'bad', action: { label: 'See why', run: () => navigate({ name: 'doc', id }) } });
    }
  } else {
    const big = d.type === '01' && d.source === 'manual' && totals(d.lines).total > RM10K;
    setState((s2) => ({
      ...s2,
      guide: {
        ...s2.guide,
        done: { ...s2.guide.done, fix: s2.guide.done.fix || !!d.wasInvalid, big: s2.guide.done.big || big },
      },
      docs: mapDocs(s2, one, (x) => ({ ...x, status: 'valid', validatedAt: t, longId: lhdnId(40), events: [...x.events, ev(t, 'valid', 'Validated by LHDN')] })),
    }));
    if (d.buyer.email && !d.consolidated) setTimeout(() => markEmailed(id), 900);
  }
  finishRunIfDone(id);
}

function markEmailed(id: string) {
  const t = now();
  setState((s) => ({
    ...s,
    docs: mapDocs(s, new Set([id]), (d) => (d.status === 'valid' ? { ...d, emailedAt: t, events: [...d.events, ev(t, 'emailed', 'Emailed to buyer')] } : d)),
  }));
}

function finishRunIfDone(docId: string) {
  const s = getState();
  const run = s.runs.find((r) => r.stage === 'submitting' && r.docIds.includes(docId));
  if (!run) return;
  const docs = s.docs.filter((d) => run.docIds.includes(d.id));
  if (docs.some((d) => d.status === 'submitted')) return;
  const t = now();
  setState((s2) => ({
    ...s2,
    runs: s2.runs.map((r) => (r.id === run.id ? { ...r, stage: 'done', doneAt: t } : r)),
    guide: { ...s2.guide, done: { ...s2.guide.done, monthend: true } },
  }));
  const biz = bizById(s, run.bizId);
  const bad = docs.filter((d) => d.status === 'invalid').length;
  toast(
    bad
      ? `${periodMonth(run.period)} filed for ${branchName(biz, run.branchId)}, with ${bad} to fix`
      : `${periodMonth(run.period)} month-end filed for ${biz?.short ?? ''} ${run.branchId === 'MAIN' ? '' : branchName(biz, run.branchId)}`.replace(/\s+/g, ' ').trim(),
    { tone: bad ? 'bad' : 'ok' },
  );
}

export async function cancelDoc(id: string, reason: string): Promise<{ ok: boolean; message?: string }> {
  const s = getState();
  const d = s.docs.find((x) => x.id === id);
  if (!d || d.status !== 'valid') return { ok: false, message: 'Only valid e-invoices can be cancelled.' };
  if (!d.validatedAt || now() - d.validatedAt > CANCEL_WINDOW) {
    return { ok: false, message: 'The 72-hour cancel window has closed. Use a credit note instead.' };
  }
  const notes = s.docs.filter((x) => x.refId === id && x.status === 'valid');
  if (notes.length) {
    const names = notes.map((n) => n.number).join(' and ');
    return { ok: false, message: `${names} refers to this e-invoice. LHDN needs ${notes.length === 1 ? 'it' : 'them'} cancelled first.` };
  }
  await sleep(quick() ? 450 : 1100);
  const t = now();
  setState((s2) => ({
    ...s2,
    docs: mapDocs(s2, new Set([id]), (x) => ({ ...x, status: 'cancelled', cancelledAt: t, cancelReason: reason, events: [...x.events, ev(t, 'cancelled', 'Cancelled')] })),
  }));
  toast(`${d.number} cancelled`);
  return { ok: true };
}

export function emailAgain(id: string) {
  const d = getState().docs.find((x) => x.id === id);
  if (!d || !d.buyer.email) return;
  const t = now();
  setState((s) => ({
    ...s,
    docs: mapDocs(s, new Set([id]), (x) => ({ ...x, emailedAt: t, events: [...x.events, ev(t, 'emailed', 'Emailed to buyer again')] })),
  }));
  toast(`Emailed ${d.number} to ${d.buyer.email}`);
}

const NOT_FOUND = new Set(['C99999999990', 'IG99999999999']);

export async function verifyTin(tin: string): Promise<TinStatus> {
  await sleep(quick() ? 350 : 800);
  const t = tin.trim().toUpperCase();
  return checkTin(t).ok && !NOT_FOUND.has(t) ? 'verified' : 'not-found';
}

// ---------------------------------------------------------------------------
// Buyer requests

export function issueRequest(reqId: string, fixedTin?: string): string | null {
  const s = getState();
  const r = s.requests.find((x) => x.id === reqId);
  if (!r || r.status !== 'pending') return null;
  const buyer: Party = { ...partyOf(r.buyer), tin: (fixedTin ?? r.buyer.tin).toUpperCase() };
  if (!checkTin(buyer.tin).ok) return null;
  const number = takeNumber(r.bizId, '01');
  const t = now();
  const id = uid('doc');
  setState((s2) => {
    let buyers = s2.buyers;
    let buyerId = buyers.find((b) => b.bizId === r.bizId && b.tin === buyer.tin)?.id;
    if (!buyerId) {
      buyerId = uid('b');
      buyers = [...buyers, { id: buyerId, bizId: r.bizId, ...buyer, tinStatus: 'verified', checkedAt: t }];
    }
    const doc: Doc = {
      id,
      bizId: r.bizId,
      type: '01',
      number,
      branchId: r.branchId,
      buyerId,
      buyer,
      tinStatus: 'verified',
      issuedAt: t,
      lines: r.items.map((i) => ({ id: uid('ln'), ...i, tax: '06' as const })),
      status: 'draft',
      attempts: 0,
      source: 'request',
      receiptNo: r.receiptNo,
      requestId: r.id,
      events: [ev(t, 'draft', `Made from the buyer's request, receipt ${r.receiptNo}`)],
    };
    return {
      ...s2,
      buyers,
      docs: [doc, ...s2.docs],
      requests: s2.requests.map((x) => (x.id === reqId ? { ...x, status: 'issued', docId: id, buyer, tinStatus: 'verified', fresh: false } : x)),
      guide: { ...s2.guide, done: { ...s2.guide.done, request: true } },
    };
  });
  submitDocs([id]);
  return id;
}

export function declineRequest(reqId: string, reason: string) {
  setState((s) => ({
    ...s,
    requests: s.requests.map((r) => (r.id === reqId ? { ...r, status: 'declined', declineReason: reason, fresh: false } : r)),
  }));
  toast('Request declined. The buyer gets an email with your reason.', { tone: 'info' });
}

export function createRequest(p: { bizId: string; branchId: string; receiptNo: string; receiptAt: number; items: RequestItem[]; buyer: Party }): string {
  const id = uid('rq');
  setState((s) => ({
    ...s,
    requests: [{ id, ...p, requestedAt: now(), tinStatus: 'verified', channel: 'receipt-qr', status: 'pending', fresh: true }, ...s.requests],
  }));
  if (getState().settings.autoIssue) {
    setTimeout(() => {
      const docId = issueRequest(id);
      if (docId) toast(`Issued an e-invoice to ${p.buyer.name} automatically`, { action: { label: 'View', run: () => navigate({ name: 'doc', id: docId }) } });
    }, 1100);
  } else {
    toast(`${p.buyer.name} asked for an e-invoice`, { tone: 'info' });
  }
  return id;
}

// ---------------------------------------------------------------------------
// Month-end

export function importSample(runId: string) {
  const run = getState().runs.find((r) => r.id === runId);
  const spec = run?.sampleSpec ? SPECS[run.sampleSpec] : undefined;
  if (!run || !spec) return;
  const t = now();
  setState((s) => ({
    ...s,
    runs: s.runs.map((r) => (r.id === runId ? { ...r, stage: 'imported', file: { name: spec.fileName, at: t, spec: spec.key } } : r)),
  }));
}

export function importRows(runId: string, name: string, rows: Receipt[], skipped: number) {
  const t = now();
  setState((s) => ({
    ...s,
    runs: s.runs.map((r) => (r.id === runId ? { ...r, stage: 'imported', file: { name, at: t, rows, skipped } } : r)),
  }));
}

export function clearFile(runId: string) {
  setState((s) => ({ ...s, runs: s.runs.map((r) => (r.id === runId ? { ...r, stage: 'no-file', file: undefined } : r)) }));
}

export function submitRun(runId: string): number {
  const s = getState();
  const run = s.runs.find((r) => r.id === runId);
  if (!run || run.stage !== 'imported') return 0;
  const split = splitOf(s, run);
  const t = now();
  const docs: Doc[] = [];
  const [y, m] = run.period.split('-');
  if (split.lines.length) {
    docs.push({
      id: uid('doc'),
      bizId: run.bizId,
      type: '01',
      number: `CON-${y.slice(2)}${m}-${run.branchId}`,
      branchId: run.branchId,
      buyer: GENERAL_PUBLIC,
      tinStatus: 'verified',
      issuedAt: t,
      lines: split.lines.map((l) => ({
        id: uid('ln'),
        desc: l.from === l.to ? `Receipt ${l.from}` : `Receipts ${l.from} to ${l.to}`,
        cls: '004',
        qty: 1,
        price: l.cents / 100,
        tax: '06' as const,
      })),
      status: 'draft',
      attempts: 0,
      source: 'month-end',
      consolidated: { period: run.period, branchId: run.branchId, receipts: split.consolidated.length },
      events: [ev(t, 'draft', `Built from ${run.file?.name ?? 'the sales file'}`)],
    });
  }
  for (const r of split.individual) {
    docs.push({
      id: uid('doc'),
      bizId: run.bizId,
      type: '01',
      number: takeNumber(run.bizId, '01'),
      branchId: run.branchId,
      buyer: GENERAL_PUBLIC,
      tinStatus: 'verified',
      issuedAt: t,
      lines: [{ id: uid('ln'), desc: `Sale above RM10,000, receipt ${r.no}`, cls: '022', qty: 1, price: r.cents / 100, tax: '06' }],
      status: 'draft',
      attempts: 0,
      source: 'month-end',
      receiptNo: r.no,
      events: [ev(t, 'draft', `Taken out of the month-end file, receipt ${r.no}`)],
    });
  }
  const ids = docs.map((d) => d.id);
  setState((s2) => ({
    ...s2,
    docs: [...docs, ...s2.docs],
    runs: s2.runs.map((r) => (r.id === runId ? { ...r, stage: 'submitting', docIds: ids, submittedAt: t } : r)),
  }));
  submitDocs(ids);
  return ids.length;
}

// ---------------------------------------------------------------------------
// Accountant view

export function switchPersona(p: State['persona']) {
  setState((s) => ({
    ...s,
    persona: p,
    activeBizId: p === 'owner' ? 'jaya' : null,
    guide: p === 'accountant' ? { ...s.guide, done: { ...s.guide.done, accountant: true } } : s.guide,
  }));
  navigate(p === 'owner' ? { name: 'today' } : { name: 'clients' });
}

export function openClient(bizId: string | null, route?: Route) {
  setState((s) => ({ ...s, activeBizId: bizId }));
  navigate(route ?? (bizId ? { name: 'today' } : { name: 'clients' }));
}

export function sendReminders(bizIds: string[]) {
  if (!bizIds.length) return;
  const t = now();
  setState((s) => ({ ...s, clients: s.clients.map((c) => (c.bizId && bizIds.includes(c.bizId) ? { ...c, remindedAt: t } : c)) }));
  toast(bizIds.length === 1 ? 'Reminder sent' : `Reminders sent to ${bizIds.length} clients`);
  // In the demo, the furniture shop answers within seconds.
  if (bizIds.includes('seri')) {
    setTimeout(() => {
      const run = getState().runs.find((r) => r.bizId === 'seri' && r.period === PERIOD);
      if (!run || run.stage !== 'no-file') return;
      importSample(run.id);
      toast('Kedai Perabot Seri sent their October sales file', {
        tone: 'info',
        action: { label: 'Review', run: () => openClient('seri', { name: 'monthend', runId: run.id }) },
      });
    }, 6500);
  }
}

export function addClient(name: string, tin: string, email: string) {
  setState((s) => ({ ...s, clients: [...s.clients, { id: uid('c'), name, tin, invitedEmail: email, invitedAt: now() }] }));
  toast(`Invite sent to ${email}`);
}

// ---------------------------------------------------------------------------
// Directory, settings, demo

export function addBuyer(bizId: string, p: Party, tinStatus: TinStatus): string {
  const id = uid('b');
  setState((s) => ({ ...s, buyers: [...s.buyers, { id, bizId, ...partyOf(p), tinStatus, checkedAt: tinStatus === 'verified' ? now() : undefined }] }));
  return id;
}

export function updateBuyer(id: string, patch: Partial<Buyer>) {
  setState((s) => ({ ...s, buyers: s.buyers.map((b) => (b.id === id ? { ...b, ...patch } : b)) }));
}

export function addItem(item: Omit<Item, 'id'>): string {
  const id = uid('i');
  setState((s) => ({ ...s, items: [...s.items, { id, ...item }] }));
  return id;
}

export function setSettings(patch: Partial<Settings>) {
  setState((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
}

export function setGuideOpen(open: boolean) {
  setState((s) => ({ ...s, guide: { ...s.guide, open } }));
}

export function resetDemo() {
  resetState();
  navigate({ name: 'today' }, { replace: true });
  toast('Demo reset to its starting point');
}
