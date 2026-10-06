/**
 * What monsters and chests drop: gold always (more in later levels and from tougher foes),
 * sometimes a spell book. Pure rules, unit tested; Game spawns the pickups.
 */

export type Tier = 'normal' | 'elite' | 'guardian';

export type Drop = { kind: 'gold'; amount: number } | { kind: 'book' };

export const LOOT = {
  /** Gold per kill: [min, max] at level 1, plus `perLevel` × (level − 1) on each end. */
  gold: { normal: [2, 5], elite: [8, 14], guardian: [45, 60] } as Record<Tier, [number, number]>,
  goldPerLevel: { normal: 1, elite: 3, guardian: 20 } as Record<Tier, number>,
  /** Chance of a spell book. */
  book: { normal: 0.03, elite: 0.1, guardian: 1 } as Record<Tier, number>,
  /** A chest: gold (plus per level) and a chance of a book. */
  chestGold: [30, 45] as [number, number],
  chestGoldPerLevel: 10,
  chestBook: 0.6,
};

/** Monsters this tough (max HP) count as elites. */
export const ELITE_HP = 140;

export function tierOf(enemy: { bossName: string | null; maxHp: number }): Tier {
  if (enemy.bossName) return 'guardian';
  return enemy.maxHp >= ELITE_HP ? 'elite' : 'normal';
}

const between = (rng: () => number, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));

/** Loot from a kill on level `level` (1-based). */
export function rollLoot(tier: Tier, level: number, rng: () => number): Drop[] {
  const [lo, hi] = LOOT.gold[tier];
  const extra = LOOT.goldPerLevel[tier] * Math.max(0, level - 1);
  const drops: Drop[] = [{ kind: 'gold', amount: between(rng, lo + extra, hi + extra) }];
  if (rng() < LOOT.book[tier]) drops.push({ kind: 'book' });
  return drops;
}

/** Loot from a chest on level `level`. */
export function chestLoot(level: number, rng: () => number): Drop[] {
  const extra = LOOT.chestGoldPerLevel * Math.max(0, level - 1);
  const drops: Drop[] = [{ kind: 'gold', amount: between(rng, LOOT.chestGold[0] + extra, LOOT.chestGold[1] + extra) }];
  if (rng() < LOOT.chestBook) drops.push({ kind: 'book' });
  return drops;
}
