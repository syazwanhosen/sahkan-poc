// Small shared building blocks. Styling lives in styles.css.
import {
  forwardRef,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  Ban,
  Check,
  CircleAlert,
  CircleCheck,
  Copy,
  FileText,
  LoaderCircle,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { DocStatus } from './types';
import { now } from './lib/clock';
import { toast } from './state/toast';

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

/** A decorative icon. */
export const ic = (C: LucideIcon, cls = 'ico') => <C className={cls} aria-hidden="true" />;

/** Re-renders on an interval with the demo clock's current time. */
export function useNow(ms = 1000): number {
  const [t, setT] = useState(now);
  useEffect(() => {
    const id = setInterval(() => setT(now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return t;
}

// ---------------------------------------------------------------------------
// Buttons, chips

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  size?: 'sm' | 'lg';
  icon?: ReactNode;
  block?: boolean;
  busy?: boolean;
};

export function Button({ variant = 'default', size, icon, block, busy, className, children, disabled, type = 'button', ...rest }: BtnProps) {
  return (
    <button
      type={type}
      className={cx('btn', variant !== 'default' && `btn-${variant}`, size && `btn-${size}`, block && 'btn-block', !children && 'btn-icon', className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? ic(LoaderCircle, 'ico spin') : icon}
      {children}
    </button>
  );
}

export type Tone = 'ok' | 'info' | 'bad' | 'due' | 'mute' | 'draft';

export function Chip({ tone, icon, children, lg, title }: { tone: Tone; icon?: ReactNode; children: ReactNode; lg?: boolean; title?: string }) {
  return (
    <span className={cx('chip', `chip-${tone}`, !icon && 'chip-plain', lg && 'chip-lg')} title={title}>
      {icon}
      {children}
    </span>
  );
}

const STATUS: Record<DocStatus, { tone: Tone; label: string; icon: LucideIcon }> = {
  draft: { tone: 'draft', label: 'Draft', icon: FileText },
  submitted: { tone: 'info', label: 'Submitted', icon: LoaderCircle },
  valid: { tone: 'ok', label: 'Valid', icon: CircleCheck },
  invalid: { tone: 'bad', label: 'Invalid', icon: CircleAlert },
  cancelled: { tone: 'mute', label: 'Cancelled', icon: Ban },
};

export function StatusChip({ status, lg }: { status: DocStatus; lg?: boolean }) {
  const m = STATUS[status];
  return (
    <Chip tone={m.tone} lg={lg} icon={ic(m.icon, status === 'submitted' ? 'ico-sm spin' : 'ico-sm')}>
      {m.label}
    </Chip>
  );
}

export function Note({ tone = 'info', icon, children, className }: { tone?: 'info' | 'ok' | 'bad' | 'due'; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cx('note', `note-${tone}`, className)}>
      {icon}
      <div style={{ minWidth: 0, flex: 1 }}>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layout

export function PageHeader({
  title,
  sub,
  crumb,
  actions,
  status,
}: {
  title: ReactNode;
  sub?: ReactNode;
  crumb?: { label: string; onClick: () => void };
  actions?: ReactNode;
  status?: ReactNode;
}) {
  return (
    <header className="ph">
      <div style={{ minWidth: 0 }}>
        {crumb && (
          <button type="button" className="crumb" onClick={crumb.onClick}>
            {ic(ArrowLeft, 'ico-sm')}
            {crumb.label}
          </button>
        )}
        <div className="row" style={{ gap: 12 }}>
          <h1 className="ph-title">{title}</h1>
          {status}
        </div>
        {sub && <p className="ph-sub">{sub}</p>}
      </div>
      {actions && <div className="ph-actions">{actions}</div>}
    </header>
  );
}

export function Panel({
  title,
  sub,
  actions,
  children,
  className,
  pad,
}: {
  title?: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  pad?: boolean;
}) {
  const id = useId();
  return (
    <section className={cx('panel', className)} aria-labelledby={title ? id : undefined}>
      {title && (
        <div className="panel-head">
          <div style={{ minWidth: 0 }}>
            <h2 className="h2" id={id}>
              {title}
            </h2>
            {sub && <p className="hint" style={{ marginTop: 3 }}>{sub}</p>}
          </div>
          {actions && <div className="row" style={{ gap: 8 }}>{actions}</div>}
        </div>
      )}
      {pad ? <div className="pad">{children}</div> : children}
    </section>
  );
}

export function Empty({ icon, title, children }: { icon?: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon && ic(icon)}
      <div className="strong" style={{ color: 'var(--ink)' }}>{title}</div>
      {children}
    </div>
  );
}

export function Avatar({ initials, tone = 0, round, lg }: { initials: string; tone?: number | 'solid'; round?: boolean; lg?: boolean }) {
  return (
    <span className={cx('avatar', round && 'avatar-round', lg && 'avatar-lg', tone === 'solid' ? 'tone-solid' : `tone-${tone % 6}`)} aria-hidden="true">
      {initials}
    </span>
  );
}

export function Progress({ value, label }: { value: number; label: string }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)}>
      <div style={{ width: `${v * 100}%` }} />
    </div>
  );
}

export function Tabs<T extends string>({ id, value, tabs, onChange }: { id: string; value: T; tabs: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist" aria-label="Views">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          id={`${id}-tab-${t.value}`}
          aria-selected={value === t.value}
          aria-controls={`${id}-panel`}
          className="tab"
          onClick={() => onChange(t.value)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Forms

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
  action,
}: {
  label: ReactNode;
  htmlFor: string;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <div className={cx('field', className)}>
      <div className="field-top">
        <label className="label" htmlFor={htmlFor}>
          {label}
        </label>
        {action}
      </div>
      {children}
      {error ? (
        <div className="err" id={`${htmlFor}-msg`}>
          {ic(CircleAlert, 'ico-sm')}
          <span>{error}</span>
        </div>
      ) : hint ? (
        <div className="hint" id={`${htmlFor}-msg`}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input(
  { invalid, className, ...rest },
  ref,
) {
  return <input ref={ref} className={cx('input', className)} aria-invalid={invalid || undefined} {...rest} />;
});

export function Select({ invalid, className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select className={cx('select', className)} aria-invalid={invalid || undefined} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx('textarea', className)} {...rest} />;
}

/** A number field that lets people type freely ("2.", "") and reports a parsed value. */
export function NumInput({
  id,
  value,
  onChange,
  label,
  invalid,
  className,
}: {
  id: string;
  value: number;
  onChange: (n: number) => void;
  label?: string;
  invalid?: boolean;
  className?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    const parsed = parseFloat(text.replace(/,/g, ''));
    if ((Number.isFinite(parsed) ? parsed : 0) !== value) setText(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      id={id}
      className={cx('input num', className)}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={text}
      aria-label={label}
      aria-invalid={invalid || undefined}
      onChange={(e) => {
        setText(e.target.value);
        const n = parseFloat(e.target.value.replace(/,/g, ''));
        onChange(Number.isFinite(n) ? n : 0);
      }}
    />
  );
}

export function Switch({
  id,
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="switch" htmlFor={id}>
      <span style={{ minWidth: 0 }}>
        <span className="strong" style={{ display: 'block' }}>
          {label}
        </span>
        {hint && <span className="hint">{hint}</span>}
      </span>
      <input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" aria-hidden="true" />
    </label>
  );
}

export function Segmented<T extends string>({
  id,
  value,
  options,
  onChange,
  label,
  size,
}: {
  id: string;
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (v: T) => void;
  label: string;
  size?: 'sm';
}) {
  return (
    <div className={cx('seg', size === 'sm' && 'seg-sm')} role="radiogroup" aria-label={label} id={id}>
      {options.map((o) => (
        <button
          key={o.value}
          id={`${id}-${o.value}`}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className="seg-btn"
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal

export function Modal({
  id,
  open,
  onClose,
  title,
  sub,
  children,
  foot,
  wide,
}: {
  id: string;
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  sub?: ReactNode;
  children: ReactNode;
  foot?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('[data-autofocus]') ?? el?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close])');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close.current();
      }
      if (e.key === 'Tab' && el) {
        const f = [...el.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
          (x) => !x.hasAttribute('disabled'),
        );
        if (!f.length) return;
        const a = f[0];
        const z = f[f.length - 1];
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          z.focus();
        } else if (!e.shiftKey && document.activeElement === z) {
          e.preventDefault();
          a.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div
      className="modal-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={cx('modal', wide && 'modal-wide')} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} id={id} ref={ref}>
        <div className="modal-head">
          <div style={{ minWidth: 0 }}>
            <h2 className="h2" id={`${id}-title`}>
              {title}
            </h2>
            {sub && <p className="hint" style={{ marginTop: 4 }}>{sub}</p>}
          </div>
          <Button variant="ghost" size="sm" aria-label="Close" data-close="" onClick={onClose} icon={ic(X)} />
        </div>
        <div className="modal-body">{children}</div>
        {foot && <div className="modal-foot">{foot}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Copy

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label={label}
      title={label}
      icon={done ? ic(Check, 'ico-sm') : ic(Copy, 'ico-sm')}
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } else {
          toast("Couldn't copy here. Select the text instead.", { tone: 'info' });
        }
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Combobox: a text box with a list of suggestions.

export function Combobox<T>({
  id,
  label,
  placeholder,
  items,
  getKey,
  filter,
  render,
  onPick,
  extra = [],
  value,
  onChange,
  invalid,
  maxItems = 8,
  autoFocus,
  labelledBy,
}: {
  id: string;
  label: string;
  placeholder?: string;
  items: T[];
  getKey: (t: T) => string;
  filter: (t: T, q: string) => boolean;
  render: (t: T) => ReactNode;
  onPick: (t: T) => void;
  extra?: { key: string; render: ReactNode; onPick: () => void }[];
  value?: string;
  onChange?: (v: string) => void;
  invalid?: boolean;
  maxItems?: number;
  autoFocus?: boolean;
  labelledBy?: string;
}) {
  const [own, setOwn] = useState('');
  const text = value ?? own;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const q = text.trim().toLowerCase();
  const list = useMemo(() => items.filter((t) => filter(t, q)).slice(0, maxItems), [items, q, filter, maxItems]);
  const total = list.length + extra.length;

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const pick = (i: number) => {
    if (i < list.length) onPick(list[i]);
    else extra[i - list.length]?.onPick();
    setOpen(false);
    if (value === undefined) setOwn('');
  };
  const listId = `${id}-list`;
  const show = open && total > 0;
  const option = (i: number, key: string, body: ReactNode) => (
    <li
      key={key}
      id={`${id}-opt-${i}`}
      role="option"
      aria-selected={i === active}
      className="option"
      onMouseDown={(e) => {
        e.preventDefault();
        pick(i);
      }}
      onMouseEnter={() => setActive(i)}
    >
      {body}
    </li>
  );

  return (
    <div className="combo" ref={wrap}>
      <input
        id={id}
        className="input"
        role="combobox"
        aria-expanded={show}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={show ? `${id}-opt-${active}` : undefined}
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        placeholder={placeholder}
        value={text}
        autoFocus={autoFocus}
        onChange={(e) => {
          if (value === undefined) setOwn(e.target.value);
          else onChange?.(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(total - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter' && show) {
            e.preventDefault();
            pick(active);
          } else if (e.key === 'Escape') {
            setOpen(false);
          } else if (e.key === 'Tab') {
            setOpen(false);
          }
        }}
      />
      {show && (
        <ul className="listbox" role="listbox" id={listId} aria-label={label}>
          {list.map((t, i) => option(i, getKey(t), render(t)))}
          {extra.map((x, k) => option(list.length + k, x.key, x.render))}
        </ul>
      )}
    </div>
  );
}
