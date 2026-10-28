export type DocType = '01' | '02' | '03' | '04';
export type DocStatus = 'draft' | 'submitted' | 'valid' | 'invalid' | 'cancelled';
export type TaxCode = '06' | '02' | '01' | 'E';
export type BuyerKind = 'company' | 'individual' | 'general';
export type IdType = 'BRN' | 'NRIC' | 'PASSPORT' | 'ARMY';
export type TinStatus = 'verified' | 'unchecked' | 'not-found';

export interface Address {
  line1: string;
  postcode: string;
  city: string;
  state: string;
}

export interface Branch {
  id: string;
  name: string;
  prefix: string;
}

export interface Person {
  name: string;
  role: string;
  initials: string;
}

export interface Business {
  id: string;
  name: string;
  short: string;
  initials: string;
  tin: string;
  /** The ID that goes with the TIN: the BRN for a company or sole proprietor, else MyKad (or passport, army number) for an individual. */
  brn: string;
  /** What brn holds. Unset means BRN. */
  idType?: IdType;
  /** SST registration number, or empty when not registered ("NA" on the e-invoice). */
  sst?: string;
  msic: string;
  msicName: string;
  activity: string;
  address: Address;
  phone: string;
  email: string;
  phase: 1 | 2 | 3 | 4;
  branches: Branch[];
  owner: Person;
  tone: number;
}

export interface Party {
  kind: BuyerKind;
  name: string;
  tin: string;
  idType: IdType;
  idValue: string;
  email: string;
  phone: string;
  address: Address;
}

export interface Buyer extends Party {
  id: string;
  bizId: string;
  tinStatus: TinStatus;
  checkedAt?: number;
}

export interface Item {
  id: string;
  bizId: string;
  sku: string;
  name: string;
  cls: string;
  price: number;
  tax: TaxCode;
}

export interface Line {
  id: string;
  desc: string;
  cls: string;
  qty: number;
  price: number;
  tax: TaxCode;
}

export interface DocError {
  path: string;
  message: string;
  field?: string;
}

export type EventKind = 'draft' | 'submitted' | 'resubmitted' | 'valid' | 'invalid' | 'emailed' | 'cancelled';

export interface DocEvent {
  t: number;
  kind: EventKind;
  label: string;
}

/** How a document was sent to the real MyInvois. Follow-up calls use the same login. */
export interface LiveRef {
  env: 'sandbox' | 'production';
  version: '1.0' | '1.1';
  /** The client's TIN when an intermediary sent it. */
  onBehalfOf?: string;
  /** The buyer asked LHDN to reject it; it stays valid until the supplier cancels. */
  rejectRequestedAt?: number;
  rejectReason?: string;
}

export interface Doc {
  id: string;
  bizId: string;
  type: DocType;
  number: string;
  branchId: string;
  buyerId?: string;
  buyer: Party;
  tinStatus: TinStatus;
  issuedAt: number;
  lines: Line[];
  status: DocStatus;
  attempts: number;
  uuid?: string;
  submissionUid?: string;
  longId?: string;
  submittedAt?: number;
  validatedAt?: number;
  cancelledAt?: number;
  cancelReason?: string;
  emailedAt?: number;
  errors?: DocError[];
  refId?: string;
  consolidated?: { period: string; branchId: string; receipts: number };
  source: 'manual' | 'request' | 'month-end' | 'import';
  receiptNo?: string;
  requestId?: string;
  wasInvalid?: boolean;
  /** Set when the document went to the real MyInvois rather than the simulated one. */
  live?: LiveRef;
  events: DocEvent[];
}

/**
 * An e-invoice a supplier issued to one of our businesses. The buyer can reject it within 72 hours
 * of validation; it stays valid until the supplier cancels it.
 */
export interface ReceivedDoc {
  id: string;
  bizId: string;
  uuid: string;
  longId?: string;
  /** "Invoice", "Credit Note"… as MyInvois names the type. */
  typeName: string;
  number: string;
  supplierName: string;
  supplierTin: string;
  issuedAt: number;
  validatedAt?: number;
  total: number;
  status: 'valid' | 'cancelled';
  rejectRequestedAt?: number;
  rejectReason?: string;
  cancelledAt?: number;
  lines?: { desc: string; qty: number; amount: number }[];
  /** Set when it came from the real MyInvois; follow-up calls use the same login. */
  live?: { env: LiveRef['env']; onBehalfOf?: string };
}

export interface RequestItem {
  desc: string;
  cls: string;
  qty: number;
  price: number;
}

export interface BuyerRequest {
  id: string;
  bizId: string;
  branchId: string;
  receiptNo: string;
  receiptAt: number;
  requestedAt: number;
  items: RequestItem[];
  buyer: Party;
  tinStatus: TinStatus;
  channel: 'receipt-qr' | 'counter';
  status: 'pending' | 'issued' | 'declined';
  docId?: string;
  declineReason?: string;
  fresh?: boolean;
}

export interface Receipt {
  no: string;
  seq: number;
  at: number;
  cents: number;
}

export interface RunFile {
  name: string;
  at: number;
  spec?: string;
  rows?: Receipt[];
  skipped?: number;
}

export interface MonthEndRun {
  id: string;
  bizId: string;
  branchId: string;
  period: string;
  stage: 'no-file' | 'imported' | 'submitting' | 'done';
  file?: RunFile;
  sampleSpec?: string;
  docIds: string[];
  submittedAt?: number;
  doneAt?: number;
}

export interface ClientMeta {
  id: string;
  bizId?: string;
  name: string;
  tin: string;
  remindedAt?: number;
  invitedEmail?: string;
  invitedAt?: number;
}

export interface Settings {
  autoIssue: boolean;
  speed: 'quick' | 'realistic';
  rejectNext: boolean;
}

export type GuideKey = 'fix' | 'big' | 'request' | 'monthend' | 'accountant';

/** demo: sample data, simulated MyInvois, demo clock. live: your own data, real MyInvois, real clock. */
export type Workspace = 'demo' | 'live';

export interface State {
  v: number;
  workspace: Workspace;
  realStart: number;
  persona: 'owner' | 'accountant';
  activeBizId: string | null;
  firm: { name: string; initials: string; tin: string; user: Person };
  businesses: Business[];
  clients: ClientMeta[];
  buyers: Buyer[];
  items: Item[];
  docs: Doc[];
  received: ReceivedDoc[];
  requests: BuyerRequest[];
  runs: MonthEndRun[];
  counters: Record<string, Record<DocType, number>>;
  settings: Settings;
  guide: { open: boolean; done: Record<GuideKey, boolean> };
}
