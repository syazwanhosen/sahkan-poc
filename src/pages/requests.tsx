import { useMemo, useState } from 'react';
import { BadgeCheck, Check, CircleCheck, Inbox, Lock, QrCode, ReceiptText, ScanLine, Smartphone, Store, TriangleAlert, WandSparkles } from 'lucide-react';
import type { BuyerRequest, Party, RequestItem } from '../types';
import { MIN, PERIOD, now } from '../lib/clock';
import { STATES, checkEmail, checkMykad, checkPhone, checkPostcode, checkTin, clsLabel } from '../lib/rules';
import { ago, dateTime, initials, rm, rmx, time } from '../lib/format';
import { useApp } from '../state/store';
import { navigate } from '../state/nav';
import { branchName } from '../state/select';
import { createRequest, declineRequest, issueRequest, setSettings, verifyTin } from '../state/actions';
import { toast } from '../state/toast';
import { Avatar, Button, Chip, Empty, Field, Input, Modal, Note, PageHeader, Panel, Segmented, Select, StatusChip, Switch, Textarea, cx, ic, useNow } from '../ui';
import { useBizOf } from './common';

const reqTotal = (items: RequestItem[]) => items.reduce((a, i) => a + i.qty * i.price, 0);

function RequestCard({ r }: { r: BuyerRequest }) {
  const s = useApp();
  const biz = useBizOf(s);
  const t = useNow(30_000);
  const [declining, setDeclining] = useState(false);
  const tin = checkTin(r.buyer.tin);
  const run = s.runs.find((x) => x.bizId === r.bizId && x.branchId === r.branchId && x.period === PERIOD);
  const october = new Date(r.receiptAt + 8 * 3_600_000).getUTCMonth() === 9;
  const issue = (fixed?: string) => {
    const id = issueRequest(r.id, fixed);
    if (id) toast(`E-invoice sent to LHDN for ${r.buyer.name}`, { action: { label: 'View', run: () => navigate({ name: 'doc', id }) } });
  };
  return (
    <li className={cx('req', r.fresh && 'fresh')}>
      <div className="req-who">
        <Avatar initials={initials(r.buyer.name)} tone={1} round />
        <div className="grow">
          <div className="strong">{r.buyer.name}</div>
          <div className="small mono">TIN {r.buyer.tin}</div>
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            {tin.ok ? <Chip tone="ok" icon={ic(BadgeCheck, 'ico-sm')}>TIN format OK</Chip> : <Chip tone="bad" icon={ic(TriangleAlert, 'ico-sm')}>TIN needs fixing</Chip>}
            <Chip tone="mute" icon={ic(r.channel === 'counter' ? Store : QrCode, 'ico-sm')}>
              {r.channel === 'counter' ? 'At the counter' : 'Receipt QR'}
            </Chip>
          </div>
        </div>
      </div>
      <div className="req-what">
        <div className="small">
          Receipt <span className="strong mono">{r.receiptNo}</span> · {branchName(biz, r.branchId)} · {dateTime(r.receiptAt)}
        </div>
        <ul className="req-items">
          {r.items.map((i, k) => (
            <li key={k}>
              <span className="grow">
                {i.qty > 1 ? `${i.qty} × ` : ''}
                {i.desc}
              </span>
              <span className="num">{rm(i.qty * i.price)}</span>
            </li>
          ))}
        </ul>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="small">Asked {ago(r.requestedAt, t)}</span>
          <span className="strong num">{rmx(reqTotal(r.items))}</span>
        </div>
        {october && run && run.stage !== 'done' && <div className="small t-due">October sale: issue it before you file month-end, so it isn't counted twice.</div>}
      </div>
      {!tin.ok && (
        <Note tone="due" icon={ic(TriangleAlert)} className="req-note">
          {tin.message}
          {tin.fix && (
            <>
              {' '}
              The right number is probably <span className="mono strong">{tin.fix}</span>.
            </>
          )}
        </Note>
      )}
      <div className="req-act">
        {tin.ok ? (
          <Button variant="primary" icon={ic(Check, 'ico-sm')} onClick={() => issue()} id={`req-issue-${r.id}`}>
            Issue e-invoice
          </Button>
        ) : tin.fix ? (
          <Button variant="primary" icon={ic(WandSparkles, 'ico-sm')} onClick={() => issue(tin.fix)} id={`req-issue-${r.id}`}>
            Issue with {tin.fix}
          </Button>
        ) : null}
        <Button onClick={() => setDeclining(true)} id={`req-decline-${r.id}`}>
          Decline
        </Button>
      </div>
      <DeclineDialog r={r} open={declining} onClose={() => setDeclining(false)} />
    </li>
  );
}

const DECLINE = ["We can't find this receipt", 'This receipt already has an e-invoice', "The details don't match the sale", 'Something else'];

function DeclineDialog({ r, open, onClose }: { r: BuyerRequest; open: boolean; onClose: () => void }) {
  const [reason, setReason] = useState(DECLINE[0]);
  const [other, setOther] = useState('');
  const id = `decline-${r.id}`;
  return (
    <Modal
      id={id}
      open={open}
      onClose={onClose}
      title={`Decline ${r.buyer.name}'s request?`}
      sub="The buyer gets an email with your reason. They can ask again."
      foot={
        <>
          <Button onClick={onClose}>Back</Button>
          <Button
            variant="danger"
            id={`${id}-confirm`}
            disabled={reason === DECLINE[3] && !other.trim()}
            onClick={() => {
              declineRequest(r.id, reason === DECLINE[3] ? other.trim() : reason);
              onClose();
            }}
          >
            Decline request
          </Button>
        </>
      }
    >
      <fieldset className="radios">
        <legend className="label">Reason</legend>
        {DECLINE.map((x, i) => (
          <label key={x} className="check" htmlFor={`${id}-r${i}`}>
            <input id={`${id}-r${i}`} type="radio" name={`${id}-reason`} checked={reason === x} onChange={() => setReason(x)} />
            {x}
          </label>
        ))}
      </fieldset>
      {reason === DECLINE[3] && (
        <Field label="Tell the buyer why" htmlFor={`${id}-other`}>
          <Textarea id={`${id}-other`} value={other} onChange={(e) => setOther(e.target.value)} rows={3} />
        </Field>
      )}
    </Modal>
  );
}

export function RequestsPage() {
  const s = useApp();
  const biz = useBizOf(s);
  const t = useNow(30_000);
  const mine = s.requests.filter((r) => r.bizId === biz.id);
  const pending = mine.filter((r) => r.status === 'pending').sort((a, b) => b.requestedAt - a.requestedAt);
  const handled = mine
    .filter((r) => r.status !== 'pending')
    .sort((a, b) => b.requestedAt - a.requestedAt)
    .slice(0, 8);
  return (
    <>
      <PageHeader
        title="Buyer requests"
        sub="Buyers scan the QR code on their receipt and fill in their details. You check them and issue."
        actions={
          <Button icon={ic(Smartphone, 'ico-sm')} onClick={() => navigate({ name: 'buyer' })} id="req-buyer-view">
            Try it as a buyer
          </Button>
        }
      />
      <section className="panel pad">
        <Switch
          id="auto-issue"
          checked={s.settings.autoIssue}
          onChange={(v) => {
            setSettings({ autoIssue: v });
            toast(v ? 'New requests with a valid TIN are issued automatically' : 'New requests wait for you', { tone: 'info' });
          }}
          label="Issue automatically when the TIN checks out"
          hint="New requests go straight to LHDN. Requests with a problem still wait for you."
        />
      </section>
      <Panel title="Waiting for you" actions={<Chip tone={pending.length ? 'info' : 'ok'}>{pending.length ? `${pending.length} waiting` : 'All done'}</Chip>}>
        {pending.length ? (
          <ul className="reqs">
            {pending.map((r) => (
              <RequestCard key={r.id} r={r} />
            ))}
          </ul>
        ) : (
          <Empty icon={Inbox} title="All caught up">
            New requests show up here as buyers send them.
            <Button size="sm" icon={ic(Smartphone, 'ico-sm')} onClick={() => navigate({ name: 'buyer' })}>
              Send one as a buyer
            </Button>
          </Empty>
        )}
      </Panel>
      {handled.length > 0 && (
        <Panel title="Recently handled">
          <div className="tw">
            <table className="tbl">
              <caption className="sr-only">Recently handled requests</caption>
              <thead>
                <tr>
                  <th scope="col">Buyer</th>
                  <th scope="col" className="hide-sm">Receipt</th>
                  <th scope="col" className="hide-md">Asked</th>
                  <th scope="col">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {handled.map((r) => {
                  const doc = r.docId ? s.docs.find((x) => x.id === r.docId) : undefined;
                  return (
                    <tr key={r.id} className={doc ? 'clickable' : undefined} onClick={doc ? () => navigate({ name: 'doc', id: doc.id }) : undefined}>
                      <td>
                        <span className="strong">{r.buyer.name}</span>
                        <span className="cell-sub show-sm">{r.receiptNo}</span>
                      </td>
                      <td className="hide-sm mono nw">{r.receiptNo}</td>
                      <td className="hide-md nw">{ago(r.requestedAt, t)}</td>
                      <td>
                        {doc ? (
                          <span className="row" style={{ gap: 8 }}>
                            <button
                              type="button"
                              className="row-link"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate({ name: 'doc', id: doc.id });
                              }}
                            >
                              {doc.number}
                            </button>
                            <StatusChip status={doc.status} />
                          </span>
                        ) : (
                          <span className="hint">Declined: {r.declineReason}</span>
                        )}
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

// ---------------------------------------------------------------------------
// The buyer's side: the page a receipt QR code opens, shown in a phone frame.

type Lang = 'en' | 'bm';
const TX = {
  en: {
    receipt: 'Your receipt',
    title: 'Get your e-invoice',
    lead: 'Fill in your details once. We email the e-invoice after LHDN validates it.',
    scan: 'Fill in with my MyInvois QR',
    or: 'or type your details',
    name: 'Full name',
    tin: 'Tax number (TIN)',
    tinHint: 'Starts with IG. Find it in the MyTax app.',
    mykad: 'MyKad number',
    email: 'Email',
    phone: 'Phone',
    address: 'Address',
    postcode: 'Postcode',
    city: 'City',
    state: 'State',
    privacy: 'Your details are used only to issue this e-invoice.',
    send: 'Request e-invoice',
    deadline: 'Ask by 30 Nov. After that, this sale goes into the shop’s monthly e-invoice.',
    sent: 'Request sent',
    sentLead: 'We’ll email your e-invoice when it’s ready.',
    s1: 'Request sent',
    s2: 'Shop issues your e-invoice',
    s3: 'LHDN validates it',
    s4: 'Emailed to you',
    again: 'Start again with another receipt',
    verified: 'Verified',
    checking: 'Checking…',
    powered: 'Powered by Sahkan',
    waiting: 'Waiting for the shop',
    declined: 'The shop declined',
  },
  bm: {
    receipt: 'Resit anda',
    title: 'Dapatkan e-Invois anda',
    lead: 'Isi butiran anda sekali sahaja. Kami e-melkan e-Invois selepas LHDN mengesahkannya.',
    scan: 'Isi dengan QR MyInvois saya',
    or: 'atau taip butiran anda',
    name: 'Nama penuh',
    tin: 'Nombor cukai (TIN)',
    tinHint: 'Bermula dengan IG. Lihat dalam aplikasi MyTax.',
    mykad: 'Nombor MyKad',
    email: 'E-mel',
    phone: 'Telefon',
    address: 'Alamat',
    postcode: 'Poskod',
    city: 'Bandar',
    state: 'Negeri',
    privacy: 'Butiran anda hanya digunakan untuk mengeluarkan e-Invois ini.',
    send: 'Minta e-Invois',
    deadline: 'Minta sebelum 30 Nov. Selepas itu, jualan ini masuk ke e-Invois bulanan kedai.',
    sent: 'Permintaan dihantar',
    sentLead: 'Kami akan e-melkan e-Invois anda apabila siap.',
    s1: 'Permintaan dihantar',
    s2: 'Kedai mengeluarkan e-Invois anda',
    s3: 'LHDN mengesahkannya',
    s4: 'Dihantar melalui e-mel',
    again: 'Mula semula dengan resit lain',
    verified: 'Disahkan',
    checking: 'Menyemak…',
    powered: 'Dikuasakan oleh Sahkan',
    waiting: 'Menunggu kedai',
    declined: 'Kedai menolak',
  },
};

const SAMPLE_RECEIPTS: { no: string; items: RequestItem[] }[] = [
  {
    no: 'R-08852',
    items: [
      { desc: 'Tablet, 11-inch', cls: '003', qty: 1, price: 1099 },
      { desc: 'Tablet case', cls: '022', qty: 1, price: 48.3 },
    ],
  },
  {
    no: 'R-08853',
    items: [
      { desc: 'Laptop, 15-inch, 16 GB', cls: '003', qty: 1, price: 3799 },
      { desc: 'Laptop bag, 14-inch', cls: '022', qty: 1, price: 89 },
    ],
  },
  { no: 'R-08854', items: [{ desc: 'Wireless earbuds', cls: '022', qty: 2, price: 189 }] },
];

const SAMPLE_BUYERS: Party[] = [
  {
    kind: 'individual',
    name: 'Hakim bin Zulkifli',
    tin: 'IG96072304418',
    idType: 'NRIC',
    idValue: '960723145589',
    email: 'hakim.z@example.com',
    phone: '0179925310',
    address: { line1: '6 Jalan Kemuja, Bangsar', postcode: '59000', city: 'Kuala Lumpur', state: '14' },
  },
  {
    kind: 'individual',
    name: 'Grace Tan Li Wen',
    tin: 'IG93011808246',
    idType: 'NRIC',
    idValue: '930118105264',
    email: 'grace.tan@example.com',
    phone: '0126640281',
    address: { line1: '18 Jalan Ara, Bangsar', postcode: '59100', city: 'Kuala Lumpur', state: '14' },
  },
  {
    kind: 'individual',
    name: 'Arjun a/l Menon',
    tin: 'IG88050912275',
    idType: 'NRIC',
    idValue: '880509145523',
    email: 'arjun.menon@example.com',
    phone: '0163381097',
    address: { line1: '3 Lorong Maarof', postcode: '59000', city: 'Kuala Lumpur', state: '14' },
  },
];

const blankBuyer = (): Party => ({
  kind: 'individual',
  name: '',
  tin: '',
  idType: 'NRIC',
  idValue: '',
  email: '',
  phone: '',
  address: { line1: '', postcode: '', city: '', state: '14' },
});

function BuyerScreen({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  const s = useApp();
  const x = TX[lang];
  const [k, setK] = useState(0);
  const sample = SAMPLE_RECEIPTS[k % SAMPLE_RECEIPTS.length];
  const receiptAt = useMemo(() => now() - 9 * MIN, [k]);
  const [p, setP] = useState<Party>(blankBuyer);
  const [scanning, setScanning] = useState(false);
  const [tinState, setTinState] = useState<'idle' | 'checking' | 'ok' | 'bad'>('idle');
  const [tried, setTried] = useState(false);
  const [reqId, setReqId] = useState<string | null>(null);
  const used = s.requests.some((r) => r.receiptNo === sample.no);

  const errs: Record<string, string | undefined> = {
    name: p.name.trim() ? undefined : lang === 'en' ? 'Add your name.' : 'Masukkan nama anda.',
    tin: checkTin(p.tin).ok ? undefined : checkTin(p.tin).message,
    idValue: checkMykad(p.idValue).ok ? undefined : checkMykad(p.idValue).message,
    email: p.email.trim() && checkEmail(p.email).ok ? undefined : lang === 'en' ? 'We need an email to send it to.' : 'Kami perlukan e-mel untuk menghantarnya.',
    phone: checkPhone(p.phone).ok ? undefined : checkPhone(p.phone).message,
    address: p.address.line1.trim() ? undefined : lang === 'en' ? 'Add your address.' : 'Masukkan alamat anda.',
    postcode: checkPostcode(p.address.postcode).ok ? undefined : checkPostcode(p.address.postcode).message,
  };
  const bad = Object.values(errs).some(Boolean);
  const e = (f: string) => (tried ? errs[f] : undefined);

  const checkTinLive = async (tin: string) => {
    if (!checkTin(tin).ok) {
      setTinState('idle');
      return;
    }
    setTinState('checking');
    const r = await verifyTin(tin);
    setTinState(r === 'verified' ? 'ok' : 'bad');
  };

  const scan = async () => {
    setScanning(true);
    await new Promise((r) => setTimeout(r, 700));
    const b = SAMPLE_BUYERS[k % SAMPLE_BUYERS.length];
    setP({ ...b, address: { ...b.address } });
    setScanning(false);
    setTinState('ok');
  };

  const send = () => {
    setTried(true);
    if (bad) return;
    const id = createRequest({ bizId: 'jaya', branchId: 'BGS', receiptNo: sample.no, receiptAt, items: sample.items, buyer: { ...p, tin: p.tin.toUpperCase() } });
    setReqId(id);
  };

  const req = reqId ? s.requests.find((r) => r.id === reqId) : undefined;
  const doc = req?.docId ? s.docs.find((d) => d.id === req.docId) : undefined;
  const total = reqTotal(sample.items);

  const header = (
    <div className="bp-head">
      <Avatar initials="JE" tone="solid" />
      <div className="grow">
        <div className="strong">Jaya Elektrik</div>
        <div className="small">Bangsar branch</div>
      </div>
      <Segmented
        id="buyer-lang"
        label="Language"
        size="sm"
        value={lang}
        options={[
          { value: 'bm', label: 'BM' },
          { value: 'en', label: 'EN' },
        ]}
        onChange={setLang}
      />
    </div>
  );

  if (req) {
    const steps = [
      { label: x.s1, done: true, at: req.requestedAt },
      { label: req.status === 'declined' ? x.declined : x.s2, done: req.status === 'issued', now: req.status === 'pending', bad: req.status === 'declined' },
      { label: x.s3, done: doc?.status === 'valid', now: doc?.status === 'submitted', bad: doc?.status === 'invalid' },
      { label: x.s4, done: !!doc?.emailedAt, now: doc?.status === 'valid' && !doc.emailedAt },
    ];
    return (
      <div className="bp">
        {header}
        <div className="bp-done">
          <span className="bp-tick">{ic(CircleCheck)}</span>
          <h3 className="h2">{x.sent}</h3>
          <p className="hint">{doc?.emailedAt ? `${doc.number} · ${p.email}` : x.sentLead}</p>
        </div>
        <ol className="tracker">
          {steps.map((st, i) => (
            <li key={i} className={cx(st.done && 'tr-done', st.now && 'tr-now', st.bad && 'tr-bad')}>
              <span className="tr-rail">
                <span className="tr-dot" />
                <span className="tr-line" />
              </span>
              <span className="tr-text">
                <span className="strong" style={{ display: 'block' }}>{st.label}</span>
                <span className="small">
                  {st.done ? ('at' in st && st.at ? time(st.at) : ic(Check, 'ico-sm')) : st.now ? (i === 1 ? x.waiting : x.checking) : ''}
                </span>
              </span>
            </li>
          ))}
        </ol>
        {doc?.status === 'valid' && (
          <div className="bp-card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="strong">{doc.number}</span>
              <StatusChip status="valid" />
            </div>
            <div className="small">UUID {doc.uuid}</div>
            <div className="strong num">{rmx(total)}</div>
          </div>
        )}
        <Button
          block
          onClick={() => {
            setReqId(null);
            setK(k + 1);
            setP(blankBuyer());
            setTried(false);
            setTinState('idle');
          }}
          id="buyer-again"
        >
          {x.again}
        </Button>
        <div className="small" style={{ textAlign: 'center' }}>{x.powered}</div>
      </div>
    );
  }

  return (
    <div className="bp">
      {header}
      <div className="bp-card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="strong">{x.receipt}</span>
          <span className="small">{dateTime(receiptAt)}</span>
        </div>
        <ul className="req-items">
          {sample.items.map((i, n) => (
            <li key={n}>
              <span className="grow">
                {i.qty > 1 ? `${i.qty} × ` : ''}
                {i.desc}
                <span className="small" style={{ display: 'block' }}>{clsLabel(i.cls)}</span>
              </span>
              <span className="num">{rm(i.qty * i.price)}</span>
            </li>
          ))}
        </ul>
        <div className="row" style={{ justifyContent: 'space-between', borderTop: '1px dashed var(--line-strong)', paddingTop: 10 }}>
          <span className="small mono">Receipt {sample.no}</span>
          <span className="strong num">{rmx(total)}</span>
        </div>
      </div>
      {used && <Note tone="due">This receipt already has a request. Start again with another receipt.</Note>}
      <div>
        <h3 className="h2">{x.title}</h3>
        <p className="hint" style={{ marginTop: 4 }}>{x.lead}</p>
      </div>
      <Button block size="lg" variant="primary" icon={ic(ScanLine)} busy={scanning} onClick={scan} id="buyer-scan">
        {x.scan}
      </Button>
      <div className="or">{x.or}</div>
      <Field label={x.name} htmlFor="bp-name" error={e('name')}>
        <Input id="bp-name" value={p.name} invalid={!!e('name')} autoComplete="name" onChange={(ev) => setP({ ...p, name: ev.target.value })} />
      </Field>
      <Field
        label={x.tin}
        htmlFor="bp-tin"
        error={e('tin') ?? (tinState === 'bad' ? 'LHDN has no record of this TIN.' : undefined)}
        hint={x.tinHint}
        action={tinState === 'ok' ? <Chip tone="ok" icon={ic(BadgeCheck, 'ico-sm')}>{x.verified}</Chip> : tinState === 'checking' ? <span className="small">{x.checking}</span> : undefined}
      >
        <Input
          id="bp-tin"
          value={p.tin}
          invalid={!!e('tin') || tinState === 'bad'}
          autoComplete="off"
          spellCheck={false}
          onChange={(ev) => {
            setP({ ...p, tin: ev.target.value.toUpperCase().replace(/\s/g, '') });
            setTinState('idle');
          }}
          onBlur={() => checkTinLive(p.tin)}
        />
      </Field>
      <Field label={x.mykad} htmlFor="bp-mykad" error={e('idValue')}>
        <Input id="bp-mykad" value={p.idValue} invalid={!!e('idValue')} inputMode="numeric" autoComplete="off" onChange={(ev) => setP({ ...p, idValue: ev.target.value })} />
      </Field>
      <Field label={x.email} htmlFor="bp-email" error={e('email')}>
        <Input id="bp-email" type="email" value={p.email} invalid={!!e('email')} autoComplete="email" onChange={(ev) => setP({ ...p, email: ev.target.value })} />
      </Field>
      <Field label={x.phone} htmlFor="bp-phone" error={e('phone')}>
        <Input id="bp-phone" type="tel" value={p.phone} invalid={!!e('phone')} autoComplete="tel" onChange={(ev) => setP({ ...p, phone: ev.target.value })} />
      </Field>
      <Field label={x.address} htmlFor="bp-addr" error={e('address')}>
        <Input id="bp-addr" value={p.address.line1} invalid={!!e('address')} autoComplete="street-address" onChange={(ev) => setP({ ...p, address: { ...p.address, line1: ev.target.value } })} />
      </Field>
      <div className="bp-two">
        <Field label={x.postcode} htmlFor="bp-postcode" error={e('postcode')}>
          <Input id="bp-postcode" value={p.address.postcode} invalid={!!e('postcode')} inputMode="numeric" autoComplete="postal-code" onChange={(ev) => setP({ ...p, address: { ...p.address, postcode: ev.target.value } })} />
        </Field>
        <Field label={x.city} htmlFor="bp-city">
          <Input id="bp-city" value={p.address.city} autoComplete="address-level2" onChange={(ev) => setP({ ...p, address: { ...p.address, city: ev.target.value } })} />
        </Field>
      </div>
      <Field label={x.state} htmlFor="bp-state">
        <Select id="bp-state" value={p.address.state} onChange={(ev) => setP({ ...p, address: { ...p.address, state: ev.target.value } })}>
          {STATES.filter(([c]) => c !== '17').map(([c, n]) => (
            <option key={c} value={c}>
              {n}
            </option>
          ))}
        </Select>
      </Field>
      <div className="small row" style={{ gap: 6, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        {ic(Lock, 'ico-sm')}
        <span>{x.privacy}</span>
      </div>
      <Button block size="lg" variant="primary" onClick={send} disabled={used} id="buyer-send">
        {x.send}
      </Button>
      {tried && bad && <div className="err">{lang === 'en' ? 'Check the fields marked above.' : 'Semak ruangan yang ditanda di atas.'}</div>}
      <div className="small" style={{ textAlign: 'center' }}>{x.deadline}</div>
      <div className="small" style={{ textAlign: 'center' }}>{x.powered}</div>
    </div>
  );
}

export function BuyerPage() {
  const s = useApp();
  const [lang, setLang] = useState<Lang>('en');
  const pending = s.requests.filter((r) => r.bizId === 'jaya' && r.status === 'pending').length;
  return (
    <>
      <PageHeader
        title="The buyer's side"
        sub="What a buyer sees after scanning the QR code on a Jaya Elektrik receipt. Try it here, then approve it as the shop."
      />
      <div className="cols buyer-cols">
        <div className="col-side stack" style={{ flexBasis: 300 }}>
          <Panel title="How it works" pad>
            <ol className="steps-list">
              <li>
                {ic(ReceiptText, 'ico-sm')}
                <span>Every receipt has a QR code that opens this page, with the sale already filled in.</span>
              </li>
              <li>
                {ic(ScanLine, 'ico-sm')}
                <span>The buyer fills in their details once, or scans their own MyInvois QR. The TIN is checked with LHDN as they type.</span>
              </li>
              <li>
                {ic(Store, 'ico-sm')}
                <span>The shop approves it in Buyer requests, or turns on automatic issuing.</span>
              </li>
              <li>
                {ic(CircleCheck, 'ico-sm')}
                <span>LHDN validates it and the buyer gets it by email. The sale stays out of the monthly consolidated e-invoice.</span>
              </li>
            </ol>
          </Panel>
          <section className="panel pad stack">
            <Switch
              id="buyer-auto"
              checked={s.settings.autoIssue}
              onChange={(v) => setSettings({ autoIssue: v })}
              label="Issue automatically"
              hint="Off: the request waits in Buyer requests."
            />
            <Button block icon={ic(Inbox, 'ico-sm')} onClick={() => navigate({ name: 'requests' })} id="buyer-open-requests">
              Open Buyer requests{pending ? ` (${pending})` : ''}
            </Button>
          </section>
        </div>
        <div className="col-main" style={{ flexBasis: 400 }}>
          <div className="phone" aria-label="Buyer's phone">
            <div className="phone-screen">
              <div className="phone-bar">
                <div className="phone-url">
                  {ic(Lock, 'ico-sm')}
                  sahkan.example/r/jaya-bgs
                </div>
              </div>
              <div className="phone-body">
                <BuyerScreen lang={lang} setLang={setLang} />
              </div>
            </div>
          </div>
          <p className="hint" style={{ textAlign: 'center', marginTop: 12 }}>
            Sample page. The QR codes and links in this demo don't go anywhere real.
          </p>
        </div>
      </div>
    </>
  );
}

