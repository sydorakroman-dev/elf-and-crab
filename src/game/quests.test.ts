import { describe, expect, it } from 'vitest';
import { CAMP, CampQuest, FOX, FoxQuest, KNIGHT, KnightQuest, campTrackerLine, foxTrackerLine, knightTrackerLine, placeCampQuest, placeFoxQuest, placeKnightQuest, walkPath, type FoxInput } from './quests';
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

describe('Q03 Cages of the War Camp', () => {
  const camp = ROOMS[3];
  const none = { found: false, unlatch: [0, 0, 0] as [number, number, number], alarm: false, hornsDown: 0, guardianDown: false };

  it('places three cages by a guard pack and three war horns round them, on every war camp (same from the same seed)', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const level = generateLevel(camp, seed * 37);
      const plan = placeCampQuest(level, camp, seed * 37);
      expect(plan, `seed ${seed}`).not.toBeNull();
      const p = plan!;
      for (const c of p.cages) expect(level.map.floorAt(c.x, c.z)).toBe(true);
      for (const h of p.horns) {
        expect(level.map.floorAt(h.x, h.z)).toBe(true);
        const d = Math.hypot(h.x - p.centre.x, h.z - p.centre.z);
        expect(d).toBeGreaterThan(12);
        expect(d).toBeLessThan(30);
      }
      // A sleeping pack keeps watch nearby.
      expect(level.packs.some((k) => !k.boss && Math.hypot(k.x - p.centre.x, k.z - p.centre.z) < 15)).toBe(true);
      expect(Math.hypot(p.centre.x - level.start.x, p.centre.z - level.start.z)).toBeGreaterThan(30);
    }
    expect(placeCampQuest(generateLevel(camp, 5), camp, 5)).toEqual(placeCampQuest(generateLevel(camp, 5), camp, 5));
    expect(placeCampQuest(generateLevel(ROOMS[0], 5), ROOMS[0], 5)).toBeNull();
  });

  it('quietly: standing at the cages unlatches them (the familiar faster); all three freed → the merchant’s best thanks', () => {
    const q = new CampQuest();
    expect(q.step(0.1, none)).toEqual([]);
    expect(q.step(0.1, { ...none, found: true })).toEqual([{ e: 'found' }]);
    const fam = 1 / CAMP.familiarSeconds;
    q.step(1, { ...none, unlatch: [fam, 0, 0] });
    expect(q.cages[0]).toBe('shut'); // halfway
    expect(q.step(1, { ...none, unlatch: [fam, 0, 0] })).toEqual([{ e: 'unlatched', cage: 0 }]);
    q.step(CAMP.heroSeconds, { ...none, unlatch: [0, 1 / CAMP.heroSeconds, fam] });
    expect(q.cages).toEqual(['open', 'open', 'open']);
    q.step(0.1, { ...none, guardianDown: true });
    expect(q.thanks).toBe('all');
    expect(q.claimXp()).toBe(3 * CAMP.xpDirect);
    expect(q.claimXp()).toBe(0);
  });

  it('a raised camp gives 20 s (35 with a horn down) before the caged are taken to the keep; they’re freed after the battle', () => {
    const q = new CampQuest();
    q.hook(); // the merchant told you
    q.step(5, { ...none, unlatch: [1, 0, 0] });
    expect(q.step(0.1, { ...none, alarm: true })).toEqual([{ e: 'alarm', seconds: CAMP.alarmSeconds }]);
    q.step(CAMP.alarmSeconds - 1, none);
    expect(q.step(1.01, none)).toEqual([{ e: 'moved', count: 2 }]);
    expect(q.cages).toEqual(['open', 'moved', 'moved']);
    q.step(0.1, { ...none, unlatch: [0, 1, 1] }); // nothing to unlatch in an empty cage
    q.step(0.1, { ...none, guardianDown: true });
    expect([q.freedDirect, q.freedLate, q.thanks]).toEqual([1, 2, 'some']);
    expect(q.claimXp()).toBe(CAMP.xpDirect + 2 * CAMP.xpLate);

    const h = new CampQuest();
    h.hook();
    expect(h.step(0.1, { ...none, alarm: true, hornsDown: 1 })).toEqual([{ e: 'alarm', seconds: CAMP.alarmSecondsHornDown }]);
    const silent = new CampQuest();
    silent.hook();
    expect(silent.step(0.1, { ...none, alarm: true, hornsDown: 3 })).toEqual([]); // all horns down: no alarm reaches them
  });

  it('never found: nothing changes, and the merchant has nothing to say', () => {
    const q = new CampQuest();
    q.step(0.1, { ...none, alarm: true });
    q.step(0.1, { ...none, guardianDown: true });
    expect(q.thanks).toBe('none');
    expect(q.claimXp()).toBe(0);
    expect(campTrackerLine(q, 0)).toBeNull();
  });

  it('tracks what matters in a few words', () => {
    const q = new CampQuest();
    q.hook();
    expect(campTrackerLine(q, 1)!.text).toBe('🔓 Free the caged folk 0/3 · 📯 horns 2/3');
    q.alarmLeft = 12.3;
    expect(campTrackerLine(q, 1)!.text).toContain('13 s');
  });
});

