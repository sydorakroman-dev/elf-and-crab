import { describe, expect, it } from 'vitest';
import { ROOMS, WAVES_PER_ROOM, isBossWave, roomWaveDifficulty, runLabel } from './rooms';

describe('rooms', () => {
  it('has six rooms, starting in the woodland, only the last without an exit', () => {
    expect(ROOMS).toHaveLength(6);
    expect(ROOMS[0].name).toBe('The Woodland');
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

  it('gets harder every wave across the run', () => {
    let last = 0;
    for (let room = 0; room < ROOMS.length; room++) {
      for (let w = 1; w <= WAVES_PER_ROOM; w++) {
        const d = roomWaveDifficulty(room, w);
        expect(d).toBeGreaterThanOrEqual(last);
        last = d;
      }
    }
  });

  it('puts the boss on the last wave of the last room only', () => {
    expect(isBossWave(5, 3)).toBe(true);
    expect(isBossWave(5, 2)).toBe(false);
    expect(isBossWave(4, 3)).toBe(false);
  });

  it('labels each phase of the run', () => {
    expect(runLabel(0, 2, 5, 'fight', false)).toBe('The Woodland · Wave 2/3 · 5 slimes left');
    expect(runLabel(1, 3, 0, 'cleared', false)).toContain('north door');
    expect(runLabel(5, 3, 7, 'fight', true)).toContain('King Slime');
  });
});
