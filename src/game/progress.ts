import type { Difficulty } from './difficulty';

/**
 * What the player has achieved, kept in the browser: the furthest room reached (runs can
 * continue from any room up to it), and which difficulties have been beaten.
 */
export interface Progress {
  /** Highest room index reached (0-based). */
  furthest: number;
  /** Difficulties the Ash King has been beaten on. */
  wins: Difficulty[];
}

const KEY = 'elf-and-crab:progress';
type Store = Pick<Storage, 'getItem' | 'setItem'>;

function store(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadProgress(s: Store | null = store()): Progress {
  try {
    const v = JSON.parse(s?.getItem(KEY) ?? 'null') as Partial<Progress> | null;
    const furthest = Number.isInteger(v?.furthest) ? Math.max(0, v!.furthest!) : 0;
    const wins = Array.isArray(v?.wins) ? v!.wins!.filter((d): d is Difficulty => d === 'easy' || d === 'normal' || d === 'hard') : [];
    return { furthest, wins };
  } catch {
    return { furthest: 0, wins: [] };
  }
}

function save(p: Progress, s: Store | null): void {
  try {
    s?.setItem(KEY, JSON.stringify(p));
  } catch {
    // not saved: progress just won't carry over
  }
}

/** Records reaching room `room`; returns the updated progress. */
export function reachRoom(room: number, s: Store | null = store()): Progress {
  const p = loadProgress(s);
  if (room > p.furthest) {
    p.furthest = room;
    save(p, s);
  }
  return p;
}

/** Records a win on `d`; returns the updated progress. */
export function recordWin(d: Difficulty, s: Store | null = store()): Progress {
  const p = loadProgress(s);
  if (!p.wins.includes(d)) {
    p.wins.push(d);
    save(p, s);
  }
  return p;
}
