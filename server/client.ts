// MyInvois API client. One login per ERP system and taxpayer, cached until shortly before it
// expires (LHDN asks for this), a fresh login after a 401, and a wait on 429 as Retry-After says.
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { readFileSync } from 'node:fs';
import type { Config, Credentials } from './config.js';

export interface ErrorDetail {
  code?: string;
  message: string;
  path?: string;
  property?: string;
}

export class MyInvoisError extends Error {
  status: number;
  code: string;
  details: ErrorDetail[];
  retryAfter?: number;
  /** MyInvois's own answer, for the server log. */
  raw?: string;
  constructor(status: number, code: string, message: string, details: ErrorDetail[] = [], retryAfter?: number) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAfter = retryAfter;
  }
}

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  text: string;
}

type Query = Record<string, string | number | undefined>;
type Json = Record<string, unknown>;

const CODES: Record<number, string> = {
  400: 'BadRequest',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'NotFound',
  422: 'Unprocessable',
  429: 'TooManyRequests',
  500: 'InternalServerError',
  503: 'ServiceUnavailable',
};

const wait = (s: number) => new Promise((r) => setTimeout(r, s * 1000));
const enc = encodeURIComponent;

/** Seconds to wait before calling again, from Retry-After or X-Rate-Limit-Reset. */
function retryAfter(h: http.IncomingHttpHeaders): number | undefined {
  const ra = Number(h['retry-after']);
  if (Number.isFinite(ra) && ra >= 0) return ra;
  const reset = Date.parse(String(h['x-rate-limit-reset'] ?? ''));
  return Number.isFinite(reset) ? Math.max(0, Math.ceil((reset - Date.now()) / 1000)) : undefined;
}

/**
 * MyInvois nests the real problems in innerError (validation results) or details (rejected
 * documents), sometimes several levels deep. This returns the innermost ones.
 */
export function flattenErrors(list: unknown): ErrorDetail[] {
  if (!Array.isArray(list)) return [];
  return list.flatMap((x: Json) => {
    const inner = flattenErrors(x?.innerError ?? x?.details);
    if (inner.length) return inner;
    const message = String(x?.error ?? x?.message ?? '').trim();
    if (!message) return [];
    return [
      {
        code: String(x.errorCode ?? x.code ?? '') || undefined,
        message,
        path: (x.propertyPath as string) || undefined,
        property: ((x.propertyName ?? x.target) as string) || undefined,
      },
    ];
  });
}

/**
 * MyInvois answers errors in several shapes: OAuth ({ error, error_description }) from the
 * identity service, its standard { error: { errorCode, error, innerError } } (sometimes flat, or
 * as { code, message, details }), ASP.NET's { title, detail, errors: { field: [..] } } when the
 * request itself doesn't bind, and plain text from the gateway. Whatever it is, its words reach
 * the caller: an unrecognised body is passed on as text rather than dropped.
 */
function parseError(r: Reply): MyInvoisError {
  const err = readError(r);
  err.raw = r.text.slice(0, 2000);
  return err;
}

function readError(r: Reply): MyInvoisError {
  let body: unknown;
  try {
    body = r.text ? JSON.parse(r.text) : undefined;
  } catch {
    body = undefined;
  }
  const retry = retryAfter(r.headers);
  const fallback = CODES[r.status] ?? `Http${r.status}`;
  const b = (Array.isArray(body) ? { details: body } : body) as Json | undefined;
  if (b && typeof b.error === 'string') {
    return new MyInvoisError(r.status, b.error, String(b.error_description || b.error), [], retry);
  }
  const e = (b?.error && typeof b.error === 'object' ? b.error : b) as Json | undefined;
  const inner = e ? flattenErrors(e.innerError ?? e.details) : [];
  if (e && (e.errorCode || e.code || e.error || e.message || e.Message || inner.length)) {
    // MyInvois sometimes leaves message null and puts the only reason in details.
    const own = e.error || e.message || e.Message;
    const message = String(own || inner[0]?.message || fallback).trim();
    return new MyInvoisError(r.status, String(e.errorCode || e.code || fallback), message, own ? inner : inner.slice(1), retry);
  }
  if (b && (b.title || b.detail || b.errors)) {
    const fields = b.errors && typeof b.errors === 'object' ? (b.errors as Record<string, unknown>) : {};
    const details = Object.entries(fields).flatMap(([property, list]) =>
      (Array.isArray(list) ? list : [list]).map((m) => ({ message: String(m), property: property || undefined })),
    );
    return new MyInvoisError(r.status, fallback, String(b.detail || b.title || fallback), details, retry);
  }
  const text = r.text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
  if (text) return new MyInvoisError(r.status, fallback, `MyInvois answered with HTTP ${r.status}: ${text}`, [], retry);
  const words: Record<number, string> = {
    400: 'MyInvois answered with HTTP 400 and gave no reason.',
    401: 'MyInvois did not accept the access token.',
    403: 'MyInvois refused this for the signed-in system.',
    404: 'MyInvois has no record of that.',
    429: 'MyInvois asked us to slow down. Try again in a moment.',
  };
  return new MyInvoisError(r.status, fallback, words[r.status] ?? `MyInvois answered with HTTP ${r.status}.`, [], retry);
}

