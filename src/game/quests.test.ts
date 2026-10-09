import { describe, expect, it } from 'vitest';
import { FOX, FoxQuest, foxTrackerLine, placeFoxQuest, walkPath, type FoxInput } from './quests';
import { generateLevel } from '../world/levelgen';
import { ROOMS } from '../world/rooms';

const quiet: FoxInput = { playerNear: false, threat: false, atDen: false, guardianDown: false };

describe('Q01 The Lantern Fox: placement', () => {
  const woodland = ROOMS[0];

  it('places the kit, the den under the Hollow Oak, a trail and the far burrow on every Woodland level', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const level = generateLevel(woodland, seed * 101);
      const plan = placeFoxQuest(level, woodland, seed * 101);
      expect(plan, `seed ${seed}`).not.toBeNull();
      const p = plan!;
      const oak = level.landmarks.find((l) => l.name === 'the Hollow Oak')!;
      expect(Math.hypot(p.den.x - oak.x, p.den.z - oak.z)).toBeLessThan(10);
      // The kit waits away from the start and from every pack.
      expect(Math.hypot(p.kit.x - level.start.x, p.kit.z - level.start.z)).toBeGreaterThan(15);
      for (const k of level.packs) expect(Math.hypot(k.x - p.kit.x, k.z - p.kit.z)).toBeGreaterThan(12);
      // Everything stands on the floor, and the kit can walk home.
      for (const q of [p.kit, p.den, p.exit, ...p.trail]) expect(level.map.floorAt(q.x, q.z)).toBe(true);
      expect(walkPath(level.map, p.kit, p.den).length).toBeGreaterThan(3);
      expect(p.trail.length).toBeGreaterThan(2);
      // The burrow comes out by the guardian's hall, but not in it.
      const boss = level.halls.find((h) => h.kind === 'boss')!;
      const d = Math.hypot(p.exit.x - boss.x, p.exit.z - boss.z);
      expect(d).toBeGreaterThan(boss.r);
      expect(d).toBeLessThan(boss.r + 20);
    }
  });

  it('is the same from the same seed (the tablet rebuilds it), and absent elsewhere', () => {
    const a = placeFoxQuest(generateLevel(woodland, 7), woodland, 7);
    const b = placeFoxQuest(generateLevel(woodland, 7), woodland, 7);
    expect(a).toEqual(b);
    for (const room of ROOMS.slice(1)) expect(placeFoxQuest(generateLevel(room, 7), room, 7)).toBeNull();
  });
});

describe('Q01 The Lantern Fox: state', () => {
  it('found → following → hiding while threatened → following again after a calm spell → home, rewarded once', () => {
    const q = new FoxQuest();
    expect(q.step(0.1, quiet)).toBeNull();
    expect(q.step(0.1, { ...quiet, playerNear: true })).toBe('found');
    expect(q.state).toBe('following');
    expect(q.step(0.1, { ...quiet, threat: true })).toBe('spooked');
    expect(q.step(1, { ...quiet, threat: true })).toBeNull();
    expect(q.step(1.5, quiet)).toBeNull(); // not calm long enough yet
    expect(q.step(FOX.calmSeconds, quiet)).toBe('calmed');
    expect(q.burrowOpen).toBe(false);
    expect(q.step(0.1, { ...quiet, atDen: true })).toBe('home');
    expect(q.burrowOpen).toBe(true);
    expect(q.claimReward()).toBe(true);
    expect(q.claimReward()).toBe(false);
    expect(q.step(0.1, { ...quiet, guardianDown: true })).toBeNull(); // stays home
  });

  it('closes (no reward) if the guardian falls first, from any open state', () => {
    for (const lead of [[], [{ ...quiet, playerNear: true }], [{ ...quiet, playerNear: true }, { ...quiet, threat: true }]]) {
      const q = new FoxQuest();
      for (const i of lead) q.step(0.1, i);
      expect(q.step(0.1, { ...quiet, guardianDown: true })).toBe('closed');
      expect(q.claimReward()).toBe(false);
      expect(q.burrowOpen).toBe(false);
    }
  });

  it('keeps the tracker short and truthful', () => {
    expect(foxTrackerLine('waiting', 0)).toBeNull();
    expect(foxTrackerLine('following', 41.6)!.text).toContain('42 m');
    expect(foxTrackerLine('hiding', 0)!.text).toContain('hiding');
    expect(foxTrackerLine('home', 0)!.done).toBe(true);
    expect(foxTrackerLine('closed', 0)!.done).toBe(true);
  });
});
