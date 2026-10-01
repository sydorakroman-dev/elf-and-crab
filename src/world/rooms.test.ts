import { describe, expect, it } from 'vitest';
import { ROOMS, WAVES_PER_ROOM, runLabel } from './rooms';
import { createEnemy, type EnemyKind, type RoomWave } from '../game/enemies';

const hpOf = (k: EnemyKind) => createEnemy(k, 0, 0).maxHp;
const waveHp = (w: RoomWave) => Object.entries(w.mix).reduce((sum, [k, n]) => sum + hpOf(k as EnemyKind) * (n ?? 0), w.boss ? hpOf(w.boss) : 0);

describe('rooms', () => {
  it('has six rooms, starting in the woodland, only the last without an exit', () => {
    expect(ROOMS).toHaveLength(6);
    expect(ROOMS.map((r) => r.name)).toEqual(['The Woodland', 'The Crystal Cave', 'The Crypt', 'The Throne Room', 'The Flooded Hall', 'The Lava Chamber']);
    expect(ROOMS.map((r) => r.hasExit)).toEqual([true, true, true, true, true, false]);
    for (const r of ROOMS) {
      expect(Number.isInteger(r.half)).toBe(true);
      for (const [x, z] of [...r.pillars, ...(r.crystals ?? []), ...(r.trees ?? [])]) {
        expect(Math.abs(x)).toBeLessThan(r.half - 2);
        expect(Math.abs(z)).toBeLessThan(r.half - 2);
      }
    }
  });

  it('keeps the entry spot and the walk to the exit clear of pillars and crystals', () => {
    for (const r of ROOMS) {
      const entryZ = r.half - 12; // matches Dungeon.entry
      for (const [x, z] of [...r.pillars, ...(r.crystals ?? []), ...(r.trees ?? [])]) {
        // Nothing within 3.5 m of where the elf (and the camera behind them) arrives…
        expect(Math.hypot(x, z - entryZ)).toBeGreaterThan(3.5);
        // …or right in front of the exit door.
        if (r.hasExit) expect(Math.hypot(x, z + r.half - 2)).toBeGreaterThan(3.5);
      }
    }
  });

  it('has three waves per room, the last one bringing a boss', () => {
    for (const r of ROOMS) {
      expect(r.waves).toHaveLength(WAVES_PER_ROOM);
      expect(r.waves.slice(0, -1).every((w) => !w.boss)).toBe(true);
      const boss = createEnemy(r.waves[WAVES_PER_ROOM - 1].boss!, 0, 0);
      expect(boss.bossName).toBeTruthy();
    }
  });

  it('gets tougher room by room (total HP of each wave)', () => {
    for (let w = 0; w < WAVES_PER_ROOM; w++) {
      for (let r = 1; r < ROOMS.length; r++) expect(waveHp(ROOMS[r].waves[w])).toBeGreaterThan(waveHp(ROOMS[r - 1].waves[w]));
    }
  });

  it('labels each phase of the run', () => {
    expect(runLabel(0, 2, 5, 'fight', null)).toBe('The Woodland · Wave 2/3 · 5 foes left');
    expect(runLabel(1, 2, 1, 'fight', null)).toBe('The Crystal Cave · Wave 2/3 · 1 foe left');
    expect(runLabel(1, 3, 0, 'cleared', null)).toContain('north door');
    expect(runLabel(0, 0, 0, 'ready', null)).toBe('The Woodland · ready when you are');
    expect(runLabel(5, 3, 7, 'fight', 'The Inferno')).toContain('The Inferno');
  });
});
