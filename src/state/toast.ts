import { useSyncExternalStore } from 'react';

export interface Toast {
  id: number;
  tone: 'ok' | 'info' | 'bad';
  text: string;
  action?: { label: string; run: () => void };
}

let toasts: Toast[] = [];
let next = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(text: string, opts: { tone?: Toast['tone']; action?: Toast['action']; ms?: number } = {}) {
  const t: Toast = { id: ++next, tone: opts.tone ?? 'ok', text, action: opts.action };
  toasts = [...toasts, t].slice(-3);
  emit();
  setTimeout(() => dismiss(t.id), opts.ms ?? (opts.action ? 6000 : 4200));
}

export function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => toasts,
    () => toasts,
  );
}
