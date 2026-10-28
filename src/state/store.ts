import { useSyncExternalStore } from 'react';
import type { State, Workspace } from '../types';
import { STATE_VERSION, makeLiveSeed, makeSeed, withPeriodRuns } from '../data/seed';
import { setRealClock, startClock } from '../lib/clock';

// One in-memory store for the whole app, holding one of two workspaces. The demo is kept in
// sessionStorage so a reload in the same tab continues it and closing the tab starts fresh.
// The live workspace is kept in localStorage: what it holds was filed with LHDN, so it survives
// closing the browser.
const KEYS: Record<Workspace, string> = { demo: 'sahkan-demo', live: 'sahkan-live' };
const PICK = 'sahkan-workspace';
let state: State;
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function storage(ws: Workspace): Storage | null {
  try {
    return ws === 'live' ? localStorage : sessionStorage;
  } catch {
    return null;
  }
}

function load(ws: Workspace): State | null {
  try {
    const raw = storage(ws)?.getItem(KEYS[ws]);
    if (!raw) return null;
    const s = JSON.parse(raw) as State;
    return s && s.v === STATE_VERSION && s.workspace === ws ? s : null;
  } catch {
    return null;
  }
}

function writeNow() {
  clearTimeout(saveTimer);
  try {
    storage(state.workspace)?.setItem(KEYS[state.workspace], JSON.stringify(state));
  } catch {
    /* storage unavailable: the app still works for this visit */
  }
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeNow, 300);
}

function emit() {
  listeners.forEach((l) => l());
}

/** Loads (or starts) a workspace and sets the clock it runs on. */
function open(ws: Workspace): State {
  setRealClock(ws === 'live');
  if (ws === 'live') return withPeriodRuns(load('live') ?? makeLiveSeed(Date.now()));
  return load('demo') ?? makeSeed(Date.now());
}

export function initStore(hot?: unknown) {
  // Seeding also registers the sample sales files, so it always runs.
  const fresh = makeSeed(Date.now());
  let ws: Workspace = 'demo';
  try {
    if (localStorage.getItem(PICK) === 'live') ws = 'live';
  } catch {
    /* no storage: the demo */
  }
  const fromHot = hot && (hot as State).v === STATE_VERSION ? (hot as State) : null;
  state = fromHot ?? (ws === 'demo' ? (load('demo') ?? fresh) : open('live'));
  setRealClock(state.workspace === 'live');
  startClock(state.realStart);
}

/** Switches between the demo and the live workspace, keeping each one's data. */
export function switchWorkspace(ws: Workspace) {
  if (state.workspace === ws) return;
  writeNow();
  try {
    localStorage.setItem(PICK, ws);
  } catch {
    /* the choice lasts for this visit */
  }
  state = open(ws);
  startClock(state.realStart);
  save();
  emit();
}

export function resetState() {
  if (state.workspace !== 'demo') return;
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
