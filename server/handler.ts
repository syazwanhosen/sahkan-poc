// The app's /api/myinvois/* endpoints. The browser never holds a token or a secret: it names the
// call (and, for an accountant, the client's TIN in X-MyInvois-On-Behalf-Of); this side logs in,
// signs and calls MyInvois. Never from another site; locally only from this computer, and on a
// public host (Vercel) only from browsers that hold the access key.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { MyInvoisError, createClient, flattenErrors, type ErrorDetail } from './client.js';
import { loadSigner, type Signer } from './sign.js';
import type { Config, DocVersion } from './config.js';

// MyInvois JSON is deep and loosely shaped; it is passed through, so it stays untyped here.
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

interface Ctx {
  params: string[];
  query: URLSearchParams;
  onBehalfOf?: string;
  /** The request carries the access key, or none is set. */
  unlocked: boolean;
  body: () => Promise<Json>;
}

export interface HandlerOptions {
  /** Served on the internet (Vercel): any of its domains may call, but only with the access key. */
  hosted?: boolean;
}

const PREFIX = '/api/myinvois';
const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);

const RECENT_QUERY = [
  'pageNo',
  'pageSize',
  'submissionDateFrom',
  'submissionDateTo',
  'issueDateFrom',
  'issueDateTo',
  'InvoiceDirection',
  'status',
  'documentType',
  'receiverId',
  'receiverIdType',
  'receiverTin',
  'issuerTin',
  'issuerId',
  'issuerIdType',
];
const SEARCH_QUERY = [
  'uuid',
  'submissionDateFrom',
  'submissionDateTo',
  'pageSize',
  'pageNo',
  'issueDateFrom',
  'issueDateTo',
  'invoiceDirection',
  'status',
  'documentType',
  'searchQuery',
  'classificationCode',
];
const NOTICE_QUERY = ['dateFrom', 'dateTo', 'type', 'language', 'status', 'pageNo', 'pageSize'];
const TIN_QUERY = ['idType', 'idValue', 'taxpayerName', 'fileType'];

const pick = (q: URLSearchParams, keys: string[]) => Object.fromEntries(keys.flatMap((k) => (q.get(k) ? [[k, q.get(k)!]] : [])));
const errorsOf = (e: unknown): ErrorDetail[] => flattenErrors(e ? [e] : []);
const sha256 = (s: string) => createHash('sha256').update(s).digest();

/** Whether the request carries the access key ("Authorization: Bearer <key>"), compared in constant time. */
function hasKey(req: IncomingMessage, key: string): boolean {
  const given = /^Bearer (.+)$/i.exec(req.headers.authorization ?? '')?.[1] ?? '';
  return timingSafeEqual(sha256(given.trim()), sha256(key));
}

/** The Taxpayer's QR Code API wants the decoded text; a scanner gives base64. Accept either. */
function qrCodeText(input: string): string {
  const s = input.trim();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuid.test(s)) return s;
  const decoded = Buffer.from(s, 'base64').toString('utf8').trim();
  return uuid.test(decoded) ? decoded : s;
}

function withVersion(ubl: unknown, version: DocVersion): Json {
  const doc = ubl as Json;
  const inv = doc?.Invoice?.[0];
  if (!inv?.InvoiceTypeCode?.[0]) throw new MyInvoisError(400, 'BadDocument', 'A document is missing Invoice.InvoiceTypeCode.');
  const { UBLExtensions: _x, Signature: _s, ...rest } = inv;
  return { ...doc, Invoice: [{ ...rest, InvoiceTypeCode: [{ ...inv.InvoiceTypeCode[0], listVersionID: version }] }] };
}

function readBody(req: IncomingMessage, limit = 8 * 1024 * 1024): Promise<Json> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new MyInvoisError(413, 'TooLarge', 'The request is too large.'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? (JSON.parse(Buffer.concat(chunks).toString('utf8')) as Json) : {});
      } catch {
        reject(new MyInvoisError(400, 'BadJson', "The request body isn't valid JSON."));
      }
    });
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

