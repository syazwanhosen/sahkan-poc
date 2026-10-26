const ALNUM = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Small seeded random generator (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** MyInvois-style identifier: 26 Latin alphanumeric characters. */
export function lhdnId(len = 26, rand: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < len; i++) s += ALNUM[Math.floor(rand() * ALNUM.length)];
  return s;
}

let counter = 0;
export function uid(prefix = 'id'): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function pick<T>(list: T[], rand: () => number): T {
  return list[Math.floor(rand() * list.length)];
}
