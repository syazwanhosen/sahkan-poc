import { useMemo, useRef, useState } from 'react';
import { CalendarCheck, Check, CircleAlert, CircleCheck, FileSpreadsheet, Inbox, LoaderCircle, Send, Upload } from 'lucide-react';
import type { Doc, MonthEndRun } from '../types';
import { PERIOD, PERIOD_DUE } from '../lib/clock';
import { parseSalesCsv, templateCsv } from '../lib/csv';
import { ago, centsx, cents, date, dayMon, daysLeft, int, periodLabel, periodMonth, plural, rm } from '../lib/format';
import { useDownloads } from '../lib/downloads';
import { SPECS } from '../data/receipts';
import { useApp } from '../state/store';
import { navigate } from '../state/nav';
import { branchName, docTotal, runsOf, splitOf } from '../state/select';
import { clearFile, importRows, importSample, submitRun } from '../state/actions';
import { toast } from '../state/toast';
import { Button, Chip, Note, PageHeader, Panel, Progress, StatusChip, cx, ic, useNow } from '../ui';
import { offerFile, useBizOf } from './common';

const STAGE_CHIP: Record<MonthEndRun['stage'], { tone: 'mute' | 'info' | 'ok' | 'due'; label: string }> = {
  'no-file': { tone: 'due', label: 'Sales not imported' },
  imported: { tone: 'info', label: 'Ready to submit' },
  submitting: { tone: 'info', label: 'Submitting' },
  done: { tone: 'ok', label: 'Filed' },
};

function DueChip({ run }: { run?: MonthEndRun }) {
  const t = useNow(60_000);
  if (run?.stage === 'done') return <Chip tone="ok" icon={ic(CircleCheck, 'ico-sm')}>Filed {run.doneAt ? dayMon(run.doneAt) : ''}</Chip>;
  const ms = PERIOD_DUE - t;
  return <Chip tone={ms < 2 * 86_400_000 ? 'bad' : 'due'}>Due {dayMon(PERIOD_DUE)}, {daysLeft(ms)}</Chip>;
}

export function MonthEndPage({ runId }: { runId?: string }) {
  const s = useApp();
  const biz = useBizOf(s);
  const runs = runsOf(s, biz.id);
  const run = runId ? s.runs.find((r) => r.id === runId && r.bizId === biz.id) : runs.length === 1 ? runs[0] : undefined;
  if (run) return <RunView run={run} multi={runs.length > 1 || run.period !== PERIOD} />;
  return <Overview />;
}

