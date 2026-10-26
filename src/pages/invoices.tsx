import { useMemo, useState } from 'react';
import { Download, FileText, Plus, Search } from 'lucide-react';
import type { Doc } from '../types';
import { HOUR } from '../lib/clock';
import { DOC_LABEL } from '../lib/rules';
import { useDownloads } from '../lib/downloads';
import { useApp } from '../state/store';
import { navigate, type Filter } from '../state/nav';
import { branchName, byNewest, docTotal, docsOf, windowLeft } from '../state/select';
import { Button, Empty, Input, PageHeader, Panel, ic, useNow } from '../ui';
import { DocTable, csvCell, offerFile, useBizOf } from './common';

const FILTERS: { key: Filter; label: string; test: (d: Doc, t: number) => boolean }[] = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'invalid', label: 'Needs fixing', test: (d) => d.status === 'invalid' },
  { key: 'submitted', label: 'Checking', test: (d) => d.status === 'submitted' },
  {
    key: 'closing',
    label: 'Cancel window closing',
    test: (d, t) => {
      const l = windowLeft(d, t);
      return l > 0 && l < 24 * HOUR;
    },
  },
  { key: 'valid', label: 'Valid', test: (d) => d.status === 'valid' },
  { key: 'draft', label: 'Drafts', test: (d) => d.status === 'draft' },
  { key: 'cancelled', label: 'Cancelled', test: (d) => d.status === 'cancelled' },
];

const PAGE = 25;

export function InvoicesPage({ filter: initial = 'all', q: initialQ = '' }: { filter?: Filter; q?: string }) {
  const s = useApp();
  const t = useNow(15_000);
  const biz = useBizOf(s);
  const canSave = useDownloads();
  const [filter, setFilter] = useState<Filter>(initial);
  const [q, setQ] = useState(initialQ);
  const [shown, setShown] = useState(PAGE);
  const all = useMemo(() => docsOf(s, biz.id).sort(byNewest), [s, biz.id]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, all.filter((d) => f.test(d, t)).length])), [all, t]);
  const needle = q.trim().toLowerCase();
  const list = all.filter(
    (d) =>
      FILTERS.find((f) => f.key === filter)!.test(d, t) &&
      (!needle ||
        d.number.toLowerCase().includes(needle) ||
        d.buyer.name.toLowerCase().includes(needle) ||
        d.buyer.tin.toLowerCase().includes(needle) ||
        (d.receiptNo ?? '').toLowerCase().includes(needle)),
  );

  const exportCsv = () => {
    const head = ['number', 'type', 'buyer', 'buyer_tin', 'branch', 'issued', 'amount_rm', 'status', 'uuid'];
    const rows = list.map((d) =>
      [d.number, DOC_LABEL[d.type], d.buyer.name, d.buyer.tin, branchName(biz, d.branchId), new Date(d.issuedAt).toISOString(), docTotal(d).toFixed(2), d.status, d.uuid ?? '']
        .map(csvCell)
        .join(','),
    );
    offerFile(`e-invoices-${biz.id}-${filter}.csv`, [head.join(','), ...rows].join('\n') + '\n');
  };

  return (
    <>
      <PageHeader
        title="E-invoices"
        sub={`${all.length.toLocaleString('en-MY')} for ${biz.name}, newest first`}
        actions={
          <>
            {canSave && (
              <Button icon={ic(Download, 'ico-sm')} onClick={exportCsv} id="inv-export">
                Export CSV
              </Button>
            )}
            <Button variant="primary" icon={ic(Plus)} onClick={() => navigate({ name: 'compose' })} id="inv-new">
              New e-invoice
            </Button>
          </>
        }
      />
      <div className="toolbar">
        <div className="pills" role="group" aria-label="Filter by status">
          {FILTERS.filter((f) => f.key === 'all' || f.key === filter || counts[f.key] > 0).map((f) => (
            <button
              key={f.key}
              type="button"
              className="pill"
              aria-pressed={filter === f.key}
              onClick={() => {
                setFilter(f.key);
                setShown(PAGE);
              }}
              id={`filter-${f.key}`}
            >
              {f.label}
              <span className="count">{counts[f.key]}</span>
            </button>
          ))}
        </div>
        <div className="search" style={{ flex: '1 1 260px', maxWidth: 360 }}>
          {ic(Search)}
          <Input
            id="inv-search"
            type="search"
            placeholder="Search number, buyer, TIN or receipt"
            aria-label="Search e-invoices"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setShown(PAGE);
            }}
          />
        </div>
      </div>
      <Panel>
        {list.length ? (
          <>
            <DocTable docs={list.slice(0, shown)} t={t} biz={biz} label="E-invoices" showBranch={biz.branches.length > 1} />
            <div className="table-foot">
              <span className="hint">
                Showing {Math.min(shown, list.length).toLocaleString('en-MY')} of {list.length.toLocaleString('en-MY')}
              </span>
              {shown < list.length && (
                <Button size="sm" onClick={() => setShown(shown + PAGE)} id="inv-more">
                  Show {Math.min(PAGE, list.length - shown)} more
                </Button>
              )}
            </div>
          </>
        ) : (
          <Empty icon={FileText} title={needle ? `Nothing matches "${q.trim()}"` : 'Nothing here'}>
            {needle ? 'Try a different number, buyer name or TIN.' : 'E-invoices with this status will show up here.'}
          </Empty>
        )}
      </Panel>
    </>
  );
}
