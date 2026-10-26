// Sample data for the demo: one retailer (Jaya Elektrik, two branches) in full detail,
// and an accounting firm (Teguh Accounting) with seven more clients.
// Every name, tax number and amount here is invented.
import type {
  Address,
  Business,
  Buyer,
  BuyerKind,
  BuyerRequest,
  ClientMeta,
  Doc,
  DocError,
  DocStatus,
  DocType,
  IdType,
  Item,
  Line,
  MonthEndRun,
  Party,
  Person,
  State,
  TinStatus,
} from '../types';
import { DAY, DEMO_START as T, HOUR, MIN, PERIOD, myt } from '../lib/clock';
import { GENERAL_PUBLIC_TIN } from '../lib/rules';
import { lhdnId, pick, rng } from '../lib/ids';
import { computeSplit } from '../lib/split';
import { makeReceipts, receiptAtNo, registerSpec, type ReceiptSpec } from './receipts';

export const STATE_VERSION = 7;

export const GENERAL_PUBLIC: Party = {
  kind: 'general',
  name: 'General Public',
  tin: GENERAL_PUBLIC_TIN,
  idType: 'BRN',
  idValue: 'NA',
  email: '',
  phone: 'NA',
  address: { line1: 'NA', postcode: '', city: 'NA', state: '17' },
};

export const FIRM = {
  name: 'Teguh Accounting',
  initials: 'TA',
  tin: 'C29934106090',
  user: { name: 'Aina Rahman', role: 'Partner', initials: 'AR' } as Person,
};

interface Ctx {
  rand: () => number;
  docs: Doc[];
  buyers: Buyer[];
  items: Item[];
  requests: BuyerRequest[];
  runs: MonthEndRun[];
  counters: State['counters'];
}

let nid = 0;
const sid = (p: string) => `${p}_${(++nid).toString(36)}`;
const pad4 = (n: number) => String(n).padStart(4, '0');

const L = (it: Item, qty: number): Line => ({ id: sid('ln'), desc: it.name, cls: it.cls, qty, price: it.price, tax: it.tax });

export function partyOf(b: Party): Party {
  return {
    kind: b.kind,
    name: b.name,
    tin: b.tin,
    idType: b.idType,
    idValue: b.idValue,
    email: b.email,
    phone: b.phone,
    address: { ...b.address },
  };
}

interface DocSeed {
  id?: string;
  bizId: string;
  number: string;
  type?: DocType;
  branchId: string;
  buyer: Party;
  buyerId?: string;
  tinStatus?: TinStatus;
  lines: Line[];
  status: DocStatus;
  issuedAt: number;
  submittedAt?: number;
  validatedAt?: number;
  emailedAt?: number;
  cancelledAt?: number;
  cancelReason?: string;
  errors?: DocError[];
  refId?: string;
  source?: Doc['source'];
  receiptNo?: string;
  requestId?: string;
  consolidated?: Doc['consolidated'];
}

function mkDoc(c: Ctx, p: DocSeed): Doc {
  const events: Doc['events'] = [{ t: p.issuedAt, kind: 'draft', label: 'Draft saved' }];
  if (p.submittedAt) events.push({ t: p.submittedAt, kind: 'submitted', label: 'Sent to LHDN' });
  if (p.status === 'invalid' && p.submittedAt) events.push({ t: p.submittedAt + 5000, kind: 'invalid', label: 'Rejected by LHDN' });
  if (p.validatedAt) events.push({ t: p.validatedAt, kind: 'valid', label: 'Validated by LHDN' });
  if (p.emailedAt) events.push({ t: p.emailedAt, kind: 'emailed', label: 'Emailed to buyer' });
  if (p.cancelledAt) events.push({ t: p.cancelledAt, kind: 'cancelled', label: 'Cancelled' });
  const d: Doc = {
    id: p.id ?? sid('doc'),
    bizId: p.bizId,
    type: p.type ?? '01',
    number: p.number,
    branchId: p.branchId,
    buyerId: p.buyerId,
    buyer: p.buyer,
    tinStatus: p.tinStatus ?? 'verified',
    issuedAt: p.issuedAt,
    lines: p.lines,
    status: p.status,
    attempts: p.submittedAt ? 1 : 0,
    uuid: p.submittedAt ? lhdnId(26, c.rand) : undefined,
    submissionUid: p.submittedAt ? lhdnId(26, c.rand) : undefined,
    longId: p.validatedAt ? lhdnId(40, c.rand) : undefined,
    submittedAt: p.submittedAt,
    validatedAt: p.validatedAt,
    cancelledAt: p.cancelledAt,
    cancelReason: p.cancelReason,
    emailedAt: p.emailedAt,
    errors: p.errors,
    refId: p.refId,
    consolidated: p.consolidated,
    source: p.source ?? 'manual',
    receiptNo: p.receiptNo,
    requestId: p.requestId,
    wasInvalid: p.status === 'invalid' || undefined,
    events,
  };
  c.docs.push(d);
  return d;
}

/** Sent at `at`, validated six seconds later, emailed a minute after that. */
function okDoc(c: Ctx, p: Omit<DocSeed, 'status' | 'issuedAt'> & { at: number; issuedAt?: number }): Doc {
  const { at, ...rest } = p;
  return mkDoc(c, {
    ...rest,
    status: 'valid',
    issuedAt: p.issuedAt ?? at - 6 * MIN,
    submittedAt: at,
    validatedAt: at + 6000,
    emailedAt: p.buyer.email ? at + 55_000 : undefined,
  });
}

interface RunLineSeed {
  from: string;
  to: string;
  cents: number;
}

