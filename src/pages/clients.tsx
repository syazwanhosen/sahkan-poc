import { useState } from 'react';
import { Bell, Building2, CircleAlert, LoaderCircle, Plus, ShieldCheck } from 'lucide-react';
import type { ClientMeta } from '../types';
import { PERIOD, PERIOD_DUE } from '../lib/clock';
import { checkEmail, checkTin } from '../lib/rules';
import { ago, dayMon, daysLeft, periodMonth } from '../lib/format';
import { useApp } from '../state/store';
import { addClient, openClient, sendReminders } from '../state/actions';
import { bizById, clientState, type ClientState } from '../state/select';
import { toast } from '../state/toast';
import { Avatar, Button, Chip, Field, Input, Modal, PageHeader, Panel, cx, ic, useNow } from '../ui';

type Group = 'all' | 'needs' | 'ready' | 'done';

const PROGRESS_LABEL = ['No sales file', 'Sales file in', 'Imported', 'Submitted', 'Valid'];

function StatusCell({ st, c, t }: { st: ClientState; c: ClientMeta; t: number }) {
  switch (st.status) {
    case 'invalid':
      return <Chip tone="bad" icon={ic(CircleAlert, 'ico-sm')}>{st.invalid.length} invalid</Chip>;
    case 'waiting':
      return c.remindedAt ? <Chip tone="mute" icon={ic(Bell, 'ico-sm')}>Reminded {ago(c.remindedAt, t)}</Chip> : <Chip tone="due">Waiting for client</Chip>;
    case 'ready':
      return <Chip tone="info">Ready to submit</Chip>;
    case 'sending':
      return <Chip tone="info" icon={ic(LoaderCircle, 'ico-sm spin')}>Submitting</Chip>;
    case 'done':
      return <Chip tone="ok">Done</Chip>;
    default:
      return <Chip tone="mute">Invite sent</Chip>;
  }
}

function AddClientDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [tin, setTin] = useState('');
  const [email, setEmail] = useState('');
  const [tried, setTried] = useState(false);
  const tinCheck = checkTin(tin);
  const emailOk = !!email.trim() && checkEmail(email).ok;
  const ok = name.trim() && tinCheck.ok && emailOk;
  return (
    <Modal
      id="add-client"
      open={open}
      onClose={onClose}
      title="Add a client"
      sub="We email them an invite. Once they accept, LHDN lists you as their intermediary in MyInvois."
      foot={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            id="add-client-send"
            onClick={() => {
              setTried(true);
              if (!ok) return;
              addClient(name.trim(), tin.trim().toUpperCase(), email.trim());
              setName('');
              setTin('');
              setEmail('');
              setTried(false);
              onClose();
            }}
          >
            Send invite
          </Button>
        </>
      }
    >
      <Field label="Business name" htmlFor="client-name" error={tried && !name.trim() ? 'Add the business name.' : undefined}>
        <Input id="client-name" value={name} invalid={tried && !name.trim()} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Tax number (TIN)" htmlFor="client-tin" error={tried && !tinCheck.ok ? tinCheck.message : undefined}>
        <Input id="client-tin" value={tin} invalid={tried && !tinCheck.ok} spellCheck={false} onChange={(e) => setTin(e.target.value.toUpperCase().replace(/\s/g, ''))} />
      </Field>
      <Field label="Owner's email" htmlFor="client-email" error={tried && !emailOk ? 'Add an email for the invite.' : undefined}>
        <Input id="client-email" type="email" value={email} invalid={tried && !emailOk} onChange={(e) => setEmail(e.target.value)} />
      </Field>
    </Modal>
  );
}

