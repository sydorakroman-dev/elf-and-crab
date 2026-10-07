import { describe, expect, it } from 'vitest';
import { ActivePowers, MAX_STACK, POWER_UPS, pickPowerUp, randomSpawnPoint, spreadDirections } from './powerups';
import { mulberry32 } from '../util/rng';
import { insideArena } from './combat';

describe('ActivePowers', () => {
  it('starts, counts down and expires', () => {
    const p = new ActivePowers();
    p.add('rapid');
    expect(p.has('rapid')).toBe(true);
    expect(p.remaining('rapid')).toBe(POWER_UPS.rapid.duration);
    p.tick(POWER_UPS.rapid.duration - 1);
    expect(p.remaining('rapid')).toBeCloseTo(1);
    p.tick(1.01);
    expect(p.has('rapid')).toBe(false);
  });

  it('extends when picked again, up to the cap', () => {
    const p = new ActivePowers();
    for (let i = 0; i < 10; i++) p.add('multishot');
    expect(p.remaining('multishot')).toBe(MAX_STACK);
  });

  it('ignores instant power-ups and can end one early', () => {
    const p = new ActivePowers();
    p.add('heart');
    expect(p.list()).toEqual([]);
    p.add('shield');
    p.end('shield');
    expect(p.has('shield')).toBe(false);
  });

  it('lists several at once in catalogue order', () => {
    const p = new ActivePowers();
    p.add('shield');
    p.add('multishot');
    expect(p.list().map((x) => x.type)).toEqual(['multishot', 'shield']);
  });
});

describe('pickPowerUp', () => {
  it('never offers a heart at full health', () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 500; i++) expect(pickPowerUp(rng, 5, 5)).not.toBe('heart');
  });

  it('offers every type, roughly by weight, when hurt', () => {
    const rng = mulberry32(9);
    const counts: Record<string, number> = {};
    for (let i = 0; i < 15000; i++) {
      const t = pickPowerUp(rng, 2, 5);
      counts[t] = (counts[t] ?? 0) + 1;
    }
    expect(Object.keys(counts).sort()).toEqual(['heart', 'multishot', 'pierce', 'rapid', 'shield', 'swift']);
    // Weights 3:3:2:2:3:2 of 15 → multishot (Frenzy) ≈ 3000, pierce (Might) ≈ 2000.
    expect(counts.multishot).toBeGreaterThan(2700);
    expect(counts.multishot).toBeLessThan(3300);
    expect(counts.pierce).toBeGreaterThan(1750);
    expect(counts.pierce).toBeLessThan(2250);
  });
});

describe('randomSpawnPoint', () => {
  it('stays on the floor near the player, off obstacles and not underfoot', () => {
    const rng = mulberry32(1);
    const obstacles = [{ x: 0, z: 0, radius: 2 }];
    const player = { x: 5, z: 5 };
    for (let i = 0; i < 200; i++) {
      const p = randomSpawnPoint(rng, player, obstacles, [player], 6);
      expect(insideArena(p.x, p.z, 1.9)).toBe(true);
      expect(Math.hypot(p.x - 5, p.z - 5)).toBeLessThanOrEqual(18.01);
      expect(Math.hypot(p.x, p.z)).toBeGreaterThanOrEqual(3.5);
      expect(Math.hypot(p.x - 5, p.z - 5)).toBeGreaterThanOrEqual(6);
    }
  });
});

describe('spreadDirections', () => {
  it('fans evenly around the aim and keeps the middle on target', () => {
    const d = spreadDirections(0, 1, 3, 0.2);
    expect(d).toHaveLength(3);
    expect(d[1].x).toBeCloseTo(0);
    expect(d[1].z).toBeCloseTo(1);
    expect(d[0].x).toBeCloseTo(-Math.sin(0.2));
    expect(d[2].x).toBeCloseTo(Math.sin(0.2));
    for (const v of d) expect(Math.hypot(v.x, v.z)).toBeCloseTo(1);
  });

  it('with one arrow is just the aim', () => {
    const [v] = spreadDirections(1, 0, 1, 0.2);
    expect(v.x).toBeCloseTo(1);
    expect(v.z).toBeCloseTo(0);
  });
});
