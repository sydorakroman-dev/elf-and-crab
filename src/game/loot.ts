/**
 * What monsters and chests drop: gold always (more in later levels and from tougher foes),
 * sometimes a spell book, a piece of gear or a potion. Pure rules, unit tested; Game spawns the pickups.
 */
import { rollRarity, type PotionKind, type Rarity } from './items';

export type Tier = 'normal' | 'elite' | 'guardian';

export type Drop = { kind: 'gold'; amount: number } | { kind: 'book' } | { kind: 'item'; rarity: Rarity } | { kind: 'potion'; potion: PotionKind };

export const LOOT = {
  /** Gold per kill: [min, max] at level 1, plus `perLevel` × (level − 1) on each end. */
  gold: { normal: [2, 5], elite: [8, 14], guardian: [45, 60] } as Record<Tier, [number, number]>,
  goldPerLevel: { normal: 1, elite: 3, guardian: 20 } as Record<Tier, number>,
  /** Chance of a spell book. */
  book: { normal: 0.03, elite: 0.1, guardian: 1 } as Record<Tier, number>,
  /** Chance of a piece of gear, and the odds of [common, rare, epic]. */
  item: { normal: 0.04, elite: 0.12, guardian: 1 } as Record<Tier, number>,
  rarity: { normal: [75, 22, 3], elite: [50, 40, 10], guardian: [0, 65, 35] } as Record<Tier, [number, number, number]>,
  /** Chance of a potion (health or mana, evenly). */
  potion: { normal: 0.06, elite: 0.12, guardian: 0.5 } as Record<Tier, number>,
  /** A chest: gold (plus per level), a chance of a book, and of gear. */
  chestGold: [30, 45] as [number, number],
  chestGoldPerLevel: 10,
  chestBook: 0.6,
  chestItem: 0.6,
  chestRarity: [40, 45, 15] as [number, number, number],
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
  if (rng() < LOOT.item[tier]) drops.push({ kind: 'item', rarity: rollRarity(rng, LOOT.rarity[tier]) });
  if (rng() < LOOT.potion[tier]) drops.push({ kind: 'potion', potion: rng() < 0.5 ? 'health' : 'mana' });
  return drops;
}

/**
 * Loot from a chest on level `level`. `detour`: how far (m) off the shortest way to the guardian
 * it lies — the further out of the way, the richer (more gold, likelier books, rarer gear).
 */
export function chestLoot(level: number, rng: () => number, detour = 0): Drop[] {
  const extra = LOOT.chestGoldPerLevel * Math.max(0, level - 1);
  const far = Math.min(1, detour / 150); // 0 on the way … 1 at 150 m or more out of the way
  const gold = between(rng, LOOT.chestGold[0] + extra, LOOT.chestGold[1] + extra);
  const drops: Drop[] = [{ kind: 'gold', amount: Math.round(gold * (1 + far)) }];
  if (rng() < LOOT.chestBook + far * 0.3) drops.push({ kind: 'book' });
  const [c, r, e] = LOOT.chestRarity;
  if (rng() < LOOT.chestItem + far * 0.4) drops.push({ kind: 'item', rarity: rollRarity(rng, [c * (1 - far), r, e * (1 + far * 2)]) });
  return drops;
}