describe('Q02 The Knight Who Would Not Rest', () => {
  const crypt = ROOMS[2];
  const none = { playerNear: false, runeBroken: false, plunder: 0, holding: false, bossFight: false };

  it('places the tomb by the middle obelisk and three rune stones in sight of it, on every crypt', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const level = generateLevel(crypt, seed * 53);
      const plan = placeKnightQuest(level, crypt, seed * 53);
      expect(plan, `seed ${seed}`).not.toBeNull();
      const p = plan!;
      const mark = level.landmarks[1] ?? level.landmarks[0];
      expect(Math.hypot(p.tomb.x - mark.x, p.tomb.z - mark.z)).toBeLessThan(9);
      for (const s of p.stones) {
        expect(level.map.floorAt(s.x, s.z)).toBe(true);
        expect(level.map.lineOfSight(p.tomb, s)).toBe(true);
      }
      const boss = level.halls.find((h) => h.kind === 'boss')!;
      expect(Math.hypot(p.tomb.x - boss.x, p.tomb.z - boss.z)).toBeGreaterThan(boss.r);
    }
    expect(placeKnightQuest(generateLevel(ROOMS[0], 3), ROOMS[0], 3)).toBeNull();
  });

  it('freeing: three rune stones break, and he is free; the blade can no longer be taken after the first', () => {
    const q = new KnightQuest();
    expect(q.step(0.1, { ...none, playerNear: true })).toBe('found');
    expect(q.step(0.1, { ...none, runeBroken: true })).toBe('rune');
    expect(q.step(5, { ...none, plunder: 5, holding: true })).toBeNull(); // locked out
    expect(q.state).toBe('freeing');
    q.step(0.1, { ...none, runeBroken: true });
    expect(q.step(0.1, { ...none, runeBroken: true })).toBe('freed');
    expect(q.claim()).toEqual({ xp: KNIGHT.xpFreed, blade: false });
    expect(q.claim()).toBeNull();
    expect(q.step(0.1, { ...none, bossFight: true })).toBeNull(); // stays freed
  });

  it('plundering: holding Interact for 1.5 s takes the blade (letting go starts over; stepping away only pauses)', () => {
    const q = new KnightQuest();
    q.step(0.1, { ...none, playerNear: true });
    q.step(1, { ...none, plunder: 1, holding: true });
    q.step(0.1, none); // let go
    expect(q.plunderHeld).toBe(0);
    q.step(1, { ...none, plunder: 1, holding: true });
    q.step(0.3, { ...none, plunder: 0, holding: true }); // a step out of reach, still holding: paused
    expect(q.plunderHeld).toBe(1);
    expect(q.step(0.6, { ...none, plunder: 0.6, holding: true })).toBe('plundered');
    expect(q.claim()).toEqual({ xp: KNIGHT.xpPlundered, blade: true });
  });

  it('the boss fight closes it: quietly if never found, with a word if left half-done', () => {
    const unseen = new KnightQuest();
    expect(unseen.step(0.1, { ...none, bossFight: true })).toBeNull();
    expect(unseen.step(0.1, { ...none, playerNear: true })).toBeNull(); // too late to find it
    expect(knightTrackerLine(unseen)).toBeNull();
    const q = new KnightQuest();
    q.step(0.1, { ...none, playerNear: true });
    q.step(0.1, { ...none, runeBroken: true });
    expect(q.step(0.1, { ...none, bossFight: true })).toBe('left');
    expect(q.claim()).toBeNull();
    expect(knightTrackerLine(new KnightQuest())).toBeNull();
  });
});
