import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Ban,
  CalendarCheck,
  Check,
  CircleAlert,
  Clock,
  CloudDownload,
  Download,
  FilePlus2,
  FileText,
  Inbox,
  LoaderCircle,
  Mail,
  PencilLine,
  RefreshCw,
  Send,
  Undo2,
  Wrench,
  X,
} from 'lucide-react';
import type { Doc, DocEvent } from '../types';
import { CANCEL_WINDOW, HOUR } from '../lib/clock';
import { DOC_LABEL } from '../lib/rules';
import { dateTime, int, left, periodLabel, rmx, time } from '../lib/format';
import { useDownloads } from '../lib/downloads';
import { submissionPreview } from '../lib/ubl';
import { errorText, validationUrl } from '../lib/myinvois';
import { useApp } from '../state/store';
import { useLive } from '../state/live';
import { back, navigate } from '../state/nav';
import { bizById, docTotal, windowLeft } from '../state/select';
import { cancelDoc, emailAgain, liveCopy, refreshDoc, submitDocs } from '../state/actions';
import { InvoicePaper } from '../paper';
import { Button, Chip, CopyButton, Empty, Modal, Note, PageHeader, Panel, Select, StatusChip, Tabs, cx, ic, useNow } from '../ui';
import { downloadPdf, offerFile } from './common';

const lastOf = (d: Doc, kinds: DocEvent['kind'][]) => [...d.events].reverse().find((e) => kinds.includes(e.kind))?.t;