function consolidatedDoc(c: Ctx, bizId: string, branchId: string, period: string, lines: RunLineSeed[], receipts: number, at: number): Doc {
  const [y, m] = period.split('-');
  return okDoc(c, {
    bizId,
    number: `CON-${y.slice(2)}${m}-${branchId}`,
    branchId,
    buyer: GENERAL_PUBLIC,
    lines: lines.map((r) => ({
      id: sid('ln'),
      desc: r.from === r.to ? `Receipt ${r.from}` : `Receipts ${r.from} to ${r.to}`,
      cls: '004',
      qty: 1,
      price: r.cents / 100,
      tax: '06' as const,
    })),
    at,
    source: 'month-end',
    consolidated: { period, branchId, receipts },
  });
}

/** Summary lines for an older month that was filed before the demo starts. */
function pastRuns(rand: () => number, prefix: string, start: number, count: number, totalCents: number, gaps: number) {
  const cuts = new Set<number>();
  while (cuts.size < gaps) cuts.add(3 + Math.floor(rand() * (count - 6)));
  const sorted = [...cuts].sort((a, b) => a - b);
  const segs: { from: number; to: number }[] = [];
  let s0 = 0;
  for (const cut of sorted) {
    if (cut - 1 >= s0) segs.push({ from: s0, to: cut - 1 });
    s0 = cut + 1;
  }
  segs.push({ from: s0, to: count - 1 });
  const raw = segs.map((sg) => (sg.to - sg.from + 1) * (0.9 + rand() * 0.2));
  const sum = raw.reduce((a, b) => a + b, 0);
  const cents = raw.map((r) => Math.round(((r / sum) * totalCents) / 10) * 10);
  const diff = totalCents - cents.reduce((a, b) => a + b, 0);
  cents[cents.indexOf(Math.max(...cents))] += diff;
  const no = (i: number) => prefix + String(start + i).padStart(5, '0');
  return {
    lines: segs.map((sg, k) => ({ from: no(sg.from), to: no(sg.to), cents: cents[k] })),
    receipts: segs.reduce((a, sg) => a + sg.to - sg.from + 1, 0),
  };
}

const person = (
  name: string,
  tin: string,
  mykad: string,
  email: string,
  phone: string,
  line1: string,
  postcode: string,
  city: string,
  state: string,
): Party => ({ kind: 'individual', name, tin, idType: 'NRIC', idValue: mykad, email, phone, address: { line1, postcode, city, state } });

// ---------------------------------------------------------------------------
// Jaya Elektrik: the business the demo opens on.

