import { useState } from 'react';
import { Package, Plus, Search, SearchCheck, Users } from 'lucide-react';
import type { Buyer, Item, Party, TaxCode, TinStatus } from '../types';
import { now } from '../lib/clock';
import { CLASSIFICATIONS, TAX_TYPES, clsLabel, taxOf } from '../lib/rules';
import { maskId, rm } from '../lib/format';
import { useApp } from '../state/store';
import { navigate } from '../state/nav';
import { EMPTY_PARTY, addBuyer, addItem, updateBuyer, verifyTin } from '../state/actions';
import { toast } from '../state/toast';
import { PartyFields, TinChip, problemsOf } from '../party';
import { Button, Empty, Field, Input, Modal, NumInput, PageHeader, Panel, Select, ic } from '../ui';
import { useBizOf } from './common';

function AddBuyerDialog({ open, onClose, bizId }: { open: boolean; onClose: () => void; bizId: string }) {
  const [p, setP] = useState<Party>(() => ({ ...EMPTY_PARTY, address: { ...EMPTY_PARTY.address } }));
  const [tinStatus, setTinStatus] = useState<TinStatus>('unchecked');
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [tried, setTried] = useState(false);
  const reset = () => {
    setP({ ...EMPTY_PARTY, address: { ...EMPTY_PARTY.address } });
    setTinStatus('unchecked');
    setTouched(new Set());
    setTried(false);
  };
  const probs = problemsOf(p);
  return (
    <Modal
      id="add-buyer"
      wide
      open={open}
      onClose={onClose}
      title="Add a buyer"
      sub="Saved buyers fill in by themselves on new e-invoices."
      foot={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            id="add-buyer-save"
            onClick={() => {
              setTried(true);
              if (Object.keys(probs).length) return;
              addBuyer(bizId, p, tinStatus);
              toast(`${p.name} saved to Buyers`);
              reset();
              onClose();
            }}
          >
            Save buyer
          </Button>
        </>
      }
    >
      <PartyFields
        idp="nb"
        party={p}
        onChange={setP}
        tinStatus={tinStatus}
        onTinStatus={(s) => setTinStatus(s)}
        show={(f) => tried || touched.has(f)}
        touch={(f) => setTouched((x) => new Set(x).add(f))}
        tinChip
      />
    </Modal>
  );
}

