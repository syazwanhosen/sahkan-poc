import { useMemo, useState } from 'react';
import { CircleAlert, CircleCheck, Info, Plus, Send, Trash2, UserPlus, Users } from 'lucide-react';
import type { Business, Doc, DocType, Line, Party, State, TinStatus } from '../types';
import { CANCEL_WINDOW, MIN, now } from '../lib/clock';
import { CLASSIFICATIONS, DOC_LABEL, GENERAL_PUBLIC_CLASS, GENERAL_PUBLIC_TIN, RM10K, TAX_TYPES, businessProblems, lineAmount, totals } from '../lib/rules';
import { ago, dateTime, fromLocalInput, initials, plural, rm, rmx, time, toLocalInput } from '../lib/format';
import { uid } from '../lib/ids';
import { GENERAL_PUBLIC, partyOf } from '../data/seed';
import { getState, useApp } from '../state/store';
import { back, navigate } from '../state/nav';
import { EMPTY_PARTY, addBuyer, peekNumber, saveDoc, submitDocs, tinMismatch, verifyTin, type Draft } from '../state/actions';
import { useLive } from '../state/live';
import { toast } from '../state/toast';
import { PartyFields, TinChip, problemsOf, type Problem } from '../party';
import { Avatar, Button, Chip, Combobox, Field, Input, Note, NumInput, PageHeader, Panel, Segmented, Select, cx, ic, useNow } from '../ui';
import { useBizOf } from './common';

const emptyLine = (): Line => ({ id: uid('ln'), desc: '', cls: '', qty: 1, price: 0, tax: '06' });

const FIELD_NAME: Record<string, string> = {
  name: 'name',
  phone: 'phone number',
  email: 'email',
  postcode: 'postcode',
  address: 'address',
  idValue: 'ID number',
};

interface Init {
  draft: Draft;
  editing?: Doc;
  fixing: boolean;
  savedAt?: number;
  serverErrs: Record<string, Problem>;
}

function initialDraft(s: State, biz: Business, o: { type?: DocType; fromId?: string; editId?: string; buyerId?: string }): Init {
  const t = now();
  const doc = o.editId ? s.docs.find((x) => x.id === o.editId) : undefined;
  if (doc && (doc.status === 'draft' || doc.status === 'invalid')) {
    const serverErrs: Record<string, Problem> = {};
    for (const e of doc.errors ?? []) if (e.field === 'idValue') serverErrs.idValue = { message: e.message };
    return {
      draft: {
        id: doc.id,
        type: doc.type,
        number: doc.number,
        numberTouched: true,
        branchId: doc.branchId,
        issuedAt: doc.issuedAt,
        issuedAuto: false,
        buyerId: doc.buyerId,
        buyer: partyOf(doc.buyer),
        tinStatus: doc.tinStatus,
        lines: doc.lines.map((l) => ({ ...l })),
        refId: doc.refId,
        saveBuyer: true,
      },
      editing: doc,
      fixing: doc.status === 'invalid',
      savedAt: doc.status === 'draft' ? doc.events[doc.events.length - 1]?.t : undefined,
      serverErrs,
    };
  }
  const ref = o.fromId ? s.docs.find((x) => x.id === o.fromId) : undefined;
  if (ref) {
    const type = o.type ?? '02';
    return {
      draft: {
        type,
        number: peekNumber(s, biz.id, type),
        numberTouched: false,
        branchId: ref.branchId,
        issuedAt: t,
        issuedAuto: true,
        buyerId: ref.buyerId,
        buyer: partyOf(ref.buyer),
        tinStatus: ref.tinStatus,
        lines: ref.lines.map((l) => ({ ...l, id: uid('ln') })),
        refId: ref.id,
        saveBuyer: false,
      },
      fixing: false,
      serverErrs: {},
    };
  }
  const type = o.type ?? '01';
  const b = o.buyerId ? s.buyers.find((x) => x.id === o.buyerId) : undefined;
  return {
    draft: {
      type,
      number: peekNumber(s, biz.id, type),
      numberTouched: false,
      branchId: biz.branches[0].id,
      issuedAt: t,
      issuedAuto: true,
      buyerId: b?.id,
      buyer: b ? partyOf(b) : undefined,
      tinStatus: b?.tinStatus ?? 'unchecked',
      checkedAt: b?.checkedAt,
      lines: [emptyLine()],
      saveBuyer: true,
    },
    fixing: false,
    serverErrs: {},
  };
}

