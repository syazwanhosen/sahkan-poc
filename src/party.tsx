// Buyer details form, shared by the composer and the Buyers page.
// It shows the same field problems MyInvois would reject a document for.
import { useState } from 'react';
import { BadgeCheck, CircleHelp, SearchCheck, TriangleAlert } from 'lucide-react';
import type { IdType, Party, TinStatus } from './types';
import { STATES, checkMykad, partyProblems } from './lib/rules';
import { now } from './lib/clock';
import { verifyTin } from './state/actions';
import { Button, Chip, Field, Input, Segmented, Select, ic } from './ui';

export interface Problem {
  message: string;
  fix?: string;
}

/** Every problem with a buyer's details, keyed by field. */
export function problemsOf(p: Party): Record<string, Problem> {
  const out: Record<string, Problem> = {};
  for (const x of partyProblems(p)) out[x.field] = { message: x.message, fix: x.fix };
  if (p.kind === 'individual' && p.idType === 'NRIC') {
    const m = checkMykad(p.idValue);
    if (!m.ok) out.idValue = { message: m.message! };
  }
  if (p.kind === 'company' && p.idType === 'BRN' && !/^\d{12}$/.test(p.idValue.trim())) {
    out.idValue = { message: 'New business registration numbers have 12 digits.' };
  }
  return out;
}

export function TinChip({ status }: { status: TinStatus }) {
  if (status === 'verified') return <Chip tone="ok" icon={ic(BadgeCheck, 'ico-sm')}>TIN verified</Chip>;
  if (status === 'not-found') return <Chip tone="bad" icon={ic(TriangleAlert, 'ico-sm')}>TIN not found</Chip>;
  return <Chip tone="mute" icon={ic(CircleHelp, 'ico-sm')}>TIN not checked</Chip>;
}

const ID_TYPES: { value: IdType; label: string }[] = [
  { value: 'BRN', label: 'BRN' },
  { value: 'NRIC', label: 'MyKad' },
  { value: 'PASSPORT', label: 'Passport' },
  { value: 'ARMY', label: 'Army ID' },
];

