import { describe, expect, it } from 'vitest';
import { ROOMS, runLabel } from './rooms';
import { insideArena } from '../game/combat';
import { createEnemy, type EnemyKind, type RoomWave } from '../game/enemies';

const hpOf = (k: EnemyKind) => createEnemy(k, 0, 0).maxHp;
const waveHp = (w: RoomWave) => Object.entries(w.mix).reduce((sum, [k, n]) => sum + hpOf(k as EnemyKind) * (n ?? 0), w.boss ? hpOf(w.boss) : 0);

describe('rooms', () => {
  it('comes in different shapes', () => {
    expect(new Set(ROOMS.map((r) => r.shape))).toEqual(new Set(['square', 'circle', 'octagon']));
  });

  it('has seven rooms, starting in the woodland, only the last without an exit', () => {
    expect(ROOMS).toHaveLength(7);
    expect(ROOMS.map((r) => r.name)).toEqual(['The Woodland', 'The Crystal Cave', 'The Crypt', 'The Throne Room', 'The Flooded Hall', 'The Lava Chamber', "The Ash King's Lair"]);
    expect(ROOMS.map((r) => r.hasExit)).toEqual([true, true, true, true, true, true, false]);
    for (const r of ROOMS) {
      expect(Number.isInteger(r.half)).toBe(true);
      for (const [x, z] of [...r.pillars, ...(r.crystals ?? []), ...(r.trees ?? []), ...(r.spires ?? []), ...(r.pools ?? [])]) {
        expect(insideArena(x, z, r.half, 2, r.shape)).toBe(true);
      }
    }
  });

  it('keeps the entry spot and the walk to the exit clear of pillars and crystals', () => {
    for (const r of ROOMS) {
      const entryZ = r.half - 12; // matches Dungeon.entry
      for (const [x, z] of [...r.pillars, ...(r.crystals ?? []), ...(r.trees ?? []), ...(r.spires ?? []), ...(r.pools ?? [])]) {
        // Nothing within 3.5 m of where the elf (and the camera behind them) arrives…
        expect(Math.hypot(x, z - entryZ)).toBeGreaterThan(3.5);
        // …or right in front of the exit door.
        if (r.hasExit) expect(Math.hypot(x, z + r.half - 2)).toBeGreaterThan(3.5);
      }
    }
  });

  it('has waves in every room, the last one bringing a boss; the Ash King comes alone', () => {
    for (const r of ROOMS) {
      expect(r.waves.length).toBeGreaterThan(0);
      expect(r.waves.slice(0, -1).every((w) => !w.boss)).toBe(true);
      expect(createEnemy(r.waves.at(-1)!.boss!, 0, 0).bossName).toBeTruthy();
    }
    expect(ROOMS.at(-1)!.waves).toEqual([{ mix: {}, boss: 'ashking' }]);
  });

  it('gets tougher room by room (total HP of each wave, and of each boss wave)', () => {
    for (let r = 1; r < ROOMS.length; r++) {
      const [a, b] = [ROOMS[r - 1].waves, ROOMS[r].waves];
      for (let w = 0; w < Math.min(a.length, b.length) - 1; w++) expect(waveHp(b[w])).toBeGreaterThan(waveHp(a[w]));
      expect(waveHp(b.at(-1)!)).toBeGreaterThan(waveHp(a.at(-1)!));
    }
  });

  it('only puts vines and treants in the woodland, and water elementals in the flooded hall', () => {
    const where = (k: string) => ROOMS.filter((r) => r.waves.some((w) => k in w.mix)).map((r) => r.name);
    expect(where('vine')).toEqual(['The Woodland']);
    expect(where('treant')).toEqual(['The Woodland']);
    expect(where('water')).toEqual(['The Flooded Hall']);
  });

  it('labels each phase of the run', () => {
    expect(runLabel(0, 2, 5, 'fight', null)).toBe('The Woodland · Wave 2/3 · 5 foes left');
    expect(runLabel(1, 2, 1, 'fight', null)).toBe('The Crystal Cave · Wave 2/3 · 1 foe left');
    expect(runLabel(1, 3, 0, 'cleared', null)).toContain('north door');
    expect(runLabel(0, 0, 0, 'ready', null)).toBe('The Woodland · ready when you are');
    expect(runLabel(5, 3, 7, 'fight', 'The Inferno')).toContain('The Inferno');
  });
});
