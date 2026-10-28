import { useSyncExternalStore } from 'react';
import type { DocType } from '../types';

export type Filter = 'all' | 'invalid' | 'submitted' | 'valid' | 'cancelled' | 'draft' | 'closing';

export type Route =
  | { name: 'today' }
  | { name: 'invoices'; filter?: Filter; q?: string }
  | { name: 'compose'; type?: DocType; fromId?: string; editId?: string; buyerId?: string }
  | { name: 'doc'; id: string; tab?: 'paper' | 'data' }
  | { name: 'requests' }
  | { name: 'received'; id?: string }
  | { name: 'monthend'; runId?: string }
  | { name: 'buyers' }
  | { name: 'items' }
  | { name: 'settings' }
  | { name: 'clients' }
  | { name: 'buyer' };

// Views live in memory: the artifact viewer doesn't route on the URL.
// A plain #token on the link opens one view directly (see main.tsx).
let route: Route = { name: 'today' };
let stack: Route[] = [];
let key = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function initRoute(r: Route) {
  route = r;
}

export function navigate(r: Route, opts: { replace?: boolean } = {}) {
  if (!opts.replace) stack = [...stack, route].slice(-40);
  route = r;
  key += 1;
  emit();
  try {
    window.scrollTo({ top: 0 });
  } catch {
    /* ignore */
  }
}

export function back(fallback: Route) {
  const prev = stack[stack.length - 1];
  stack = stack.slice(0, -1);
  route = prev ?? fallback;
  key += 1;
  emit();
}

export function useRoute(): { route: Route; key: number } {
  const snap = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => key,
    () => key,
  );
  return { route, key: snap };
}

export function currentRoute(): Route {
  return route;
}
