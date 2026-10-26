// Files go to the viewer through the artifact's `downloads` capability.
// Outside an artifact viewer it resolves to null and download buttons stay hidden.
import { useEffect, useState } from 'react';

interface Downloads {
  save: (req: { filename: string; data: string | Blob | ArrayBuffer }) => Promise<{ status: string }>;
}

let pending: Promise<Downloads | null> | null = null;

export function downloads(): Promise<Downloads | null> {
  if (!pending) {
    const c = (window as unknown as { claude?: { use?: (n: string) => Promise<unknown> } }).claude;
    pending =
      c && typeof c.use === 'function'
        ? (c.use('downloads') as Promise<Downloads | null>).catch(() => null)
        : Promise.resolve(null);
  }
  return pending;
}

export function useDownloads(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let live = true;
    downloads().then((d) => live && setOk(!!d));
    return () => {
      live = false;
    };
  }, []);
  return ok;
}

export type SaveOutcome = 'saved' | 'declined' | 'busy' | 'failed';

export async function saveFile(filename: string, data: string | Blob): Promise<SaveOutcome> {
  const d = await downloads();
  if (!d) return 'failed';
  try {
    await d.save({ filename, data });
    return 'saved';
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === 'declined') return 'declined';
    if (code === 'rate_limited') return 'busy';
    return 'failed';
  }
}
