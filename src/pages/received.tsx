// E-invoices suppliers issued to this business. Within 72 hours of validation the buyer can reject
// one, which asks the supplier to cancel it; after that, only the supplier's credit note changes it.
import { useEffect, useState } from 'react';
import { Ban, CircleAlert, ExternalLink, FileDown, RefreshCw } from 'lucide-react';
import type { ReceivedDoc } from '../types';
import { CANCEL_WINDOW, HOUR } from '../lib/clock';
import { dateTime, dayMon, leftShort, rm, rmx } from '../lib/format';
import { errorText, validationUrl } from '../lib/myinvois';
import { useApp } from '../state/store';
import { useLive } from '../state/live';
import { rejectLeft } from '../state/select';
import { receivedLines, rejectReceived, syncReceived } from '../state/actions';
import { Button, Chip, Empty, Modal, Note, PageHeader, Panel, Select, StatusChip, Textarea, cx, ic, useNow } from '../ui';
import { useBizOf } from './common';

type Filter = 'all' | 'open' | 'asked' | 'cancelled';

const FILTERS: { key: Filter; label: string; test: (r: ReceivedDoc, t: number) => boolean }[] = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'open', label: 'Can reject', test: (r, t) => rejectLeft(r, t) > 0 },
  { key: 'asked', label: 'Rejection asked', test: (r) => r.status === 'valid' && !!r.rejectRequestedAt },
  { key: 'cancelled', label: 'Cancelled', test: (r) => r.status === 'cancelled' },
];

const REASONS = ['Wrong amount or items', 'Wrong buyer details', 'Goods or services not received', 'Issued twice by mistake'];

function next(r: ReceivedDoc, t: number): { text: string; tone?: 'due' | 'info' } {
  if (r.status === 'cancelled') return { text: r.cancelledAt ? `Cancelled ${dayMon(r.cancelledAt)}` : 'Cancelled' };
  if (r.rejectRequestedAt) return { text: 'Waiting for the supplier to cancel', tone: 'info' };
  const left = rejectLeft(r, t);
  if (left > 0) return { text: `${leftShort(left)} left to reject`, tone: left < 24 * HOUR ? 'due' : undefined };
  return { text: 'Accepted' };
}