function seedJaya(c: Ctx): Business {
  const bizId = 'jaya';
  const biz: Business = {
    id: bizId,
    name: 'Jaya Elektrik Sdn Bhd',
    short: 'Jaya Elektrik',
    initials: 'JE',
    tin: 'C21765409030',
    brn: '201601023456',
    msic: '47411',
    msicName: 'Retail sale of computers, computer equipment and supplies',
    activity: 'Computers and phones retail',
    address: { line1: '12 Jalan Bangsar Utama 1, Bangsar', postcode: '59000', city: 'Kuala Lumpur', state: '14' },
    phone: '0322841188',
    email: 'billing.jaya@example.com',
    phase: 4,
    branches: [
      { id: 'BGS', name: 'Bangsar', prefix: 'R-' },
      { id: 'CHR', name: 'Cheras', prefix: 'CH-' },
    ],
    owner: { name: 'Mei Ling', role: 'Owner', initials: 'ML' },
    tone: 0,
  };

  const I = (id: string, sku: string, name: string, cls: string, price: number): Item => {
    const it: Item = { id, bizId, sku, name, cls, price, tax: '06' };
    c.items.push(it);
    return it;
  };
  const lt14 = I('i_lt14', 'LT-1416', 'Laptop, 14-inch, 16 GB', '003', 2899);
  const lt15 = I('i_lt15', 'LT-1516', 'Laptop, 15-inch, 16 GB', '003', 3799);
  const ph67 = I('i_ph67', 'PH-6725', 'Smartphone, 6.7-inch, 256 GB', '003', 2349);
  const tb11 = I('i_tb11', 'TB-1101', 'Tablet, 11-inch', '003', 1099);
  const mn27 = I('i_mn27', 'MN-2701', 'Monitor, 27-inch', '022', 1299);
  const prlj = I('i_prlj', 'PR-LJ01', 'Laser printer', '022', 459);
  const ebw2 = I('i_ebw2', 'EB-W202', 'Wireless earbuds', '022', 189);
  const tbcs = I('i_tbcs', 'TB-CASE', 'Tablet case', '022', 48.3);
  const wr3y = I('i_wr3y', 'WR-3Y', '3-year on-site warranty', '022', 221);
  const setup = I('i_setup', 'SV-SETUP', 'Setup and data transfer', '022', 120);
  I('i_scr', 'RP-SCRN', 'Screen repair', '030', 350);
  const bag = I('i_bag', 'AC-BAG14', 'Laptop bag, 14-inch', '022', 89);

  const B = (
    id: string,
    kind: BuyerKind,
    name: string,
    tin: string,
    idType: IdType,
    idValue: string,
    email: string,
    phone: string,
    address: Address,
    tinStatus: TinStatus = 'verified',
  ): Buyer => {
    const b: Buyer = { id, bizId, kind, name, tin, idType, idValue, email, phone, address, tinStatus, checkedAt: tinStatus === 'verified' ? T - 21 * DAY : undefined };
    c.buyers.push(b);
    return b;
  };
  const harmoni = B('b_harmoni', 'company', 'Klinik Gigi Harmoni Sdn Bhd', 'C2584563200', 'BRN', '201901234567', 'accounts.harmoni@example.com', '0322821450', { line1: '21 Jalan Maarof, Bangsar', postcode: '59000', city: 'Kuala Lumpur', state: '14' });
  const suria = B('b_suria', 'company', 'Suria Tuition Centre', 'C2011457701', 'BRN', '201801017755', 'admin.suria@example.com', '0379563320', { line1: '5 Jalan SS 2/24', postcode: '47300', city: 'Petaling Jaya', state: '10' }, 'unchecked');
  const mesra = B('b_mesra', 'company', 'Pasaraya Mesra Sdn Bhd', 'C10477125090', 'BRN', '200901004512', 'finance.mesra@example.com', '0391321177', { line1: '88 Jalan Cheras', postcode: '56100', city: 'Kuala Lumpur', state: '14' });
  const ahmad = B('b_ahmad', 'company', 'Bengkel Motor Ahmad', 'IG23458810020', 'BRN', '202003114455', 'bengkel.ahmad@example.com', '0340217788', { line1: '14 Jalan Gombak, Setapak', postcode: '53000', city: 'Kuala Lumpur', state: '14' });
  const farid = B('b_farid', 'individual', 'Farid bin Hassan', 'IG12345678912', 'NRIC', '880314145321', 'farid.hassan@example.com', '0123456789', { line1: '8 Jalan Mawar, SS 3', postcode: '47300', city: 'Petaling Jaya', state: '10' });
  const ceria = B('b_ceria', 'company', 'Tadika Ceria Sdn Bhd', 'C30288190050', 'BRN', '201501029911', 'office.ceria@example.com', '0342561890', { line1: '3 Jalan Ampang Hilir', postcode: '55000', city: 'Kuala Lumpur', state: '14' });
  const angkut = B('b_angkut', 'company', 'Syarikat Angkut Maju Sdn Bhd', 'C11923408070', 'BRN', '199801012345', 'ap.angkutmaju@example.com', '0331662040', { line1: 'Lot 7, Jalan Kebun Nenas', postcode: '41100', city: 'Klang', state: '10' });
  B('b_lestari', 'company', 'Lestari Hartanah Sdn Bhd', 'C24410977030', 'BRN', '201201033218', 'procurement.lestari@example.com', '03-6203 1188', { line1: 'Level 9, Menara Lestari, Jalan Tun Razak', postcode: '50400', city: 'Kuala Lumpur', state: '14' });

  const from = myt(2026, 10, 1);
  const bgs = registerSpec({
    key: 'jaya-BGS-2610',
    fileName: 'sales_oct_bangsar.csv',
    prefix: 'R-',
    pad: 5,
    start: 7001,
    count: 1842,
    from,
    days: 31,
    consolidatedCents: 48_200_000,
    big: [1_085_000, 1_120_000, 1_299_000, 1_450_000, 1_045_000, 1_328_000, 1_199_900, 1_560_000, 1_113_100],
    requested: [
      { no: 'R-07215', cents: 289_900 },
      { no: 'R-07604', cents: 379_900 },
      { no: 'R-07958', cents: 234_900 },
      { no: 'R-08102', cents: 109_900 },
      { no: 'R-08377', cents: 289_900 },
      { no: 'R-08560', cents: 114_730 },
      { no: 'R-08831', cents: 425_800 },
    ],
    fixed: [
      { no: 'R-08827', cents: 234_900 },
      { no: 'R-08830', cents: 379_900 },
    ],
    seed: 1842,
  });
  const chr = registerSpec({
    key: 'jaya-CHR-2610',
    fileName: 'sales_oct_cheras.csv',
    prefix: 'CH-',
    pad: 5,
    start: 4301,
    count: 1206,
    from,
    days: 31,
    consolidatedCents: 34_280_780,
    big: [1_090_000, 1_345_000, 1_210_000, 1_585_000],
    requested: [
      { no: 'CH-04580', cents: 289_900 },
      { no: 'CH-04977', cents: 175_800 },
      { no: 'CH-05310', cents: 148_800 },
    ],
    fixed: [{ no: 'CH-05498', cents: 18_900 }],
    seed: 1206,
  });

  // October: requests issued during the month, plus regular B2B invoices.
  interface Pending {
    id: string;
    at: number;
    branchId: string;
    buyer: Party;
    buyerId?: string;
    lines: Line[];
    receiptNo?: string;
    requestId?: string;
  }
  const october: Pending[] = [];
  const octRequests: { id: string; spec: ReceiptSpec; no: string; items: [Item, number][]; p: Party }[] = [
    { id: 'rq_aminah', spec: bgs, no: 'R-07215', items: [[lt14, 1]], p: person('Aminah binti Yusof', 'IG70051208862', '700512085566', 'aminah.yusof@example.com', '0132245098', '17 Jalan Bangsar Utama 3', '59000', 'Kuala Lumpur', '14') },
    { id: 'rq_gopal', spec: bgs, no: 'R-07604', items: [[lt15, 1]], p: person('Gopal a/l Krishnan', 'IG76092214410', '760922145087', 'gopal.k@example.com', '0192231178', '9 Jalan Telawi 5', '59100', 'Kuala Lumpur', '14') },
    { id: 'rq_chong', spec: bgs, no: 'R-07958', items: [[ph67, 1]], p: person('Chong Kar Wai', 'IG91030510237', '910305105631', 'karwai.chong@example.com', '0167782210', '26 Jalan SS 21/1', '47400', 'Petaling Jaya', '10') },
    { id: 'rq_azlina', spec: bgs, no: 'R-08102', items: [[tb11, 1]], p: person('Nor Azlina binti Ahmad', 'IG84121703359', '841217035428', 'azlina.ahmad@example.com', '0124459901', '4 Lorong Maarof', '59000', 'Kuala Lumpur', '14') },
    { id: 'rq_daniel', spec: bgs, no: 'R-08377', items: [[lt14, 1]], p: person('Daniel Lee Wen Hao', 'IG95060714422', '950607145119', 'daniel.lee@example.com', '0176620934', '11 Jalan Kemuja', '59000', 'Kuala Lumpur', '14') },
    { id: 'rq_priya', spec: bgs, no: 'R-08560', items: [[tb11, 1], [tbcs, 1]], p: person('Priya a/p Ramasamy', 'IG88042508816', '880425085342', 'priya.r@example.com', '0113390218', '2 Jalan Abdullah', '59000', 'Kuala Lumpur', '14') },
    { id: 'rq_wong', spec: chr, no: 'CH-04580', items: [[lt14, 1]], p: person('Wong Siew Ling', 'IG82070214475', '820702145268', 'siewling.wong@example.com', '0123348876', '33 Jalan Cheras Hartamas', '56100', 'Kuala Lumpur', '14') },
    { id: 'rq_hafiz', spec: chr, no: 'CH-04977', items: [[mn27, 1], [prlj, 1]], p: person('Mohd Hafiz bin Rahman', 'IG90111110293', '901111105377', 'hafiz.rahman@example.com', '0198812054', '7 Jalan Suarasa 8/3', '43200', 'Cheras', '10') },
    { id: 'rq_kumar', spec: chr, no: 'CH-05310', items: [[mn27, 1], [ebw2, 1]], p: person('Kumaran a/l Selvam', 'IG79030308831', '790303085211', 'kumaran.s@example.com', '0162275341', '15 Jalan Mutiara 2', '56000', 'Kuala Lumpur', '14') },
  ];
  for (const r of octRequests) {
    const receiptAt = receiptAtNo(r.spec, r.no);
    const requestedAt = receiptAt + 12 * MIN;
    const docId = sid('doc');
    const branchId = r.spec === bgs ? 'BGS' : 'CHR';
    october.push({ id: docId, at: requestedAt + 38 * MIN, branchId, buyer: r.p, lines: r.items.map(([it, q]) => L(it, q)), receiptNo: r.no, requestId: r.id });
    c.requests.push({
      id: r.id,
      bizId,
      branchId,
      receiptNo: r.no,
      receiptAt,
      requestedAt,
      items: r.items.map(([it, q]) => ({ desc: it.name, cls: it.cls, qty: q, price: it.price })),
      buyer: r.p,
      tinStatus: 'verified',
      channel: 'receipt-qr',
      status: 'issued',
      docId,
    });
  }
  const regulars = [harmoni, mesra, ahmad, ceria, angkut];
  const pool = [lt14, lt15, ph67, tb11, mn27, prlj, ebw2, wr3y, setup, bag];
  for (let k = 0; k < 21; k++) {
    const day = 1 + Math.floor(c.rand() * 26);
    const at = myt(2026, 10, day, 9 + Math.floor(c.rand() * 9), Math.floor(c.rand() * 60));
    const buyer = pick(regulars, c.rand);
    const used = new Set<string>();
    const lines: Line[] = [];
    const n = 1 + Math.floor(c.rand() * 2);
    for (let j = 0; j < n; j++) {
      let it = pick(pool, c.rand);
      while (used.has(it.id)) it = pick(pool, c.rand);
      used.add(it.id);
      lines.push(L(it, 1 + Math.floor(c.rand() * 4)));
    }
    october.push({ id: sid('doc'), at, branchId: c.rand() < 0.55 ? 'BGS' : 'CHR', buyer: partyOf(buyer), buyerId: buyer.id, lines });
  }
  october.sort((a, b) => a.at - b.at);
  october.forEach((p, k) => {
    okDoc(c, {
      id: p.id,
      bizId,
      number: `INV-${pad4(878 + k)}`,
      branchId: p.branchId,
      buyer: p.buyer,
      buyerId: p.buyerId,
      lines: p.lines,
      at: p.at,
      source: p.requestId ? 'request' : 'manual',
      receiptNo: p.receiptNo,
      requestId: p.requestId,
    });
  });

  // The last week, document by document.
  const n = (k: number) => `INV-${pad4(k)}`;
  const doc = (b: Buyer) => ({ buyer: partyOf(b), buyerId: b.id });
  okDoc(c, { bizId, number: n(908), branchId: 'CHR', ...doc(ceria), lines: [L(wr3y, 3)], at: myt(2026, 10, 27, 11, 40) });
  okDoc(c, { bizId, number: n(909), branchId: 'BGS', ...doc(harmoni), lines: [L(mn27, 1)], at: myt(2026, 10, 28, 15, 5) });
  mkDoc(c, {
    bizId,
    number: n(910),
    branchId: 'BGS',
    ...doc(angkut),
    lines: [L(mn27, 1)],
    status: 'cancelled',
    issuedAt: myt(2026, 10, 29, 10, 10),
    submittedAt: myt(2026, 10, 29, 10, 14),
    validatedAt: myt(2026, 10, 29, 10, 14, 6),
    emailedAt: myt(2026, 10, 29, 10, 15),
    cancelledAt: myt(2026, 10, 29, 11, 2),
    cancelReason: 'Wrong invoice details',
  });
  mkDoc(c, {
    bizId,
    number: n(911),
    branchId: 'BGS',
    ...doc(harmoni),
    lines: [L(lt14, 1), { ...L(bag, 1), cls: '' }],
    status: 'invalid',
    issuedAt: myt(2026, 10, 30, 15, 4),
    submittedAt: myt(2026, 10, 30, 15, 10),
    source: 'import',
    errors: [
      {
        path: 'Invoice › InvoiceLine[2] › Item › CommodityClassification',
        message: 'Line 2, Laptop bag, 14-inch, has no classification code.',
        field: 'line-2',
      },
    ],
  });
  const inv912 = okDoc(c, { bizId, number: n(912), branchId: 'CHR', ...doc(mesra), lines: [L(mn27, 2), L(prlj, 2)], at: T - 63 * HOUR });
  okDoc(c, { bizId, number: n(913), branchId: 'CHR', ...doc(ceria), lines: [L(lt14, 3)], at: T - 48 * HOUR - 55 * MIN });
  okDoc(c, { bizId, number: 'CN-0042', type: '02', branchId: 'CHR', ...doc(mesra), lines: [L(prlj, 1)], refId: inv912.id, at: T - 48 * HOUR - 20 * MIN });
  okDoc(c, { bizId, number: n(914), branchId: 'BGS', ...doc(angkut), lines: [L(tb11, 5)], at: T - 25 * HOUR });
  okDoc(c, { bizId, number: n(915), branchId: 'CHR', ...doc(ahmad), lines: [L(lt14, 1)], at: myt(2026, 11, 2, 14, 30) });
  mkDoc(c, {
    bizId,
    number: n(916),
    branchId: 'BGS',
    ...doc(suria),
    tinStatus: 'unchecked',
    lines: [L(prlj, 2)],
    status: 'invalid',
    issuedAt: myt(2026, 11, 2, 16, 1),
    submittedAt: myt(2026, 11, 2, 16, 5),
    errors: [
      {
        path: 'Invoice › AccountingCustomerParty › PartyIdentification (TIN)',
        message: "LHDN couldn't match the buyer's TIN C2011457701. Company tax numbers always end in 0.",
        field: 'tin',
      },
    ],
  });
  okDoc(c, { bizId, number: n(917), branchId: 'BGS', ...doc(harmoni), lines: [L(lt14, 4), L(wr3y, 4)], issuedAt: T - 62 * MIN, at: T - 55 * MIN });
  mkDoc(c, {
    id: 'doc_farid',
    bizId,
    number: n(918),
    branchId: 'BGS',
    ...doc(farid),
    lines: [L(lt15, 1), L(prlj, 1)],
    status: 'submitted',
    issuedAt: T - 14_000,
    submittedAt: T - 8_000,
    source: 'request',
    receiptNo: 'R-08831',
    requestId: 'rq_farid',
  });

  // Buyer requests: Farid's was just approved, five are waiting.
  const items = (list: [Item, number][]) => list.map(([it, q]) => ({ desc: it.name, cls: it.cls, qty: q, price: it.price }));
  const faridAt = receiptAtNo(bgs, 'R-08831');
  c.requests.push({
    id: 'rq_farid',
    bizId,
    branchId: 'BGS',
    receiptNo: 'R-08831',
    receiptAt: faridAt,
    requestedAt: faridAt + 12 * MIN,
    items: items([[lt15, 1], [prlj, 1]]),
    buyer: partyOf(farid),
    tinStatus: 'verified',
    channel: 'receipt-qr',
    status: 'issued',
    docId: 'doc_farid',
  });
  const waiting = (
    id: string,
    branchId: string,
    receiptNo: string,
    receiptAt: number,
    list: [Item, number][],
    p: Party,
    tinStatus: TinStatus = 'verified',
    channel: BuyerRequest['channel'] = 'receipt-qr',
  ) =>
    c.requests.push({
      id,
      bizId,
      branchId,
      receiptNo,
      receiptAt,
      requestedAt: receiptAt + (channel === 'counter' ? 2 : 9 + Math.floor(c.rand() * 12)) * MIN,
      items: items(list),
      buyer: p,
      tinStatus,
      channel,
      status: 'pending',
    });
  waiting('rq_nurul', 'BGS', 'R-08827', receiptAtNo(bgs, 'R-08827'), [[ph67, 1]], person('Nurul Aisyah binti Kamal', 'IG95021407788', '950214107788', 'nurul.aisyah@example.com', '0172219034', '22 Jalan Telawi 3, Bangsar Baru', '59100', 'Kuala Lumpur', '14'));
  waiting('rq_lim', 'CHR', 'CH-05498', receiptAtNo(chr, 'CH-05498'), [[ebw2, 1]], person('Lim Wei Jie', 'IG90061208815', '900612085543', 'weijie.lim@example.com', '0127730195', '5 Jalan Cerdas, Taman Connaught', '56000', 'Kuala Lumpur', '14'));
  waiting('rq_rajesh', 'BGS', 'R-08830', receiptAtNo(bgs, 'R-08830'), [[lt15, 1]], person('Rajesh a/l Subramaniam', 'IG82111503361', '821115035519', 'rajesh.s@example.com', '0193345120', '40 Jalan Ara, Bangsar', '59100', 'Kuala Lumpur', '14'));
  waiting('rq_siti', 'CHR', 'CH-05512', myt(2026, 11, 1, 11, 30), [[tb11, 1]], person('Siti Hajar binti Osman', 'IG99030209924', '990302105608', 'sitihajar.osman@example.com', '0145523987', '12 Jalan Manis 4, Taman Segar', '56100', 'Kuala Lumpur', '14'));
  waiting('rq_tan', 'BGS', 'R-08844', myt(2026, 11, 2, 16, 47), [[prlj, 1]], person('Tan Mei Xin', 'SG87042116650', '870421145662', 'meixin.tan@example.com', '0166678042', '9 Jalan Medang Serai', '59100', 'Kuala Lumpur', '14'), 'unchecked', 'counter');

  // Month-end: Cheras imported its October sales yesterday, Bangsar hasn't yet.
  c.runs.push({ id: 'run_jaya_BGS', bizId, branchId: 'BGS', period: PERIOD, stage: 'no-file', sampleSpec: bgs.key, docIds: [] });
  c.runs.push({
    id: 'run_jaya_CHR',
    bizId,
    branchId: 'CHR',
    period: PERIOD,
    stage: 'imported',
    sampleSpec: chr.key,
    file: { name: chr.fileName, at: T - 20 * HOUR, spec: chr.key },
    docIds: [],
  });
  const sepB = pastRuns(c.rand, 'R-', 5112, 1906, 54_821_040, 11);
  const conB = consolidatedDoc(c, bizId, 'BGS', '2026-09', sepB.lines, sepB.receipts, myt(2026, 10, 5, 10, 2));
  c.runs.push({ id: 'run_jaya_BGS_09', bizId, branchId: 'BGS', period: '2026-09', stage: 'done', docIds: [conB.id], submittedAt: conB.submittedAt, doneAt: conB.validatedAt });
  const sepC = pastRuns(c.rand, 'CH-', 3150, 1151, 37_790_615, 6);
  const conC = consolidatedDoc(c, bizId, 'CHR', '2026-09', sepC.lines, sepC.receipts, myt(2026, 10, 5, 10, 4));
  c.runs.push({ id: 'run_jaya_CHR_09', bizId, branchId: 'CHR', period: '2026-09', stage: 'done', docIds: [conC.id], submittedAt: conC.submittedAt, doneAt: conC.validatedAt });

  c.counters[bizId] = { '01': 918, '02': 42, '03': 0, '04': 0 };
  return biz;
}