function networkError(e: unknown): MyInvoisError {
  const code = (e as { code?: string })?.code ?? '';
  if (/CERT|SELF_SIGNED|ISSUER/.test(code)) {
    return new MyInvoisError(
      502,
      'TlsError',
      "Can't verify MyInvois's certificate. If your network inspects TLS (Zscaler and similar), set MYINVOIS_CA_FILE to its root certificate.",
    );
  }
  return new MyInvoisError(502, 'NetworkError', `Can't reach MyInvois: ${(e as Error)?.message ?? 'network error'}.`);
}

export interface Identity {
  /** The taxpayer the token acts for: documents must carry this TIN as the supplier. */
  taxpayerTin?: string;
  intermediaryTin?: string;
}

/** The access token is a JWT naming the taxpayer it represents (TaxpayerTIN, IntermedTIN). */
function identityOf(token: string): Identity {
  try {
    const c = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;
    const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
    return { taxpayerTin: s(c.TaxpayerTIN), intermediaryTin: s(c.IntermedTIN) };
  } catch {
    return {};
  }
}

export function createClient(cfg: Config) {
  const ca = cfg.caFile ? [...tls.rootCertificates, readFileSync(cfg.caFile, 'utf8')] : undefined;
  const agent = new https.Agent({ keepAlive: true, ca });
  const tokens = new Map<string, { token: string; until: number; who: Identity }>();
  const logins = new Map<string, Promise<string>>();

  function exchange(url: string, method: string, headers: Record<string, string>, body?: string): Promise<Reply> {
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const h = body === undefined ? headers : { ...headers, 'Content-Length': String(Buffer.byteLength(body)) };
    return new Promise((resolve, reject) => {
      const req = lib.request(u, { method, headers: h, agent: u.protocol === 'http:' ? undefined : agent, timeout: 60_000 }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', (e) => reject(networkError(e)));
      });
      req.on('timeout', () => req.destroy(Object.assign(new Error('no answer within 60 seconds'), { code: 'ETIMEDOUT' })));
      req.on('error', (e) => reject(networkError(e)));
      if (body !== undefined) req.write(body);
      req.end();
    });
  }

  function credsFor(onBehalfOf?: string): Credentials {
    const c = onBehalfOf ? cfg.intermediary : cfg.taxpayer;
    if (c) return c;
    throw new MyInvoisError(
      503,
      'NotConfigured',
      onBehalfOf
        ? 'No intermediary system is set up. Set MYINVOIS_INTERMEDIARY_CLIENT_ID and MYINVOIS_INTERMEDIARY_CLIENT_SECRET.'
        : 'No taxpayer system is set up. Set MYINVOIS_CLIENT_ID and MYINVOIS_CLIENT_SECRET.',
    );
  }

  async function login(onBehalfOf?: string): Promise<string> {
    const c = credsFor(onBehalfOf);
    const body = new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, grant_type: 'client_credentials', scope: 'InvoicingAPI' }).toString();
    const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
    if (onBehalfOf) headers.onbehalfof = onBehalfOf;
    for (let attempt = 0; ; attempt++) {
      const r = await exchange(`${cfg.apiBase}/connect/token`, 'POST', headers, body);
      if (r.status === 429 && attempt < 2) {
        await wait(Math.min(retryAfter(r.headers) ?? 5, 30));
        continue;
      }
      if (r.status !== 200) throw parseError(r);
      const j = JSON.parse(r.text) as { access_token: string; expires_in?: number };
      // Renew two minutes early so a token never expires mid-call.
      tokens.set(onBehalfOf ?? '', { token: j.access_token, until: Date.now() + Math.max(60, (j.expires_in ?? 3600) - 120) * 1000, who: identityOf(j.access_token) });
      return j.access_token;
    }
  }

  function token(onBehalfOf?: string, fresh = false): Promise<string> {
    const key = onBehalfOf ?? '';
    const hit = tokens.get(key);
    if (!fresh && hit && hit.until > Date.now()) return Promise.resolve(hit.token);
    const busy = logins.get(key);
    if (busy) return busy;
    const p = login(onBehalfOf).finally(() => logins.delete(key));
    logins.set(key, p);
    return p;
  }

  async function call(method: string, path: string, o: { onBehalfOf?: string; query?: Query; body?: unknown } = {}): Promise<Reply> {
    const url = new URL(path, cfg.apiBase);
    for (const [k, v] of Object.entries(o.query ?? {})) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    const body = o.body === undefined ? undefined : JSON.stringify(o.body);
    let fresh = false;
    for (let attempt = 0; ; attempt++) {
      const t = await token(o.onBehalfOf, fresh);
      const headers: Record<string, string> = { Authorization: `Bearer ${t}`, Accept: 'application/json', 'Accept-Language': 'en' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const r = await exchange(url.toString(), method, headers, body);
      if (r.status === 401 && !fresh) {
        fresh = true;
        continue;
      }
      if (r.status === 429 && attempt < 2) {
        await wait(Math.min(retryAfter(r.headers) ?? 5, 30));
        continue;
      }
      return r;
    }
  }

  async function json<T>(r: Reply): Promise<T> {
    if (r.status < 200 || r.status >= 300) throw parseError(r);
    return (r.text ? JSON.parse(r.text) : {}) as T;
  }

  const get = async <T = Json>(path: string, onBehalfOf?: string, query?: Query) => json<T>(await call('GET', path, { onBehalfOf, query }));

  return {
    /** Logs in now, to check the credentials. */
    login: (onBehalfOf?: string) => token(onBehalfOf, true),
    /** Whom the (cached) login acts for, logging in first if needed. */
    async identity(onBehalfOf?: string): Promise<Identity> {
      await token(onBehalfOf);
      return tokens.get(onBehalfOf ?? '')?.who ?? {};
    },

    // Platform APIs
    documentTypes: (ob?: string) => get('/api/v1.0/documenttypes', ob),
    documentType: (id: string, ob?: string) => get(`/api/v1.0/documenttypes/${enc(id)}`, ob),
    documentTypeVersion: (id: string, vid: string, ob?: string) => get(`/api/v1.0/documenttypes/${enc(id)}/versions/${enc(vid)}`, ob),
    notifications: (q: Query, ob?: string) => get('/api/v1.0/notifications/taxpayer', ob, q),

    // Taxpayers
    async validateTin(tin: string, idType: string, idValue: string, ob?: string): Promise<boolean> {
      const r = await call('GET', `/api/v1.0/taxpayer/validate/${enc(tin)}`, { onBehalfOf: ob, query: { idType, idValue } });
      if (r.status === 200) return true;
      if (r.status === 404) return false;
      throw parseError(r);
    },
    async searchTin(q: Query, ob?: string): Promise<string | null> {
      const r = await call('GET', '/api/v1.0/taxpayer/search/tin', { onBehalfOf: ob, query: q });
      if (r.status === 404) return null;
      return (await json<{ tin?: string }>(r)).tin ?? null;
    },
    taxpayerFromQr: (qrCodeText: string, ob?: string) => get(`/api/v1.0/taxpayers/qrcodeinfo/${enc(qrCodeText)}`, ob),

    // Documents
    submitDocuments: async (documents: { format: 'JSON'; document: string; documentHash: string; codeNumber: string }[], ob?: string) =>
      json<Json>(await call('POST', '/api/v1.0/documentsubmissions/', { onBehalfOf: ob, body: { documents } })),
    setDocumentState: async (uuid: string, status: 'cancelled' | 'rejected', reason: string, ob?: string) =>
      json<Json>(await call('PUT', `/api/v1.0/documents/state/${enc(uuid)}/state`, { onBehalfOf: ob, body: { status, reason } })),
    submission: (uid: string, q: Query, ob?: string) => get(`/api/v1.0/documentsubmissions/${enc(uid)}`, ob, q),
    recentDocuments: (q: Query, ob?: string) => get('/api/v1.0/documents/recent', ob, q),
    searchDocuments: (q: Query, ob?: string) => get('/api/v1.0/documents/search', ob, q),
    document: (uuid: string, ob?: string) => get(`/api/v1.0/documents/${enc(uuid)}/raw`, ob),
    documentDetails: (uuid: string, ob?: string) => get(`/api/v1.0/documents/${enc(uuid)}/details`, ob),
  };
}

export type MyInvoisClient = ReturnType<typeof createClient>;