interface Check {
  key: string;
  ok: boolean;
  title: string;
  sub?: string;
  fix?: { label: string; run: () => void };
}

export function ComposePage(props: { type?: DocType; fromId?: string; editId?: string; buyerId?: string }) {
  const s = useApp();
  const biz = useBizOf(s);
  const live = useLive();
  const t = useNow(20_000);
  const init = useMemo(() => initialDraft(getState(), biz, props), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [d, setD] = useState<Draft>(init.draft);
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [showAll, setShowAll] = useState(init.fixing);
  const [savedAt, setSavedAt] = useState(init.savedAt);
  const [serverErrs, setServerErrs] = useState(init.serverErrs);
  const [detailsOpen, setDetailsOpen] = useState(() => !!init.draft.buyer && (!init.draft.buyerId || Object.keys(problemsOf(init.draft.buyer)).length > 0 || init.fixing));
  const [tinBusy, setTinBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const editing = init.editing;

  const buyers = useMemo(() => s.buyers.filter((b) => b.bizId === biz.id), [s.buyers, biz.id]);
  const items = useMemo(() => s.items.filter((i) => i.bizId === biz.id), [s.items, biz.id]);
  const originals = useMemo(
    () =>
      s.docs
        .filter((x) => x.bizId === biz.id && x.type === '01' && x.status === 'valid' && !x.consolidated)
        .sort((a, b) => b.issuedAt - a.issuedAt)
        .slice(0, 60),
    [s.docs, biz.id],
  );
  const ref = d.refId ? s.docs.find((x) => x.id === d.refId) : undefined;
  const number = d.numberTouched ? d.number : peekNumber(s, biz.id, d.type);
  const issued = d.issuedAuto ? t : d.issuedAt;
  const buyer = d.buyer;
  const general = buyer?.kind === 'general';
  const probs = buyer && !general ? problemsOf(buyer) : {};
  const sums = totals(d.lines);
  const isNote = d.type !== '01';

  const show = (f: string) => showAll || touched.has(f) || !!d.buyerId;
  const touch = (f: string) => setTouched((x) => (x.has(f) ? x : new Set(x).add(f)));
  const setBuyer = (p: Party) => {
    setD((x) => ({ ...x, buyer: p }));
    setServerErrs((e) => {
      if (!e.idValue || !buyer || (p.idValue === buyer.idValue && p.tin === buyer.tin)) return e;
      const { idValue: _gone, ...rest } = e;
      return rest;
    });
  };
  const setTin = (st: TinStatus, at?: number) => setD((x) => ({ ...x, tinStatus: st, checkedAt: at ?? x.checkedAt }));
  const setLine = (id: string, patch: Partial<Line>) => setD((x) => ({ ...x, lines: x.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
  const removeLine = (id: string) => setD((x) => ({ ...x, lines: x.lines.length > 1 ? x.lines.filter((l) => l.id !== id) : [emptyLine()] }));

  const pickBuyer = (p: Party, buyerId: string | undefined, tinStatus: TinStatus, checkedAt?: number) => {
    setD((x) => ({ ...x, buyer: partyOf(p), buyerId, tinStatus, checkedAt, saveBuyer: true }));
    setTouched(new Set());
    setServerErrs({});
    setDetailsOpen(!buyerId || Object.keys(problemsOf(p)).length > 0);
  };

  const checkTinNow = async () => {
    if (!buyer) return;
    setTinBusy(true);
    const r = await verifyTin(buyer);
    setTinBusy(false);
    setTin(r, now());
    if (r === 'verified') toast(`TIN ${buyer.tin.toUpperCase()} matched with LHDN`);
  };

  // The same checks MyInvois runs, before anything is sent.
  const checks: Check[] = [];
  // Live, your own business is the supplier on the document, and MyInvois rejects gaps there too.
  const bizGaps = s.workspace === 'live' ? businessProblems(biz) : [];
  const mismatch = live?.taxpayerTin ? tinMismatch(biz.id) : null;
  if (mismatch) {
    checks.push({ key: 'login', ok: false, title: "Your MyInvois login is for another TIN", sub: mismatch, fix: { label: 'Open settings', run: () => navigate({ name: 'settings' }) } });
  }
  if (bizGaps.length) {
    checks.push({
      key: 'supplier',
      ok: false,
      title: 'Finish your business details',
      sub: bizGaps[0].message,
      fix: { label: 'Open settings', run: () => navigate({ name: 'settings' }) },
    });
  }
  if (!buyer) {
    checks.push({ key: 'buyer', ok: false, title: 'Choose a buyer', sub: 'Or use General public for a walk-in sale.' });
  } else if (general) {
    checks.push({ key: 'tin', ok: true, title: 'General public TIN', sub: `${GENERAL_PUBLIC_TIN}, for buyers with no TIN` });
  } else {
    const tp = probs.tin;
    if (tp) {
      checks.push({
        key: 'tin',
        ok: false,
        title: 'Buyer TIN needs fixing',
        sub: tp.message,
        fix: tp.fix
          ? {
              label: `Use ${tp.fix}`,
              run: () => {
                setBuyer({ ...buyer, tin: tp.fix! });
                setTin('unchecked');
              },
            }
          : undefined,
      });
    } else if (d.tinStatus === 'verified') {
      checks.push({ key: 'tin', ok: true, title: 'Buyer TIN verified', sub: d.checkedAt ? `Matched with LHDN ${ago(d.checkedAt, t)}` : 'Matched with LHDN' });
    } else if (d.tinStatus === 'not-found') {
      checks.push({ key: 'tin', ok: false, title: 'LHDN has no record of this TIN', sub: 'Check the number with the buyer.' });
    } else {
      checks.push({ key: 'tin', ok: false, title: 'Check the TIN with LHDN', sub: 'A wrong TIN is the most common rejection.', fix: { label: 'Check', run: checkTinNow } });
    }
    const other = Object.entries(probs).filter(([f]) => f !== 'tin');
    if (other.length) {
      const [f, p] = other[0];
      checks.push({
        key: 'details',
        ok: false,
        title: other.length === 1 ? `Buyer ${FIELD_NAME[f] ?? f} needs fixing` : `${other.length} buyer details need fixing`,
        sub: p.message,
        fix: p.fix
          ? { label: 'Fix', run: () => setBuyer({ ...buyer, phone: p.fix! }) }
          : {
              label: 'Show',
              run: () => {
                setDetailsOpen(true);
                setShowAll(true);
                setTimeout(() => document.getElementById(`cb-${f === 'idValue' ? 'id' : f === 'address' ? 'addr' : f}`)?.focus(), 30);
              },
            },
      });
    } else {
      checks.push({ key: 'details', ok: true, title: 'Buyer details complete', sub: 'Name, ID, phone and address' });
    }
  }
  const n = d.lines.length;
  const withCls = d.lines.filter((l) => l.cls).length;
  checks.push({ key: 'cls', ok: withCls === n && n > 0, title: 'Every item has a classification', sub: `${withCls} of ${plural(n, 'item')}` });
  if (general && d.lines.some((l) => l.cls !== GENERAL_PUBLIC_CLASS)) {
    checks.push({
      key: 'gp-cls',
      ok: false,
      title: `General public needs classification ${GENERAL_PUBLIC_CLASS}`,
      sub: 'LHDN accepts the general-public TIN only on consolidated (004) lines. For anything else, use the buyer\'s own TIN.',
      fix: { label: `Use ${GENERAL_PUBLIC_CLASS}`, run: () => setD((x) => ({ ...x, lines: x.lines.map((l) => ({ ...l, cls: GENERAL_PUBLIC_CLASS })) })) },
    });
  }
  const unfinished = d.lines.filter((l) => !l.desc.trim() || !(l.qty > 0) || !(l.price > 0)).length;
  checks.push({
    key: 'items',
    ok: unfinished === 0 && sums.total > 0,
    title: 'Every item has a description and price',
    sub: unfinished ? `${plural(unfinished, 'item')} to finish` : `Total ${rmx(sums.total)}`,
  });
  const late = t - issued > CANCEL_WINDOW;
  const future = issued > t + 5 * MIN;
  checks.push({
    key: 'date',
    ok: !late && !future,
    title: late ? 'Issue date is more than 72 hours ago' : future ? 'Issue date is in the future' : 'Issue date is in the window',
    sub: late || future ? 'LHDN takes e-invoices issued in the last 72 hours.' : d.issuedAuto ? 'Set to the moment you submit' : `Submit before ${dateTime(issued + CANCEL_WINDOW)}`,
    fix: late || future ? { label: 'Use now', run: () => setD((x) => ({ ...x, issuedAuto: true })) } : undefined,
  });
  if (isNote) {
    checks.push({
      key: 'ref',
      ok: !!ref,
      title: ref ? `Refers to ${ref.number}` : 'Choose the original e-invoice',
      sub: ref ? `${ref.buyer.name}, ${rmx(totals(ref.lines).total)}` : `A ${DOC_LABEL[d.type].toLowerCase()} must point to the e-invoice it changes.`,
    });
    if (ref && (d.type === '02' || d.type === '04')) {
      const max = totals(ref.lines).total;
      checks.push({ key: 'max', ok: sums.total <= max + 0.001, title: 'Not more than the original', sub: `Up to ${rmx(max)}` });
    }
  }
  const failing = checks.filter((c) => !c.ok);
  const passed = checks.length - failing.length;
  const big = d.type === '01' && sums.total > RM10K;

  const persistBuyer = (): string | undefined => {
    if (d.buyerId || !buyer || general || !d.saveBuyer) return d.buyerId;
    return addBuyer(biz.id, buyer, d.tinStatus);
  };

  const saveDraft = () => {
    const buyerId = persistBuyer();
    const id = saveDoc(biz.id, { ...d, buyerId, number });
    const saved = getState().docs.find((x) => x.id === id);
    setD((x) => ({ ...x, id, buyerId, number: saved?.number ?? number, numberTouched: true }));
    setSavedAt(now());
    toast(`Draft ${saved?.number ?? number} saved`);
  };

  const submit = () => {
    setShowAll(true);
    if (failing.length) {
      toast(`Fix ${plural(failing.length, 'issue')} first`, { tone: 'info' });
      return;
    }
    setBusy(true);
    const buyerId = persistBuyer();
    const id = saveDoc(biz.id, { ...d, buyerId, number, issuedAt: d.issuedAuto ? now() : d.issuedAt });
    submitDocs([id]);
    navigate({ name: 'doc', id }, { replace: true });
  };

  const title = editing
    ? init.fixing
      ? `Fix ${editing.number}`
      : `Edit ${editing.number}`
    : isNote
      ? `New ${DOC_LABEL[d.type].toLowerCase()}`
      : 'New e-invoice';

  const submitLabel = failing.length ? `Fix ${plural(failing.length, 'issue')} to submit` : editing?.status === 'invalid' ? 'Submit again' : 'Submit to LHDN';

  return (
    <>
      <PageHeader
        crumb={{ label: 'E-invoices', onClick: () => back({ name: 'invoices' }) }}
        title={title}
        sub={savedAt ? `Draft saved at ${time(savedAt)}` : editing && init.fixing ? `Rejected by LHDN. Nothing was filed yet.` : `${biz.name}`}
        actions={
          <>
            <Button onClick={saveDraft} id="compose-save" disabled={busy}>
              Save draft
            </Button>
            <Button variant="primary" icon={ic(Send, 'ico-sm')} onClick={submit} busy={busy} aria-disabled={failing.length > 0} id="compose-submit">
              {failing.length ? 'Submit to LHDN' : submitLabel}
            </Button>
          </>
        }
      />

      {init.fixing && editing?.errors?.length ? (
        <Note tone="bad" icon={ic(CircleAlert)}>
          <div className="strong">LHDN said:</div>
          <ul className="plain-list">
            {editing.errors.map((e, i) => (
              <li key={i}>{e.message}</li>
            ))}
          </ul>
          <div style={{ marginTop: 6 }}>The fields to fix are marked below. Submitting again sends the corrected e-invoice with the same number.</div>
        </Note>
      ) : null}

      <div className="cols">
        <div className="col-main stack">
          {!editing && (
            <Segmented
              id="doc-type"
              label="Document type"
              value={d.type}
              options={(['01', '02', '03', '04'] as DocType[]).map((v) => ({ value: v, label: DOC_LABEL[v] }))}
              onChange={(v) => setD((x) => ({ ...x, type: v, refId: v === '01' ? undefined : x.refId }))}
            />
          )}

          {isNote && (
            <Panel title="Original e-invoice" sub="The validated e-invoice this note changes." pad>
              <Field label="E-invoice" htmlFor="compose-ref" error={showAll && !ref ? 'Choose the original e-invoice.' : undefined}>
                <Select
                  id="compose-ref"
                  value={d.refId ?? ''}
                  invalid={showAll && !ref}
                  onChange={(e) => {
                    const r = s.docs.find((x) => x.id === e.target.value);
                    setD((x) => {
                      const blank = x.lines.every((l) => !l.desc && !l.price);
                      return {
                        ...x,
                        refId: r?.id,
                        buyer: x.buyer ?? (r ? partyOf(r.buyer) : undefined),
                        buyerId: x.buyer ? x.buyerId : r?.buyerId,
                        tinStatus: x.buyer ? x.tinStatus : (r?.tinStatus ?? 'unchecked'),
                        branchId: r?.branchId ?? x.branchId,
                        lines: blank && r ? r.lines.map((l) => ({ ...l, id: uid('ln') })) : x.lines,
                      };
                    });
                  }}
                >
                  <option value="">Choose an e-invoice</option>
                  {ref && !originals.includes(ref) && <option value={ref.id}>{ref.number}</option>}
                  {originals.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.number}, {o.buyer.name}, RM {rm(totals(o.lines).total)}
                    </option>
                  ))}
                </Select>
              </Field>
            </Panel>
          )}

          <Panel
            title="Buyer"
            actions={
              buyer && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={ic(Users, 'ico-sm')}
                  onClick={() => setD((x) => ({ ...x, buyer: undefined, buyerId: undefined, tinStatus: 'unchecked' }))}
                  id="compose-change-buyer"
                >
                  Change buyer
                </Button>
              )
            }
          >
            <div className="pad stack" style={{ paddingTop: 0 }}>
              {!buyer ? (
                <Field label="Find a buyer" htmlFor="buyer-search" hint={`${buyers.length} saved buyers. Search by name or TIN.`} error={showAll ? 'Choose a buyer first.' : undefined}>
                  <Combobox
                    id="buyer-search"
                    label="Find a buyer"
                    placeholder="Type a name or TIN"
                    items={buyers}
                    getKey={(b) => b.id}
                    filter={(b, q) => !q || b.name.toLowerCase().includes(q) || b.tin.toLowerCase().includes(q)}
                    render={(b) => (
                      <>
                        <Avatar initials={initials(b.name)} tone={b.kind === 'individual' ? 1 : 0} round={b.kind === 'individual'} />
                        <span className="grow">
                          <span className="strong" style={{ display: 'block' }}>{b.name}</span>
                          <span className="small mono">{b.tin}</span>
                        </span>
                        {b.tinStatus !== 'verified' && <TinChip status={b.tinStatus} />}
                      </>
                    )}
                    onPick={(b) => pickBuyer(b, b.id, b.tinStatus, b.checkedAt)}
                    extra={[
                      {
                        key: 'new',
                        render: (
                          <>
                            <span className="icon-box tone-0" style={{ width: 34, height: 34 }}>{ic(UserPlus, 'ico-sm')}</span>
                            <span className="strong">New buyer</span>
                          </>
                        ),
                        onPick: () => pickBuyer({ ...EMPTY_PARTY, address: { ...EMPTY_PARTY.address } }, undefined, 'unchecked'),
                      },
                      {
                        key: 'general',
                        render: (
                          <>
                            <span className="icon-box tone-4" style={{ width: 34, height: 34 }}>{ic(Users, 'ico-sm')}</span>
                            <span className="grow">
                              <span className="strong" style={{ display: 'block' }}>General public</span>
                              <span className="small">Walk-in sale, the buyer gave no details</span>
                            </span>
                          </>
                        ),
                        onPick: () => pickBuyer(GENERAL_PUBLIC, undefined, 'verified'),
                      },
                    ]}
                  />
                </Field>
              ) : general ? (
                <div className="buyer-card">
                  <span className="icon-box tone-4">{ic(Users)}</span>
                  <div className="grow">
                    <div className="strong">General public</div>
                    <div className="hint mono">TIN {GENERAL_PUBLIC_TIN}</div>
                    <div className="hint">For a sale where the buyer gives no details. Most walk-in sales go into the monthly consolidated e-invoice instead.</div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="buyer-card">
                    <Avatar initials={initials(buyer.name || '?')} tone={buyer.kind === 'individual' ? 1 : 0} lg round={buyer.kind === 'individual'} />
                    <div className="grow">
                      <div className="strong">{buyer.name || 'New buyer'}</div>
                      <div className="hint mono">
                        TIN {buyer.tin || '—'}
                        {buyer.idValue ? `, ${buyer.idType === 'NRIC' ? 'MyKad' : buyer.idType} ${buyer.idValue}` : ''}
                      </div>
                    </div>
                    <TinChip status={d.tinStatus} />
                  </div>
                  {!detailsOpen ? (
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <span className="hint">
                        {buyer.email || 'No email'} · {buyer.phone || 'No phone'} · {buyer.address.city || 'No address'}
                      </span>
                      <button type="button" className="link-btn small" onClick={() => setDetailsOpen(true)} id="compose-edit-buyer">
                        Edit details
                      </button>
                    </div>
                  ) : (
                    <>
                      <PartyFields idp="cb" party={buyer} onChange={setBuyer} tinStatus={d.tinStatus} onTinStatus={setTin} show={show} touch={touch} extra={serverErrs} />
                      <label className="check" htmlFor="compose-savebuyer">
                        <input id="compose-savebuyer" type="checkbox" checked={d.saveBuyer} onChange={(e) => setD((x) => ({ ...x, saveBuyer: e.target.checked }))} />
                        {d.buyerId ? 'Update this buyer in Buyers too' : 'Save this buyer to Buyers'}
                      </label>
                    </>
                  )}
                </>
              )}
            </div>
          </Panel>

          <Panel title={`${DOC_LABEL[d.type]} details`} pad>
            <div className="form-grid">
              <Field label={`${DOC_LABEL[d.type]} number`} htmlFor="compose-number" hint={d.numberTouched ? undefined : 'Next in your series'}>
                <Input
                  id="compose-number"
                  value={number}
                  readOnly={!!editing}
                  onChange={(e) => setD((x) => ({ ...x, number: e.target.value, numberTouched: true }))}
                />
              </Field>
              <Field
                label="Issue date"
                htmlFor="compose-issued"
                hint={d.issuedAuto ? 'The moment you submit' : undefined}
                action={
                  !d.issuedAuto && (
                    <button type="button" className="link-btn small" onClick={() => setD((x) => ({ ...x, issuedAuto: true }))}>
                      Use now
                    </button>
                  )
                }
                error={showAll && (late || future) ? 'LHDN takes e-invoices issued in the last 72 hours.' : undefined}
              >
                <Input
                  id="compose-issued"
                  type="datetime-local"
                  value={toLocalInput(issued)}
                  invalid={showAll && (late || future)}
                  onChange={(e) => {
                    const v = fromLocalInput(e.target.value);
                    if (v) setD((x) => ({ ...x, issuedAt: v, issuedAuto: false }));
                  }}
                />
              </Field>
              <Field label="Branch" htmlFor="compose-branch">
                <Select id="compose-branch" value={d.branchId} onChange={(e) => setD((x) => ({ ...x, branchId: e.target.value }))}>
                  {biz.branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Currency" htmlFor="compose-currency">
                <Input id="compose-currency" value="MYR, Malaysian ringgit" readOnly />
              </Field>
            </div>
          </Panel>

          <Panel
            title="Items"
            actions={
              <Button size="sm" icon={ic(Plus, 'ico-sm')} onClick={() => setD((x) => ({ ...x, lines: [...x.lines, emptyLine()] }))} id="compose-add-line">
                Add item
              </Button>
            }
          >
            <div className="lines">
            <div className="lines-head" aria-hidden="true">
              <span>Item</span>
              <span>Classification</span>
              <span>Qty</span>
              <span>Unit price (RM)</span>
              <span>Tax</span>
              <span style={{ textAlign: 'right' }}>Amount (RM)</span>
              <span />
            </div>
            {d.lines.map((l, i) => {
              const clsBad = !l.cls && (showAll || touched.has(`cls-${l.id}`));
              return (
                <div className="line-row" key={l.id}>
                  <div className="lr-desc">
                    <label className="line-label" htmlFor={`ln-${l.id}-desc`}>
                      Item {i + 1}
                    </label>
                    <Combobox
                      id={`ln-${l.id}-desc`}
                      label={`Item ${i + 1} description`}
                      placeholder="Search your items or type"
                      items={items}
                      getKey={(it) => it.id}
                      filter={(it, q) => !q || it.name.toLowerCase().includes(q) || it.sku.toLowerCase().includes(q)}
                      render={(it) => (
                        <>
                          <span className="grow">
                            <span className="strong" style={{ display: 'block' }}>{it.name}</span>
                            <span className="small">
                              SKU {it.sku} · {it.cls}
                            </span>
                          </span>
                          <span className="num small strong">{rm(it.price)}</span>
                        </>
                      )}
                      onPick={(it) => setLine(l.id, { desc: it.name, cls: it.cls, price: it.price, tax: it.tax })}
                      value={l.desc}
                      onChange={(v) => setLine(l.id, { desc: v })}
                      invalid={showAll && !l.desc.trim()}
                      maxItems={6}
                    />
                  </div>
                  <div className="lr-cls">
                    <label className="line-label" htmlFor={`ln-${l.id}-cls`}>
                      Classification
                    </label>
                    <Select
                      id={`ln-${l.id}-cls`}
                      value={l.cls}
                      invalid={clsBad}
                      aria-label={`Item ${i + 1} classification`}
                      onChange={(e) => setLine(l.id, { cls: e.target.value })}
                      onBlur={() => touch(`cls-${l.id}`)}
                    >
                      <option value="">Choose a code</option>
                      {CLASSIFICATIONS.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.code} {c.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="lr-qty">
                    <label className="line-label" htmlFor={`ln-${l.id}-qty`}>
                      Qty
                    </label>
                    <NumInput id={`ln-${l.id}-qty`} value={l.qty} onChange={(v) => setLine(l.id, { qty: v })} label={`Item ${i + 1} quantity`} invalid={showAll && !(l.qty > 0)} />
                  </div>
                  <div className="lr-price">
                    <label className="line-label" htmlFor={`ln-${l.id}-price`}>
                      Unit price (RM)
                    </label>
                    <NumInput id={`ln-${l.id}-price`} value={l.price} onChange={(v) => setLine(l.id, { price: v })} label={`Item ${i + 1} unit price`} invalid={showAll && !(l.price > 0)} />
                  </div>
                  <div className="lr-tax">
                    <label className="line-label" htmlFor={`ln-${l.id}-tax`}>
                      Tax
                    </label>
                    <Select id={`ln-${l.id}-tax`} value={l.tax} aria-label={`Item ${i + 1} tax`} onChange={(e) => setLine(l.id, { tax: e.target.value as Line['tax'] })}>
                      {TAX_TYPES.map((x) => (
                        <option key={x.code} value={x.code}>
                          {x.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="line-amt">
                    <span className="line-label">Amount (RM)</span>
                    {rm(lineAmount(l))}
                  </div>
                  <div className="lr-del">
                    <Button size="sm" variant="ghost" aria-label={`Remove item ${i + 1}`} onClick={() => removeLine(l.id)} icon={ic(Trash2, 'ico-sm')} />
                  </div>
                </div>
              );
            })}
            </div>
            <div className="pad stack" style={{ paddingTop: 18 }}>
              {big && (
                <Note tone="info" icon={ic(Info)}>
                  This sale is above RM10,000. It gets its own e-invoice and stays out of the monthly consolidated e-invoice.
                </Note>
              )}
              <dl className="sum">
                <dt>Subtotal</dt>
                <dd className="num">{rm(sums.subtotal)}</dd>
                <dt>Tax</dt>
                <dd className="num">{rm(sums.tax)}</dd>
                <dt className="sum-total">{d.type === '02' ? 'Credit total' : d.type === '04' ? 'Refund total' : 'Total'}</dt>
                <dd className="sum-total num">{rmx(sums.total)}</dd>
              </dl>
            </div>
          </Panel>
        </div>

        <div className="col-side">
          <Panel title="Before you submit" sub="The same checks LHDN runs." className="sticky">
            <div className="pad stack" style={{ paddingTop: 0 }}>
              <div className="stack-sm">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="small strong" style={{ color: 'var(--ink-2)' }}>
                    {passed} of {checks.length} checks passed
                  </span>
                </div>
                <div className="progress">
                  <div style={{ width: `${(passed / checks.length) * 100}%`, background: failing.length ? 'var(--due)' : 'var(--brand)' }} />
                </div>
              </div>
              <ul className="checks" aria-label="Checks">
                {checks.map((c) => (
                  <li key={c.key} className={cx('check-row', !c.ok && 'check-bad')}>
                    {ic(c.ok ? CircleCheck : CircleAlert, 'ico check-ico')}
                    <div className="grow">
                      <div className="strong">{c.title}</div>
                      {c.sub && <div className="hint">{c.sub}</div>}
                      {c.fix && (
                        <Button size="sm" className="check-fix" onClick={c.fix.run} busy={c.key === 'tin' && tinBusy} id={`check-${c.key}-fix`}>
                          {c.fix.label}
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
                {big && (
                  <li className="check-row check-info">
                    {ic(Info, 'ico check-ico')}
                    <div className="grow">
                      <div className="strong">Goes out on its own</div>
                      <div className="hint">Total is above RM10,000</div>
                    </div>
                  </li>
                )}
              </ul>
              <div className="divider" />
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="strong">Total</span>
                <span className="strong num" style={{ fontSize: 18 }}>{rmx(sums.total)}</span>
              </div>
              <Button variant="primary" size="lg" block icon={failing.length ? undefined : ic(Send)} onClick={submit} busy={busy} aria-disabled={failing.length > 0} id="compose-submit-side">
                {submitLabel}
              </Button>
              {failing.length > 0 && <Chip tone="due">Nothing is sent until every check passes</Chip>}
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
