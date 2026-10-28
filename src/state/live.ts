import { useSyncExternalStore } from 'react';
import { liveStatus, type LiveStatus } from '../lib/myinvois';

// What the server says about its MyInvois setup. undefined while asking, null when there is
// no server (the single-file build) and the app can only run the simulated demo.
let status: LiveStatus | null | undefined;
const listeners = new Set<() => void>();

export async function refreshLive(): Promise<LiveStatus | null> {
  status = await liveStatus();
  listeners.forEach((l) => l());
  return status;
}

export const getLive = () => status;

export function useLive(): LiveStatus | null | undefined {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => status,
    () => status,
  );
}