function ReceivedDialog({ r, onClose }: { r: ReceivedDoc | undefined; onClose: () => void }) {
  const t = useNow(30_000);
  const [reason, setReason] = useState(REASONS[0]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linesError, setLinesError] = useState<string | null>(null);
  const id = r?.id;
  useEffect(() => {
    if (!id) return;
    setError(null);
    setLinesError(null);
    setNote('');
    receivedLines(id).catch((e) => setLinesError(errorText(e)));
  }, [id]);
  if (!r) return null;
  const left = rejectLeft(r, t);
  const link = r.live && r.longId ? validationUrl(r.live.env, r.uuid, r.longId) : undefined;
  const reject = async () => {
    setBusy(true);
    setError(null);
    const out = await rejectReceived(r.id, note.trim() ? `${reason}. ${note.trim()}` : reason);
    setBusy(false);
    if (!out.ok) setError(out.message ?? "Couldn't reject it.");
  };
  return (
    <Modal
      id="received-dialog"
      open
      onClose={onClose}
      wide
      title={`${r.typeName} ${r.number}`}
      sub={`From ${r.supplierName || 'a supplier'}, ${r.supplierTin}`}
      foot={
        <>
          <Button onClick={onClose}>Close</Button>
          {left > 0 && (
            <Button variant="danger" busy={busy} icon={ic(Ban, 'ico-sm')} onClick={reject} id="received-reject">
              Reject e-invoice
            </Button>
          )}
        </>
      }
    >
      <div className="stack">
        <dl className="kv">
          <dt>Status</dt>
          <dd>
            <StatusChip status={r.status} />
            {r.status === 'valid' && r.rejectRequestedAt && (
              <>
                {' '}
                <Chip tone="due">Rejection asked</Chip>
              </>
            )}
          </dd>
          <dt>Issued</dt>
          <dd>{dateTime(r.issuedAt)}</dd>
          {r.validatedAt && (
            <>
              <dt>Validated</dt>
              <dd>{dateTime(r.validatedAt)}</dd>
            </>
          )}
          <dt>Total</dt>
          <dd className="num strong">{rmx(r.total)}</dd>
          <dt>UUID</dt>
          <dd className="mono clip">{r.uuid}</dd>
          {link && (
            <>
              <dt>Public link</dt>
              <dd>
                <a href={link} target="_blank" rel="noreferrer" id="received-portal">
                  Open on MyInvois {ic(ExternalLink, 'ico-sm')}
                </a>
              </dd>
            </>
          )}
        </dl>

        {r.lines ? (
          r.lines.length > 0 && (
            <div className="tw">
              <table className="tbl">
                <caption className="sr-only">Lines</caption>
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col" className="r">Qty</th>
                    <th scope="col" className="r">Amount (RM)</th>
                  </tr>
                </thead>
                <tbody>
                  {r.lines.map((l, i) => (
                    <tr key={i}>
                      <td>{l.desc}</td>
                      <td className="r num">{l.qty}</td>
                      <td className="r num nw">{rm(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : linesError ? (
          <Note tone="bad">Couldn't load the lines from MyInvois. {linesError}</Note>
        ) : (
          <div className="hint">Loading the lines from MyInvois…</div>
        )}

        {r.status === 'cancelled' ? (
          <Note tone="info">
            {r.supplierName || 'The supplier'} cancelled it{r.cancelledAt ? ` on ${dateTime(r.cancelledAt)}` : ''}
            {r.rejectReason ? `. Reason: ${r.rejectReason}` : ''}. It no longer counts for either of you.
          </Note>
        ) : r.rejectRequestedAt ? (
          <Note tone="due" icon={ic(CircleAlert)}>
            You asked LHDN to reject it on {dateTime(r.rejectRequestedAt)}
            {r.rejectReason ? `: ${r.rejectReason}` : ''}. It stays valid until {r.supplierName || 'the supplier'} cancels it.
          </Note>
        ) : left > 0 ? (
          <div className="stack-sm">
            <div className="field">
              <label className="label" htmlFor="received-reason">
                Reason for rejecting
              </label>
              <Select id="received-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
                {REASONS.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </Select>
            </div>
            <div className="field">
              <label className="label" htmlFor="received-note">
                Details for the supplier
              </label>
              <Textarea id="received-note" rows={2} maxLength={240} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
              <div className="hint">
                LHDN sends this to the supplier and asks them to cancel. You can reject only once, until {dateTime(r.validatedAt! + CANCEL_WINDOW)}.
              </div>
            </div>
          </div>
        ) : (
          <p className="hint">The 72-hour window to reject it has closed. If something is wrong, ask {r.supplierName || 'the supplier'} for a credit note.</p>
        )}

        {error && (
          <Note tone="bad" icon={ic(CircleAlert)}>
            {error}
          </Note>
        )}
      </div>
    </Modal>
  );
}

export function ReceivedPage({ id }: { id?: string }) {
  const s = useApp();
  const live = useLive();
  const biz = useBizOf(s);
  const t = useNow(30_000);
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<string | undefined>(id);
  const [busy, setBusy] = useState(false);
  const isLive = s.workspace === 'live';
  useEffect(() => void syncReceived(biz.id), [biz.id, live?.configured]);

  const all = s.received.filter((r) => r.bizId === biz.id).sort((a, b) => b.issuedAt - a.issuedAt);
  const counts = Object.fromEntries(FILTERS.map((f) => [f.key, all.filter((r) => f.test(r, t)).length])) as Record<Filter, number>;
  const list = all.filter((r) => FILTERS.find((f) => f.key === filter)!.test(r, t));
  const refresh = async () => {
    setBusy(true);
    await syncReceived(biz.id, true);
    setBusy(false);
  };

  return (
    <>
      <PageHeader
        title="Received e-invoices"
        sub={`What suppliers issued to ${biz.name || biz.short}. You can reject one within 72 hours of validation.`}
        actions={
          isLive ? (
            <Button icon={ic(RefreshCw, 'ico-sm')} busy={busy} disabled={!live?.configured} onClick={refresh} id="received-refresh">
              Check MyInvois
            </Button>
          ) : undefined
        }
      />
      <div className="toolbar">
        <div className="pills" role="group" aria-label="Filter received e-invoices">
          {FILTERS.filter((f) => f.key === 'all' || f.key === filter || counts[f.key] > 0).map((f) => (
            <button key={f.key} type="button" className="pill" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)} id={`rfilter-${f.key}`}>
              {f.label}
              <span className="count">{counts[f.key]}</span>
            </button>
          ))}
        </div>
      </div>
      <Panel>
        {list.length ? (
          <div className="tw">
            <table className="tbl">
              <caption className="sr-only">Received e-invoices</caption>
              <thead>
                <tr>
                  <th scope="col">Supplier</th>
                  <th scope="col" className="hide-sm">E-invoice</th>
                  <th scope="col" className="hide-sm">Date</th>
                  <th scope="col" className="r">Amount (RM)</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="hide-md">Next</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => {
                  const n = next(r, t);
                  return (
                    <tr key={r.id} className="clickable" onClick={() => setOpen(r.id)}>
                      <td>
                        <button
                          type="button"
                          className="row-link"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpen(r.id);
                          }}
                        >
                          {r.supplierName || r.supplierTin}
                        </button>
                        <span className="cell-sub mono">{r.supplierTin}</span>
                        <span className="cell-sub show-sm">{r.number}</span>
                      </td>
                      <td className="hide-sm">
                        <span className="clip">{r.number}</span>
                        {r.typeName !== 'Invoice' && <span className="cell-sub">{r.typeName}</span>}
                      </td>
                      <td className="hide-sm nw">{dayMon(r.issuedAt)}</td>
                      <td className="r num nw">{rm(r.total)}</td>
                      <td>
                        <StatusChip status={r.status} />
                      </td>
                      <td className={cx('hide-md nw', n.tone && `t-${n.tone}`)}>{n.text}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon={FileDown} title={filter === 'all' ? 'No received e-invoices yet' : 'Nothing here'}>
            {isLive
              ? live?.configured
                ? `E-invoices issued to ${biz.tin || 'this TIN'} in the last 30 days show up here.`
                : 'MyInvois is not set up on the server.'
              : 'Received e-invoices with this status will show up here.'}
          </Empty>
        )}
      </Panel>
      <ReceivedDialog r={open ? s.received.find((r) => r.id === open) : undefined} onClose={() => setOpen(undefined)} />
    </>
  );
}