// ---------------------------------------------------------------------------
// The accounting firm's other clients, generated from a short description each.

interface ClientSpec {
  id: string;
  name: string;
  short: string;
  initials: string;
  tin: string;
  brn: string;
  phase: 3 | 4;
  msic: string;
  msicName: string;
  activity: string;
  address: Address;
  phone: string;
  owner: Person;
  tone: number;
  status: 'waiting' | 'invalid' | 'ready' | 'done';
  filedAt?: number;
  startNo: number;
  items: [string, string, string, number][];
  receipts: { count: number; cents: number; big?: number[] };
  seed: number;
}

const CLIENT_BUYERS: [string, string, string, string, string][] = [
  ['Restoran Selera Kampung Sdn Bhd', '18 Jalan Raja Muda Abdul Aziz', '50300', 'Kuala Lumpur', '14'],
  ['Hotel Seri Puteri Sdn Bhd', '2 Jalan Sultan Ismail', '50250', 'Kuala Lumpur', '14'],
  ['Azman & Co', '5 Jalan Kemajuan, Seksyen 12', '46200', 'Petaling Jaya', '10'],
  ['Kilang Roti Mesra Sdn Bhd', 'Lot 22, Jalan Perusahaan 3', '40300', 'Shah Alam', '10'],
  ['Syarikat Pengangkutan Laju Sdn Bhd', '9 Jalan Klang Lama', '58000', 'Kuala Lumpur', '14'],
  ['Pusat Rawatan Sejahtera Sdn Bhd', '44 Jalan Pahang', '53000', 'Kuala Lumpur', '14'],
  ['Aircond Pro Services', '7 Jalan Cempaka 2, Taman Cempaka', '68000', 'Ampang', '10'],
];

