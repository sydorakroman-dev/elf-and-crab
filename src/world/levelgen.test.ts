import { describe, expect, it } from 'vitest';
import { generateLevel, type Level } from './levelgen';
import { ROOMS } from './rooms';

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
