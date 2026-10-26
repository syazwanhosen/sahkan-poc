import { useSyncExternalStore } from 'react';
import type { State } from '../types';
import { STATE_VERSION, makeSeed } from '../data/seed';
import { startClock } from '../lib/clock';

// One in-memory store for the whole demo. It is kept in sessionStorage so a reload
// in the same tab continues the demo; closing the tab starts fresh.
const KEY = 'sahkan-demo';
let state: State;
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function load(): State | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as State;
    return s && s.v === STATE_VERSION ? s : null;
  } catch {
    return null;
  }
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* storage unavailable: the demo still works for this visit */
    }
  }, 300);
}

function emit() {
  listeners.forEach((l) => l());
}

export function initStore(hot?: unknown) {
  // Seeding also registers the sample sales files, so it always runs.
  const fresh = makeSeed(Date.now());
  const fromHot = hot && (hot as State).v === STATE_VERSION ? (hot as State) : null;
  state = fromHot ?? load() ?? fresh;
  startClock(state.realStart);
}

export function resetState() {
  state = makeSeed(Date.now());
  startClock(state.realStart);
  save();
  emit();
}

export function getState(): State {
  return state;
}

export function setState(fn: (s: State) => State) {
  const next = fn(state);
  if (next === state) return;
  state = next;
  save();
  emit();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useApp(): State {
  return useSyncExternalStore(subscribe, getState, getState);
}