const CLIENT_SPECS: ClientSpec[] = [
  {
    id: 'seri',
    name: 'Kedai Perabot Seri Sdn Bhd',
    short: 'Perabot Seri',
    initials: 'PS',
    tin: 'C30982214070',
    brn: '201401012876',
    phase: 4,
    msic: '47591',
    msicName: 'Retail sale of household furniture',
    activity: 'Furniture retail',
    address: { line1: '2 Jalan Kristal 7/6, Seksyen 7', postcode: '40000', city: 'Shah Alam', state: '10' },
    phone: '0355101876',
    owner: { name: 'Rosli Ismail', role: 'Director', initials: 'RI' },
    tone: 2,
    status: 'waiting',
    startNo: 341,
    items: [
      ['SF-3S', 'Sofa, 3-seater', '022', 2890],
      ['DN-6', 'Dining set, 6 seats', '022', 3450],
      ['BD-QN', 'Queen bed frame', '022', 1690],
      ['SV-DLV', 'Delivery and assembly', '022', 150],
    ],
    receipts: { count: 640, cents: 18_642_000, big: [1_135_000, 1_268_000] },
    seed: 640,
  },
  {
    id: 'mesra',
    name: 'Pasaraya Mesra Sdn Bhd',
    short: 'Pasaraya Mesra',
    initials: 'PM',
    tin: 'C10477125090',
    brn: '200901004512',
    phase: 3,
    msic: '47111',
    msicName: 'Retail sale in non-specialised stores, mainly food',
    activity: 'Supermarket',
    address: { line1: '88 Jalan Cheras', postcode: '56100', city: 'Kuala Lumpur', state: '14' },
    phone: '0391321177',
    owner: { name: 'Halim Yusof', role: 'Finance manager', initials: 'HY' },
    tone: 3,
    status: 'invalid',
    filedAt: myt(2026, 11, 2, 17, 25),
    startNo: 2211,
    items: [
      ['GR-RICE10', 'Rice, 10 kg', '022', 38.9],
      ['GR-OIL5', 'Cooking oil, 5 kg', '022', 32.5],
      ['GR-CATER', 'Groceries for catering, bulk', '022', 2480],
      ['GR-WATER', 'Mineral water, 24 bottles', '022', 14.9],
    ],
    receipts: { count: 3120, cents: 52_480_000, big: [1_250_000] },
    seed: 3120,
  },
  {
    id: 'harmoni',
    name: 'Klinik Gigi Harmoni Sdn Bhd',
    short: 'Klinik Gigi Harmoni',
    initials: 'KG',
    tin: 'C2584563200',
    brn: '201901234567',
    phase: 4,
    msic: '86203',
    msicName: 'Dental practice activities',
    activity: 'Dental clinic',
    address: { line1: '21 Jalan Maarof, Bangsar', postcode: '59000', city: 'Kuala Lumpur', state: '14' },
    phone: '0322821450',
    owner: { name: 'Dr Nadia Karim', role: 'Director', initials: 'NK' },
    tone: 1,
    status: 'ready',
    startNo: 1181,
    items: [
      ['DT-SCL', 'Scaling and polishing', '041', 180],
      ['DT-FIL', 'Tooth filling', '041', 150],
      ['DT-RCT', 'Root canal treatment', '041', 950],
      ['DT-CRN', 'Dental crown', '041', 1800],
    ],
    receipts: { count: 412, cents: 9_654_000 },
    seed: 412,
  },
  {
    id: 'ahmad',
    name: 'Bengkel Motor Ahmad',
    short: 'Bengkel Motor Ahmad',
    initials: 'BA',
    tin: 'IG23458810020',
    brn: '202003114455',
    phase: 4,
    msic: '45200',
    msicName: 'Maintenance and repair of motor vehicles',
    activity: 'Car workshop',
    address: { line1: '14 Jalan Gombak, Setapak', postcode: '53000', city: 'Kuala Lumpur', state: '14' },
    phone: '0340217788',
    owner: { name: 'Ahmad Zaki', role: 'Owner', initials: 'AZ' },
    tone: 4,
    status: 'done',
    filedAt: myt(2026, 11, 3, 9, 12),
    startNo: 461,
    items: [
      ['SV-ENG', 'Engine service', '030', 280],
      ['SV-BRK', 'Brake pad replacement', '030', 220],
      ['TY-205', 'Tyre, 205/55 R16', '022', 260],
    ],
    receipts: { count: 238, cents: 5_412_000 },
    seed: 238,
  },
  {
    id: 'suria',
    name: 'Suria Tuition Centre',
    short: 'Suria Tuition',
    initials: 'ST',
    tin: 'C20114577010',
    brn: '201801017755',
    phase: 4,
    msic: '85494',
    msicName: 'Tuition centre',
    activity: 'Tuition centre',
    address: { line1: '5 Jalan SS 2/24', postcode: '47300', city: 'Petaling Jaya', state: '10' },
    phone: '0379563320',
    owner: { name: 'Kavitha Raman', role: 'Principal', initials: 'KR' },
    tone: 5,
    status: 'done',
    filedAt: myt(2026, 11, 2, 16, 40),
    startNo: 771,
    items: [
      ['ED-SPM', 'Monthly tuition, SPM', '010', 320],
      ['ED-WKS', 'Exam workshop', '010', 150],
    ],
    receipts: { count: 186, cents: 5_952_000 },
    seed: 186,
  },
  {
    id: 'ceria',
    name: 'Tadika Ceria Sdn Bhd',
    short: 'Tadika Ceria',
    initials: 'TC',
    tin: 'C30288190050',
    brn: '201501029911',
    phase: 4,
    msic: '85101',
    msicName: 'Pre-primary education',
    activity: 'Kindergarten',
    address: { line1: '3 Jalan Ampang Hilir', postcode: '55000', city: 'Kuala Lumpur', state: '14' },
    phone: '0342561890',
    owner: { name: 'Faridah Musa', role: 'Director', initials: 'FM' },
    tone: 2,
    status: 'waiting',
    startNo: 151,
    items: [
      ['TK-FEE', 'Kindergarten fees, monthly', '002', 650],
      ['TK-REG', 'Registration fee', '002', 300],
    ],
    receipts: { count: 120, cents: 7_800_000 },
    seed: 120,
  },
  {
    id: 'kuat',
    name: 'Kuat Fitness Sdn Bhd',
    short: 'Kuat Fitness',
    initials: 'KF',
    tin: 'C27765310040',
    brn: '201701044190',
    phase: 4,
    msic: '93113',
    msicName: 'Fitness centres',
    activity: 'Gym',
    address: { line1: '1 Jalan PJU 7/3, Mutiara Damansara', postcode: '47800', city: 'Petaling Jaya', state: '10' },
    phone: '0377221903',
    owner: { name: 'Jason Ong', role: 'Director', initials: 'JO' },
    tone: 1,
    status: 'done',
    filedAt: myt(2026, 11, 1, 11, 5),
    startNo: 906,
    items: [
      ['GY-MTH', 'Gym membership, monthly', '013', 159],
      ['GY-PT10', 'Personal training, 10 sessions', '013', 900],
    ],
    receipts: { count: 744, cents: 15_088_000 },
    seed: 744,
  },
];

