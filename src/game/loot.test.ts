import { describe, expect, it } from 'vitest';
import { ELITE_HP, chestLoot, rollLoot, tierOf, type Drop } from './loot';
import { mulberry32 } from '../util/rng';

const gold = (d: Drop[]) => d.reduce((s, x) => s + (x.kind === 'gold' ? x.amount : 0), 0);
const books = (runs: Drop[][]) => runs.filter((d) => d.some((x) => x.kind === 'book')).length / runs.length;

describe('loot', () => {
  it('sorts monsters into tiers', () => {
    expect(tierOf({ bossName: 'The Crystal Bear', maxHp: 450 })).toBe('guardian');
    expect(tierOf({ bossName: null, maxHp: ELITE_HP + 10 })).toBe('elite');
    expect(tierOf({ bossName: null, maxHp: 30 })).toBe('normal');
  });

  it('always drops some gold, more from tougher foes and in later levels', () => {
    const rng = mulberry32(1);
    const avg = (tier: 'normal' | 'elite' | 'guardian', level: number) => {
      let s = 0;
      for (let i = 0; i < 500; i++) s += gold(rollLoot(tier, level, rng));
      return s / 500;
    };
    for (let i = 0; i < 100; i++) expect(gold(rollLoot('normal', 1, rng))).toBeGreaterThan(0);
    expect(avg('elite', 1)).toBeGreaterThan(avg('normal', 1) * 2);
    expect(avg('guardian', 1)).toBeGreaterThan(avg('elite', 1) * 3);
    expect(avg('normal', 5)).toBeGreaterThan(avg('normal', 1));
  });

  it('drops spell books rarely from monsters, always from guardians, often from chests', () => {
    const rng = mulberry32(2);
    const runs = (f: () => Drop[]) => Array.from({ length: 4000 }, f);
    expect(books(runs(() => rollLoot('normal', 1, rng)))).toBeGreaterThan(0.015);
    expect(books(runs(() => rollLoot('normal', 1, rng)))).toBeLessThan(0.05);
    expect(books(runs(() => rollLoot('guardian', 3, rng)))).toBe(1);
    expect(books(runs(() => chestLoot(2, rng)))).toBeGreaterThan(0.5);
  });
});
