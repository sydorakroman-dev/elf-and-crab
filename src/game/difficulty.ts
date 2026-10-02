/**
 * Difficulty levels: how tough enemies are, how hard they hit the elf, and how score counts.
 * Chosen on the title screen and remembered in the browser; applied when enemies are created
 * and when the elf takes damage.
 */
export type Difficulty = 'easy' | 'normal' | 'hard';

export const DIFFICULTIES: Record<Difficulty, { label: string; icon: string; enemyHp: number; enemyDamage: number; score: number; blurb: string }> = {
  easy: { label: 'Easy', icon: '🌱', enemyHp: 0.65, enemyDamage: 0.55, score: 0.5, blurb: 'Weaker monsters that hit softer — see all seven rooms.' },
  normal: { label: 'Normal', icon: '⚔️', enemyHp: 1, enemyDamage: 1, score: 1, blurb: 'The intended challenge.' },
  hard: { label: 'Hard', icon: '🔥', enemyHp: 1.35, enemyDamage: 1.3, score: 1.5, blurb: 'Tougher monsters, harder hits, more score.' },
};
export const DIFFICULTY_LIST: Difficulty[] = ['easy', 'normal', 'hard'];

const KEY = 'elf-and-crab:difficulty';
let current: Difficulty = load();

function load(): Difficulty {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'easy' || v === 'hard' ? v : 'normal';
  } catch {
    return 'normal';
  }
}

export function difficulty(): Difficulty {
  return current;
}

export function setDifficulty(d: Difficulty): void {
  current = d;
  try {
    localStorage.setItem(KEY, d);
  } catch {
    // not remembered, still applies to this session
  }
}

/** Enemy HP for this difficulty. */
export function scaledHp(hp: number): number {
  return Math.max(1, Math.round(hp * DIFFICULTIES[current].enemyHp));
}

/** Damage to the elf for this difficulty (at least 1). */
export function scaledDamage(amount: number): number {
  return Math.max(1, Math.round(amount * DIFFICULTIES[current].enemyDamage));
}