function Timeline({ d }: { d: Doc }) {
  type Step = { label: string; state: 'done' | 'now' | 'bad' | 'todo'; at?: number; note?: string };
  const sent = lastOf(d, ['submitted', 'resubmitted']);
  const steps: Step[] = [
    { label: 'Draft saved', state: 'done', at: d.events[0]?.t },
    { label: d.attempts > 1 ? 'Sent to LHDN again' : 'Sent to LHDN', state: sent ? 'done' : 'todo', at: sent },
  ];
  if (d.status === 'invalid') steps.push({ label: 'Rejected', state: 'bad', at: lastOf(d, ['invalid']) });
  else if (d.status === 'submitted') steps.push({ label: 'Checking', state: 'now', note: 'Usually a few seconds' });
  else steps.push({ label: 'Validated', state: d.validatedAt ? 'done' : 'todo', at: d.validatedAt });
  if (d.status === 'cancelled') steps.push({ label: 'Cancelled', state: 'bad', at: d.cancelledAt });
  else if (d.consolidated || d.buyer.kind === 'general') steps.push({ label: 'No email needed', state: d.validatedAt ? 'done' : 'todo', note: 'General public buyer' });
  // The real MyInvois tells the buyer itself, by email, once the e-invoice is valid.
  else if (d.live) steps.push({ label: 'Buyer told by LHDN', state: d.validatedAt ? 'done' : 'todo', at: d.validatedAt });
  else if (!d.buyer.email) steps.push({ label: 'Emailed to buyer', state: 'todo', note: 'No email on file' });
  else steps.push({ label: 'Emailed to buyer', state: d.emailedAt ? 'done' : d.status === 'valid' ? 'now' : 'todo', at: d.emailedAt, note: d.status === 'valid' && !d.emailedAt ? 'Sending' : undefined });

  return (
    <ol className="timeline" aria-label="Progress">
      {steps.map((st, i) => (
        <li key={i} className={cx('tl-step', `tl-${st.state}`)}>
          <div className="tl-track">
            <span className="tl-dot" aria-hidden="true">
              {st.state === 'done' && <Check className="ico-sm" />}
              {st.state === 'bad' && <X className="ico-sm" />}
              {st.state === 'now' && <LoaderCircle className="ico-sm spin" />}
            </span>
            {i < steps.length - 1 && <span className="tl-line" />}
          </div>
          <div className="tl-text">
            <div className="tl-label">{st.label}</div>
            <div className="small">{st.at ? time(st.at) : (st.note ?? 'Not yet')}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function WindowBox({ d, t }: { d: Doc; t: number }) {
  const l = windowLeft(d, t);
  let label = 'Cancel window';
  let value: ReactNode = '';
  let sub: ReactNode = '';
  if (d.status === 'valid' && d.consolidated) {
    label = 'Consolidated e-invoice';
    value = periodLabel(d.consolidated.period);
    sub = `${int(d.consolidated.receipts)} walk-in receipts in one e-invoice.`;
  } else if (d.status === 'valid' && l > 0) {
    value = <span style={{ color: l < 24 * HOUR ? 'var(--due-fg)' : undefined }}>{left(l)} left</span>;
    sub = `Closes ${dateTime(d.validatedAt! + CANCEL_WINDOW)}. Then use a credit note.`;
  } else if (d.status === 'valid') {
    value = 'Closed';
    sub = 'To change this e-invoice now, issue a credit or debit note.';
  } else if (d.status === 'cancelled') {
    label = 'Cancelled';
    value = d.cancelledAt ? time(d.cancelledAt) : '';
    sub = d.cancelReason ? `Reason: ${d.cancelReason}.` : '';
  } else if (d.status === 'invalid') {
    label = 'Not filed';
    value = 'Fix and resend';
    sub = 'LHDN keeps nothing from a rejected submission.';
  } else if (d.status === 'submitted') {
    label = 'With LHDN';
    value = 'Checking';
    sub = 'The result comes back on its own.';
  } else {
    label = 'Draft';
    value = 'Not sent';
    sub = 'Only you can see this draft.';
  }
  return (
    <div className="window">
      <div className="small strong">{label}</div>
      <div className="window-value">{value}</div>
      <div className="hint">{sub}</div>
    </div>
  );
}

// Light JSON colouring for the data tab.
function highlight(json: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(json))) {
    if (m.index > last) out.push(json.slice(last, m.index));
    if (m[1]) {
      out.push(
        <span key={k++} className={m[2] ? 'k' : 's'}>
          {m[1]}
        </span>,
      );
      if (m[2]) out.push(m[2]);
    } else if (m[3] || m[4]) out.push(<span key={k++} className="n">{m[3] ?? m[4]}</span>);
    else out.push(<span key={k++} className="p">{m[5]}</span>);
    last = re.lastIndex;
  }
  out.push(json.slice(last));
  return out;
}

/** The document as MyInvois stores it (Get Document), signed when it went as version 1.1. */
function LhdnCopy({ d }: { d: Doc }) {
  const [copy, setCopy] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!copy) {
    return (
      <div className="stack-sm">
        <div>
          <Button
            size="sm"
            icon={ic(CloudDownload, 'ico-sm')}
            busy={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const raw = await liveCopy(d.id);
                try {
                  setCopy(JSON.stringify(JSON.parse(raw), null, 2));
                } catch {
                  setCopy(raw);
                }
              } catch (e) {
                setError(errorText(e));
              }
              setBusy(false);
            }}
            id="doc-lhdn-copy"
          >
            Show the copy LHDN holds
          </Button>
        </div>
        {error && (
          <Note tone="bad" icon={ic(CircleAlert)}>
            {error}
          </Note>
        )}
      </div>
    );
  }
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3 className="h3">The copy LHDN holds</h3>
        <CopyButton text={copy} label="Copy LHDN's copy" />
      </div>
      <pre className="code" tabIndex={0} aria-label="The document as MyInvois stores it">
        {highlight(copy)}
      </pre>
    </>
  );
}