function Overview() {
  const s = useApp();
  const biz = useBizOf(s);
  const runs = runsOf(s, biz.id);
  const earlier = s.runs.filter((r) => r.bizId === biz.id && r.period !== PERIOD && r.stage === 'done').sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
  return (
    <>
      <PageHeader
        title={`${periodMonth(PERIOD)} month-end`}
        status={<DueChip run={runs.every((r) => r.stage === 'done') ? runs[0] : undefined} />}
        sub="Walk-in sales without their own e-invoice go into one consolidated e-invoice per branch, due within 7 days of the month's end."
      />
      <div className="cards">
        {runs.map((r) => {
          const split = r.stage === 'no-file' ? null : splitOf(s, r);
          const chip = STAGE_CHIP[r.stage];
          return (
            <section key={r.id} className="panel pad stack" aria-label={`${branchName(biz, r.branchId)} branch`}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h2 className="h2">{branchName(biz, r.branchId)} branch</h2>
                <Chip tone={chip.tone} icon={r.stage === 'submitting' ? ic(LoaderCircle, 'ico-sm spin') : undefined}>
                  {chip.label}
                </Chip>
              </div>
              {split ? (
                <dl className="kv">
                  <dt>Sales file</dt>
                  <dd className="mono clip">{r.file?.name}</dd>
                  <dt>Receipts</dt>
                  <dd>{int(split.receipts)}</dd>
                  <dt>Total sales</dt>
                  <dd>{centsx(split.totalCents)}</dd>
                  <dt>E-invoices</dt>
                  <dd>
                    {split.lines.length ? 1 : 0} consolidated, {split.individual.length} on their own
                  </dd>
                </dl>
              ) : (
                <p className="hint">Import this branch's {periodMonth(r.period)} sales from your POS to build its consolidated e-invoice.</p>
              )}
              <Button
                variant={r.stage === 'done' ? 'default' : 'primary'}
                icon={ic(r.stage === 'no-file' ? Upload : r.stage === 'imported' ? Send : CalendarCheck, 'ico-sm')}
                onClick={() => navigate({ name: 'monthend', runId: r.id })}
                id={`me-open-${r.branchId}`}
              >
                {r.stage === 'no-file' ? 'Import sales' : r.stage === 'imported' ? 'Review and submit' : 'View'}
              </Button>
            </section>
          );
        })}
      </div>
      {earlier.length > 0 && (
        <Panel title="Earlier months">
          <div className="tw">
            <table className="tbl">
              <caption className="sr-only">Earlier months</caption>
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col" className="hide-sm">Branch</th>
                  <th scope="col" className="hide-sm">Filed</th>
                  <th scope="col" className="r">Amount (RM)</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {earlier.map((r) => {
                  const docs = r.docIds.map((id) => s.docs.find((d) => d.id === id)).filter(Boolean) as Doc[];
                  const amount = docs.reduce((a, d) => a + docTotal(d), 0);
                  return (
                    <tr key={r.id} className="clickable" onClick={() => navigate({ name: 'monthend', runId: r.id })}>
                      <td className="nw">
                        <button
                          type="button"
                          className="row-link"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate({ name: 'monthend', runId: r.id });
                          }}
                        >
                          {periodLabel(r.period)}
                        </button>
                        <span className="cell-sub show-sm">{branchName(biz, r.branchId)}</span>
                      </td>
                      <td className="hide-sm">{branchName(biz, r.branchId)}</td>
                      <td className="hide-sm nw">{r.doneAt ? date(r.doneAt) : ''}</td>
                      <td className="r num">{rm(amount)}</td>
                      <td>
                        <StatusChip status="valid" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  );
}

function Stepper({ stage }: { stage: MonthEndRun['stage'] }) {
  const at = stage === 'no-file' ? 0 : stage === 'imported' ? 1 : 2;
  const labels = ['Import sales', 'Check the split', 'Submit'];
  return (
    <ol className="stepper" aria-label="Steps">
      {labels.map((l, i) => {
        const done = i < at || stage === 'done';
        const now = i === at && stage !== 'done';
        return (
          <li key={l} className={cx(done && 'step-done', now && 'step-now')} aria-current={now ? 'step' : undefined}>
            {i > 0 && <span className={cx('step-bar', (i <= at || stage === 'done') && 'step-bar-done')} aria-hidden="true" />}
            <span className="step-dot" aria-hidden="true">
              {done ? <Check className="ico-sm" /> : i + 1}
            </span>
            <span className={cx(now && 'strong')}>{l}</span>
          </li>
        );
      })}
    </ol>
  );
}

function RunView({ run, multi }: { run: MonthEndRun; multi: boolean }) {
  const s = useApp();
  const biz = useBizOf(s);
  const branch = branchName(biz, run.branchId);
  return (
    <>
      <PageHeader
        crumb={{ label: multi ? 'Month-end' : 'Today', onClick: () => navigate(multi ? { name: 'monthend' } : { name: 'today' }) }}
        title={`${periodLabel(run.period)}, ${branch === 'Main' ? biz.short : `${branch} branch`}`}
        status={run.period === PERIOD ? <DueChip run={run} /> : <Chip tone="ok">Filed</Chip>}
        sub="Monthly consolidated e-invoice for walk-in sales"
      />
      <Stepper stage={run.stage} />
      {run.stage === 'no-file' && <ImportPanel run={run} />}
      {run.stage === 'imported' && <SplitView run={run} />}
      {(run.stage === 'submitting' || run.stage === 'done') && <Results run={run} />}
    </>
  );
}

function ImportPanel({ run }: { run: MonthEndRun }) {
  const s = useApp();
  const biz = useBizOf(s);
  const canSave = useDownloads();
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const spec = run.sampleSpec ? SPECS[run.sampleSpec] : undefined;
  const prefix = biz.branches.find((b) => b.id === run.branchId)?.prefix ?? 'R-';

  const handle = async (f: File) => {
    setError(null);
    if (!/\.csv$/i.test(f.name)) {
      setError('Choose a CSV file. Most point-of-sale systems can export one.');
      return;
    }
    setBusy(true);
    try {
      const parsed = parseSalesCsv(await f.text(), run.period);
      if (parsed.error) setError(parsed.error);
      else {
        importRows(run.id, f.name, parsed.rows, parsed.skipped);
        toast(`Imported ${plural(parsed.rows.length, 'receipt')} from ${f.name}`);
      }
    } catch {
      setError("We couldn't read that file.");
    }
    setBusy(false);
  };

  return (
    <Panel title={`Import ${periodMonth(run.period)} sales`} sub="One row per receipt, with the receipt number, date and amount. Export it from your point-of-sale system.">
      <div className="pad stack" style={{ paddingTop: 0 }}>
        <div
          className={cx('drop', drag && 'drop-on')}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files[0];
            if (f) handle(f);
          }}
        >
          {ic(Upload)}
          <div className="strong">Drop the sales file here</div>
          <div className="hint">A CSV file</div>
          <div className="row" style={{ justifyContent: 'center', marginTop: 4 }}>
            <Button onClick={() => input.current?.click()} busy={busy} id="me-choose">
              Choose file
            </Button>
            {spec && (
              <Button
                variant="primary"
                icon={ic(FileSpreadsheet, 'ico-sm')}
                id="me-sample"
                onClick={() => {
                  importSample(run.id);
                  toast(`Imported ${plural(spec.count, 'receipt')} from ${spec.fileName}`);
                }}
              >
                Use the sample file
              </Button>
            )}
          </div>
          <input
            ref={input}
            id="me-file"
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handle(f);
              e.target.value = '';
            }}
          />
        </div>
        {spec && (
          <p className="hint">
            The sample is <span className="mono">{spec.fileName}</span>, with {int(spec.count)} receipts from {periodMonth(run.period)}.
          </p>
        )}
        {error && (
          <Note tone="bad" icon={ic(CircleAlert)}>
            {error}
          </Note>
        )}
        {canSave && (
          <div>
            <button type="button" className="link-btn small" onClick={() => offerFile('sales-template.csv', templateCsv(prefix))} id="me-template">
              Download a CSV template
            </button>
          </div>
        )}
      </div>
    </Panel>
  );
}

