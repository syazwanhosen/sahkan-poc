import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, CircleAlert, FlaskConical, History, KeyRound, Layers, PencilLine, PlugZap, SearchCheck, ShieldCheck, Smartphone, TriangleAlert } from 'lucide-react';
import type { Business, IdType, TinStatus } from '../types';
import { ID_LABEL, STATES, businessProblems, stateName } from '../lib/rules';
import { date, dateTime, plural } from '../lib/format';
import type { DocSummary, DocumentType, DocumentTypeVersion, Page } from '../lib/myinvois';
import { errorText } from '../lib/myinvois';
import { useApp } from '../state/store';
import { askAccessKey, refreshLive, useLive } from '../state/live';
import { navigate } from '../state/nav';
import { activeBiz } from '../state/select';
import { businessFromTaxpayer, checkLive, liveDocType, liveDocTypeVersion, liveRecent, openWorkspace, setSettings, tinMismatch, updateBusiness, verifyTin } from '../state/actions';
import { toast } from '../state/toast';
import { QR } from '../paper';
import { QrFill, TinChip } from '../party';
import { Button, Chip, Field, Input, Modal, Note, PageHeader, Panel, Segmented, Select, Switch, ic } from '../ui';

function BusinessDialog({ biz, open, onClose }: { biz: Business; open: boolean; onClose: () => void }) {
  const [b, setB] = useState<Business>(biz);
  const [tried, setTried] = useState(false);
  const [tin, setTin] = useState<TinStatus>('unchecked');
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    if (!open) return;
    setB(biz);
    setTried(false);
    setTin('unchecked');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const probs = Object.fromEntries(businessProblems(b).map((p) => [p.field, p.message]));
  const err = (f: string) => (tried ? probs[f] : undefined);
  const set = (patch: Partial<Business>) => setB((x) => ({ ...x, ...patch }));
  const setAddr = (patch: Partial<Business['address']>) => setB((x) => ({ ...x, address: { ...x.address, ...patch } }));
  const check = async () => {
    setChecking(true);
    setTin(await verifyTin({ tin: b.tin, idType: b.idType ?? 'BRN', idValue: b.brn }));
    setChecking(false);
  };
  const save = () => {
    setTried(true);
    if (Object.keys(probs).length) return;
    updateBusiness(biz.id, {
      name: b.name.trim(),
      tin: b.tin.trim().toUpperCase(),
      brn: b.brn.trim(),
      idType: b.idType ?? 'BRN',
      sst: b.sst?.trim() ?? '',
      msic: b.msic.trim(),
      msicName: b.msicName.trim(),
      activity: b.msicName.trim(),
      address: { ...b.address, line1: b.address.line1.trim(), postcode: b.address.postcode.trim(), city: b.address.city.trim() },
      phone: b.phone.trim(),
      email: b.email.trim(),
    });
    toast('Business details saved');
    onClose();
  };
  return (
    <Modal
      id="biz-dialog"
      open={open}
      onClose={onClose}
      wide
      title="Business details"
      sub="The supplier on every e-invoice. MyInvois checks them against the taxpayer who logs in."
      foot={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} id="biz-save">
            Save details
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <div className="span-all">
          <QrFill
            id="biz-qr"
            label="Fill in from your MyInvois QR code"
            onInfo={(x) => {
              setB((cur) => ({ ...cur, ...businessFromTaxpayer(x) }));
              setTin('verified');
            }}
          />
        </div>
        <Field label="Registered name" htmlFor="biz-name" error={err('name')} className="span-all">
          <Input id="biz-name" value={b.name} invalid={!!err('name')} autoComplete="organization" onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Tax number (TIN)" htmlFor="biz-tin" error={err('tin') ?? (tin === 'not-found' ? "LHDN doesn't match this TIN with the BRN." : undefined)} action={<TinChip status={tin} />}>
          <div className="input-row">
            <Input
              id="biz-tin"
              value={b.tin}
              invalid={!!err('tin') || tin === 'not-found'}
              autoComplete="off"
              spellCheck={false}
              className="mono-input"
              onChange={(e) => {
                set({ tin: e.target.value.toUpperCase().replace(/\s/g, '') });
                setTin('unchecked');
              }}
            />
            <Button onClick={check} busy={checking} disabled={!b.tin.trim() || !b.brn.trim()} icon={ic(SearchCheck, 'ico-sm')} id="biz-tin-check">
              Check
            </Button>
          </div>
        </Field>
        <Field
          label="ID number"
          htmlFor="biz-brn"
          error={err('brn')}
          hint={(b.idType ?? 'BRN') === 'BRN' ? 'Business registration number, for a company or sole proprietor.' : 'For an individual without a business registration.'}
        >
          <div className="input-row">
            <Select
              id="biz-idtype"
              aria-label="ID type"
              value={b.idType ?? 'BRN'}
              onChange={(e) => {
                set({ idType: e.target.value as IdType });
                setTin('unchecked');
              }}
              style={{ flex: '0 0 112px', width: 112 }}
            >
              {(Object.keys(ID_LABEL) as IdType[]).map((k) => (
                <option key={k} value={k}>
                  {ID_LABEL[k]}
                </option>
              ))}
            </Select>
            <Input
              id="biz-brn"
              value={b.brn}
              invalid={!!err('brn')}
              inputMode={(b.idType ?? 'BRN') === 'PASSPORT' ? 'text' : 'numeric'}
              autoComplete="off"
              onChange={(e) => {
                set({ brn: e.target.value });
                setTin('unchecked');
              }}
            />
          </div>
        </Field>
        <Field label="SST registration number" htmlFor="biz-sst" hint="Leave it empty if the business isn't registered for SST.">
          <Input id="biz-sst" value={b.sst ?? ''} autoComplete="off" onChange={(e) => set({ sst: e.target.value })} />
        </Field>
        <Field label="MSIC code" htmlFor="biz-msic" error={err('msic')} hint="5 digits, like 47411. 00000 if not in business.">
          <Input id="biz-msic" value={b.msic} invalid={!!err('msic')} inputMode="numeric" autoComplete="off" onChange={(e) => set({ msic: e.target.value })} />
        </Field>
        <Field label="Business activity" htmlFor="biz-activity" error={err('msicName')} className="span-all">
          <Input id="biz-activity" value={b.msicName} invalid={!!err('msicName')} autoComplete="off" onChange={(e) => set({ msicName: e.target.value })} />
        </Field>
        <Field label="Address" htmlFor="biz-addr" error={err('address')} className="span-all">
          <Input id="biz-addr" value={b.address.line1} invalid={!!err('address')} autoComplete="street-address" onChange={(e) => setAddr({ line1: e.target.value })} />
        </Field>
        <Field label="Postcode" htmlFor="biz-postcode" error={err('postcode')}>
          <Input id="biz-postcode" value={b.address.postcode} invalid={!!err('postcode')} inputMode="numeric" autoComplete="postal-code" onChange={(e) => setAddr({ postcode: e.target.value })} />
        </Field>
        <Field label="City" htmlFor="biz-city" error={err('city')}>
          <Input id="biz-city" value={b.address.city} invalid={!!err('city')} autoComplete="address-level2" onChange={(e) => setAddr({ city: e.target.value })} />
        </Field>
        <Field label="State" htmlFor="biz-state">
          <Select id="biz-state" value={b.address.state} onChange={(e) => setAddr({ state: e.target.value })}>
            {STATES.filter(([c]) => c !== '17').map(([c, n]) => (
              <option key={c} value={c}>
                {n}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Phone" htmlFor="biz-phone" error={err('phone')} hint="Digits only, like 0322841188.">
          <Input id="biz-phone" type="tel" value={b.phone} invalid={!!err('phone')} autoComplete="tel" onChange={(e) => set({ phone: e.target.value })} />
        </Field>
        <Field label="Email" htmlFor="biz-email" error={err('email')}>
          <Input id="biz-email" type="email" value={b.email} invalid={!!err('email')} autoComplete="email" onChange={(e) => set({ email: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

const WORKFLOW: Record<string, string> = {
  submissionDuration: 'Submit within',
  cancellationDuration: 'Cancel within',
  rejectionDuration: 'Buyer can reject within',
};

/** Get All Document Types, then Get Document Type (versions, time limits) and Get Document Type Version on demand. */
function DocTypesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [types, setTypes] = useState<DocumentType[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<number, DocumentType | string>>({});
  const [versions, setVersions] = useState<Record<number, DocumentTypeVersion | string>>({});
  useEffect(() => {
    if (!open || types) return;
    checkLive()
      .then(setTypes)
      .catch((e) => setError(errorText(e)));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const expand = async (id: number) => {
    if (detail[id]) return setDetail(({ [id]: _gone, ...rest }) => rest);
    setDetail((d) => ({ ...d, [id]: 'Loading…' }));
    try {
      const x = await liveDocType(id);
      setDetail((d) => ({ ...d, [id]: x }));
    } catch (e) {
      setDetail((d) => ({ ...d, [id]: errorText(e) }));
    }
  };
  const version = async (id: number, vid: number) => {
    setVersions((v) => ({ ...v, [vid]: 'Loading…' }));
    try {
      const x = await liveDocTypeVersion(id, vid);
      setVersions((v) => ({ ...v, [vid]: x }));
    } catch (e) {
      setVersions((v) => ({ ...v, [vid]: errorText(e) }));
    }
  };
  const day = (s?: string | null) => (s ? date(Date.parse(s)) : '');
  return (
    <Modal id="doctypes-dialog" open={open} onClose={onClose} wide title="Document types on MyInvois" sub="What LHDN accepts, and the time limits it applies to each type." foot={<Button onClick={onClose}>Close</Button>}>
      {error ? (
        <Note tone="bad" icon={ic(CircleAlert)}>
          {error}
        </Note>
      ) : !types ? (
        <p className="hint">Asking MyInvois…</p>
      ) : (
        <ul className="related">
          {types.map((ty) => {
            const d = detail[ty.id];
            return (
              <li key={ty.id} style={{ display: 'block' }}>
                <button type="button" className="link-btn strong" aria-expanded={!!d} onClick={() => expand(ty.id)} id={`doctype-${ty.id}`}>
                  {ic(d ? ChevronDown : ChevronRight, 'ico-sm')} {String(ty.invoiceTypeCode).padStart(2, '0')} {ty.description}
                </button>
                <span className="small"> · versions {(ty.documentTypeVersions ?? []).map((v) => v.name).join(', ') || 'none'}</span>
                {typeof d === 'string' && <div className="hint">{d}</div>}
                {d && typeof d !== 'string' && (
                  <div className="stack-sm" style={{ margin: '8px 0 4px 22px' }}>
                    {d.workflowParameters?.length ? (
                      <div className="small">
                        {d.workflowParameters.map((w) => `${WORKFLOW[w.parameter] ?? w.parameter} ${w.value} hours`).join(' · ')}
                      </div>
                    ) : null}
                    {(d.documentTypeVersions ?? []).map((v) => {
                      const full = versions[v.id];
                      return (
                        <div key={v.id} className="small">
                          <span className="strong">Version {v.name}</span>, {v.status}
                          {v.activeFrom ? `, from ${day(v.activeFrom)}` : ''}
                          {v.activeTo ? ` to ${day(v.activeTo)}` : ''}{' '}
                          {!full && (
                            <button type="button" className="link-btn small" onClick={() => version(ty.id, v.id)} id={`doctype-${ty.id}-v${v.id}`}>
                              Details
                            </button>
                          )}
                          {typeof full === 'string' && <span className="hint"> {full}</span>}
                          {full && typeof full !== 'string' && (
                            <span className="hint">
                              {' '}
                              {full.description ?? ''}, version number {full.versionNumber}, {full.status}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}

/** Get Recent Documents: the last 31 days on MyInvois, with the channel each came through. For troubleshooting. */
function RecentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [dir, setDir] = useState<'Sent' | 'Received'>('Sent');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<DocSummary> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let on = true;
    setData(null);
    setError(null);
    liveRecent(dir, page)
      .then((x) => on && setData(x))
      .catch((e) => on && setError(errorText(e)));
    return () => {
      on = false;
    };
  }, [open, dir, page]);
  const pages = data?.metadata?.totalPages ?? 1;
  return (
    <Modal
      id="recent-dialog"
      open={open}
      onClose={onClose}
      wide
      title="Recent on MyInvois"
      sub="Everything MyInvois holds from the last 31 days, whichever system or person sent it. LHDN means this list for troubleshooting."
      foot={<Button onClick={onClose}>Close</Button>}
    >
      <div className="stack">
        <Segmented
          id="recent-dir"
          label="Direction"
          size="sm"
          value={dir}
          options={[
            { value: 'Sent', label: 'Sent' },
            { value: 'Received', label: 'Received' },
          ]}
          onChange={(v) => {
            setDir(v);
            setPage(1);
          }}
        />
        {error ? (
          <Note tone="bad" icon={ic(CircleAlert)}>
            {error}
          </Note>
        ) : !data ? (
          <p className="hint">Asking MyInvois…</p>
        ) : data.result.length ? (
          <div className="tw">
            <table className="tbl">
              <caption className="sr-only">Recent documents</caption>
              <thead>
                <tr>
                  <th scope="col">Number</th>
                  <th scope="col">{dir === 'Sent' ? 'Buyer' : 'Supplier'}</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="hide-sm">Sent through</th>
                  <th scope="col" className="hide-sm">Received by LHDN</th>
                </tr>
              </thead>
              <tbody>
                {data.result.map((d) => (
                  <tr key={d.uuid}>
                    <td>
                      {d.internalId}
                      <span className="cell-sub">{d.typeName}</span>
                    </td>
                    <td>{dir === 'Sent' ? (d.buyerName ?? d.receiverName ?? '') : (d.supplierName ?? d.issuerName ?? '')}</td>
                    <td>{d.status}</td>
                    <td className="hide-sm">
                      {d.submissionChannel ?? ''}
                      {d.intermediaryName && <span className="cell-sub">by {d.intermediaryName}</span>}
                    </td>
                    <td className="hide-sm nw">{d.dateTimeReceived ? dateTime(Date.parse(d.dateTimeReceived)) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="hint">Nothing {dir.toLowerCase()} in the last 31 days.</p>
        )}
        {pages > 1 && (
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)} id="recent-prev">
              Newer
            </Button>
            <span className="small">
              Page {page} of {pages}
            </span>
            <Button size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)} id="recent-next">
              Older
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

function ConnectionPanel() {
  const s = useApp();
  const live = useLive();
  const biz = activeBiz(s);
  const accountant = s.persona === 'accountant';
  const [types, setTypes] = useState<DocumentType[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'types' | 'recent' | null>(null);

  if (s.workspace === 'demo') {
    return (
      <Panel title="MyInvois connection" actions={<Chip tone="info" icon={ic(ShieldCheck, 'ico-sm')}>Simulated</Chip>} pad>
        <div className="stack">
          <p className="hint">
            This demo answers like MyInvois does: it accepts a submission at once, then validates each document a moment later with the same field rules. No LHDN account is
            used and nothing leaves this page.
          </p>
          <dl className="kv">
            <dt>Environment</dt>
            <dd>Sandbox, simulated</dd>
            <dt>Signing in</dt>
            <dd>{accountant ? `As intermediary for ${biz ? biz.short : 'each client'}` : 'As the taxpayer'}</dd>
            <dt>Validation</dt>
            <dd>Asynchronous, about {s.settings.speed === 'quick' ? 'half a second' : 'two seconds'} per document</dd>
          </dl>
          {live?.configured || live?.locked ? (
            <Note tone="info" icon={ic(PlugZap)}>
              The server has a MyInvois {live.env} system set up. Switch to work with your own business on the real API. The demo stays as it is.
              <div style={{ marginTop: 10 }}>
                <Button variant="primary" icon={ic(PlugZap, 'ico-sm')} onClick={() => openWorkspace('live')} id="settings-live">
                  Use MyInvois {live.env}
                </Button>
              </div>
            </Note>
          ) : (
            <>
              <p className="hint">
                To use the real MyInvois, give the server your sandbox client ID and secret: in <span className="mono">.env</span> for{' '}
                <span className="mono">npm run dev</span>, or as environment variables on Vercel. The README explains each setting.
              </p>
              {live?.problems.map((p) => (
                <Note key={p} tone="bad" icon={ic(CircleAlert)}>
                  {p}
                </Note>
              ))}
            </>
          )}
        </div>
      </Panel>
    );
  }

  const ok = !!live?.configured;
  const check = async () => {
    setChecking(true);
    setProblem(null);
    setTypes(null);
    try {
      await refreshLive();
      const list = await checkLive();
      setTypes(list);
      toast('Connected to MyInvois');
    } catch (e) {
      setProblem(errorText(e));
    }
    setChecking(false);
  };
  const who = accountant
    ? live?.intermediary
      ? `As intermediary for ${biz ? biz.name || biz.short : 'each client'}`
      : 'No intermediary system set up'
    : live?.taxpayer
      ? `As the taxpayer${live.taxpayerTin ? `, TIN ${live.taxpayerTin}` : ''}`
      : 'No taxpayer system set up';
  const mismatch = biz ? tinMismatch(biz.id) : null;
  return (
    <Panel
      title="MyInvois connection"
      actions={
        <Chip tone={ok ? 'ok' : 'bad'} icon={ic(ok ? ShieldCheck : TriangleAlert, 'ico-sm')}>
          {!ok ? (live?.locked ? 'Locked' : 'Not set up') : live!.env === 'production' ? 'Production' : 'Sandbox'}
        </Chip>
      }
      pad
    >
      <div className="stack">
        {live === null && <Note tone="bad">The app can't reach its server, so nothing can go to MyInvois. When you run it yourself, start it with npm run dev.</Note>}
        {live?.locked && (
          <Note tone="due" icon={ic(KeyRound)}>
            The server asks for its access key before the app may use MyInvois.
            <div style={{ marginTop: 10 }}>
              <Button variant="primary" icon={ic(KeyRound, 'ico-sm')} onClick={() => askAccessKey()} id="settings-key">
                Enter the access key
              </Button>
            </div>
          </Note>
        )}
        {live && (
          <dl className="kv">
            <dt>Environment</dt>
            <dd>
              {live.env === 'production' ? 'Production' : 'Sandbox (pre-production)'}, <span className="mono">{live.apiHost}</span>
            </dd>
            <dt>Signing in</dt>
            <dd>{who}</dd>
            <dt>Documents</dt>
            <dd>{live.version === '1.1' ? 'Version 1.1, with a digital signature' : 'Version 1.0, without a digital signature'}</dd>
            {live.signing && (
              <>
                <dt>Certificate</dt>
                <dd>
                  {live.signing.organization ?? live.signing.subject}
                  {live.signing.tin ? `, ${live.signing.tin}` : ''}, valid until {date(Date.parse(live.signing.validTo))}
                </dd>
              </>
            )}
            <dt>Portal</dt>
            <dd>
              <a href={live.portalUrl} target="_blank" rel="noreferrer">
                {new URL(live.portalUrl).host}
              </a>
            </dd>
          </dl>
        )}
        {mismatch && (
          <Note tone="bad" icon={ic(TriangleAlert)}>
            {mismatch} Until then LHDN refuses every e-invoice: "The authenticated TIN and documents TIN is not matching".
          </Note>
        )}
        {live?.problems.map((p) => (
          <Note key={p} tone="bad" icon={ic(CircleAlert)}>
            {p}
          </Note>
        ))}
        {problem && (
          <Note tone="bad" icon={ic(CircleAlert)}>
            {problem}
          </Note>
        )}
        {types && (
          <Note tone="ok" icon={ic(ShieldCheck)}>
            Logged in. MyInvois offers {plural(types.length, 'document type')}:{' '}
            {types.map((t) => `${t.description}${t.documentTypeVersions?.length ? ` (${t.documentTypeVersions.map((v) => v.versionNumber).join(', ')})` : ''}`).join(', ')}.
          </Note>
        )}
        <div className="row">
          <Button icon={ic(PlugZap, 'ico-sm')} busy={checking} disabled={!ok} onClick={check} id="settings-check">
            Check the connection
          </Button>
          <Button icon={ic(Layers, 'ico-sm')} disabled={!ok} onClick={() => setDialog('types')} id="settings-types">
            Document types
          </Button>
          <Button icon={ic(History, 'ico-sm')} disabled={!ok} onClick={() => setDialog('recent')} id="settings-recent">
            Recent on MyInvois
          </Button>
          <Button icon={ic(FlaskConical, 'ico-sm')} onClick={() => openWorkspace('demo')} id="settings-demo">
            Back to the demo
          </Button>
        </div>
      </div>
      <DocTypesDialog open={dialog === 'types'} onClose={() => setDialog(null)} />
      <RecentDialog open={dialog === 'recent'} onClose={() => setDialog(null)} />
    </Panel>
  );
}

export function SettingsPage() {
  const s = useApp();
  const biz = activeBiz(s);
  const live = s.workspace === 'live';
  const [editing, setEditing] = useState(false);
  const missing = biz && live ? businessProblems(biz) : [];
  return (
    <>
      <PageHeader title="Settings" sub={biz ? biz.name || biz.short : s.firm.name} />
      <div className="cols">
        <div className="col-main stack">
          {biz ? (
            <Panel
              title="Business"
              sub="What goes on every e-invoice as the supplier."
              actions={
                live ? (
                  <Button size="sm" icon={ic(PencilLine, 'ico-sm')} onClick={() => setEditing(true)} id="biz-edit">
                    Edit details
                  </Button>
                ) : undefined
              }
              pad
            >
              <div className="stack">
                {missing.length > 0 && (
                  <Note tone="due" icon={ic(TriangleAlert)}>
                    Finish the business details before sending anything to LHDN: {missing.map((m) => m.message.replace(/\.$/, '').toLowerCase()).join('; ')}.
                  </Note>
                )}
                <dl className="kv">
                  <dt>Name</dt>
                  <dd>{biz.name || 'Not set'}</dd>
                  <dt>TIN</dt>
                  <dd className="mono">{biz.tin || 'Not set'}</dd>
                  <dt>{ID_LABEL[biz.idType ?? 'BRN']}</dt>
                  <dd className="mono">{biz.brn || 'Not set'}</dd>
                  {live && (
                    <>
                      <dt>SST</dt>
                      <dd className="mono">{biz.sst || 'Not registered'}</dd>
                    </>
                  )}
                  <dt>MSIC code</dt>
                  <dd>{biz.msic ? `${biz.msic}, ${biz.msicName}` : 'Not set'}</dd>
                  <dt>Address</dt>
                  <dd>{biz.address.line1 ? `${biz.address.line1}, ${biz.address.postcode} ${biz.address.city}, ${stateName(biz.address.state)}` : 'Not set'}</dd>
                  <dt>Phone</dt>
                  <dd>{biz.phone || 'Not set'}</dd>
                  <dt>Email</dt>
                  <dd>{biz.email || 'Not set'}</dd>
                  <dt>Rollout phase</dt>
                  <dd>Phase {biz.phase}</dd>
                  <dt>Branches</dt>
                  <dd>{biz.branches.map((b) => `${b.name} (receipts ${b.prefix}…)`).join(', ')}</dd>
                </dl>
              </div>
            </Panel>
          ) : (
            <Panel title="Firm" pad>
              <dl className="kv">
                <dt>Name</dt>
                <dd>{s.firm.name}</dd>
                <dt>TIN</dt>
                <dd className="mono">{s.firm.tin || 'Not set'}</dd>
                <dt>Signed in as</dt>
                <dd>
                  {s.firm.user.name}, {s.firm.user.role}
                </dd>
                <dt>Clients</dt>
                <dd>{s.clients.length}</dd>
              </dl>
            </Panel>
          )}

          <ConnectionPanel />

          {biz && (
            <Panel title="Receipt QR codes" sub="Printed on every receipt. Scanning one opens the buyer's request page with the sale filled in.">
              <div className="pad" style={{ paddingTop: 0 }}>
                <div className="qr-grid">
                  {biz.branches.map((b) => (
                    <figure key={b.id} className="qr-card">
                      <QR text={`SAHKAN DEMO receipt QR for ${biz.short}, ${b.name}. Sample only.`} size={120} label={`Sample receipt QR code for ${b.name}`} />
                      <figcaption>
                        <span className="strong" style={{ display: 'block' }}>{b.name}</span>
                        <span className="small">Receipts {b.prefix}…</span>
                      </figcaption>
                    </figure>
                  ))}
                </div>
                <Button icon={ic(Smartphone, 'ico-sm')} onClick={() => navigate({ name: 'buyer' })} id="settings-buyer">
                  See the buyer's page
                </Button>
              </div>
            </Panel>
          )}
        </div>

        <div className="col-side stack">
          {biz && (
            <section className="panel pad stack" aria-label="Buyer requests">
              <h2 className="h2">Buyer requests</h2>
              <Switch
                id="settings-auto"
                checked={s.settings.autoIssue}
                onChange={(v) => setSettings({ autoIssue: v })}
                label="Issue automatically"
                hint="When the buyer's TIN checks out, the e-invoice goes to LHDN without waiting for you."
              />
            </section>
          )}
          {!live && (
            <section className="panel pad stack" aria-label="Demo controls">
              <h2 className="h2">Demo controls</h2>
              <div className="field">
                <span className="label" id="speed-label">
                  LHDN answer speed
                </span>
                <Segmented
                  id="settings-speed"
                  label="LHDN answer speed"
                  value={s.settings.speed}
                  options={[
                    { value: 'realistic', label: 'Realistic' },
                    { value: 'quick', label: 'Quick' },
                  ]}
                  onChange={(v) => setSettings({ speed: v })}
                />
              </div>
              <Switch
                id="settings-reject"
                checked={s.settings.rejectNext}
                onChange={(v) => setSettings({ rejectNext: v })}
                label="Reject the next e-invoice"
                hint="See what a rejection looks like. It switches itself off after one use."
              />
              <p className="hint">To start over, use Reset in the bar at the top.</p>
            </section>
          )}
        </div>
      </div>
      {biz && live && <BusinessDialog biz={biz} open={editing} onClose={() => setEditing(false)} />}
    </>
  );
}
