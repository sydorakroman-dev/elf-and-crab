import { describe, expect, it } from 'vitest';
import { ROOMS, runLabel } from './rooms';
import { createEnemy, type EnemyKind } from '../game/enemies';

const hpOf = (k: EnemyKind) => createEnemy(k, 0, 0).maxHp;
const poolHp = (pool: Partial<Record<EnemyKind, number>>) => {
  const n = Object.values(pool).reduce((s, w) => s + (w ?? 0), 0);
  return Object.entries(pool).reduce((s, [k, w]) => s + hpOf(k as EnemyKind) * (w ?? 0), 0) / n;
};

describe('levels', () => {
  it('has seven levels, starting in the woodland, only the last without an exit', () => {
    expect(ROOMS).toHaveLength(7);
    expect(ROOMS.map((r) => r.name)).toEqual(['The Woodland', 'The Crystal Cave', 'The Crypt', 'The Throne Room', 'The Flooded Hall', 'The Lava Chamber', "The Ash King's Lair"]);
    expect(ROOMS.map((r) => r.hasExit)).toEqual([true, true, true, true, true, true, false]);
  });

  it('mixes open plains and halls with corridors, in different hall shapes', () => {
    expect(new Set(ROOMS.map((r) => r.layout))).toEqual(new Set(['open', 'cavern', 'crypt', 'fortress', 'halls', 'lair']));
    expect(new Set(ROOMS.flatMap((r) => r.shapes))).toEqual(new Set(['square', 'circle', 'octagon']));
  });

  it('gives every level a guardian with a health bar; the Ash King comes alone', () => {
    for (const r of ROOMS) expect(createEnemy(r.boss!, 0, 0).bossName).toBeTruthy();
    const lair = ROOMS.at(-1)!;
    expect(lair.boss).toBe('ashking');
    expect(lair.foes).toBe(0);
    expect(lair.escort).toEqual({});
  });

  it('gets tougher level by level (all the packs, plus the guardian and its escort)', () => {
    const total = (r: (typeof ROOMS)[number]) =>
      poolHp(r.pool) * r.foes + hpOf(r.boss!) + Object.entries(r.escort).reduce((s, [k, n]) => s + hpOf(k as EnemyKind) * (n ?? 0), 0);
    for (let r = 1; r < ROOMS.length - 1; r++) expect(total(ROOMS[r])).toBeGreaterThan(total(ROOMS[r - 1]));
  });

  it('only puts vines and treants in the woodland, and water elementals in the flooded hall', () => {
    const where = (k: string) => ROOMS.filter((r) => k in r.pool || k in r.escort).map((r) => r.name);
    expect(where('vine')).toEqual(['The Woodland']);
    expect(where('treant')).toEqual(['The Woodland']);
    expect(where('water')).toEqual(['The Flooded Hall']);
  });

  it('labels each phase of the run', () => {
    expect(runLabel(0, 5, 'fight', null)).toContain('The Woodland · 5 foes about');
    expect(runLabel(1, 1, 'fight', null)).toContain('1 foe about');
    expect(runLabel(1, 0, 'cleared', null)).toContain('exit door is open');
    expect(runLabel(0, 0, 'ready', null)).toBe('The Woodland · ready when you are');
    expect(runLabel(5, 7, 'fight', 'The Inferno')).toContain('The Inferno');
  });
});