export function PartyFields({
  idp,
  party,
  onChange,
  tinStatus,
  onTinStatus,
  show,
  touch,
  extra = {},
  tinChip = false,
}: {
  idp: string;
  party: Party;
  onChange: (p: Party) => void;
  tinStatus: TinStatus;
  onTinStatus: (s: TinStatus, at?: number) => void;
  /** Whether to show a field's problem yet (after it is touched, or always when fixing). */
  show: (field: string) => boolean;
  touch: (field: string) => void;
  /** Problems LHDN reported that the local checks can't see (a TIN/ID mismatch). */
  extra?: Record<string, Problem>;
  /** Show the TIN status chip (the composer shows it on the buyer card instead). */
  tinChip?: boolean;
}) {
  const [checking, setChecking] = useState(false);
  const probs = { ...problemsOf(party), ...extra };
  const set = (patch: Partial<Party>) => onChange({ ...party, ...patch });
  const setAddr = (patch: Partial<Party['address']>) => onChange({ ...party, address: { ...party.address, ...patch } });
  const err = (field: string) => {
    const p = probs[field];
    if (!p || !show(field)) return undefined;
    return (
      <>
        {p.message}
        {p.fix && (
          <>
            {' '}
            <button
              type="button"
              className="link-btn fix-btn"
              onClick={() => {
                if (field === 'tin') {
                  set({ tin: p.fix! });
                  onTinStatus('unchecked');
                } else if (field === 'phone') set({ phone: p.fix! });
              }}
            >
              Use {p.fix}
            </button>
          </>
        )}
      </>
    );
  };
  const bad = (field: string) => !!probs[field] && show(field);

  const check = async () => {
    touch('tin');
    setChecking(true);
    const r = await verifyTin(party.tin);
    setChecking(false);
    onTinStatus(r, now());
  };

  return (
    <div className="form-grid">
      <div className="span-all row" style={{ justifyContent: 'space-between' }}>
        <Segmented
          id={`${idp}-kind`}
          label="Buyer type"
          size="sm"
          value={party.kind === 'individual' ? 'individual' : 'company'}
          options={[
            { value: 'company', label: 'Business' },
            { value: 'individual', label: 'Individual' },
          ]}
          onChange={(k) => set({ kind: k, idType: k === 'individual' ? 'NRIC' : 'BRN' })}
        />
        {tinChip && <TinChip status={tinStatus} />}
      </div>
      <Field label={party.kind === 'individual' ? 'Full name' : 'Business name'} htmlFor={`${idp}-name`} error={err('name')} className="span-all">
        <Input
          id={`${idp}-name`}
          value={party.name}
          invalid={bad('name')}
          autoComplete="off"
          onChange={(e) => set({ name: e.target.value })}
          onBlur={() => touch('name')}
        />
      </Field>
      <Field
        label="Tax number (TIN)"
        htmlFor={`${idp}-tin`}
        error={err('tin') ?? (tinStatus === 'not-found' ? 'LHDN has no record of this TIN. Check it with the buyer.' : undefined)}
        hint={tinStatus === 'verified' ? 'Matched with LHDN.' : party.kind === 'individual' ? 'Starts with IG, like IG12345678912.' : 'Starts with C and ends in 0.'}
      >
        <div className="input-row">
          <Input
            id={`${idp}-tin`}
            value={party.tin}
            invalid={bad('tin') || tinStatus === 'not-found'}
            autoComplete="off"
            spellCheck={false}
            className="mono-input"
            onChange={(e) => {
              set({ tin: e.target.value.toUpperCase().replace(/\s/g, '') });
              onTinStatus('unchecked');
            }}
            onBlur={() => touch('tin')}
          />
          <Button onClick={check} busy={checking} disabled={!party.tin.trim() || tinStatus === 'verified'} icon={ic(SearchCheck, 'ico-sm')} id={`${idp}-tin-check`}>
            {tinStatus === 'verified' ? 'Checked' : 'Check'}
          </Button>
        </div>
      </Field>
      <Field label="ID number" htmlFor={`${idp}-id`} error={err('idValue')}>
        <div className="input-row">
          <Select
            id={`${idp}-idtype`}
            aria-label="ID type"
            value={party.idType}
            onChange={(e) => set({ idType: e.target.value as IdType })}
            style={{ flex: '0 0 112px', width: 112 }}
          >
            {ID_TYPES.map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </Select>
          <Input
            id={`${idp}-id`}
            value={party.idValue}
            invalid={bad('idValue')}
            inputMode={party.idType === 'PASSPORT' ? 'text' : 'numeric'}
            autoComplete="off"
            onChange={(e) => set({ idValue: e.target.value })}
            onBlur={() => touch('idValue')}
          />
        </div>
      </Field>
      <Field label="Email" htmlFor={`${idp}-email`} error={err('email')} hint="The e-invoice is emailed here once it's validated.">
        <Input id={`${idp}-email`} type="email" value={party.email} invalid={bad('email')} autoComplete="off" onChange={(e) => set({ email: e.target.value })} onBlur={() => touch('email')} />
      </Field>
      <Field label="Phone" htmlFor={`${idp}-phone`} error={err('phone')} hint="Digits only, like 0322821450.">
        <Input id={`${idp}-phone`} type="tel" value={party.phone} invalid={bad('phone')} autoComplete="off" onChange={(e) => set({ phone: e.target.value })} onBlur={() => touch('phone')} />
      </Field>
      <Field label="Address" htmlFor={`${idp}-addr`} error={err('address')} className="span-all">
        <Input id={`${idp}-addr`} value={party.address.line1} invalid={bad('address')} autoComplete="off" onChange={(e) => setAddr({ line1: e.target.value })} onBlur={() => touch('address')} />
      </Field>
      <Field label="Postcode" htmlFor={`${idp}-postcode`} error={err('postcode')}>
        <Input
          id={`${idp}-postcode`}
          value={party.address.postcode}
          invalid={bad('postcode')}
          inputMode="numeric"
          autoComplete="off"
          onChange={(e) => setAddr({ postcode: e.target.value })}
          onBlur={() => touch('postcode')}
        />
      </Field>
      <Field label="City" htmlFor={`${idp}-city`}>
        <Input id={`${idp}-city`} value={party.address.city} autoComplete="off" onChange={(e) => setAddr({ city: e.target.value })} />
      </Field>
      <Field label="State" htmlFor={`${idp}-state`}>
        <Select id={`${idp}-state`} value={party.address.state} onChange={(e) => setAddr({ state: e.target.value })}>
          {STATES.filter(([c]) => c !== '17').map(([c, n]) => (
            <option key={c} value={c}>
              {n}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}
