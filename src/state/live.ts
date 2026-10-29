import { useSyncExternalStore } from 'react';
import { liveStatus, setAccessKey, type LiveStatus } from '../lib/myinvois';

// What the server says about its MyInvois setup. undefined while asking, null when there is
// no server (the single-file build) and the app can only run the simulated demo.
let status: LiveStatus | null | undefined;
// Set while the access key dialog (shell.tsx) is open, with what to do once the server takes the key.
let asking: { then?: () => void } | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export async function refreshLive(): Promise<LiveStatus | null> {
  status = await liveStatus();
  emit();
  return status;
}

export const getLive = () => status;

export function useLive(): LiveStatus | null | undefined {
  return useSyncExternalStore(subscribe, () => status, () => status);
}

/** Asks for the server's access key; `then` runs once the server accepts it. */
export function askAccessKey(then?: () => void) {
  asking = { then };
  emit();
}

export function closeAccessKey() {
  asking = undefined;
  emit();
}

export function useAccessKeyAsk(): { then?: () => void } | undefined {
  return useSyncExternalStore(subscribe, () => asking, () => asking);
}

/** Tries a key with the server: null when it works (and the dialog closes), else why not. */
export async function tryAccessKey(key: string): Promise<string | null> {
  setAccessKey(key);
  const s = await refreshLive();
  if (!s) return "Can't reach the server to check the key.";
  if (s.locked) {
    setAccessKey('');
    return "That isn't the server's access key.";
  }
  const then = asking?.then;
  closeAccessKey();
  then?.();
  return null;
}
