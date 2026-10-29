// Everything the app can do. In the demo, MyInvois is simulated: submissions are
// accepted at once, then validated a moment later by the same field rules
// the real system applies, exactly as the asynchronous API behaves.
// In the live workspace the same actions go to the real MyInvois through the
// app's server (server/handler.ts); see "Live MyInvois" below.
import type {
  Business,
  Buyer,
  Doc,
  DocError,
  DocEvent,
  DocType,
  EventKind,
  IdType,
  Item,
  Line,
  LiveRef,
  Party,
  RequestItem,
  Receipt,
  ReceivedDoc,
  Settings,
  State,
  TinStatus,
  Workspace,
} from '../types';
import { CANCEL_WINDOW, DAY, MIN, PERIOD, now } from '../lib/clock';
import { initials, periodMonth } from '../lib/format';
import { lhdnId, uid } from '../lib/ids';
import { DOC_PREFIX, GENERAL_PUBLIC_CLASS, RM10K, businessProblems, checkTin, partyProblems, stateCodeOf, totals } from '../lib/rules';
import { buildUbl, readUbl } from '../lib/ubl';
import {
  ApiError,
  errorText,
  myinvois,
  type ApiErrorDetail,
  type DocDetails,
  type DocSummary,
  type DocumentType,
  type Notice,
  type SubmitResult,
  type TaxpayerInfo,
} from '../lib/myinvois';
import { GENERAL_PUBLIC, blankBusiness, partyOf, withPeriodRuns } from '../data/seed';
import { SPECS } from '../data/receipts';
import { getState, resetState, setState, switchWorkspace } from './store';
import { askAccessKey, getLive } from './live';
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
  if (isLive()) {
    void submitLive(ids);
    return;
  }
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
  const pending = getState().docs.filter((d) => d.status === 'submitted');
  if (!isLive()) {
    if (pending.length) scheduleValidation(pending.map((d) => d.id));
    return;
  }
  // Sent but never confirmed (the page closed before LHDN answered): back to a draft to send again.
  // If LHDN did take it, the resend is caught as a duplicate rather than filed twice.
  const lost = new Set(pending.filter((d) => (!d.submissionUid || !d.uuid) && !sending.has(d.id)).map((d) => d.id));
  if (lost.size) {
    const t = now();
    setState((s) => ({
      ...s,
      docs: mapDocs(s, lost, (d) => ({ ...d, status: 'draft', events: [...d.events, ev(t, 'draft', 'LHDN never confirmed it. Send it again.')] })),
    }));
  }
  for (const id of new Set(pending.filter((d) => !lost.has(d.id) && d.submissionUid).map((d) => d.submissionUid!))) void pollSubmission(id);
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
    } else if (d.buyer.kind === 'general' && l.cls !== GENERAL_PUBLIC_CLASS) {
      out.push({
        path: `Invoice › InvoiceLine[${i + 1}] › Item › CommodityClassification`,
        message: `Line ${i + 1}: LHDN accepts a General Public buyer only on classification ${GENERAL_PUBLIC_CLASS}.`,
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
  if (d.live) {
    try {
      await myinvois.cancel(d.uuid!, reason, d.live.onBehalfOf);
    } catch (e) {
      return { ok: false, message: cancelMessage(e) };
    }
  } else {
    await sleep(quick() ? 450 : 1100);
  }
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

/** LHDN validates a TIN together with the ID it belongs to (BRN, MyKad, passport or army number). */
export async function verifyTin(p: Pick<Party, 'tin' | 'idType' | 'idValue'>): Promise<TinStatus> {
  const t = p.tin.trim().toUpperCase();
  if (isLive()) {
    const id = p.idValue.trim();
    if (!id || id.toUpperCase() === 'NA') {
      toast('Add the ID number too. LHDN checks the TIN together with it.', { tone: 'info' });
      return 'unchecked';
    }
    try {
      return (await myinvois.validateTin(t, p.idType, id, actingFor(getState().activeBizId))).valid ? 'verified' : 'not-found';
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) return 'not-found';
      toast(`Couldn't check the TIN. ${errorText(e)}`, { tone: 'bad' });
      return 'unchecked';
    }
  }
  await sleep(quick() ? 350 : 800);
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
  const why = liveBlocker(r.bizId);
  if (why) {
    toast(why, { tone: 'bad', action: { label: 'Settings', run: () => navigate({ name: 'settings' }) } });
    return null;
  }
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
  const why = liveBlocker(run.bizId);
  if (why) {
    toast(why, { tone: 'bad', action: { label: 'Settings', run: () => navigate({ name: 'settings' }) } });
    return 0;
  }
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
      lines: [{ id: uid('ln'), desc: `Sale above RM10,000, receipt ${r.no}`, cls: GENERAL_PUBLIC_CLASS, qty: 1, price: r.cents / 100, tax: '06' }],
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
    activeBizId: p === 'owner' ? (s.workspace === 'live' ? s.businesses[0].id : 'jaya') : null,
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
  if (isLive()) {
    // A real client to act for: their details are finished on the Settings page once opened.
    const id = uid('biz');
    const biz = { ...blankBusiness(id, name.trim(), tin.trim().toUpperCase()), email };
    setState((s) =>
      withPeriodRuns({
        ...s,
        businesses: [...s.businesses, biz],
        clients: [...s.clients, { id: uid('c'), bizId: id, name: biz.name, tin: biz.tin }],
        counters: { ...s.counters, [id]: { '01': 0, '02': 0, '03': 0, '04': 0 } },
      }),
    );
    toast(`${biz.name} added. Open it and finish their details in Settings.`);
    return;
  }
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

// ---------------------------------------------------------------------------
// Live MyInvois: the same actions through the app's server to the real API. Submissions are
// polled with Get Submission (LHDN asks for 3 to 5 seconds between calls); Get Document Details
// is only called for the reasons a document is invalid.

const isLive = () => getState().workspace === 'live';
const iso = (t: number) => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Documents whose submission is on its way to LHDN, still waiting for the answer. */
const sending = new Set<string>();

/** The client's TIN when the accountant acts for them (intermediary login), else undefined. */
function actingFor(bizId: string | null | undefined): string | undefined {
  const s = getState();
  const b = bizById(s, bizId);
  if (s.persona !== 'accountant' || !b?.tin) return undefined;
  // Individuals who also hold a business registration log in as TIN:ROB.
  return b.tin.startsWith('IG') && b.brn && (b.idType ?? 'BRN') === 'BRN' ? `${b.tin}:${b.brn}` : b.tin;
}

/**
 * The server's ERP system belongs to one taxpayer, and MyInvois rejects any document whose
 * supplier TIN is another ("The authenticated TIN and documents TIN is not matching").
 * An intermediary logs in for the client's own TIN, so only the owner view can mismatch.
 */
export function tinMismatch(bizId: string): string | null {
  const s = getState();
  const logged = getLive()?.taxpayerTin?.trim().toUpperCase();
  const b = bizById(s, bizId);
  if (s.workspace !== 'live' || s.persona === 'accountant' || !logged || !b?.tin.trim()) return null;
  if (b.tin.trim().toUpperCase() === logged) return null;
  return `The server's MyInvois credentials belong to TIN ${logged}, but ${b.name || 'this business'} is ${b.tin.toUpperCase()}. Register an ERP system under ${b.tin.toUpperCase()} and use its client ID and secret, or set the business to ${logged}.`;
}

/** Why nothing can be sent for this business right now, or null. */
export function liveBlocker(bizId: string): string | null {
  if (!isLive()) return null;
  if (getLive()?.locked) return 'The server needs its access key before anything goes to MyInvois. Enter it in Settings.';
  if (!getLive()?.configured) return "MyInvois isn't set up on the server, so nothing can be sent.";
  const mismatch = tinMismatch(bizId);
  if (mismatch) return mismatch;
  const b = bizById(getState(), bizId);
  if (b && businessProblems(b).length) return `Finish ${b.name || 'the business'} details in Settings before sending to LHDN.`;
  return null;
}

/** "/ubl:Invoice/cac:AccountingCustomerParty/cbc:ID" or "Invoice.AccountingCustomerParty[0].ID" as "Invoice › AccountingCustomerParty › ID". */
function readablePath(p?: string): string {
  if (!p) return 'Invoice';
  return p
    .split(/[/.]/)
    .map((seg) => seg.replace(/^\w+:/, '').replace(/\[0\]$/, ''))
    .filter(Boolean)
    .join(' › ');
}

/** The form field an error from MyInvois is about, so the composer and summaries can point at it. */
function fieldOf(e: ApiErrorDetail): string | undefined {
  const p = `${e.path ?? ''} ${e.property ?? ''}`.toLowerCase();
  const line = /invoiceline\[(\d+)\]/.exec(p);
  if (/classification/.test(p)) return `line-${line ? Number(line[1]) + (p.includes('/') ? 0 : 1) : 1}`;
  if (p.includes('issuedate') || p.includes('issuetime')) return 'issued';
  if (!p.includes('accountingcustomerparty') && !p.includes('buyer')) return undefined;
  if (p.includes('telephone')) return 'phone';
  if (p.includes('electronicmail')) return 'email';
  if (p.includes('postalzone')) return 'postcode';
  if (p.includes('addressline') || p.includes('cityname')) return 'address';
  if (p.includes('registrationname')) return 'name';
  if (/\btin\b/.test(p) || /\bTIN\b/.test(e.message)) return 'tin';
  if (p.includes('partyidentification') || /\b(brn|nric|passport|army)\b/.test(p)) return 'idValue';
  return undefined;
}

function toDocErrors(list: ApiErrorDetail[], fallback: string): DocError[] {
  const out = list.map((e) => ({ path: readablePath(e.path), message: e.message, field: fieldOf(e) }));
  return out.length ? out : [{ path: 'Invoice', message: fallback }];
}

function cancelMessage(e: unknown): string {
  const code = e instanceof ApiError ? e.code : '';
  if (code === 'OperationPeriodOver') return 'LHDN says the 72-hour cancel window has closed. Use a credit note instead.';
  if (code === 'ActiveReferencingDocuments') return 'Another e-invoice refers to this one. LHDN needs that one cancelled first.';
  if (code === 'IncorrectState') return "LHDN can't cancel it in its current state.";
  if (e instanceof ApiError && e.status === 403) return 'LHDN only lets the issuer cancel this e-invoice.';
  return `LHDN didn't cancel it. ${errorText(e)}`;
}

async function submitLive(ids: string[]) {
  const s = getState();
  const docs = ids.map((id) => s.docs.find((d) => d.id === id)).filter((d): d is Doc => !!d);
  const env = getLive()?.env ?? 'sandbox';
  for (const bizId of new Set(docs.map((d) => d.bizId))) {
    const mine = docs.filter((d) => d.bizId === bizId);
    const why = liveBlocker(bizId);
    if (why) {
      undoRun(mine);
      toast(why, { tone: 'bad', action: { label: 'Settings', run: () => navigate({ name: 'settings' }) } });
      continue;
    }
    // One taxpayer per submission, at most 100 documents in each.
    for (let i = 0; i < mine.length; i += 100) await sendBatch(bizById(s, bizId)!, mine.slice(i, i + 100), env);
  }
}

async function sendBatch(biz: Business, batch: Doc[], env: LiveRef['env']) {
  const s0 = getState();
  const onBehalfOf = actingFor(biz.id);
  const documents = batch.map((d) => ({ codeNumber: d.number, ubl: buildUbl(d, biz, d.refId ? s0.docs.find((x) => x.id === d.refId) : undefined) }));
  const before = new Map(batch.map((d) => [d.id, d]));
  const set = new Set(before.keys());
  const t = now();
  setState((s) => ({
    ...s,
    docs: mapDocs(s, set, (d) => ({
      ...d,
      status: 'submitted',
      uuid: undefined,
      submissionUid: undefined,
      longId: undefined,
      submittedAt: t,
      validatedAt: undefined,
      errors: undefined,
      attempts: d.attempts + 1,
      events: [...d.events, d.attempts > 0 ? ev(t, 'resubmitted', 'Sent to LHDN again') : ev(t, 'submitted', 'Sent to LHDN')],
    })),
  }));
  let r: SubmitResult;
  set.forEach((id) => sending.add(id));
  try {
    r = await myinvois.submit(documents, onBehalfOf);
  } catch (e) {
    // Nothing was filed: put the documents back as they were.
    setState((s) => ({ ...s, docs: s.docs.map((d) => before.get(d.id) ?? d) }));
    undoRun(batch);
    const dup = e instanceof ApiError && e.code === 'DuplicateSubmission';
    toast(dup ? `LHDN already has this exact submission from the last 10 minutes. ${errorText(e)}` : `Not sent to LHDN. ${errorText(e)}`, { tone: 'bad', ms: 8000 });
    return;
  } finally {
    set.forEach((id) => sending.delete(id));
  }
  const accepted = new Map(r.acceptedDocuments.map((a) => [a.invoiceCodeNumber, a.uuid]));
  const rejected = new Map(r.rejectedDocuments.map((x) => [x.invoiceCodeNumber, x.errors]));
  const live: LiveRef = { env, version: r.version, onBehalfOf };
  const t2 = now();
  setState((s) => ({
    ...s,
    docs: mapDocs(s, set, (d) => {
      const uuid = accepted.get(d.number);
      if (uuid) return { ...d, uuid, submissionUid: r.submissionUid, live };
      const errors = toDocErrors(rejected.get(d.number) ?? [], 'LHDN did not accept this document.');
      return { ...d, status: 'invalid', submissionUid: r.submissionUid, live, errors, wasInvalid: true, events: [...d.events, ev(t2, 'invalid', 'Rejected by LHDN')] };
    }),
  }));
  const bad = batch.filter((d) => !accepted.has(d.number));
  if (bad.length) {
    const one = bad.length === 1 ? bad[0] : undefined;
    toast(one ? `LHDN rejected ${one.number}` : `LHDN rejected ${bad.length} documents`, {
      tone: 'bad',
      action: one ? { label: 'See why', run: () => navigate({ name: 'doc', id: one.id }) } : undefined,
    });
    bad.forEach((d) => finishRunIfDone(d.id));
  }
  if (accepted.size) void pollSubmission(r.submissionUid);
}

/** A month-end that didn't reach LHDN goes back to its imported file, without the drafts made for it. */
function undoRun(batch: Doc[]) {
  const ids = new Set(batch.map((d) => d.id));
  const run = getState().runs.find((r) => r.stage === 'submitting' && r.docIds.some((id) => ids.has(id)));
  if (!run) return;
  const made = new Set(run.docIds);
  setState((s) => ({
    ...s,
    docs: s.docs.filter((d) => !made.has(d.id) || d.status !== 'draft'),
    runs: s.runs.map((r) => (r.id === run.id ? { ...r, stage: 'imported', docIds: [], submittedAt: undefined } : r)),
  }));
}

const polling = new Set<string>();

async function pollSubmission(uid: string) {
  if (polling.has(uid)) return;
  polling.add(uid);
  try {
    // Every 4 seconds at first, then slower for submissions LHDN takes longer over (about 30 minutes in all).
    for (let i = 0; i < 90; i++) {
      await sleep(i < 15 ? 4000 : i < 40 ? 10_000 : 30_000);
      const waiting = getState().docs.filter((d) => d.submissionUid === uid && d.status === 'submitted' && d.live);
      if (!waiting.length) return;
      try {
        const sub = await myinvois.submission(uid, waiting[0].live!.onBehalfOf);
        for (const ds of sub.documentSummary ?? []) await applySummary(ds);
      } catch {
        /* LHDN may not list a new submission yet, or the network blipped: ask again next round */
      }
    }
  } finally {
    polling.delete(uid);
  }
}

/** Brings one local document in line with what MyInvois reports for it. */
async function applySummary(ds: DocSummary, details?: DocDetails) {
  const d = getState().docs.find((x) => x.live && x.uuid === ds.uuid);
  if (!d) return;
  const status = ds.status?.toLowerCase();
  const one = new Set([d.id]);
  const t = now();
  // A poll and a manual check can answer at the same time: each change applies once, and only
  // while the document is still in the state it was found in.
  let changed = false;
  const change = (when: (x: Doc) => boolean, f: (x: Doc) => Doc) =>
    setState((s) => ({
      ...s,
      docs: mapDocs(s, one, (x) => {
        if (!when(x)) return x;
        changed = true;
        return f(x);
      }),
    }));
  if (d.status === 'submitted' && status === 'valid') {
    const validatedAt = Date.parse(ds.dateTimeValidated ?? '') || t;
    change(
      (x) => x.status === 'submitted',
      (x) => ({ ...x, status: 'valid', validatedAt, longId: ds.longId ?? x.longId, events: [...x.events, ev(validatedAt, 'valid', 'Validated by LHDN')] }),
    );
    if (changed) finishRunIfDone(d.id);
  } else if (d.status === 'submitted' && status === 'invalid') {
    let errors: DocError[];
    try {
      const det = details ?? (await myinvois.details(d.uuid!, d.live!.onBehalfOf));
      errors = toDocErrors(det.errors, "LHDN marked it invalid but didn't say why.");
    } catch {
      errors = [{ path: 'Invoice', message: 'LHDN marked it invalid. Open it on the MyInvois portal to see why.' }];
    }
    change(
      (x) => x.status === 'submitted',
      (x) => ({ ...x, status: 'invalid', errors, wasInvalid: true, events: [...x.events, ev(t, 'invalid', 'Rejected by LHDN')] }),
    );
    if (!changed) return;
    if (d.source !== 'month-end') toast(`LHDN rejected ${d.number}`, { tone: 'bad', action: { label: 'See why', run: () => navigate({ name: 'doc', id: d.id }) } });
    finishRunIfDone(d.id);
  } else if (status === 'cancelled' && d.status !== 'cancelled') {
    const cancelledAt = Date.parse(ds.cancelDateTime ?? '') || t;
    change(
      (x) => x.status !== 'cancelled',
      (x) => ({
        ...x,
        status: 'cancelled',
        cancelledAt,
        cancelReason: ds.documentStatusReason ?? x.cancelReason,
        events: [...x.events, ev(cancelledAt, 'cancelled', 'Cancelled on MyInvois')],
      }),
    );
  } else if (status === 'valid' && d.status === 'valid' && ds.rejectRequestDateTime && !d.live?.rejectRequestedAt) {
    const at = Date.parse(ds.rejectRequestDateTime) || t;
    change(
      (x) => x.status === 'valid' && !x.live?.rejectRequestedAt,
      (x) => ({ ...x, live: { ...x.live!, rejectRequestedAt: at, rejectReason: ds.documentStatusReason ?? undefined } }),
    );
    if (changed) toast(`The buyer asked you to cancel ${d.number}`, { tone: 'info', action: { label: 'Review', run: () => navigate({ name: 'doc', id: d.id }) } });
  }
}

/** Asks MyInvois for one document's current state: validation errors, a cancellation, a buyer's rejection. */
export async function refreshDoc(id: string) {
  const d = getState().docs.find((x) => x.id === id);
  if (!d?.live || !d.uuid) return;
  try {
    const det = await myinvois.details(d.uuid, d.live.onBehalfOf);
    await applySummary(det, det);
    const after = getState().docs.find((x) => x.id === id);
    if (after?.status === d.status && after.live?.rejectRequestedAt === d.live.rejectRequestedAt) {
      toast(`LHDN still has ${d.number} as ${det.status.toLowerCase()}`, { tone: 'info' });
    }
  } catch (e) {
    toast(`Couldn't check ${d.number}. ${errorText(e)}`, { tone: 'bad' });
  }
}

const lastSync = new Map<string, number>();

/**
 * Picks up what happened on MyInvois after validation: buyers asking for a cancellation and
 * cancellations made on the portal. One Search Documents call over the last four days, at most
 * every two minutes (the API allows 12 a minute).
 */
export async function syncLive(bizId: string) {
  if (!isLive() || !getLive()?.configured) return;
  const recent = getState().docs.filter((d) => d.bizId === bizId && d.live && d.uuid && (d.status === 'valid' || d.status === 'submitted') && now() - (d.submittedAt ?? 0) < 4 * DAY);
  if (!recent.length || now() - (lastSync.get(bizId) ?? 0) < 2 * MIN) return;
  lastSync.set(bizId, now());
  const from = Math.min(...recent.map((d) => d.submittedAt ?? now())) - 5 * MIN;
  try {
    const page = await myinvois.search({ invoiceDirection: 'Sent', submissionDateFrom: iso(from), submissionDateTo: iso(now()), pageSize: 100, pageNo: 1 }, actingFor(bizId));
    for (const ds of page.result ?? []) await applySummary(ds);
  } catch {
    /* a background check: try again next time */
  }
}

const notices = new Map<string, { at: number; list: Notice[] }>();

/** The last week of MyInvois notifications for this taxpayer, cached for two minutes. */
export async function liveNotices(bizId: string): Promise<Notice[]> {
  const key = actingFor(bizId) ?? '';
  const hit = notices.get(key);
  if (hit && now() - hit.at < 2 * MIN) return hit.list;
  const page = await myinvois.notifications({ dateFrom: iso(now() - 7 * DAY), dateTo: iso(now()), pageNo: 1, pageSize: 20 }, actingFor(bizId));
  const list = page.result ?? [];
  notices.set(key, { at: now(), list });
  return list;
}

/** Logs in and lists the document types MyInvois offers: proof the setup works. */
export async function checkLive(): Promise<DocumentType[]> {
  return (await myinvois.check(actingFor(getState().activeBizId))).documentTypes;
}

/** The copy of a document MyInvois holds, as it was submitted (signed, for version 1.1). */
export async function liveCopy(id: string): Promise<string> {
  const d = getState().docs.find((x) => x.id === id);
  if (!d?.live || !d.uuid) throw new Error('This document never went to MyInvois.');
  return (await myinvois.raw(d.uuid, d.live.onBehalfOf)).document;
}

/** Search Taxpayer's TIN: from the ID number (or the name), the one TIN that matches. */
export async function findTin(p: Pick<Party, 'kind' | 'name' | 'idType' | 'idValue'>): Promise<string | null> {
  const id = p.idValue.trim();
  try {
    const q = id ? { idType: p.idType, idValue: id, fileType: p.kind === 'individual' ? (1 as const) : (2 as const) } : { taxpayerName: p.name.trim() };
    const r = await myinvois.searchTin(q, actingFor(getState().activeBizId));
    if (!r.tin) toast('LHDN found no TIN for those details.', { tone: 'info' });
    return r.tin;
  } catch (e) {
    toast(`Couldn't search for the TIN. ${errorText(e)}`, { tone: 'bad' });
    return null;
  }
}

/** Taxpayer's QR Code: the details behind a taxpayer's MyInvois QR code. */
export async function readTaxpayerQr(text: string): Promise<TaxpayerInfo | null> {
  try {
    return await myinvois.taxpayerFromQr(text, actingFor(getState().activeBizId));
  } catch (e) {
    toast(e instanceof ApiError && e.status === 404 ? 'LHDN has no taxpayer for that QR code.' : `Couldn't read the QR code. ${errorText(e)}`, { tone: 'bad' });
    return null;
  }
}

const addressOf = (x: TaxpayerInfo) => ({
  line1: [x.addressLine0, x.addressLine1, x.addressLine2]
    .map((l) => l?.trim())
    .filter(Boolean)
    .join(', '),
  postcode: x.postalZone?.trim() ?? '',
  city: x.city?.trim() ?? '',
  state: stateCodeOf(x.state ?? '') || '14',
});

export function partyFromTaxpayer(x: TaxpayerInfo): Party {
  const individual = x.tin.startsWith('IG');
  const idType = (['BRN', 'NRIC', 'PASSPORT', 'ARMY'].includes(x.idType) ? x.idType : individual ? 'NRIC' : 'BRN') as IdType;
  return {
    kind: individual ? 'individual' : 'company',
    name: x.name,
    tin: x.tin,
    idType,
    idValue: x.idNumber ?? '',
    email: (x.email ?? '').split(';')[0].trim(),
    phone: (x.contactNumber ?? '').replace(/[^\d+]/g, ''),
    address: addressOf(x),
  };
}

export function businessFromTaxpayer(x: TaxpayerInfo): Partial<Business> {
  const activity = x.businessActivityDescriptionEN?.trim() ?? '';
  return {
    name: x.name,
    tin: x.tin,
    brn: x.idNumber ?? '',
    idType: (['BRN', 'NRIC', 'PASSPORT', 'ARMY'].includes(x.idType) ? x.idType : 'BRN') as IdType,
    sst: x.sst && x.sst !== 'NA' ? x.sst : '',
    msic: x.msic ?? '',
    msicName: activity,
    activity,
    address: addressOf(x),
    phone: (x.contactNumber ?? '').replace(/[^\d+]/g, ''),
    email: (x.email ?? '').split(';')[0].trim(),
  };
}

export function updateBusiness(id: string, patch: Partial<Business>) {
  setState((s) => ({
    ...s,
    businesses: s.businesses.map((b) => {
      if (b.id !== id) return b;
      const name = patch.name?.trim() ?? b.name;
      return { ...b, ...patch, name, short: name || b.short, initials: name ? initials(name) : b.initials };
    }),
    clients: s.clients.map((c) => (c.bizId === id ? { ...c, name: patch.name?.trim() || c.name, tin: patch.tin ?? c.tin } : c)),
  }));
}

/** Moves between the sample-data demo and the live workspace on the real MyInvois. */
export function openWorkspace(ws: Workspace) {
  // Its answer would land in the other workspace and be lost.
  if (sending.size) {
    toast('Wait a moment: LHDN is still answering a submission.', { tone: 'info' });
    return;
  }
  // A server that asks for its access key gets it before the live workspace opens.
  if (ws === 'live' && getLive()?.locked) return askAccessKey(() => openWorkspace('live'));
  switchWorkspace(ws);
  const s = getState();
  navigate(s.persona === 'accountant' && !s.activeBizId ? { name: 'clients' } : { name: 'today' }, { replace: true });
  resumePending();
  const env = getLive()?.env === 'production' ? 'production' : 'sandbox';
  toast(ws === 'live' ? `Now on MyInvois ${env}. What you submit goes to LHDN.` : 'Back to the demo with sample data', { tone: 'info' });
}

// ---------------------------------------------------------------------------
// Received e-invoices: what suppliers issued to our businesses. Within 72 hours of validation the
// buyer can reject one (Reject Document), which asks the supplier to cancel it; the e-invoice
// stays valid until they do. Listed with Search Documents, as LHDN recommends over Get Recent.

const lastReceived = new Map<string, number>();
const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/** The last 30 days of e-invoices issued to this business, at most every 2 minutes (15 seconds when asked for). */
export async function syncReceived(bizId: string, asked = false) {
  if (!isLive() || !getLive()?.configured) return;
  if (now() - (lastReceived.get(bizId) ?? 0) < (asked ? 15_000 : 2 * MIN)) return;
  lastReceived.set(bizId, now());
  const onBehalfOf = actingFor(bizId);
  const env = getLive()!.env;
  const found: DocSummary[] = [];
  try {
    for (let page = 1; page <= 5; page++) {
      const r = await myinvois.search({ invoiceDirection: 'Received', submissionDateFrom: iso(now() - 30 * DAY), submissionDateTo: iso(now()), pageSize: 100, pageNo: page }, onBehalfOf);
      found.push(...(r.result ?? []));
      if (page >= (r.metadata?.totalPages ?? 1)) break;
    }
  } catch (e) {
    if (asked) toast(`Couldn't list received e-invoices. ${errorText(e)}`, { tone: 'bad' });
    return;
  }
  setState((s) => {
    const had = new Map(s.received.filter((r) => r.bizId === bizId).map((r) => [r.uuid, r]));
    const next: ReceivedDoc[] = found.map((ds) => {
      const old = had.get(ds.uuid);
      const status = ds.status?.toLowerCase() === 'cancelled' ? 'cancelled' : 'valid';
      return {
        id: old?.id ?? uid('rcv'),
        bizId,
        uuid: ds.uuid,
        longId: ds.longId || old?.longId,
        typeName: titleCase(ds.typeName ?? 'invoice'),
        number: ds.internalId,
        supplierName: ds.supplierName ?? ds.issuerName ?? old?.supplierName ?? '',
        supplierTin: ds.supplierTIN ?? ds.supplierTin ?? ds.issuerTin ?? old?.supplierTin ?? '',
        issuedAt: Date.parse(ds.dateTimeIssued ?? '') || old?.issuedAt || now(),
        validatedAt: Date.parse(ds.dateTimeValidated ?? '') || old?.validatedAt,
        total: Number(ds.total ?? old?.total ?? 0),
        status,
        rejectRequestedAt: Date.parse(ds.rejectRequestDateTime ?? '') || old?.rejectRequestedAt,
        rejectReason: ds.documentStatusReason ?? old?.rejectReason,
        cancelledAt: status === 'cancelled' ? Date.parse(ds.cancelDateTime ?? '') || old?.cancelledAt || now() : undefined,
        lines: old?.lines,
        live: { env, onBehalfOf },
      };
    });
    const seen = new Set(next.map((r) => r.uuid));
    // Older ones fall out of the 30-day search but stay on record here.
    return { ...s, received: [...next, ...s.received.filter((r) => r.bizId !== bizId || !seen.has(r.uuid))] };
  });
}

/** The lines of a received e-invoice, from the copy MyInvois holds (Get Document). */
export async function receivedLines(id: string) {
  const r = getState().received.find((x) => x.id === id);
  if (!r?.live || r.lines) return;
  const raw = await myinvois.raw(r.uuid, r.live.onBehalfOf);
  const u = readUbl(raw.document);
  setState((s) => ({
    ...s,
    received: s.received.map((x) => (x.id === id ? { ...x, lines: u.lines, supplierName: x.supplierName || u.supplier || '', longId: raw.longId || x.longId } : x)),
  }));
}

function rejectMessage(e: unknown): string {
  const code = e instanceof ApiError ? e.code : '';
  if (code === 'OperationPeriodOver') return 'LHDN says the 72-hour window has closed. Ask the supplier for a credit note instead.';
  if (code === 'ActiveReferencingDocuments') return 'A credit or debit note refers to this e-invoice. Reject that one first.';
  if (code === 'IncorrectState') return "LHDN can't reject it now. It may already be rejected or cancelled.";
  if (e instanceof ApiError && e.status === 403) return 'LHDN only lets the buyer of this e-invoice reject it.';
  return `LHDN didn't reject it. ${errorText(e)}`;
}

/** Rejects a received e-invoice: MyInvois asks the supplier to cancel it. Allowed once, within 72 hours. */
export async function rejectReceived(id: string, reason: string): Promise<{ ok: boolean; message?: string }> {
  const r = getState().received.find((x) => x.id === id);
  if (!r || r.status !== 'valid') return { ok: false, message: 'Only valid e-invoices can be rejected.' };
  if (r.rejectRequestedAt) return { ok: false, message: 'You already asked the supplier to cancel it. LHDN allows one rejection.' };
  if (!r.validatedAt || now() - r.validatedAt > CANCEL_WINDOW) return { ok: false, message: 'The 72-hour window has closed. Ask the supplier for a credit note instead.' };
  if (r.live) {
    try {
      await myinvois.reject(r.uuid, reason, r.live.onBehalfOf);
    } catch (e) {
      return { ok: false, message: rejectMessage(e) };
    }
  } else {
    await sleep(quick() ? 450 : 1100);
  }
  const t = now();
  setState((s) => ({ ...s, received: s.received.map((x) => (x.id === id ? { ...x, rejectRequestedAt: t, rejectReason: reason } : x)) }));
  toast(`Asked ${r.supplierName} to cancel ${r.number}`);
  // In the demo the supplier agrees a few seconds later, to show the rest of the story.
  if (!r.live) {
    setTimeout(() => {
      const x = getState().received.find((y) => y.id === id);
      if (!x || x.status !== 'valid') return;
      const t2 = now();
      setState((s) => ({ ...s, received: s.received.map((y) => (y.id === id ? { ...y, status: 'cancelled', cancelledAt: t2 } : y)) }));
      toast(`${r.supplierName} cancelled ${r.number}`, { tone: 'info' });
    }, quick() ? 2500 : 6000);
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Reference and troubleshooting, for the Settings page.

/** Get Document Type: one type's versions and workflow limits (submission, cancellation, rejection). */
export const liveDocType = (id: number) => myinvois.documentType(id, actingFor(getState().activeBizId));

/** Get Document Type Version: one version's status and dates. */
export const liveDocTypeVersion = (id: number, vid: number) => myinvois.documentTypeVersion(id, vid, actingFor(getState().activeBizId));

/** Get Recent Documents: the last 31 days on MyInvois, with the channel each came through. LHDN means it for troubleshooting. */
export const liveRecent = (direction: 'Sent' | 'Received', pageNo: number) =>
  myinvois.recent({ InvoiceDirection: direction, pageNo, pageSize: 20 }, actingFor(getState().activeBizId));