function DataTab({ d, refDoc, canSave }: { d: Doc; refDoc?: Doc; canSave: boolean }) {
  const s = useApp();
  const status = useLive();
  const biz = bizById(s, d.bizId)!;
  const version = d.live?.version ?? (s.workspace === 'live' ? status?.version : undefined);
  const [p, setP] = useState<Awaited<ReturnType<typeof submissionPreview>> | null>(null);
  useEffect(() => {
    let live = true;
    submissionPreview(d, biz, refDoc, version).then((x) => live && setP(x));
    return () => {
      live = false;
    };
  }, [d, biz, refDoc, version]);
  if (!p) return <div className="pad hint">Building the document…</div>;
  const body = JSON.stringify(
    { documents: [{ ...p.body.documents[0], document: p.b64.length > 64 ? `${p.b64.slice(0, 64)}… (${int(p.b64.length)} characters)` : p.b64 }] },
    null,
    2,
  );
  return (
    <div className="pad stack">
      <Note tone="info">
        {s.workspace === 'live'
          ? `This is the UBL 2.1 JSON built from this e-invoice. The server ${version === '1.1' ? 'adds the digital signature, then ' : ''}sends it to MyInvois, so the hash LHDN sees differs from the one here.`
          : "This is the UBL 2.1 JSON the MyInvois API expects for this e-invoice, built from the data on this page. In the demo it isn't sent anywhere."}
      </Note>
      <dl className="kv">
        <dt>Endpoint</dt>
        <dd className="mono">POST /api/v1.0/documentsubmissions</dd>
        <dt>Format</dt>
        <dd>JSON, UBL 2.1, version {version ?? '1.1'}{version === '1.1' && s.workspace === 'live' ? ', signed' : ''}</dd>
        <dt>Size</dt>
        <dd>{int(p.bytes)} bytes</dd>
        <dt>SHA-256</dt>
        <dd className="mono copy-row" style={{ alignItems: 'flex-start' }}>
          <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{p.hash}</span>
          <CopyButton text={p.hash} label="Copy the document hash" />
        </dd>
      </dl>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3 className="h3">Document</h3>
        <div className="row" style={{ gap: 6 }}>
          <CopyButton text={p.pretty} label="Copy the document JSON" />
          {canSave && (
            <Button size="sm" icon={ic(Download, 'ico-sm')} onClick={() => offerFile(`${d.number}.json`, p.pretty)} id="doc-json">
              JSON
            </Button>
          )}
        </div>
      </div>
      <pre className="code" tabIndex={0} aria-label="Document JSON">
        {highlight(p.pretty)}
      </pre>
      <h3 className="h3">Request body</h3>
      <pre className="code" tabIndex={0} aria-label="Request body" style={{ maxHeight: 260 }}>
        {highlight(body)}
      </pre>
      {d.live && d.uuid && (d.status === 'valid' || d.status === 'cancelled') && <LhdnCopy d={d} />}
    </div>
  );
}

const REASONS = ['Wrong buyer details', 'Wrong amount or items', 'Issued twice by mistake', 'The sale was called off'];

function CancelDialog({ d, open, onClose }: { d: Doc; open: boolean; onClose: () => void }) {
  const s = useApp();
  const [reason, setReason] = useState(REASONS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blockers = s.docs.filter((x) => x.refId === d.id && x.status === 'valid');
  useEffect(() => {
    if (open) setError(null);
  }, [open]);
  return (
    <Modal
      id="cancel-dialog"
      open={open}
      onClose={onClose}
      title={`Cancel ${d.number}?`}
      sub="LHDN marks it cancelled and tells the buyer. This can't be undone."
      foot={
        <>
          <Button onClick={onClose}>Keep it</Button>
          <Button
            variant="danger"
            busy={busy}
            icon={ic(Ban, 'ico-sm')}
            id="cancel-confirm"
            onClick={async () => {
              setBusy(true);
              const r = await cancelDoc(d.id, reason);
              setBusy(false);
              if (r.ok) onClose();
              else setError(r.message ?? "Couldn't cancel.");
            }}
          >
            Cancel e-invoice
          </Button>
        </>
      }
    >
      <div className="field">
        <label className="label" htmlFor="cancel-reason">
          Reason
        </label>
        <Select id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
          {REASONS.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </Select>
        <div className="hint">MyInvois shows this reason to the buyer.</div>
      </div>
      {error && (
        <Note tone="bad" icon={ic(CircleAlert)}>
          {error}
          {blockers.length > 0 && (
            <div style={{ marginTop: 6 }}>
              {blockers.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    onClose();
                    navigate({ name: 'doc', id: b.id });
                  }}
                >
                  Open {b.number}
                </button>
              ))}
            </div>
          )}
        </Note>
      )}
    </Modal>
  );
}