/** Why this request may not use the API, or null when it may. */
function refuse(req: IncomingMessage, cfg: Config, hosted: boolean): string | null {
  const hostHeader = (req.headers.host ?? '').toLowerCase();
  const host = hostHeader.replace(/:\d+$/, '');
  // A public host answers on all of its domains; the access key guards it instead.
  if (!hosted && !LOCAL.has(host) && !cfg.allowedHosts.includes(host)) return `Host "${host}" isn't allowed. Add it to MYINVOIS_ALLOWED_HOSTS.`;
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host.toLowerCase() !== hostHeader) return 'Calls from other sites are not allowed.';
    } catch {
      return 'Calls from other sites are not allowed.';
    }
  }
  // Vercel hands each request over from 127.0.0.1, so the address says nothing there.
  if (hosted) return null;
  const addr = req.socket.remoteAddress ?? '';
  const loopback = addr === '::1' || addr.startsWith('127.') || addr.startsWith('::ffff:127.');
  if (!loopback && !cfg.allowedHosts.length) return 'Only this computer can use the MyInvois API. Set MYINVOIS_ALLOWED_HOSTS to allow others.';
  return null;
}

export function createHandler(cfg: Config, { hosted = false }: HandlerOptions = {}) {
  // A deployment has no files of its own and no proxy re-signing TLS: MYINVOIS_CA_FILE is for this computer only.
  const client = createClient(hosted ? { ...cfg, caFile: undefined } : cfg);
  let signer: Signer | undefined;
  let signerProblem: string | undefined;
  if (cfg.cert || cfg.key) {
    try {
      if (!cfg.cert || !cfg.key) throw new Error('Set both the certificate and its key: MYINVOIS_CERT_FILE and MYINVOIS_KEY_FILE, or MYINVOIS_CERT_PEM and MYINVOIS_KEY_PEM.');
      if (hosted && ('file' in cfg.cert || 'file' in cfg.key)) {
        throw new Error('A deployment has no files of its own: put the certificate and key themselves in MYINVOIS_CERT_PEM and MYINVOIS_KEY_PEM.');
      }
      signer = loadSigner(cfg.cert, cfg.key, cfg.keyPassphrase);
    } catch (e) {
      signerProblem = (e as Error).message;
    }
  }
  const version: DocVersion = cfg.version ?? (signer ? '1.1' : '1.0');
  if (version === '1.1' && !signer && !signerProblem) {
    signerProblem = 'Version 1.1 needs a signing certificate: set MYINVOIS_CERT_FILE and MYINVOIS_KEY_FILE (or MYINVOIS_CERT_PEM and MYINVOIS_KEY_PEM).';
  }
  // On the internet the credentials only work behind an access key: without one, nothing reaches MyInvois.
  const keyMissing =
    hosted && !cfg.accessKey
      ? "This server is on the internet, so it needs an access key before it uses MyInvois. Set MYINVOIS_ACCESS_KEY in the project's environment variables and redeploy."
      : undefined;

  /** The server's setup, plus whom the taxpayer login acts for (one cached login an hour at most). */
  async function status(c: Ctx) {
    const ready = !!(cfg.taxpayer || cfg.intermediary) && !keyMissing;
    const setup = {
      env: cfg.env,
      apiHost: new URL(cfg.apiBase).host,
      portalUrl: cfg.portalBase,
      taxpayer: !!cfg.taxpayer,
      intermediary: !!cfg.intermediary,
      version,
    };
    // Without the key, only whether there is anything to unlock: no login, no certificate details.
    if (!c.unlocked) return { ...setup, configured: false, locked: ready, signing: null, problems: [] };
    const problems = [keyMissing, signerProblem].filter((p): p is string => !!p);
    let taxpayerTin: string | undefined;
    if (ready && cfg.taxpayer) {
      try {
        const slow = new Promise<never>((_, no) => setTimeout(() => no(new Error('MyInvois did not answer within 10 seconds.')), 10_000));
        taxpayerTin = (await Promise.race([client.identity(), slow])).taxpayerTin;
      } catch (e) {
        problems.push(`Can't log in to MyInvois: ${(e as Error).message}`);
      }
    }
    return { ...setup, taxpayerTin, configured: ready, locked: false, signing: signer?.info ?? null, problems };
  }

  async function submit(c: Ctx) {
    const body = await c.body();
    const list: Json[] = Array.isArray(body.documents) ? body.documents : [];
    if (!list.length || list.length > 100) throw new MyInvoisError(400, 'BadRequest', 'Send between 1 and 100 documents in one submission.');
    if (version === '1.1' && !signer) throw new MyInvoisError(503, 'SigningNotReady', signerProblem ?? 'Signing is not set up.');
    let total = 0;
    const documents = list.map((d) => {
      const codeNumber = String(d.codeNumber ?? '').trim();
      if (!codeNumber || codeNumber.length > 50) throw new MyInvoisError(400, 'BadRequest', 'Every document needs a number of up to 50 characters.');
      const ubl = withVersion(d.ubl, version);
      const text = JSON.stringify(signer && version === '1.1' ? signer.sign(ubl) : ubl);
      const size = Buffer.byteLength(text);
      if (size > 300 * 1024) {
        throw new MyInvoisError(413, 'MaximumSizeExceeded', `${codeNumber} is ${Math.ceil(size / 1024)} KB. MyInvois takes up to 300 KB per document.`);
      }
      const document = Buffer.from(text, 'utf8').toString('base64');
      total += document.length;
      return { format: 'JSON' as const, document, documentHash: createHash('sha256').update(text).digest('hex'), codeNumber };
    });
    if (total > 5 * 1024 * 1024) throw new MyInvoisError(413, 'MaximumSizeExceeded', 'MyInvois takes up to 5 MB per submission. Send fewer documents at a time.');
    const r = await client.submitDocuments(documents, c.onBehalfOf);
    return {
      submissionUid: r.submissionUid ?? r.submissionUID,
      acceptedDocuments: (r.acceptedDocuments ?? []) as Json[],
      rejectedDocuments: ((r.rejectedDocuments ?? []) as Json[]).map((x) => ({ invoiceCodeNumber: x.invoiceCodeNumber, errors: errorsOf(x.error) })),
      version,
    };
  }

  async function details(c: Ctx) {
    const d: Json = await client.documentDetails(c.params[0], c.onBehalfOf);
    const steps: Json[] = d.validationResults?.validationSteps ?? [];
    const errors = steps
      .filter((st) => String(st.status).toLowerCase() === 'invalid')
      .flatMap((st) => {
        const list = errorsOf(st.error);
        return list.length ? list : [{ message: String(st.name ?? 'A validation step failed.') }];
      });
    return { ...d, errors };
  }

  async function setState(c: Ctx) {
    const body = await c.body();
    const state = String(body.status ?? '').toLowerCase();
    const reason = String(body.reason ?? '').trim();
    if (state !== 'cancelled' && state !== 'rejected') throw new MyInvoisError(400, 'BadRequest', 'The status must be cancelled or rejected.');
    if (!reason || reason.length > 300) throw new MyInvoisError(400, 'BadRequest', 'Give a reason of up to 300 characters.');
    return client.setDocumentState(c.params[0], state, reason, c.onBehalfOf);
  }

  const routes: [string, RegExp, (c: Ctx) => Promise<unknown>][] = [
    ['GET', /^\/status$/, status],
    [
      'POST',
      /^\/check$/,
      async (c) => ({ documentTypes: (await client.documentTypes(c.onBehalfOf)).result ?? [], taxpayerTin: (await client.identity(c.onBehalfOf)).taxpayerTin }),
    ],
    ['GET', /^\/documenttypes$/, (c) => client.documentTypes(c.onBehalfOf)],
    ['GET', /^\/documenttypes\/([^/]+)$/, (c) => client.documentType(c.params[0], c.onBehalfOf)],
    ['GET', /^\/documenttypes\/([^/]+)\/versions\/([^/]+)$/, (c) => client.documentTypeVersion(c.params[0], c.params[1], c.onBehalfOf)],
    ['GET', /^\/notifications$/, (c) => client.notifications(pick(c.query, NOTICE_QUERY), c.onBehalfOf)],
    [
      'GET',
      /^\/taxpayer\/validate\/([^/]+)$/,
      async (c) => ({ valid: await client.validateTin(c.params[0], c.query.get('idType') ?? '', c.query.get('idValue') ?? '', c.onBehalfOf) }),
    ],
    ['GET', /^\/taxpayer\/search$/, async (c) => ({ tin: await client.searchTin(pick(c.query, TIN_QUERY), c.onBehalfOf) })],
    ['GET', /^\/taxpayer\/qr\/([^/]+)$/, (c) => client.taxpayerFromQr(qrCodeText(c.params[0]), c.onBehalfOf)],
    ['POST', /^\/documents\/submit$/, submit],
    ['GET', /^\/submissions\/([^/]+)$/, (c) => client.submission(c.params[0], pick(c.query, ['pageNo', 'pageSize']), c.onBehalfOf)],
    ['GET', /^\/documents\/recent$/, (c) => client.recentDocuments(pick(c.query, RECENT_QUERY), c.onBehalfOf)],
    ['GET', /^\/documents\/search$/, (c) => client.searchDocuments(pick(c.query, SEARCH_QUERY), c.onBehalfOf)],
    ['GET', /^\/documents\/([^/]+)\/raw$/, (c) => client.document(c.params[0], c.onBehalfOf)],
    ['GET', /^\/documents\/([^/]+)\/details$/, details],
    ['PUT', /^\/documents\/([^/]+)\/state$/, setState],
  ];

  return async function handle(req: IncomingMessage, res: ServerResponse, next: () => void) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== PREFIX && !url.pathname.startsWith(`${PREFIX}/`)) return next();
    const why = refuse(req, cfg, hosted);
    if (why) return send(res, 403, { error: { status: 403, code: 'Forbidden', message: why, details: [] } });
    // Answer preflights without CORS headers, so other sites can't call in.
    if (req.method === 'OPTIONS') return send(res, 403, { error: { status: 403, code: 'Forbidden', message: 'Not available to other sites.', details: [] } });
    if (req.method !== 'GET' && !String(req.headers['content-type'] ?? '').includes('application/json')) {
      return send(res, 415, { error: { status: 415, code: 'UnsupportedMediaType', message: 'Send JSON.', details: [] } });
    }
    const path = url.pathname.slice(PREFIX.length) || '/';
    const onBehalfOf = String(req.headers['x-myinvois-on-behalf-of'] ?? '').trim() || undefined;
    if (onBehalfOf && !/^[A-Za-z0-9]{5,20}(:[A-Za-z0-9-]{1,30})?$/.test(onBehalfOf)) {
      return send(res, 400, { error: { status: 400, code: 'BadRequest', message: 'X-MyInvois-On-Behalf-Of must be a TIN, or TIN:ROB.', details: [] } });
    }
    // With an access key set (always, on a public host), only /status answers without it.
    const unlocked = !cfg.accessKey || hasKey(req, cfg.accessKey);
    for (const [method, re, run] of routes) {
      const m = re.exec(path);
      if (!m) continue;
      if (req.method !== method) return send(res, 405, { error: { status: 405, code: 'MethodNotAllowed', message: `Use ${method}.`, details: [] } });
      if (run !== status) {
        if (keyMissing) return send(res, 503, { error: { status: 503, code: 'NotConfigured', message: keyMissing, details: [] } });
        if (!unlocked) {
          return send(res, 401, { error: { status: 401, code: 'AccessKey', message: 'The server needs its access key. Enter it in Settings, under MyInvois connection.', details: [] } });
        }
      }
      try {
        const params = m.slice(1).map((p) => decodeURIComponent(p));
        return send(res, 200, await run({ params, query: url.searchParams, onBehalfOf, unlocked, body: () => readBody(req) }));
      } catch (e) {
        const err = e instanceof MyInvoisError ? e : new MyInvoisError(500, 'ServerError', (e as Error)?.message ?? 'Something went wrong.');
        if (!(e instanceof MyInvoisError)) console.error('[myinvois]', e);
        else console.warn(`[myinvois] ${req.method} ${path} -> ${err.status} ${err.code}: ${err.message}${err.raw ? `\n  MyInvois said: ${err.raw}` : ''}`);
        return send(res, err.status || 500, { error: { status: err.status, code: err.code, message: err.message, details: err.details, retryAfter: err.retryAfter } });
      }
    }
    return send(res, 404, { error: { status: 404, code: 'NotFound', message: `No such endpoint: ${path}`, details: [] } });
  };
}
