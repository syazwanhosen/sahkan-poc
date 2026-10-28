// App frame: sidebar (or a drawer on phones), the demo banner, the guide and toasts.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  Building2,
  CalendarCheck,
  Check,
  ChevronsUpDown,
  CircleAlert,
  CircleCheck,
  FileDown,
  FileText,
  FlaskConical,
  House,
  Inbox,
  Info,
  ListChecks,
  Menu,
  Package,
  PlugZap,
  Plus,
  RotateCcw,
  Settings,
  ShieldCheck,
  Smartphone,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { GuideKey, State } from './types';
import { useApp } from './state/store';
import { navigate, useRoute, type Route } from './state/nav';
import { activeBiz, attention, clientState } from './state/select';
import { openClient, openWorkspace, resetDemo, setGuideOpen, switchPersona } from './state/actions';
import { useLive } from './state/live';
import { dismiss, useToasts } from './state/toast';
import { date, plural, time } from './lib/format';
import { Avatar, Button, Modal, cx, ic, useNow } from './ui';

// ---------------------------------------------------------------------------
// Navigation

interface NavDef {
  name: Route['name'];
  label: string;
  icon: LucideIcon;
  badge?: number;
}

function navFor(s: State): NavDef[] {
  const biz = activeBiz(s);
  if (!biz) {
    const needs = s.clients.filter((c) => {
      const st = clientState(s, c).status;
      return st === 'invalid' || st === 'waiting' || st === 'ready';
    }).length;
    return [
      { name: 'clients', label: 'Clients', icon: Building2, badge: needs },
      { name: 'settings', label: 'Settings', icon: Settings },
    ];
  }
  const pending = s.requests.filter((r) => r.bizId === biz.id && r.status === 'pending').length;
  return [
    { name: 'today', label: 'Today', icon: House },
    { name: 'invoices', label: 'E-invoices', icon: FileText },
    { name: 'received', label: 'Received', icon: FileDown },
    { name: 'requests', label: 'Buyer requests', icon: Inbox, badge: pending },
    { name: 'monthend', label: 'Month-end', icon: CalendarCheck },
    { name: 'buyers', label: 'Buyers', icon: Users },
    { name: 'items', label: 'Items', icon: Package },
    { name: 'settings', label: 'Settings', icon: Settings },
  ];
}

const isOn = (nav: Route['name'], r: Route) =>
  r.name === nav || (nav === 'invoices' && (r.name === 'doc' || r.name === 'compose')) || (nav === 'requests' && r.name === 'buyer');