export function ClientsPage() {
  const s = useApp();
  const t = useNow(30_000);
  const [group, setGroup] = useState<Group>('all');
  const [adding, setAdding] = useState(false);
  const rows = s.clients
    .map((c) => ({ c, biz: bizById(s, c.bizId), st: clientState(s, c) }))
    .sort((a, b) => a.st.rank - b.st.rank || a.c.name.localeCompare(b.c.name));
  const inGroup = (g: Group, st: ClientState) =>
    g === 'all' ||
    (g === 'needs' && (st.status === 'invalid' || st.status === 'waiting' || st.status === 'invited')) ||
    (g === 'ready' && st.status === 'ready') ||
    (g === 'done' && (st.status === 'done' || st.status === 'sending'));
  const count = (g: Group) => rows.filter((r) => inGroup(g, r.st)).length;
  const waiting = rows.filter((r) => r.st.status === 'waiting' && !r.c.remindedAt && r.c.bizId);
  const due = PERIOD_DUE - t;
  const groups: { key: Group; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'needs', label: 'Needs you' },
    { key: 'ready', label: 'Ready to submit' },
    { key: 'done', label: 'Done' },
  ];
  const shown = rows.filter((r) => inGroup(group, r.st));

  const act = (r: (typeof rows)[number], where = '') => {
    const { c, st } = r;
    const id = `client-act${where}-${c.id}`;
    if (!c.bizId)
      return (
        <Button size="sm" id={id} onClick={() => toast(`Invite sent again to ${c.invitedEmail}`)}>
          Resend invite
        </Button>
      );
    const bizId = c.bizId;
    switch (st.status) {
      case 'invalid':
        return (
          <Button size="sm" variant="primary" id={id} onClick={() => openClient(bizId, { name: 'doc', id: st.invalid[0].id })}>
            Fix
          </Button>
        );
      case 'waiting':
        return (
          <Button size="sm" id={id} icon={ic(Bell, 'ico-sm')} onClick={() => sendReminders([bizId])}>
            {c.remindedAt ? 'Remind again' : 'Send reminder'}
          </Button>
        );
      case 'ready': {
        const run = st.runs.find((x) => x.stage === 'imported');
        return (
          <Button size="sm" variant="primary" id={id} onClick={() => openClient(bizId, { name: 'monthend', runId: run?.id })}>
            Review
          </Button>
        );
      }
      default:
        return (
          <Button size="sm" id={id} onClick={() => openClient(bizId, { name: 'monthend', runId: st.runs.length === 1 ? st.runs[0].id : undefined })}>
            View
          </Button>
        );
    }
  };

  return (
    <>
      <PageHeader
        title="Clients"
        sub={`${periodMonth(PERIOD)} consolidated e-invoices are due ${dayMon(PERIOD_DUE)}, ${daysLeft(due)}.`}
        actions={
          <>
            {waiting.length > 0 && (
              <Button icon={ic(Bell, 'ico-sm')} onClick={() => sendReminders(waiting.map((r) => r.c.bizId!))} id="clients-remind">
                Send {waiting.length} reminder{waiting.length > 1 ? 's' : ''}
              </Button>
            )}
            <Button variant="primary" icon={ic(Plus)} onClick={() => setAdding(true)} id="clients-add">
              Add client
            </Button>
          </>
        }
      />
      <div className="pills" role="group" aria-label="Filter clients">
        {groups.map((g) => (
          <button key={g.key} type="button" className="pill" aria-pressed={group === g.key} onClick={() => setGroup(g.key)} id={`clients-${g.key}`}>
            {g.label}
            <span className="count">{count(g.key)}</span>
          </button>
        ))}
      </div>
      <Panel>
        <div className="tw">
          <table className="tbl">
            <caption className="sr-only">Clients</caption>
            <thead>
              <tr>
                <th scope="col" className="col-client">Client</th>
                <th scope="col" className="hide-md">Phase</th>
                <th scope="col" className="hide-sm">{periodMonth(PERIOD)} progress</th>
                <th scope="col" className="hide-sm">Status</th>
                <th scope="col" className="hide-md">Due</th>
                <th scope="col" className="r hide-sm">
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const { c, biz, st } = r;
                return (
                  <tr key={c.id}>
                    <td>
                      <div className="row" style={{ gap: 12, flexWrap: 'nowrap' }}>
                        <span className="hide-sm">
                          {biz ? <Avatar initials={biz.initials} tone={biz.tone} /> : <span className="icon-box tone-4" style={{ width: 34, height: 34, borderRadius: 9 }}>{ic(Building2, 'ico-sm')}</span>}
                        </span>
                        <div style={{ minWidth: 0 }}>
                          {biz ? (
                            <button type="button" className="row-link" onClick={() => openClient(biz.id)} id={`client-open-${c.id}`}>
                              {c.name}
                            </button>
                          ) : (
                            <span className="strong">{c.name}</span>
                          )}
                          <span className="cell-sub mono">TIN {c.tin}</span>
                          <div className="show-sm">
                            <div className="client-sm">
                              <StatusCell st={st} c={c} t={t} />
                              {act(r, '-sm')}
                            </div>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="hide-md num">{biz?.phase ?? '—'}</td>
                    <td className="hide-sm">
                      {biz ? (
                        <div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
                          <span className="segs" aria-hidden="true">
                            {[1, 2, 3, 4].map((i) => (
                              <span key={i} className={cx(st.progress >= i && 'on')} />
                            ))}
                          </span>
                          <span className="small nw">{PROGRESS_LABEL[st.progress] ?? ''}</span>
                        </div>
                      ) : (
                        <span className="small">Not linked yet</span>
                      )}
                    </td>
                    <td className="hide-sm">
                      <StatusCell st={st} c={c} t={t} />
                    </td>
                    <td className="hide-md nw">{st.status === 'done' && st.filedAt ? `Filed ${dayMon(st.filedAt)}` : dayMon(PERIOD_DUE)}</td>
                    <td className="r hide-sm">{act(r)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="table-foot">
          <span className="hint row" style={{ gap: 6 }}>
            {ic(ShieldCheck, 'ico-sm')}
            {s.firm.name} files as intermediary for {s.clients.filter((c) => c.bizId).length} of {s.clients.length} clients. Progress: sales file, imported, submitted, valid.
          </span>
        </div>
      </Panel>
      <AddClientDialog open={adding} onClose={() => setAdding(false)} />
    </>
  );
}
