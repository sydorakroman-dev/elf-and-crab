export interface Best {
  score: number;
  wave: number;
}

const KEY = 'elf-and-crab:best';

/** Minimal Storage shape, so tests can pass a fake. */
type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStore(): KeyValueStore | null {
  try {
    return window.localStorage;
  } catch {
    return null; // storage blocked (e.g. some private modes)
  }
}

/** Best run so far, or null if there isn't one (or storage is unavailable/corrupt). */
export function loadBest(store: KeyValueStore | null = defaultStore()): Best | null {
  try {
    const raw = store?.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Best>;
    return Number.isFinite(v.score) && Number.isFinite(v.wave) ? { score: v.score!, wave: v.wave! } : null;
  } catch {
    return null;
  }
}

/** Records a finished run; returns true if it's a new best (higher score, ties broken by wave). */
export function recordRun(run: Best, store: KeyValueStore | null = defaultStore()): boolean {
  const best = loadBest(store);
  const isBest = !best || run.score > best.score || (run.score === best.score && run.wave > best.wave);
  if (isBest) {
    try {
      store?.setItem(KEY, JSON.stringify(run));
    } catch {
      // Quota or blocked storage: the run still counts as a best for this session's message.
    }
  }
  return isBest;
}
