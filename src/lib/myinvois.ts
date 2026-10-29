// Calls this app's /api/myinvois endpoints (server/handler.ts), which hold the MyInvois
// credentials and signing key. Nothing here talks to LHDN directly or sees a secret.
import type { IdType, LiveRef } from '../types';

export type LiveEnv = LiveRef['env'];

export interface LiveStatus {
  /** MyInvois can be used from here: the server has credentials, and this browser its access key if it asks for one. */
  configured: boolean;
  /** The server has credentials, but asks for its access key (MYINVOIS_ACCESS_KEY) first. */
  locked: boolean;
  /** The taxpayer the server's credentials log in as: the supplier TIN every document must carry. */
  taxpayerTin?: string;
  env: LiveEnv;
  apiHost: string;
  portalUrl: string;
  taxpayer: boolean;
  intermediary: boolean;
  version: '1.0' | '1.1';
  signing: { subject: string; organization?: string; tin?: string; brn?: string; issuer: string; validTo: string } | null;
  problems: string[];
}

export interface ApiErrorDetail {
  code?: string;
  message: string;
  path?: string;
  property?: string;
}

export class ApiError extends Error {
  status: number;
  code: string;
  details: ApiErrorDetail[];
  retryAfter?: number;
  constructor(status: number, code: string, message: string, details: ApiErrorDetail[] = [], retryAfter?: number) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAfter = retryAfter;
  }
}

export interface DocSummary {
  uuid: string;
  submissionUid?: string;
  submissionUID?: string;
  longId?: string;
  internalId: string;
  typeName?: string;
  typeVersionName?: string;
  issuerTin?: string;
  receiverId?: string;
  receiverName?: string;
  dateTimeIssued?: string;
  dateTimeReceived?: string;
  dateTimeValidated?: string;
  status: string;
  cancelDateTime?: string | null;
  rejectRequestDateTime?: string | null;
  documentStatusReason?: string | null;
  // Search Documents and Get Recent Documents add these (MyInvois spells some "TIN", some "Tin").
  issuerName?: string;
  supplierName?: string;
  supplierTIN?: string;
  supplierTin?: string;
  buyerName?: string;
  buyerTIN?: string;
  buyerTin?: string;
  total?: number;
  submissionChannel?: string;
  intermediaryName?: string;
  intermediaryTin?: string;
}

export interface Submission {
  submissionUid: string;
  documentCount: number;
  dateTimeReceived: string;
  overallStatus: string;
  documentSummary: DocSummary[];
}

export interface DocDetails extends DocSummary {
  errors: ApiErrorDetail[];
}

export interface RawDocument extends DocSummary {
  document: string;
}

export interface Page<T> {
  result: T[];
  metadata?: { totalPages: number; totalCount: number };
}

export interface Notice {
  notificationId: string;
  creationDateTime?: string;
  receivedDateTime?: string;
  notificationSubject: string;
  typeId: string | number;
  typeName: string;
  finalMessage?: string;
  status: string;
}

export interface TaxpayerInfo {
  tin: string;
  name: string;
  idType: string;
  idNumber: string;
  sst?: string;
  email?: string;
  contactNumber?: string;
  ttx?: string;
  businessActivityDescriptionEN?: string;
  businessActivityDescriptionBM?: string;
  msic?: string;
  addressLine0?: string;
  addressLine1?: string;
  addressLine2?: string;
  postalZone?: string;
  city?: string;
  state?: string;
  country?: string;
}

export interface DocumentTypeVersion {
  id: number;
  name: string;
  description?: string;
  versionNumber: number;
  status: string;
  activeFrom?: string;
  activeTo?: string | null;
  invoiceTypeCode?: number;
}

export interface DocumentType {
  id: number;
  invoiceTypeCode: number;
  description: string;
  activeFrom?: string;
  activeTo?: string | null;
  documentTypeVersions?: DocumentTypeVersion[];
  /** Get Document Type only: submissionDuration, cancellationDuration, rejectionDuration (hours). */
  workflowParameters?: { id: number; parameter: string; value: number; activeFrom?: string; activeTo?: string | null }[];
}

export interface SubmitResult {
  submissionUid: string;
  acceptedDocuments: { uuid: string; invoiceCodeNumber: string }[];
  rejectedDocuments: { invoiceCodeNumber: string; errors: ApiErrorDetail[] }[];
  version: '1.0' | '1.1';
}

export const PORTAL: Record<LiveEnv, string> = {
  sandbox: 'https://preprod.myinvois.hasil.gov.my',
  production: 'https://myinvois.hasil.gov.my',
};

/** The public validation page the e-invoice QR code opens. */
export const validationUrl = (env: LiveEnv, uuid: string, longId: string) => `${PORTAL[env]}/${uuid}/share/${longId}`;

type Query = Record<string, string | number | undefined>;

// Relative, so it works wherever the app is served from.
const BASE = 'api/myinvois';
const enc = encodeURIComponent;

// A server on the internet asks for its access key with every call. Only this browser keeps it.
const KEY_STORE = 'sahkan-access-key';
let accessKey: string | undefined;

function storedKey(): string {
  if (accessKey === undefined) {
    try {
      accessKey = localStorage.getItem(KEY_STORE) ?? '';
    } catch {
      accessKey = '';
    }
  }
  return accessKey;
}

/** Remembers the server's access key in this browser, or forgets it when given ''. */
export function setAccessKey(key: string) {
  accessKey = key.trim();
  try {
    if (accessKey) localStorage.setItem(KEY_STORE, accessKey);
    else localStorage.removeItem(KEY_STORE);
  } catch {
    /* no storage: the key lasts for this visit */
  }
}