function Switcher({ onNavigate }: { onNavigate?: () => void }) {
  const s = useApp();
  const biz = activeBiz(s);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const accountant = s.persona === 'accountant';
  const live = s.workspace === 'live';
  const name = biz ? biz.name || biz.short : s.firm.name;
  const sub = biz ? (accountant ? `Client of ${s.firm.name}` : `Phase ${biz.phase}, ${biz.branches.length} ${biz.branches.length === 1 ? 'branch' : 'branches'}`) : `${s.clients.length} clients`;
  const owner = live ? s.businesses[0] : (s.businesses.find((b) => b.id === 'jaya') ?? s.businesses[0]);
  const choose = (fn: () => void) => {
    setOpen(false);
    fn();
    onNavigate?.();
  };
  return (
    <div className="switcher" ref={wrap}>
      <button type="button" className="switch-btn" aria-expanded={open} aria-controls="workspace-menu" onClick={() => setOpen(!open)} id="workspace-switch">
        <Avatar initials={biz ? biz.initials : s.firm.initials} tone={biz ? biz.tone : 'solid'} />
        <span style={{ minWidth: 0, flex: 1 }}>
          <span className="switch-name">{name}</span>
          <span className="switch-sub">{sub}</span>
        </span>
        {ic(ChevronsUpDown, 'ico-sm')}
      </button>
      {open && (
        <div className="menu" id="workspace-menu" aria-label="Switch view">
          <div className="menu-label">{live ? 'Work as' : 'See the demo as'}</div>
          <button type="button" className="menu-item" aria-current={!accountant} onClick={() => choose(() => switchPersona('owner'))}>
            <Avatar initials={owner.owner.initials} tone={0} round />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="strong" style={{ display: 'block' }}>{live ? 'The taxpayer' : `${owner.owner.name}, business owner`}</span>
              <span className="small">{owner.name || owner.short}</span>
            </span>
            {!accountant && ic(Check, 'ico-sm')}
          </button>
          <button type="button" className="menu-item" aria-current={accountant} onClick={() => choose(() => switchPersona('accountant'))}>
            <Avatar initials={s.firm.user.initials} tone="solid" round />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="strong" style={{ display: 'block' }}>{live ? 'An intermediary' : `${s.firm.user.name}, accountant`}</span>
              <span className="small">
                {s.firm.name}, {s.clients.length} {s.clients.length === 1 ? 'client' : 'clients'}
              </span>
            </span>
            {accountant && ic(Check, 'ico-sm')}
          </button>
          {accountant && (
            <>
              <div className="menu-sep" />
              <div className="menu-label">Open a client</div>
              {s.clients
                .filter((c) => c.bizId)
                .map((c) => {
                  const b = s.businesses.find((x) => x.id === c.bizId)!;
                  return (
                    <button key={c.id} type="button" className="menu-item" aria-current={biz?.id === b.id} onClick={() => choose(() => openClient(b.id))}>
                      <Avatar initials={b.initials} tone={b.tone} />
                      <span style={{ flex: 1, minWidth: 0 }} className="switch-name">
                        {b.name}
                      </span>
                    </button>
                  );
                })}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SideContent({ onNavigate }: { onNavigate?: () => void }) {
  const s = useApp();
  const live = useLive();
  const liveEnv = live?.env;
  const { route } = useRoute();
  const biz = activeBiz(s);
  const accountant = s.persona === 'accountant';
  const go = (r: Route) => {
    navigate(r);
    onNavigate?.();
  };
  const person = accountant ? { name: s.firm.user.name, role: `${s.firm.user.role}, ${s.firm.name}`, initials: s.firm.user.initials } : biz?.owner;
  return (
    <div className="side-inner">
      <div className="brand">
        <Logo />
        Sahkan
      </div>
      <Switcher onNavigate={onNavigate} />
      <nav className="nav" aria-label="Sections">
        {accountant && biz && (
          <button
            type="button"
            className="nav-item nav-back"
            onClick={() => {
              openClient(null);
              onNavigate?.();
            }}
          >
            {ic(ArrowLeft)}
            All clients
          </button>
        )}
        {navFor(s).map((n) => (
          <button key={n.name} type="button" className="nav-item" aria-current={isOn(n.name, route) ? 'page' : undefined} onClick={() => go({ name: n.name } as Route)}>
            {ic(n.icon)}
            {n.label}
            {!!n.badge && <span className="badge">{n.badge}</span>}
          </button>
        ))}
      </nav>
      {biz && (
        <nav className="nav" aria-label="Try it">
          <div className="nav-group">Try it</div>
          <button type="button" className="nav-item" aria-current={route.name === 'buyer' ? 'page' : undefined} onClick={() => go({ name: 'buyer' })}>
            {ic(Smartphone)}
            Buyer's phone
          </button>
        </nav>
      )}
      <div className="side-foot">
        <button type="button" className="conn" onClick={() => go({ name: 'settings' })}>
          <span className="icon-box tone-0" style={{ width: 34, height: 34, borderRadius: 9 }}>
            {ic(ShieldCheck, 'ico-sm')}
          </span>
          <span style={{ minWidth: 0 }}>
            <span className="strong" style={{ display: 'block', fontSize: 13 }}>
              {s.workspace === 'live' ? `MyInvois ${liveEnv === 'production' ? 'production' : 'sandbox'}` : 'MyInvois, simulated'}
            </span>
            <span className="small">
              {accountant
                ? `Intermediary for ${plural(s.clients.filter((c) => c.bizId).length, 'client')}`
                : s.workspace === 'live'
                  ? live?.configured
                    ? 'Connected as the taxpayer'
                    : 'Not set up on the server'
                  : 'Sample data only'}
            </span>
          </span>
        </button>
        {person && (
          <div className="me">
            <Avatar initials={person.initials} tone={accountant ? 'solid' : 4} round />
            <span style={{ minWidth: 0 }}>
              <span className="strong" style={{ display: 'block', fontSize: 13.5 }}>{person.name}</span>
              <span className="small">{person.role}</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" style={{ fill: 'var(--brand)' }} />
      <path d="M10 8.5h8.5l4 4V23a1.5 1.5 0 0 1-1.5 1.5H10A1.5 1.5 0 0 1 8.5 23V10A1.5 1.5 0 0 1 10 8.5Z" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinejoin="round" />
      <path d="M12.5 17.2l2.6 2.6 5-5.2" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const TITLES: Partial<Record<Route['name'], string>> = {
  today: 'Today',
  invoices: 'E-invoices',
  doc: 'E-invoice',
  compose: 'New e-invoice',
  requests: 'Buyer requests',
  received: 'Received e-invoices',
  buyer: "Buyer's phone",
  monthend: 'Month-end',
  buyers: 'Buyers',
  items: 'Items',
  settings: 'Settings',
  clients: 'Clients',
};

// ---------------------------------------------------------------------------
// Demo guide

const STEPS: { key: GuideKey; title: string; sub: string }[] = [
  { key: 'fix', title: 'Fix a rejected e-invoice', sub: 'INV-0916 has a buyer TIN LHDN rejected.' },
  { key: 'big', title: 'Send an e-invoice above RM10,000', sub: 'Big sales go to LHDN on their own.' },
  { key: 'request', title: "Approve a buyer's request", sub: 'Five buyers asked from their receipt QR.' },
  { key: 'monthend', title: "File October's month-end", sub: 'Cheras is imported and ready.' },
  { key: 'accountant', title: 'See it as the accountant', sub: 'One board for every client.' },
];

function runStep(s: State, key: GuideKey) {
  const jaya = (r: Route) => {
    if (s.persona === 'owner') navigate(r);
    else openClient('jaya', r);
  };
  if (key === 'fix') {
    const bad = s.docs.filter((d) => d.bizId === 'jaya' && d.status === 'invalid');
    const pick = bad.find((d) => d.number === 'INV-0916') ?? bad[0];
    jaya(pick ? { name: 'doc', id: pick.id } : { name: 'invoices', filter: 'invalid' });
  } else if (key === 'big') jaya({ name: 'compose', buyerId: 'b_harmoni' });
  else if (key === 'request') jaya({ name: 'requests' });
  else if (key === 'monthend') {
    const run = s.runs.find((r) => r.bizId === 'jaya' && r.period === '2026-10' && r.stage === 'imported') ?? s.runs.find((r) => r.bizId === 'jaya' && r.period === '2026-10' && r.stage !== 'done');
    jaya({ name: 'monthend', runId: run?.id });
  } else if (key === 'accountant') {
    if (s.persona === 'accountant') openClient(null);
    else switchPersona('accountant');
  }
}

function Guide() {
  const s = useApp();
  const ref = useRef<HTMLElement>(null);
  const open = s.guide.open;
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const el = e.target as Node;
      if (ref.current?.contains(el) || document.getElementById('guide-toggle')?.contains(el)) return;
      setGuideOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setGuideOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  if (!open) return null;
  const done = STEPS.filter((x) => s.guide.done[x.key]).length;
  return (
    <aside className="guide" aria-labelledby="guide-title" ref={ref} id="guide">
      <div className="guide-head">
        <div>
          <h2 className="h3" id="guide-title">
            Things to try
          </h2>
          <div className="small">
            {done} of {STEPS.length} done. Each one takes under a minute.
          </div>
        </div>
        <Button variant="ghost" size="sm" aria-label="Close the guide" onClick={() => setGuideOpen(false)} icon={ic(X)} />
      </div>
      <ol className="guide-list">
        {STEPS.map((x) => {
          const ok = s.guide.done[x.key];
          return (
            <li key={x.key}>
              <button
                type="button"
                className="guide-item"
                onClick={() => {
                  setGuideOpen(false);
                  runStep(s, x.key);
                }}
                id={`guide-${x.key}`}
              >
                <span className={cx('tick', ok && 'tick-on')} aria-hidden="true">
                  {ok && <Check className="ico-sm" />}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span className="strong" style={{ display: 'block', fontSize: 13.5, textDecoration: ok ? 'line-through' : undefined, color: ok ? 'var(--muted)' : undefined }}>
                    {x.title}
                  </span>
                  <span className="small">{x.sub}</span>
                  <span className="sr-only">{ok ? ' Done.' : ''}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Toasts and the reset dialog

function Toasts() {
  const list = useToasts();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={cx('toast', `toast-${t.tone}`)}>
          {ic(t.tone === 'bad' ? CircleAlert : t.tone === 'info' ? Info : CircleCheck)}
          <span className="toast-text">{t.text}</span>
          {t.action && (
            <button
              type="button"
              className="toast-act"
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button type="button" className="toast-x" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
            {ic(X, 'ico-sm')}
          </button>
        </div>
      ))}
    </div>
  );
}

function ResetDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      id="reset-dialog"
      open={open}
      onClose={onClose}
      title="Start the demo over?"
      foot={
        <>
          <Button onClick={onClose}>Keep going</Button>
          <Button
            variant="danger"
            icon={ic(RotateCcw, 'ico-sm')}
            onClick={() => {
              onClose();
              resetDemo();
            }}
            id="reset-confirm"
          >
            Reset demo
          </Button>
        </>
      }
    >
      <p>Everything goes back to the sample data, on Tuesday 3 November 2026 at 10:15 am. Anything you made in the demo is cleared.</p>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

export function Shell({ children }: { children: ReactNode }) {
  const s = useApp();
  const live = useLive();
  const { route, key } = useRoute();
  const t = useNow(30_000);
  const [drawer, setDrawer] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const biz = activeBiz(s);
  const done = STEPS.filter((x) => s.guide.done[x.key]).length;
  useEffect(() => setDrawer(false), [key]);
  useEffect(() => {
    if (!drawer) return;
    document.getElementById('menu-close')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawer(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawer]);
  const urgent = biz ? attention(s, biz.id, t).invalid.length : 0;

  return (
    <div className="shell">
      <aside className="side" aria-label="Main menu">
        <SideContent />
      </aside>
      <div className="main">
        <header className="topbar">
          <Button variant="ghost" aria-label="Open menu" aria-expanded={drawer} onClick={() => setDrawer(true)} icon={ic(Menu)} id="menu-open" />
          <div className="topbar-title">
            <span className="strong" style={{ fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {TITLES[route.name] ?? 'Sahkan'}
            </span>
            <span className="small" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {biz ? biz.short : s.firm.name}
              {urgent ? `, ${urgent} to fix` : ''}
            </span>
          </div>
          {biz && (
            <Button size="sm" variant="primary" icon={ic(Plus, 'ico-sm')} onClick={() => navigate({ name: 'compose' })} id="top-new">
              New
            </Button>
          )}
        </header>
        <div className="banner-wrap">
        {s.workspace === 'live' ? (
          <div className="banner" role="note">
            <span className="banner-text">
              {ic(PlugZap, 'ico-sm')}
              <span>
                {live?.env === 'production'
                  ? 'Live on MyInvois production. What you submit is filed with LHDN.'
                  : "MyInvois sandbox. What you submit goes to LHDN's test system, not for tax."}
                {live === null && ' The MyInvois server is not reachable.'}
              </span>
            </span>
            <span className="banner-actions">
              <button type="button" className="banner-btn" onClick={() => openWorkspace('demo')} id="to-demo">
                {ic(FlaskConical, 'ico-sm')}
                Back to the demo
              </button>
            </span>
          </div>
        ) : (
          <>
            <div className="banner" role="note">
              <span className="banner-text">
                {ic(FlaskConical, 'ico-sm')}
                <span>
                  Demo with sample data. Nothing is sent to LHDN. <span className="banner-clock">Demo clock: {date(t)}, {time(t)}</span>
                </span>
              </span>
              <span className="banner-actions">
                {live?.configured && (
                  <button type="button" className="banner-btn" onClick={() => openWorkspace('live')} id="to-live">
                    {ic(PlugZap, 'ico-sm')}
                    Use MyInvois {live.env}
                  </button>
                )}
                <button type="button" className="banner-btn" onClick={() => setGuideOpen(!s.guide.open)} aria-expanded={s.guide.open} aria-controls="guide" id="guide-toggle">
                  {ic(ListChecks, 'ico-sm')}
                  Things to try {done}/{STEPS.length}
                </button>
                <button type="button" className="banner-btn" onClick={() => setResetOpen(true)} id="reset-open">
                  {ic(RotateCcw, 'ico-sm')}
                  Reset
                </button>
              </span>
            </div>
            <Guide />
          </>
        )}
        </div>
        <main className="page" id="main">
          {children}
        </main>
      </div>
      {drawer && (
        <>
          <div className="drawer-scrim" onClick={() => setDrawer(false)} />
          <div className="drawer" role="dialog" aria-modal="true" aria-label="Menu">
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '10px 12px 0' }}>
              <Button variant="ghost" size="sm" aria-label="Close menu" onClick={() => setDrawer(false)} icon={ic(X)} id="menu-close" />
            </div>
            <SideContent onNavigate={() => setDrawer(false)} />
          </div>
        </>
      )}
      <Toasts />
      <ResetDialog open={resetOpen} onClose={() => setResetOpen(false)} />
    </div>
  );
}