function SplitView({ run }: { run: MonthEndRun }) {
  const s = useApp();
  const biz = useBizOf(s);
  const t = useNow(60_000);
  const [all, setAll] = useState(false);
  const split = useMemo(() => splitOf(s, run), [s.requests, run]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = split.totalCents || 1;
  const waiting = s.requests.filter((r) => r.bizId === run.bizId && r.branchId === run.branchId && r.status === 'pending' && split.pending.some((p) => p.no === r.receiptNo));
  const count = (split.lines.length ? 1 : 0) + split.individual.length;
  const segs = [
    { cents: split.cCents, color: 'var(--split-a)', label: 'Monthly consolidated e-invoice', sub: `${plural(split.consolidated.length, 'receipt')}, buyer shown as General Public`, n: split.consolidated.length },
    { cents: split.iCents, color: 'var(--split-b)', label: 'Own e-invoice each, above RM10,000', sub: `${plural(split.individual.length, 'receipt')}, sent one by one`, n: split.individual.length },
    { cents: split.rCents, color: 'var(--split-c)', label: 'Already issued on request', sub: `${plural(split.requested.length, 'receipt')}, left out so nothing is filed twice`, n: split.requested.length },
  ];
  const lines = all ? split.lines : split.lines.slice(0, 5);

  return (
    <>
      <section className="panel pad file-card" aria-label="Sales file">
        <span className="icon-box tone-0">{ic(FileSpreadsheet)}</span>
        <div className="grow">
          <div className="strong mono clip">{run.file?.name}</div>
          <div className="hint">
            {int(split.receipts)} receipts, {centsx(split.totalCents)}. Imported {run.file ? ago(run.file.at, t) : ''}
            {run.file?.skipped ? `. ${plural(run.file.skipped, 'row')} skipped` : ''}.
          </div>
        </div>
        <Button size="sm" onClick={() => clearFile(run.id)} id="me-replace">
          Replace file
        </Button>
      </section>

      <Panel title={`How ${periodMonth(run.period)}'s sales split`}>
        <div className="pad stack" style={{ paddingTop: 0 }}>
          <div
            className="splitbar"
            role="img"
            aria-label={segs
              .filter((x) => x.n)
              .map((x) => `${x.label}: ${Math.round((x.cents / total) * 100)}%`)
              .join(', ')}
          >
            {segs
              .filter((x) => x.cents > 0)
              .map((x) => (
                <div key={x.label} style={{ width: `${(x.cents / total) * 100}%`, background: x.color }} />
              ))}
          </div>
          <ul className="split-keys">
            {segs.map((x) => (
              <li key={x.label}>
                <span className="key" style={{ background: x.color }} aria-hidden="true" />
                <div className="grow">
                  <div className="strong">{x.label}</div>
                  <div className="hint">{x.sub}</div>
                </div>
                <div className="strong num nw">{centsx(x.cents)}</div>
              </li>
            ))}
          </ul>
          <Note tone="ok" icon={ic(CircleCheck)}>
            Everything adds up. {int(split.consolidated.length)} + {int(split.individual.length)} + {int(split.requested.length)} = {int(split.receipts)} receipts, and{' '}
            {centsx(split.totalCents)} matches the sales file.
          </Note>
          {waiting.length > 0 && (
            <Note tone="due" icon={ic(Inbox)}>
              {waiting.length === 1 ? '1 buyer is' : `${waiting.length} buyers are`} still waiting for an e-invoice for receipt{waiting.length > 1 ? 's' : ''}{' '}
              {waiting.map((r) => r.receiptNo).join(' and ')}. Issue {waiting.length > 1 ? 'them' : 'it'} first, or {waiting.length > 1 ? 'these sales go' : 'this sale goes'} into the consolidated e-invoice.{' '}
              <button type="button" className="link-btn" onClick={() => navigate({ name: 'requests' })} id="me-requests">
                Open buyer requests
              </button>
            </Note>
          )}
        </div>
      </Panel>

      <Panel title="Lines on the consolidated e-invoice" sub="Grouped by unbroken runs of receipt numbers">
        <div className="tw">
          <table className="tbl">
            <caption className="sr-only">Consolidated e-invoice lines</caption>
            <thead>
              <tr>
                <th scope="col">Line</th>
                <th scope="col">Receipts</th>
                <th scope="col" className="r hide-sm">Count</th>
                <th scope="col" className="r">Amount (RM)</th>
                <th scope="col" className="hide-md">Classification</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.from}>
                  <td className="num">{i + 1}</td>
                  <td className="mono nw">
                    {l.from === l.to ? l.from : `${l.from} to ${l.to}`}
                    <span className="cell-sub show-sm">{plural(l.count, 'receipt')}</span>
                  </td>
                  <td className="r num hide-sm">{int(l.count)}</td>
                  <td className="r num">{cents(l.cents)}</td>
                  <td className="hide-md">004 Consolidated</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-foot">
          <span className="hint">
            Showing {lines.length} of {plural(split.lines.length, 'line')}. Gaps are receipts that got their own e-invoice.
          </span>
          {split.lines.length > 5 && (
            <Button size="sm" onClick={() => setAll(!all)} id="me-all-lines">
              {all ? 'Show fewer' : `Show all ${split.lines.length}`}
            </Button>
          )}
        </div>
      </Panel>

      {split.individual.length > 0 && (
        <Panel title="Sales above RM10,000" sub="Each one goes to LHDN as its own e-invoice, buyer General Public.">
          <div className="tw">
            <table className="tbl">
              <caption className="sr-only">Sales above RM10,000</caption>
              <thead>
                <tr>
                  <th scope="col">Receipt</th>
                  <th scope="col">Date</th>
                  <th scope="col" className="r">Amount (RM)</th>
                </tr>
              </thead>
              <tbody>
                {split.individual.map((r) => (
                  <tr key={r.no}>
                    <td className="mono">{r.no}</td>
                    <td className="nw">{date(r.at)}</td>
                    <td className="r num">{cents(r.cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <section className="panel pad submit-bar" aria-label="Submit">
        <div className="grow">
          <div className="strong">Ready to submit {plural(count, 'e-invoice')}</div>
          <div className="hint">
            {split.lines.length ? '1 consolidated' : 'No consolidated'} and {split.individual.length} individual, for {branchName(biz, run.branchId)}.
          </div>
        </div>
        <div className="row">
          <Button onClick={() => navigate({ name: 'monthend' })} id="me-back">
            Back
          </Button>
          <Button
            variant="primary"
            icon={ic(Send, 'ico-sm')}
            id="me-submit"
            disabled={!count}
            onClick={() => {
              const n = submitRun(run.id);
              if (n) toast(`Sent ${plural(n, 'e-invoice')} to LHDN`, { tone: 'info' });
            }}
          >
            Submit {plural(count, 'e-invoice')}
          </Button>
        </div>
      </section>
    </>
  );
}

function Results({ run }: { run: MonthEndRun }) {
  const s = useApp();
  const biz = useBizOf(s);
  const docs = run.docIds.map((id) => s.docs.find((d) => d.id === id)).filter(Boolean) as Doc[];
  const checked = docs.filter((d) => d.status !== 'submitted').length;
  const valid = docs.filter((d) => d.status === 'valid').length;
  const bad = docs.filter((d) => d.status === 'invalid').length;
  const total = docs.reduce((a, d) => a + docTotal(d), 0);
  return (
    <>
      {run.stage === 'done' &&
        (bad ? (
          <Note tone="bad" icon={ic(CircleAlert)}>
            {plural(bad, 'e-invoice')} came back invalid. Open {bad === 1 ? 'it' : 'them'} below to fix and resend.
          </Note>
        ) : (
          <Note tone="ok" icon={ic(CircleCheck)}>
            {periodMonth(run.period)} is filed for {branchName(biz, run.branchId) === 'Main' ? biz.short : `the ${branchName(biz, run.branchId)} branch`}. {plural(valid, 'e-invoice')}, {centsx(Math.round(total * 100))}, validated by LHDN.
          </Note>
        ))}
      <Panel title={run.stage === 'done' ? 'What was filed' : 'Sending to LHDN'} sub={run.stage === 'done' ? undefined : 'Each e-invoice is checked on its own. This takes a few seconds.'}>
        <div className="pad stack-sm" style={{ paddingTop: 0 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="small strong" style={{ color: 'var(--ink-2)' }}>
              {checked} of {docs.length} checked by LHDN
            </span>
            <span className="small num">{valid} valid</span>
          </div>
          <Progress value={docs.length ? checked / docs.length : 1} label="Checked by LHDN" />
        </div>
        <div className="tw">
          <table className="tbl">
            <caption className="sr-only">E-invoices in this month-end</caption>
            <thead>
              <tr>
                <th scope="col">E-invoice</th>
                <th scope="col" className="hide-sm">What</th>
                <th scope="col" className="r">Amount (RM)</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id} className="clickable" onClick={() => navigate({ name: 'doc', id: d.id })}>
                  <td className="nw">
                    <button
                      type="button"
                      className="row-link"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate({ name: 'doc', id: d.id });
                      }}
                    >
                      {d.number}
                    </button>
                  </td>
                  <td className="hide-sm">{d.consolidated ? `Consolidated, ${int(d.consolidated.receipts)} receipts` : `Sale above RM10,000, ${d.receiptNo}`}</td>
                  <td className="r num">{rm(docTotal(d))}</td>
                  <td>
                    <StatusChip status={d.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      {run.stage === 'done' && (
        <div className="row">
          <Button onClick={() => navigate({ name: 'monthend' })} id="me-done-back">
            Back to month-end
          </Button>
          <Button variant="ghost" onClick={() => navigate({ name: 'today' })} id="me-done-today">
            Go to Today
          </Button>
        </div>
      )}
    </>
  );
}