async function api<T>(method: string, path: string, o: { onBehalfOf?: string; query?: Query; body?: unknown } = {}): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(o.query ?? {})) if (v !== undefined && v !== '') qs.set(k, String(v));
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (o.body !== undefined) headers['Content-Type'] = 'application/json';
  if (o.onBehalfOf) headers['X-MyInvois-On-Behalf-Of'] = o.onBehalfOf;
  if (storedKey()) headers.Authorization = `Bearer ${storedKey()}`;
  const q = qs.toString();
  let r: Response;
  try {
    r = await fetch(`${BASE}${path}${q ? `?${q}` : ''}`, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  } catch {
    throw new ApiError(0, 'Offline', "Can't reach the Sahkan server. Check your connection, or that npm run dev is still running.");
  }
  const text = await r.text();
  let j: unknown;
  try {
    j = text ? JSON.parse(text) : undefined;
  } catch {
    // Not JSON: no server behind this copy (the single-file build), or the host's own error page.
    const words: Record<number, string> = {
      413: 'That is too much to send at once. Send fewer documents.',
      504: 'The server took too long to answer. Try again.',
    };
    const why = words[r.status] ?? (r.status >= 500 ? `The server failed with HTTP ${r.status}. Its log says why.` : 'This copy of the app has no MyInvois server behind it.');
    throw new ApiError(r.status, 'NoServer', why);
  }
  if (!r.ok) {
    const e = (j as { error?: { code?: string; message?: string; details?: ApiErrorDetail[]; retryAfter?: number } })?.error;
    throw new ApiError(r.status, e?.code ?? `Http${r.status}`, e?.message ?? `The server answered ${r.status}.`, e?.details ?? [], e?.retryAfter);
  }
  return j as T;
}

/** The server's MyInvois setup, or null when there is no server (the single-file build). */
export async function liveStatus(): Promise<LiveStatus | null> {
  try {
    const s = await api<LiveStatus>('GET', '/status');
    return s && typeof s.configured === 'boolean' ? s : null;
  } catch {
    return null;
  }
}

export const myinvois = {
  /** Logs in and lists the document types: proves the credentials work. */
  check: (ob?: string) => api<{ documentTypes: DocumentType[] }>('POST', '/check', { onBehalfOf: ob, body: {} }),
  documentTypes: (ob?: string) => api<Page<DocumentType>>('GET', '/documenttypes', { onBehalfOf: ob }),
  documentType: (id: number, ob?: string) => api<DocumentType>('GET', `/documenttypes/${id}`, { onBehalfOf: ob }),
  documentTypeVersion: (id: number, vid: number, ob?: string) => api<DocumentTypeVersion>('GET', `/documenttypes/${id}/versions/${vid}`, { onBehalfOf: ob }),
  notifications: (q: Query, ob?: string) => api<Page<Notice>>('GET', '/notifications', { query: q, onBehalfOf: ob }),

  validateTin: (tin: string, idType: IdType, idValue: string, ob?: string) =>
    api<{ valid: boolean }>('GET', `/taxpayer/validate/${enc(tin)}`, { query: { idType, idValue }, onBehalfOf: ob }),
  searchTin: (q: { idType?: IdType; idValue?: string; taxpayerName?: string; fileType?: 1 | 2 }, ob?: string) =>
    api<{ tin: string | null }>('GET', '/taxpayer/search', { query: q, onBehalfOf: ob }),
  taxpayerFromQr: (qrText: string, ob?: string) => api<TaxpayerInfo>('GET', `/taxpayer/qr/${enc(qrText.trim())}`, { onBehalfOf: ob }),

  submit: (documents: { codeNumber: string; ubl: unknown }[], ob?: string) => api<SubmitResult>('POST', '/documents/submit', { body: { documents }, onBehalfOf: ob }),
  submission: (uid: string, ob?: string) => api<Submission>('GET', `/submissions/${enc(uid)}`, { query: { pageSize: 100 }, onBehalfOf: ob }),
  details: (uuid: string, ob?: string) => api<DocDetails>('GET', `/documents/${enc(uuid)}/details`, { onBehalfOf: ob }),
  raw: (uuid: string, ob?: string) => api<RawDocument>('GET', `/documents/${enc(uuid)}/raw`, { onBehalfOf: ob }),
  cancel: (uuid: string, reason: string, ob?: string) => api<{ uuid: string; status: string }>('PUT', `/documents/${enc(uuid)}/state`, { body: { status: 'cancelled', reason }, onBehalfOf: ob }),
  /** For the buyer of a received e-invoice: asks the supplier to cancel it. */
  reject: (uuid: string, reason: string, ob?: string) => api<{ uuid: string; status: string }>('PUT', `/documents/${enc(uuid)}/state`, { body: { status: 'rejected', reason }, onBehalfOf: ob }),
  recent: (q: Query, ob?: string) => api<Page<DocSummary>>('GET', '/documents/recent', { query: q, onBehalfOf: ob }),
  search: (q: Query, ob?: string) => api<Page<DocSummary>>('GET', '/documents/search', { query: q, onBehalfOf: ob }),
};

/** One line for a toast or a note. */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    const first = e.details[0]?.message;
    const wait = e.retryAfter ? ` Try again in ${e.retryAfter} seconds.` : '';
    return (first && first !== e.message ? `${e.message} ${first}` : e.message) + wait;
  }
  return (e as Error)?.message ?? 'Something went wrong.';
}
