// The e-invoice as the buyer sees it, plus the QR code and the validation seal.
import { useId, useMemo } from 'react';
import type { Business, Doc } from './types';
import { docQrText, qrPath } from './lib/qr';
import { DOC_LABEL, lineAmount, stateName, taxOf, totals } from './lib/rules';
import { dateTime, rm, rmx } from './lib/format';
import { branchName } from './state/select';
import { cx } from './ui';

export function QR({ text, size = 112, label }: { text: string; size?: number; label: string }) {
  const { size: n, d } = useMemo(() => qrPath(text), [text]);
  return (
    <svg
      width={size}
      height={size}
      viewBox={`-2 -2 ${n + 4} ${n + 4}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      style={{ background: 'var(--paper)', borderRadius: 6, flex: 'none', display: 'block' }}
    >
      <path d={d} style={{ fill: 'var(--paper-ink)' }} />
    </svg>
  );
}

const SEAL: Record<'demo' | 'sandbox' | 'production', { text: string; label: string }> = {
  demo: { text: 'VALIDATED · SIMULATED DEMO ·', label: 'Validated, simulated in this demo' },
  sandbox: { text: 'VALIDATED · MYINVOIS SANDBOX ·', label: 'Validated on the MyInvois sandbox' },
  production: { text: 'VALIDATED · LHDN MYINVOIS ·', label: 'Validated by LHDN' },
};

/** A round "validated" seal. It says plainly where the validation came from: the demo, the sandbox or LHDN. */
export function Seal({ stamp, size = 104, via = 'demo' }: { stamp?: boolean; size?: number; via?: keyof typeof SEAL }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg className={cx('seal', stamp && 'seal-stamp')} width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={SEAL[via].label}>
      <defs>
        <path id={`arc${id}`} d="M60,60 m-45,0 a45,45 0 1,1 90,0 a45,45 0 1,1 -90,0" />
      </defs>
      <circle cx="60" cy="60" r="57" fill="none" strokeWidth="3" style={{ stroke: 'var(--paper-seal)' }} />
      <circle cx="60" cy="60" r="33" strokeWidth="1.5" style={{ fill: 'var(--paper-seal-tint)', stroke: 'var(--paper-seal)' }} />
      <text fontSize="10" fontWeight="700" letterSpacing="1.6" style={{ fill: 'var(--paper-seal)', fontFamily: 'var(--font)' }}>
        <textPath href={`#arc${id}`} textLength="276" lengthAdjust="spacing">
          {SEAL[via].text}
        </textPath>
      </text>
      <path d="M45 61 l10 10 l20 -22" fill="none" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: 'var(--paper-seal)' }} />
    </svg>
  );
}

const addr = (a: Business['address']) => [a.line1, `${a.postcode} ${a.city}`.trim(), stateName(a.state)].filter((x) => x && x !== 'NA' && x !== 'Not applicable').join(', ');