export function BuyersPage() {
  const s = useApp();
  const biz = useBizOf(s);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const needle = q.trim().toLowerCase();
  const list = s.buyers
    .filter((b) => b.bizId === biz.id)
    .filter((b) => !needle || b.name.toLowerCase().includes(needle) || b.tin.toLowerCase().includes(needle) || b.email.toLowerCase().includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name));

  const check = async (b: Buyer) => {
    setBusy(b.id);
    const r = await verifyTin(b);
    setBusy(null);
    if (r === 'unchecked') return; // not checked (the reason was already shown)
    updateBuyer(b.id, { tinStatus: r, checkedAt: now() });
    toast(r === 'verified' ? `${b.name}: TIN matched with LHDN` : `${b.name}: LHDN couldn't match ${b.tin}`, { tone: r === 'verified' ? 'ok' : 'bad' });
  };

  return (
    <>
      <PageHeader
        title="Buyers"
        sub="Saved buyer details, checked against LHDN before you use them."
        actions={
          <Button variant="primary" icon={ic(Plus)} onClick={() => setAdding(true)} id="buyers-add">
            Add buyer
          </Button>
        }
      />
      <div className="search" style={{ maxWidth: 420 }}>
        {ic(Search)}
        <Input id="buyers-search" type="search" placeholder="Search name, TIN or email" aria-label="Search buyers" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Panel>
        {list.length ? (
          <div className="tw">
            <table className="tbl">
              <caption className="sr-only">Buyers</caption>
              <thead>
                <tr>
                  <th scope="col">Buyer</th>
                  <th scope="col" className="hide-sm">TIN</th>
                  <th scope="col" className="hide-md">ID</th>
                  <th scope="col" className="hide-md">Contact</th>
                  <th scope="col" className="r">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.map((b) => {
                  const issues = Object.keys(problemsOf(b)).length;
                  return (
                    <tr key={b.id}>
                      <td>
                        <span className="strong">{b.name}</span>
                        <span className="cell-sub">
                          {b.kind === 'individual' ? 'Individual' : 'Business'}
                          {issues ? `, ${issues} detail${issues > 1 ? 's' : ''} to fix` : ''}
                        </span>
                        <span className="cell-sub show-sm mono">{b.tin}</span>
                      </td>
                      <td className="hide-sm">
                        <div className="mono">{b.tin}</div>
                        <div style={{ marginTop: 4 }}>
                          <TinChip status={b.tinStatus} />
                        </div>
                      </td>
                      <td className="hide-md mono nw">
                        {b.idType === 'NRIC' ? 'MyKad ' + maskId(b.idValue) : `${b.idType} ${b.idValue}`}
                      </td>
                      <td className="hide-md">
                        <span className="clip">{b.email || '—'}</span>
                        <span className="cell-sub">{b.phone}</span>
                      </td>
                      <td className="r nw">
                        <div className="row" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                          {b.tinStatus !== 'verified' && (
                            <Button size="sm" icon={ic(SearchCheck, 'ico-sm')} busy={busy === b.id} onClick={() => check(b)} id={`buyer-check-${b.id}`}>
                              Check TIN
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => navigate({ name: 'compose', buyerId: b.id })} id={`buyer-new-${b.id}`}>
                            New e-invoice
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon={Users} title={needle ? `No buyer matches "${q.trim()}"` : 'No buyers yet'} />
        )}
      </Panel>
      <AddBuyerDialog open={adding} onClose={() => setAdding(false)} bizId={biz.id} />
    </>
  );
}

function AddItemDialog({ open, onClose, bizId }: { open: boolean; onClose: () => void; bizId: string }) {
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [cls, setCls] = useState('');
  const [price, setPrice] = useState(0);
  const [tax, setTax] = useState<TaxCode>('06');
  const [tried, setTried] = useState(false);
  const ok = name.trim() && cls && price > 0;
  return (
    <Modal
      id="add-item"
      open={open}
      onClose={onClose}
      title="Add an item"
      sub="The classification code goes on every e-invoice line for this item."
      foot={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            id="add-item-save"
            onClick={() => {
              setTried(true);
              if (!ok) return;
              addItem({ bizId, sku: sku.trim() || name.trim().slice(0, 8).toUpperCase(), name: name.trim(), cls, price, tax });
              toast(`${name.trim()} saved to Items`);
              setSku('');
              setName('');
              setCls('');
              setPrice(0);
              setTried(false);
              onClose();
            }}
          >
            Save item
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Name" htmlFor="item-name" error={tried && !name.trim() ? 'Add a name.' : undefined} className="span-all">
          <Input id="item-name" value={name} invalid={tried && !name.trim()} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="SKU" htmlFor="item-sku" hint="Optional">
          <Input id="item-sku" value={sku} onChange={(e) => setSku(e.target.value)} />
        </Field>
        <Field label="Unit price (RM)" htmlFor="item-price" error={tried && !(price > 0) ? 'Add a price.' : undefined}>
          <NumInput id="item-price" value={price} onChange={setPrice} invalid={tried && !(price > 0)} />
        </Field>
        <Field label="Classification" htmlFor="item-cls" error={tried && !cls ? 'Choose a classification code.' : undefined} className="span-all">
          <Select id="item-cls" value={cls} invalid={tried && !cls} onChange={(e) => setCls(e.target.value)}>
            <option value="">Choose a code</option>
            {CLASSIFICATIONS.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Tax" htmlFor="item-tax">
          <Select id="item-tax" value={tax} onChange={(e) => setTax(e.target.value as TaxCode)}>
            {TAX_TYPES.map((x) => (
              <option key={x.code} value={x.code}>
                {x.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

export function ItemsPage() {
  const s = useApp();
  const biz = useBizOf(s);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const list: Item[] = s.items
    .filter((i) => i.bizId === biz.id)
    .filter((i) => !needle || i.name.toLowerCase().includes(needle) || i.sku.toLowerCase().includes(needle) || i.cls.includes(needle));
  return (
    <>
      <PageHeader
        title="Items"
        sub="Your products and services, each with its LHDN classification code."
        actions={
          <Button variant="primary" icon={ic(Plus)} onClick={() => setAdding(true)} id="items-add">
            Add item
          </Button>
        }
      />
      <div className="search" style={{ maxWidth: 420 }}>
        {ic(Search)}
        <Input id="items-search" type="search" placeholder="Search name, SKU or code" aria-label="Search items" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Panel>
        {list.length ? (
          <div className="tw">
            <table className="tbl">
              <caption className="sr-only">Items</caption>
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col" className="hide-sm">Classification</th>
                  <th scope="col" className="r">Unit price (RM)</th>
                  <th scope="col" className="hide-md">Tax</th>
                </tr>
              </thead>
              <tbody>
                {list.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <span className="strong">{i.name}</span>
                      <span className="cell-sub mono">SKU {i.sku}</span>
                      <span className="cell-sub show-sm">
                        {i.cls} {clsLabel(i.cls)}
                      </span>
                    </td>
                    <td className="hide-sm">
                      <span className="mono strong">{i.cls}</span> <span className="hint">{clsLabel(i.cls)}</span>
                    </td>
                    <td className="r num">{rm(i.price)}</td>
                    <td className="hide-md">{taxOf(i.tax).label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon={Package} title={needle ? `No item matches "${q.trim()}"` : 'No items yet'} />
        )}
      </Panel>
      <AddItemDialog open={adding} onClose={() => setAdding(false)} bizId={biz.id} />
    </>
  );
}