export function DocPage({ id, tab: initialTab = 'paper' }: { id: string; tab?: 'paper' | 'data' }) {
  const s = useApp();
  const t = useNow(1000);
  const canSave = useDownloads();
  const [tab, setTab] = useState<'paper' | 'data'>(initialTab);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const d = s.docs.find((x) => x.id === id);
  const prev = useRef(d?.status);
  const [stamp, setStamp] = useState(false);
  useEffect(() => {
    if (prev.current === 'submitted' && d?.status === 'valid') setStamp(true);
    prev.current = d?.status;
  }, [d?.status]);

  if (!d) {
    return (
      <Panel>
        <Empty icon={FileText} title="This e-invoice isn't here">
          <Button onClick={() => navigate({ name: 'invoices' })}>Go to e-invoices</Button>
        </Empty>
      </Panel>
    );
  }
  const biz = bizById(s, d.bizId)!;
  const refDoc = d.refId ? s.docs.find((x) => x.id === d.refId) : undefined;
  const notes = s.docs.filter((x) => x.refId === d.id);
  const run = s.runs.find((r) => r.docIds.includes(d.id));
  const req = d.requestId ? s.requests.find((r) => r.id === d.requestId) : undefined;
  const l = windowLeft(d, t);
  const canCancel = d.status === 'valid' && !d.consolidated && l > 0;
  // Live e-invoices are emailed to the buyer by MyInvois itself.
  const email = d.status === 'valid' && !!d.buyer.email && !d.consolidated && !d.live;
  const link = d.live && d.uuid && d.longId ? validationUrl(d.live.env, d.uuid, d.longId) : undefined;
  const checkNow = async () => {
    setChecking(true);
    await refreshDoc(d.id);
    setChecking(false);
  };

  return (
    <>
      <PageHeader
        crumb={{ label: 'E-invoices', onClick: () => back({ name: 'invoices' }) }}
        title={d.number}
        status={<StatusChip status={d.status} lg />}
        sub={`${d.type !== '01' ? `${DOC_LABEL[d.type]} · ` : ''}${d.buyer.name || 'No buyer'}, ${rmx(docTotal(d))}`}
        actions={
          <>
            {d.status === 'draft' && (
              <>
                <Button icon={ic(PencilLine, 'ico-sm')} onClick={() => navigate({ name: 'compose', editId: d.id })} id="doc-edit">
                  Edit
                </Button>
                <Button variant="primary" icon={ic(Send, 'ico-sm')} onClick={() => submitDocs([d.id])} id="doc-submit">
                  Submit to LHDN
                </Button>
              </>
            )}
            {d.status === 'invalid' && (
              <Button variant="primary" icon={ic(Wrench, 'ico-sm')} onClick={() => navigate({ name: 'compose', editId: d.id })} id="doc-fix">
                Fix and resubmit
              </Button>
            )}
            {email && (
              <Button icon={ic(Mail, 'ico-sm')} onClick={() => emailAgain(d.id)} id="doc-email">
                Email buyer
              </Button>
            )}
            {d.live && d.uuid && d.status !== 'draft' && (
              <Button icon={ic(RefreshCw, 'ico-sm')} busy={checking} onClick={checkNow} id="doc-refresh">
                Check with LHDN
              </Button>
            )}
            {canSave && (
              <Button icon={ic(Download, 'ico-sm')} onClick={() => downloadPdf(d, biz, refDoc)} id="doc-pdf">
                Download PDF
              </Button>
            )}
          </>
        }
      />

      <section className="panel status-panel" aria-label="Status">
        <Timeline d={d} />
        <WindowBox d={d} t={t} />
      </section>

      {d.status === 'valid' && d.live?.rejectRequestedAt && (
        <Note tone="due" icon={ic(CircleAlert)}>
          <div className="strong">The buyer asked LHDN to reject this e-invoice</div>
          <div style={{ marginTop: 2 }}>
            {d.live.rejectReason ? `Their reason: ${d.live.rejectReason}. ` : ''}It stays valid until you cancel it.{' '}
            {canCancel ? 'Cancel it if they are right, or talk to them first.' : 'The cancel window has closed, so issue a credit note if they are right.'}
          </div>
          {canCancel && (
            <div style={{ marginTop: 8 }}>
              <Button size="sm" variant="danger" icon={ic(Ban, 'ico-sm')} onClick={() => setCancelOpen(true)} id="doc-reject-cancel">
                Cancel e-invoice
              </Button>
            </div>
          )}
        </Note>
      )}

      {d.status === 'invalid' && d.errors?.length ? (
        <Panel title="Why LHDN rejected it" sub={`${d.errors.length === 1 ? '1 problem' : `${d.errors.length} problems`}. Nothing was filed, so you can fix it and send it again with the same number.`}>
          <ul className="errors">
            {d.errors.map((e, i) => (
              <li key={i}>
                {ic(CircleAlert, 'ico err-ico')}
                <div className="grow">
                  <div className="strong">{e.message}</div>
                  <div className="small mono">{e.path}</div>
                </div>
              </li>
            ))}
          </ul>
          <div className="pad" style={{ paddingTop: 0 }}>
            <Button variant="primary" icon={ic(Wrench, 'ico-sm')} onClick={() => navigate({ name: 'compose', editId: d.id })} id="doc-fix-2">
              Fix and resubmit
            </Button>
          </div>
        </Panel>
      ) : null}

      <div className="cols">
        <div className="col-main stack">
          <Tabs
            id="doc"
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'paper', label: 'E-invoice' },
              { value: 'data', label: 'Data sent to LHDN' },
            ]}
          />
          <div role="tabpanel" id="doc-panel" aria-labelledby={`doc-tab-${tab}`}>
            {tab === 'paper' ? (
              <InvoicePaper doc={d} biz={biz} refDoc={refDoc} stamp={stamp} />
            ) : (
              <section className="panel">
                <DataTab d={d} refDoc={refDoc} canSave={canSave} />
              </section>
            )}
          </div>
        </div>

        <div className="col-side stack">
          {d.status === 'valid' && (
            <Panel title="Actions">
              <div className="pad stack-sm" style={{ paddingTop: 0 }}>
                {email && (
                  <Button block className="btn-left" icon={ic(Mail, 'ico-sm')} onClick={() => emailAgain(d.id)} id="act-email">
                    Email the buyer again
                  </Button>
                )}
                {d.type === '01' && !d.consolidated && (
                  <>
                    <Button block className="btn-left" icon={ic(Undo2, 'ico-sm')} onClick={() => navigate({ name: 'compose', type: '02', fromId: d.id })} id="act-credit">
                      Create credit note
                    </Button>
                    <Button block className="btn-left" icon={ic(FilePlus2, 'ico-sm')} onClick={() => navigate({ name: 'compose', type: '03', fromId: d.id })} id="act-debit">
                      Create debit note
                    </Button>
                  </>
                )}
                {!d.consolidated && (
                  <>
                    <Button block className="btn-left" variant="danger" icon={ic(Ban, 'ico-sm')} disabled={!canCancel} onClick={() => setCancelOpen(true)} id="act-cancel">
                      Cancel e-invoice
                    </Button>
                    <div className="hint">{canCancel ? 'LHDN allows cancelling for 72 hours after validation.' : 'The 72-hour cancel window has closed.'}</div>
                  </>
                )}
              </div>
            </Panel>
          )}

          {d.uuid && (
            <Panel title="MyInvois record">
              <div className="pad" style={{ paddingTop: 0 }}>
                <dl className="kv">
                  <dt>UUID</dt>
                  <dd className="copy-row mono">
                    <span className="clip">{d.uuid}</span>
                    <CopyButton text={d.uuid} label="Copy UUID" />
                  </dd>
                  {d.submissionUid && (
                    <>
                      <dt>Submission</dt>
                      <dd className="copy-row mono">
                        <span className="clip">{d.submissionUid}</span>
                        <CopyButton text={d.submissionUid} label="Copy submission ID" />
                      </dd>
                    </>
                  )}
                  {d.submittedAt && (
                    <>
                      <dt>Sent</dt>
                      <dd>{dateTime(lastOf(d, ['submitted', 'resubmitted']) ?? d.submittedAt)}</dd>
                    </>
                  )}
                  {d.validatedAt && (
                    <>
                      <dt>Validated</dt>
                      <dd>{dateTime(d.validatedAt)}</dd>
                    </>
                  )}
                  {d.attempts > 1 && (
                    <>
                      <dt>Attempts</dt>
                      <dd>{d.attempts}</dd>
                    </>
                  )}
                  {d.live && (
                    <>
                      <dt>Filed on</dt>
                      <dd>
                        MyInvois {d.live.env}, version {d.live.version}
                        {d.live.onBehalfOf ? ', by an intermediary' : ''}
                      </dd>
                    </>
                  )}
                  {link && (
                    <>
                      <dt>Public link</dt>
                      <dd>
                        <a href={link} target="_blank" rel="noreferrer" id="doc-portal">
                          Open on MyInvois
                        </a>
                      </dd>
                    </>
                  )}
                  <dt>Buyer told</dt>
                  <dd>{d.status === 'valid' || d.status === 'cancelled' ? (d.emailedAt ? 'By MyInvois and email' : d.buyer.kind === 'general' ? 'Not needed' : 'By MyInvois') : 'Not yet'}</dd>
                </dl>
              </div>
            </Panel>
          )}

          {(refDoc || notes.length > 0 || run || req || d.source === 'import') && (
            <Panel title="Related">
              <ul className="related">
                {refDoc && (
                  <li>
                    {ic(FileText, 'ico-sm')}
                    <span className="grow">Original e-invoice</span>
                    <button type="button" className="link-btn" onClick={() => navigate({ name: 'doc', id: refDoc.id })}>
                      {refDoc.number}
                    </button>
                  </li>
                )}
                {notes.map((n) => (
                  <li key={n.id}>
                    {ic(Undo2, 'ico-sm')}
                    <span className="grow">
                      {DOC_LABEL[n.type]} <StatusChip status={n.status} />
                    </span>
                    <button type="button" className="link-btn" onClick={() => navigate({ name: 'doc', id: n.id })}>
                      {n.number}
                    </button>
                  </li>
                ))}
                {run && (
                  <li>
                    {ic(CalendarCheck, 'ico-sm')}
                    <span className="grow">{periodLabel(run.period)} month-end</span>
                    <button type="button" className="link-btn" onClick={() => navigate({ name: 'monthend', runId: run.id })}>
                      Open
                    </button>
                  </li>
                )}
                {req && (
                  <li>
                    {ic(Inbox, 'ico-sm')}
                    <span className="grow">Buyer request, receipt {req.receiptNo}</span>
                    <button type="button" className="link-btn" onClick={() => navigate({ name: 'requests' })}>
                      Open
                    </button>
                  </li>
                )}
                {d.source === 'import' && (
                  <li>
                    {ic(Clock, 'ico-sm')}
                    <span className="grow">Imported from the point-of-sale system</span>
                  </li>
                )}
              </ul>
            </Panel>
          )}
          {d.status === 'submitted' && (
            <Chip tone="info" icon={ic(LoaderCircle, 'ico-sm spin')}>
              LHDN is checking it now
            </Chip>
          )}
        </div>
      </div>
      <CancelDialog d={d} open={cancelOpen} onClose={() => setCancelOpen(false)} />
    </>
  );
}