export function InvoicePaper({ doc, biz, refDoc, stamp }: { doc: Doc; biz: Business; refDoc?: Doc; stamp?: boolean }) {
  const t = totals(doc.lines);
  const general = doc.buyer.kind === 'general';
  const taxLabel = (() => {
    const codes = [...new Set(doc.lines.map((l) => l.tax))];
    return codes.length === 1 ? taxOf(codes[0]).label : 'Mixed';
  })();
  return (
    <article className="paper" aria-label={`${DOC_LABEL[doc.type]} ${doc.number}`}>
      <div className="paper-top">
        <div className="row" style={{ alignItems: 'flex-start', gap: 14, flexWrap: 'nowrap', minWidth: 0 }}>
          <span className="avatar avatar-lg" style={{ background: 'var(--paper-ink)', color: 'var(--paper)' }} aria-hidden="true">
            {biz.initials}
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="strong" style={{ fontSize: 15 }}>{biz.name}</div>
            <div className="pm small">{addr(biz.address)}</div>
            <div className="pm small">
              TIN {biz.tin}, BRN {biz.brn}
            </div>
          </div>
        </div>
        <div className="paper-title">
          <div className="pm small strong">e-Invoice · {DOC_LABEL[doc.type]}</div>
          <div className="paper-no">{doc.number}</div>
          <div className="pm small">Issued {dateTime(doc.issuedAt)}</div>
        </div>
      </div>

      <div className="paper-parties">
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <div className="pm small strong">Bill to</div>
          <div className="strong" style={{ marginTop: 4 }}>{doc.buyer.name || 'No buyer yet'}</div>
          {general ? (
            <div className="pm small">Walk-in sales, no buyer details. TIN {doc.buyer.tin}</div>
          ) : (
            <>
              <div className="pm small">{addr(doc.buyer.address)}</div>
              <div className="pm small">
                TIN {doc.buyer.tin || '—'}
                {doc.buyer.idValue && doc.buyer.idValue !== 'NA' ? `, ${doc.buyer.idType === 'NRIC' ? 'MyKad' : doc.buyer.idType} ${doc.buyer.idType === 'NRIC' ? '•••• ' + doc.buyer.idValue.slice(-4) : doc.buyer.idValue}` : ''}
              </div>
            </>
          )}
        </div>
        <dl className="paper-meta">
          <dt>Branch</dt>
          <dd>{branchName(biz, doc.branchId)}</dd>
          <dt>Currency</dt>
          <dd>MYR</dd>
          {refDoc && (
            <>
              <dt>Original</dt>
              <dd>{refDoc.number}</dd>
            </>
          )}
          {doc.consolidated && (
            <>
              <dt>Receipts</dt>
              <dd>{doc.consolidated.receipts.toLocaleString('en-MY')}</dd>
            </>
          )}
        </dl>
      </div>

      <table className="paper-tbl">
        <thead>
          <tr>
            <th>Description</th>
            <th className="hide-sm">Class.</th>
            <th className="r hide-sm">Qty</th>
            <th className="r hide-sm">Unit price</th>
            <th className="r">Amount (RM)</th>
          </tr>
        </thead>
        <tbody>
          {doc.lines.map((l) => (
            <tr key={l.id}>
              <td>
                {l.desc || 'Untitled item'}
                <span className="show-sm pm small" style={{ marginTop: 2 }}>
                  {l.cls || 'no class.'} · {l.qty} × {rm(l.price)}
                </span>
              </td>
              <td className="hide-sm num">{l.cls || <span style={{ color: 'var(--paper-void)' }}>missing</span>}</td>
              <td className="r hide-sm num">{l.qty}</td>
              <td className="r hide-sm num">{rm(l.price)}</td>
              <td className="r num">{rm(lineAmount(l))}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="paper-totals">
        <div>
          <span className="pm">Subtotal</span>
          <span className="num">{rm(t.subtotal)}</span>
        </div>
        <div>
          <span className="pm">Tax ({taxLabel.toLowerCase()})</span>
          <span className="num">{rm(t.tax)}</span>
        </div>
        <div className="paper-total">
          <span>Total</span>
          <span className="num">{rmx(t.total)}</span>
        </div>
      </div>

      <div className="paper-foot">
        {doc.status === 'valid' || doc.status === 'cancelled' ? (
          <>
            <QR
              text={docQrText(doc)}
              size={104}
              label={doc.live ? 'QR code. It opens this e-invoice on the MyInvois portal.' : 'Sample QR code. It holds demo text, not a MyInvois link.'}
            />
            <div style={{ flex: '1 1 220px', minWidth: 0 }}>
              <div className="strong">
                {doc.status === 'cancelled'
                  ? 'Cancelled after validation'
                  : doc.live
                    ? `Validated by LHDN${doc.live.env === 'sandbox' ? ' (MyInvois sandbox)' : ''}`
                    : 'Validated (simulated in this demo)'}
              </div>
              <div className="pm small mono" style={{ marginTop: 4 }}>UUID {doc.uuid}</div>
              {doc.validatedAt && <div className="pm small">Validated {dateTime(doc.validatedAt)}</div>}
              <div className="pm small" style={{ marginTop: 6 }}>
                {!doc.live
                  ? 'Sample document. On a real e-invoice this QR code opens the MyInvois validation page.'
                  : doc.live.env === 'sandbox'
                    ? "Sandbox document from LHDN's test system, not for tax. The QR code opens it on the MyInvois sandbox portal."
                    : 'Scan the QR code to check this e-invoice on MyInvois.'}
              </div>
            </div>
            {doc.status === 'valid' && <Seal stamp={stamp} via={doc.live?.env ?? 'demo'} />}
          </>
        ) : (
          <div className="pm small">
            {doc.status === 'draft' && 'Draft. Not sent to LHDN yet, so there is no QR code.'}
            {doc.status === 'submitted' && 'Sent to LHDN. The QR code appears once it is validated.'}
            {doc.status === 'invalid' && 'Rejected by LHDN. Nothing was filed. Fix it and submit again.'}
          </div>
        )}
      </div>
      {doc.status === 'cancelled' && <div className="void">CANCELLED</div>}
      {doc.status === 'invalid' && <div className="void">REJECTED</div>}
    </article>
  );
}
