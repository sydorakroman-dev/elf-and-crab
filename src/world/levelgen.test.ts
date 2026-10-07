import { describe, expect, it } from 'vitest';
import { generateLevel, type Level } from './levelgen';
import { ROOMS } from './rooms';
import { WalkMap } from '../game/walkmap';

const SEEDS = [1, 2, 3, 77, 1234, 99991];

/** Walking distance (tiles) from the start to (x, z); -1 if unreachable. */
function reach(level: Level, x: number, z: number): number {
  const field = level.map.distanceField(level.start.x, level.start.z);
  const m = level.map;
  return field[m.row(z) * m.cols + m.col(x)];
}

const floorArea = (l: Level) => l.map.tiles.reduce((n, t) => n + (t ? 1 : 0), 0) * 4;

describe('level generator', () => {
  for (const room of ROOMS) {
    it(`${room.name}: a big, connected level with a guardian and an exit`, () => {
      for (const seed of SEEDS) {
        const level = generateLevel(room, seed);
        // Big: at least 16 000 m² (the first levels were ~6 000, the old rooms ~2 000).
        expect(floorArea(level)).toBeGreaterThan(room.layout === 'lair' ? 4000 : 16000);
        // You start on open floor, and every hall, pack, chest and the exit can be walked to.
        expect(level.map.clear(level.start.x, level.start.z, 1)).toBe(true);
        for (const h of level.halls) expect(reach(level, h.x, h.z)).toBeGreaterThanOrEqual(0);
        for (const p of level.packs) expect(reach(level, p.x, p.z)).toBeGreaterThanOrEqual(0);
        for (const c of level.chests) expect(reach(level, c.x, c.z)).toBeGreaterThanOrEqual(0);
        // The guardian holds the very top (north); you start at the bottom.
        const boss = level.halls.find((h) => h.kind === 'boss')!;
        expect(Math.min(...level.halls.map((h) => h.z))).toBe(boss.z);
        expect(level.start.z).toBeGreaterThan(boss.z + (room.layout === 'lair' ? 60 : 250));
        if (room.hasExit) {
          expect(level.exit).not.toBeNull();
          const e = level.exit!;
          expect(reach(level, e.x, e.z + 1)).toBeGreaterThan(20); // a good walk away
          expect(level.map.floorAt(e.x, e.z - 1)).toBe(false); // the door is set in a wall
        } else expect(level.exit).toBeNull();
        // The guardian's pack, and nobody waiting right where you arrive.
        const bossPacks = level.packs.filter((p) => p.boss);
        expect(bossPacks).toHaveLength(1);
        expect(bossPacks[0].kinds[0]).toBe(room.boss);
        for (const p of level.packs) expect(Math.hypot(p.x - level.start.x, p.z - level.start.z)).toBeGreaterThan(25);
        // About the planned number of monsters.
        const foes = level.packs.filter((p) => !p.boss).reduce((n, p) => n + p.kinds.length, 0);
        expect(foes).toBeGreaterThanOrEqual(Math.floor(room.foes * 0.7));
        expect(foes).toBeLessThanOrEqual(room.foes);
        // Props stand on the floor and never block the start or the exit.
        for (const pr of level.props) {
          expect(level.map.floorAt(pr.x, pr.z)).toBe(true);
          expect(Math.hypot(pr.x - level.start.x, pr.z - level.start.z)).toBeGreaterThan(pr.r + 2);
        }
      }
    });
  }

  it('gives every level (but the lair) named landmarks spread from south to north', () => {
    for (const room of ROOMS) {
      if (room.layout === 'lair') continue;
      for (const seed of SEEDS) {
        const l = generateLevel(room, seed);
        expect(l.landmarks.length).toBeGreaterThanOrEqual(2);
        expect(new Set(l.landmarks.map((m) => m.name)).size).toBe(l.landmarks.length);
        const zs = l.landmarks.map((m) => m.z);
        expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(100); // not bunched together
        for (const m of l.landmarks) expect(l.props.some((p) => p.kind === 'landmark' && p.name === m.name)).toBe(true);
      }
    }
  });

  it('has a second way to the guardian when the shortest one is blocked', () => {
    for (const room of ROOMS) {
      if (room.layout === 'lair') continue;
      for (const seed of SEEDS) {
        const l = generateLevel(room, seed);
        const m = l.map;
        const boss = l.halls.find((h) => h.kind === 'boss')!;
        const field = m.distanceField(boss.x, boss.z);
        const tiles = new Uint8Array(m.tiles);
        let c = m.col(l.start.x);
        let r = m.row(l.start.z);
        // Walk the shortest way and wall it off (a band 5 tiles wide), except right by the ends.
        for (let steps = 0; field[r * m.cols + c] > 0 && steps < 5000; steps++) {
          let best = [c, r];
          let low = field[r * m.cols + c];
          for (let dr = -1; dr <= 1; dr++)
            for (let dc = -1; dc <= 1; dc++) {
              const d = field[(r + dr) * m.cols + c + dc];
              if (m.isFloor(c + dc, r + dr) && d >= 0 && d < low) {
                low = d;
                best = [c + dc, r + dr];
              }
            }
          [c, r] = best;
          const p = m.centre(c, r);
          if (Math.hypot(p.x - l.start.x, p.z - l.start.z) > 25 && Math.hypot(p.x - boss.x, p.z - boss.z) > boss.r + 6)
            for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) if (m.isFloor(c + a, r + b)) tiles[(r + b) * m.cols + c + a] = 0;
        }
        const blocked = new WalkMap(m.cols, m.rows, m.originX, m.originZ, tiles).distanceField(l.start.x, l.start.z);
        expect(blocked[m.row(boss.z) * m.cols + m.col(boss.x)], `${room.name} seed ${seed}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('puts treasure rooms in every level but the lair, and rates how far off the way each lies', () => {
    for (const room of ROOMS) {
      if (room.layout === 'lair') continue;
      const l = generateLevel(room, 5);
      expect(l.chests.length).toBeGreaterThanOrEqual(3);
      for (const c of l.chests) expect(c.detour).toBeGreaterThan(0);
    }
  });

  it('uses halls and corridors in the dungeon levels, open ground in the woodland', () => {
    const cave = generateLevel(ROOMS[1], 5);
    expect(cave.halls.filter((h) => h.kind === 'normal').length).toBeGreaterThanOrEqual(4);
    const wood = generateLevel(ROOMS[0], 5);
    expect(wood.props.filter((p) => p.kind === 'tree').length).toBeGreaterThan(40);
  });

  it('is the same level for the same seed, and a different one for another seed', () => {
    const a = generateLevel(ROOMS[2], 42);
    const b = generateLevel(ROOMS[2], 42);
    const c = generateLevel(ROOMS[2], 43);
    expect(Array.from(a.map.tiles)).toEqual(Array.from(b.map.tiles));
    expect(a.packs).toEqual(b.packs);
    expect(a.props).toEqual(b.props);
    expect(Array.from(a.map.tiles)).not.toEqual(Array.from(c.map.tiles));
  });

  it('builds a single empty room for practice', () => {
    const p = generateLevel({ ...ROOMS[0], layout: 'practice' }, 1);
    expect(p.packs).toEqual([]);
    expect(p.map.clear(0, 0, 3)).toBe(true);
  });
});
