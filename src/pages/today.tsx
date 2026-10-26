import { CalendarCheck, CircleAlert, CircleCheck, Clock, FileSpreadsheet, FileText, Inbox, LoaderCircle, Plus, Upload } from 'lucide-react';
import { DAY, PERIOD, PERIOD_DUE } from '../lib/clock';
import { daysLeft, int, longDay, periodMonth, plural, rmx } from '../lib/format';
import { useApp } from '../state/store';
import { navigate } from '../state/nav';
import { attention, branchName, byNewest, docsOf, runsOf, splitOf, stats } from '../state/select';
import { Button, Chip, Empty, PageHeader, Panel, Progress, ic, useNow } from '../ui';
import { DocTable, shortReason, useBizOf } from './common';

const compact = (n: number) => (Math.abs(n) >= 1e6 ? `RM ${(n / 1e6).toFixed(2)} million` : rmx(n));

export function TodayPage() {
  const s = useApp();
  const t = useNow(15_000);
  const biz = useBizOf(s);
  const a = attention(s, biz.id, t);
  const st = stats(s, biz.id, t);
  const runs = runsOf(s, biz.id);
  const filed = runs.filter((r) => r.stage === 'done').length;
  const recent = docsOf(s, biz.id)
    .filter((d) => !d.consolidated && d.source !== 'month-end')
    .sort(byNewest)
    .slice(0, 6);
  const branches = [...new Set(a.pending.map((r) => branchName(biz, r.branchId)))];

  const rows = [
    a.invalid.length > 0 && {
      key: 'invalid',
      tone: 'tone-3',
      icon: CircleAlert,
      title: `${plural(a.invalid.length, 'e-invoice')} ${a.invalid.length === 1 ? 'was' : 'were'} rejected`,
      sub: a.invalid
        .slice(0, 2)
        .map((d) => `${d.number} ${shortReason(d)}.`)
        .join(' '),
      action: a.invalid.length === 1 ? 'Fix it' : 'Fix now',
      go: () => navigate(a.invalid.length === 1 ? { name: 'doc', id: a.invalid[0].id } : { name: 'invoices', filter: 'invalid' }),
    },
    a.closing.length > 0 && {
      key: 'closing',
      tone: 'tone-2',
      icon: Clock,
      title: `${plural(a.closing.length, 'cancel window')} close${a.closing.length === 1 ? 's' : ''} within 24 hours`,
      sub: `${a.closing.map((d) => d.number).join(', ')}. After 72 hours, any change needs a credit note.`,
      action: 'Review',
      go: () => navigate({ name: 'invoices', filter: 'closing' }),
    },
    a.pending.length > 0 && {
      key: 'pending',
      tone: 'tone-1',
      icon: Inbox,
      title: `${plural(a.pending.length, 'buyer')} asked for an e-invoice`,
      sub: `Sent from receipt QR codes at ${branches.join(' and ')}.`,
      action: 'Review',
      go: () => navigate({ name: 'requests' }),
    },
    a.drafts.length > 0 && {
      key: 'drafts',
      tone: 'tone-4',
      icon: FileText,
      title: `${plural(a.drafts.length, 'draft')} not sent yet`,
      sub: a.drafts
        .slice(0, 3)
        .map((d) => `${d.number}${d.buyer.name ? ` for ${d.buyer.name}` : ''}`)
        .join(', '),
      action: 'Open',
      go: () => navigate(a.drafts.length === 1 ? { name: 'compose', editId: a.drafts[0].id } : { name: 'invoices', filter: 'draft' }),
    },
  ].filter(Boolean) as { key: string; tone: string; icon: typeof Clock; title: string; sub: string; action: string; go: () => void }[];

  const firstOpen = runs.find((r) => r.stage === 'imported') ?? runs.find((r) => r.stage !== 'done');
  const due = PERIOD_DUE - t;

  return (
    <>
      <PageHeader
        title="Today"
        sub={longDay(t)}
        actions={
          <Button variant="primary" icon={ic(Plus)} onClick={() => navigate({ name: 'compose' })} id="today-new">
            New e-invoice
          </Button>
        }
      />

      <div className="cols">
        <Panel
          className="col-main"
          title="Needs your attention"
          actions={rows.length ? <Chip tone="mute">{rows.length} to do</Chip> : <Chip tone="ok">All clear</Chip>}
        >
          {rows.length ? (
            rows.map((r) => (
              <div className="attn" key={r.key}>
                <span className={`icon-box ${r.tone}`}>{ic(r.icon)}</span>
                <div className="grow">
                  <div className="strong">{r.title}</div>
                  <div className="hint" style={{ marginTop: 2 }}>{r.sub}</div>
                </div>
                <Button size="sm" onClick={r.go} id={`attn-${r.key}`}>
                  {r.action}
                </Button>
              </div>
            ))
          ) : (
            <Empty icon={CircleCheck} title="Nothing needs you right now">
              New requests and anything LHDN rejects will show up here.
            </Empty>
          )}
        </Panel>

        <Panel
          className="col-side"
          title={`${periodMonth(PERIOD)} month-end`}
          actions={filed === runs.length && runs.length ? <Chip tone="ok">Filed</Chip> : <Chip tone={due < 2 * DAY ? 'bad' : 'due'}>{daysLeft(due)}</Chip>}
        >
          <div className="pad stack" style={{ paddingTop: 0 }}>
            <div className="hint">Consolidated e-invoice for walk-in sales, due 7 Nov.</div>
            <div className="stack-sm">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="small strong" style={{ color: 'var(--ink-2)' }}>
                  Branches filed
                </span>
                <span className="small num">
                  {filed} of {runs.length}
                </span>
              </div>
              <Progress value={runs.length ? filed / runs.length : 0} label="Branches filed" />
            </div>
            <ul className="me-list">
              {runs.map((r) => {
                const split = r.stage === 'no-file' ? null : splitOf(s, r);
                const name = branchName(biz, r.branchId);
                const icon = r.stage === 'done' ? CircleCheck : r.stage === 'submitting' ? LoaderCircle : r.stage === 'imported' ? FileSpreadsheet : Upload;
                const text =
                  r.stage === 'done'
                    ? `${name} filed, ${int(split!.receipts)} receipts`
                    : r.stage === 'submitting'
                      ? `${name} is being checked by LHDN`
                      : r.stage === 'imported'
                        ? `${name} sales imported, ${int(split!.receipts)} receipts`
                        : `${name} sales file not imported yet`;
                return (
                  <li key={r.id}>
                    <span className={`me-ico me-${r.stage}`}>{ic(icon, r.stage === 'submitting' ? 'ico-sm spin' : 'ico-sm')}</span>
                    <span className="grow">{text}</span>
                    {r.stage !== 'done' && r.stage !== 'submitting' && (
                      <button type="button" className="link-btn small" onClick={() => navigate({ name: 'monthend', runId: r.id })}>
                        {r.stage === 'imported' ? 'Review' : 'Import'}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            <Button block icon={ic(CalendarCheck, 'ico-sm')} onClick={() => navigate({ name: 'monthend', runId: firstOpen?.id })} id="today-monthend">
              {filed === runs.length ? 'See month-end' : 'Continue month-end'}
            </Button>
          </div>
        </Panel>
      </div>

      <section className="panel stat-strip" aria-label="Last 30 days">
        <div className="stat">
          <div className="hint">E-invoices sent, last 30 days</div>
          <div className="stat-value">{int(st.count)}</div>
        </div>
        <div className="stat">
          <div className="hint">Valid on first submission</div>
          <div className="stat-value">{(st.firstTry * 100).toFixed(1)}%</div>
        </div>
        <div className="stat">
          <div className="hint">Invoiced, last 30 days</div>
          <div className="stat-value">{compact(st.invoiced)}</div>
        </div>
      </section>

      <Panel
        title="Recent e-invoices"
        actions={
          <Button size="sm" variant="ghost" onClick={() => navigate({ name: 'invoices' })} id="today-all">
            View all
          </Button>
        }
      >
        <DocTable docs={recent} t={t} biz={biz} label="Recent e-invoices" showBranch={biz.branches.length > 1} />
      </Panel>
    </>
  );
}