function companyTin(rand: () => number): string {
  let d = String(1 + Math.floor(rand() * 9));
  for (let i = 0; i < 9; i++) d += Math.floor(rand() * 10);
  return 'C' + d + '0';
}

function seedClient(c: Ctx, s: ClientSpec): Business {
  const rand = rng(s.seed * 97);
  const biz: Business = {
    id: s.id,
    name: s.name,
    short: s.short,
    initials: s.initials,
    tin: s.tin,
    brn: s.brn,
    msic: s.msic,
    msicName: s.msicName,
    activity: s.activity,
    address: s.address,
    phone: s.phone,
    email: `accounts.${s.id}@example.com`,
    phase: s.phase,
    branches: [{ id: 'MAIN', name: 'Main', prefix: `${s.initials}-` }],
    owner: s.owner,
    tone: s.tone,
  };
  const items = s.items.map(([sku, name, cls, price], k) => {
    const it: Item = { id: `i_${s.id}_${k}`, bizId: s.id, sku, name, cls, price, tax: '06' };
    c.items.push(it);
    return it;
  });
  const offset = Math.floor(rand() * CLIENT_BUYERS.length);
  const buyers = [0, 1, 2, 3].map((k) => {
    const [name, line1, postcode, city, state] = CLIENT_BUYERS[(offset + k) % CLIENT_BUYERS.length];
    const b: Buyer = {
      id: `b_${s.id}_${k}`,
      bizId: s.id,
      kind: 'company',
      name,
      tin: companyTin(rand),
      idType: 'BRN',
      idValue: String(2005 + Math.floor(rand() * 15)) + '0' + String(1e6 + Math.floor(rand() * 9e6)).slice(1, 8),
      email: `accounts${k + 1}.${s.id}@example.com`,
      phone: '03' + String(Math.floor(2e7 + rand() * 7e7)),
      address: { line1, postcode, city, state },
      tinStatus: 'verified',
      checkedAt: T - 30 * DAY,
    };
    c.buyers.push(b);
    return b;
  });

  let no = s.startNo;
  const times = Array.from({ length: 7 }, () => myt(2026, 10, 6, 9) + Math.floor(rand() * 26 * DAY)).sort((a, b) => a - b);
  for (const at of times) {
    const it = pick(items, rand);
    const qty = it.price > 1000 ? 1 + Math.floor(rand() * 3) : 2 + Math.floor(rand() * 18);
    const b = pick(buyers, rand);
    okDoc(c, { bizId: s.id, number: `INV-${pad4(no++)}`, branchId: 'MAIN', buyer: partyOf(b), buyerId: b.id, lines: [L(it, qty)], at });
  }
  if (s.status === 'invalid') {
    const wrong: Buyer = {
      id: `b_${s.id}_wrong`,
      bizId: s.id,
      kind: 'company',
      name: 'Kafe Teratai Sdn Bhd',
      tin: 'C2290017451',
      idType: 'BRN',
      idValue: '201901045522',
      email: 'accounts.teratai@example.com',
      phone: '0322877410',
      address: { line1: '3 Jalan Telawi 2, Bangsar Baru', postcode: '59100', city: 'Kuala Lumpur', state: '14' },
      tinStatus: 'unchecked',
    };
    c.buyers.push(wrong);
    mkDoc(c, {
      bizId: s.id,
      number: `INV-${pad4(no++)}`,
      branchId: 'MAIN',
      buyer: partyOf(wrong),
      buyerId: wrong.id,
      tinStatus: 'unchecked',
      lines: [L(items[2], 1)],
      status: 'invalid',
      issuedAt: T - 30 * HOUR - 4 * MIN,
      submittedAt: T - 30 * HOUR,
      errors: [
        {
          path: 'Invoice › AccountingCustomerParty › PartyIdentification (TIN)',
          message: "LHDN couldn't match the buyer's TIN C2290017451. Company tax numbers always end in 0.",
          field: 'tin',
        },
      ],
    });
  }

  const sep = pastRuns(rand, biz.branches[0].prefix, 10001 - Math.floor(s.receipts.count * 0.97), Math.floor(s.receipts.count * 0.97), Math.round(s.receipts.cents * (0.92 + rand() * 0.1) / 10) * 10, 2 + Math.floor(rand() * 3));
  const sepDoc = consolidatedDoc(c, s.id, 'MAIN', '2026-09', sep.lines, sep.receipts, myt(2026, 10, 3 + Math.floor(rand() * 3), 10, 30));
  c.runs.push({ id: `run_${s.id}_MAIN_09`, bizId: s.id, branchId: 'MAIN', period: '2026-09', stage: 'done', docIds: [sepDoc.id], submittedAt: sepDoc.submittedAt, doneAt: sepDoc.validatedAt });

  const big = s.receipts.big ?? [];
  const spec = registerSpec({
    key: `${s.id}-MAIN-2610`,
    fileName: `sales_oct_${s.id}.csv`,
    prefix: biz.branches[0].prefix,
    pad: 5,
    start: 10001,
    count: s.receipts.count,
    from: myt(2026, 10, 1),
    days: 31,
    consolidatedCents: s.receipts.cents - big.reduce((a, b) => a + b, 0),
    big,
    requested: [],
    fixed: [],
    seed: s.seed,
  });
  const run: MonthEndRun = { id: `run_${s.id}_MAIN`, bizId: s.id, branchId: 'MAIN', period: PERIOD, stage: 'no-file', sampleSpec: spec.key, docIds: [] };
  if (s.status === 'ready') {
    run.stage = 'imported';
    run.file = { name: spec.fileName, at: T - (3 + Math.floor(rand() * 15)) * HOUR, spec: spec.key };
  }
  if ((s.status === 'done' || s.status === 'invalid') && s.filedAt) {
    const split = computeSplit(makeReceipts(spec), new Set(), new Set());
    const con = consolidatedDoc(c, s.id, 'MAIN', PERIOD, split.lines, split.consolidated.length, s.filedAt);
    const ids = [con.id];
    for (const r of split.individual) {
      const d = okDoc(c, {
        bizId: s.id,
        number: `INV-${pad4(no++)}`,
        branchId: 'MAIN',
        buyer: GENERAL_PUBLIC,
        lines: [{ id: sid('ln'), desc: `Sale above RM10,000, receipt ${r.no}`, cls: items[0].cls, qty: 1, price: r.cents / 100, tax: '06' }],
        at: s.filedAt + 20_000,
        source: 'month-end',
        receiptNo: r.no,
      });
      ids.push(d.id);
    }
    run.stage = 'done';
    run.file = { name: spec.fileName, at: s.filedAt - 35 * MIN, spec: spec.key };
    run.docIds = ids;
    run.submittedAt = s.filedAt;
    run.doneAt = s.filedAt + 30_000;
  }
  c.runs.push(run);
  c.counters[s.id] = { '01': no - 1, '02': 0, '03': 0, '04': 0 };
  return biz;
}

export function makeSeed(realStart: number): State {
  nid = 0;
  const c: Ctx = { rand: rng(20261103), docs: [], buyers: [], items: [], requests: [], runs: [], counters: {} };
  const jaya = seedJaya(c);
  const others = CLIENT_SPECS.map((s) => seedClient(c, s));
  const all = [jaya, ...others];
  const clients: ClientMeta[] = all.map((b) => ({ id: `c_${b.id}`, bizId: b.id, name: b.name, tin: b.tin }));
  return {
    v: STATE_VERSION,
    realStart,
    persona: 'owner',
    activeBizId: 'jaya',
    firm: FIRM,
    businesses: all,
    clients,
    buyers: c.buyers,
    items: c.items,
    docs: c.docs,
    requests: c.requests,
    runs: c.runs,
    counters: c.counters,
    settings: { autoIssue: false, speed: 'realistic', rejectNext: false },
    guide: { open: true, done: { fix: false, big: false, request: false, monthend: false, accountant: false } },
  };
}
