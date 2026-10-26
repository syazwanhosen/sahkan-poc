// Pieces several pages share: the e-invoice table, "what happens next" text, file saving.
import type { Business, Doc, State } from '../types';
import { HOUR } from '../lib/clock';
import { DOC_LABEL } from '../lib/rules';
import { dayMon, leftShort, periodMonth, rm } from '../lib/format';
import { saveFile } from '../lib/downloads';
import { docPdf } from '../lib/pdf';
import { navigate } from '../state/nav';
import { activeBiz, branchName, docTotal, windowLeft } from '../state/select';
import { toast } from '../state/toast';
import { StatusChip, cx } from '../ui';

export function useBizOf(s: State): Business {
  return activeBiz(s) ?? s.businesses[0];
}

/** One short reason an e-invoice was rejected, for summaries. */
export function shortReason(d: Doc): string {
  const f = d.errors?.[0]?.field ?? '';
  if (f === 'tin') return "has a buyer TIN LHDN couldn't match";
  if (f.startsWith('line-')) return 'is missing a classification code';
  if (f === 'phone') return "has a buyer phone number LHDN can't read";
  if (f === 'idValue') return "has a buyer ID that doesn't match their TIN";
  if (f === 'issued') return 'was issued more than 72 hours before it was sent';
  return 'has buyer details to fix';
}

export function nextStep(d: Doc, t: number): { text: string; tone?: 'bad' | 'due' | 'info' } {
  switch (d.status) {
    case 'draft':
      return { text: 'Not sent yet' };
    case 'submitted':
      return { text: 'Checking with LHDN', tone: 'info' };
    case 'invalid': {
      const f = d.errors?.[0]?.field ?? '';
      if (f === 'tin') return { text: "Fix the buyer's TIN", tone: 'bad' };
      if (f.startsWith('line-')) return { text: 'Add a classification', tone: 'bad' };
      if (f === 'idValue') return { text: "Check the buyer's ID", tone: 'bad' };
      return { text: 'Fix and send again', tone: 'bad' };
    }
    case 'cancelled':
      return { text: d.cancelledAt ? `Cancelled ${dayMon(d.cancelledAt)}` : 'Cancelled' };
    case 'valid': {
      if (d.consolidated) return { text: `Filed for ${periodMonth(d.consolidated.period)}` };
      const left = windowLeft(d, t);
      if (left > 0) return { text: `${leftShort(left)} left to cancel`, tone: left < 24 * HOUR ? 'due' : undefined };
      return { text: 'Credit note only' };
    }
  }
}

export function DocTable({ docs, t, biz, showBranch = true, label }: { docs: Doc[]; t: number; biz: Business; showBranch?: boolean; label: string }) {
  return (
    <div className="tw">
      <table className="tbl">
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr>
            <th scope="col">E-invoice</th>
            <th scope="col" className="hide-sm">Buyer</th>
            {showBranch && <th scope="col" className="hide-md">Branch</th>}
            <th scope="col" className="hide-sm">Date</th>
            <th scope="col" className="r">Amount (RM)</th>
            <th scope="col">Status</th>
            <th scope="col" className="hide-md">Next</th>
          </tr>
        </thead>
        <tbody>
          {docs.map((d) => {
            const n = nextStep(d, t);
            const open = () => navigate({ name: 'doc', id: d.id });
            return (
              <tr key={d.id} className="clickable" onClick={open}>
                <td>
                  <button
                    type="button"
                    className="row-link"
                    onClick={(e) => {
                      e.stopPropagation();
                      open();
                    }}
                  >
                    {d.number}
                  </button>
                  {d.type !== '01' && <span className="cell-sub">{DOC_LABEL[d.type]}</span>}
                  <span className="cell-sub show-sm">{d.buyer.name}</span>
                </td>
                <td className="hide-sm">
                  <span className="clip">{d.buyer.name || 'No buyer'}</span>
                  {d.consolidated && <span className="cell-sub">{d.consolidated.receipts.toLocaleString('en-MY')} receipts</span>}
                </td>
                {showBranch && <td className="hide-md nw">{branchName(biz, d.branchId)}</td>}
                <td className="hide-sm nw">{dayMon(d.issuedAt)}</td>
                <td className="r num nw">{rm(docTotal(d))}</td>
                <td>
                  <StatusChip status={d.status} />
                </td>
                <td className={cx('hide-md nw', n.tone && `t-${n.tone}`)}>{n.text}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export async function offerFile(filename: string, data: string | Blob) {
  const out = await saveFile(filename, data);
  if (out === 'saved') toast(`Saved ${filename}`);
  else if (out === 'busy') toast('Another download is waiting for you. Try again in a moment.', { tone: 'info' });
  else if (out === 'failed') toast("Downloads aren't available here.", { tone: 'info' });
}

export function downloadPdf(d: Doc, biz: Business, ref?: Doc) {
  try {
    const blob = docPdf(d, biz, ref);
    return offerFile(`${d.number}.pdf`, blob);
  } catch {
    toast("Couldn't make the PDF.", { tone: 'bad' });
  }
}

export function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
