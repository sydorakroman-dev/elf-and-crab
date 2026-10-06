import { describe, expect, it } from 'vitest';
import { FLOOR, TILE, WalkMap } from './walkmap';

/** A map from rows of text: '#' wall, '.' floor; tile (0,0) at the origin corner. */
function fromText(rows: string[]): WalkMap {
  const cols = rows[0].length;
  const tiles = new Uint8Array(cols * rows.length);
  rows.forEach((line, r) => [...line].forEach((ch, c) => (tiles[r * cols + c] = ch === '.' ? FLOOR : 0)));
  return new WalkMap(cols, rows.length, 0, 0, tiles);
}

// An L-shaped corridor: in at the top left, round the corner, down to the bottom right.
const L = fromText([
  '##########',
  '#....#####',
  '#....#####',
  '#.......##',
  '#####...##',
  '#####...##',
  '##########',
]);

describe('WalkMap', () => {
  it('knows floor from wall', () => {
    expect(L.floorAt(3, 3)).toBe(true); // tile (1,1)
    expect(L.floorAt(1, 1)).toBe(false); // tile (0,0)
    expect(L.floorAt(-5, 3)).toBe(false); // off the map
  });

  it('pushes a circle out of a wall and leaves clear ones alone', () => {
    const p = { x: 2.2, z: 5 }; // too close to the west wall (x = 2)
    expect(L.clampCircle(p, 0.5)).toBe(true);
    expect(p.x).toBeCloseTo(2.5);
    expect(p.z).toBeCloseTo(5);
    const q = { x: 5, z: 5 };
    expect(L.clampCircle(q, 0.5)).toBe(false);
  });

  it('slides along a wall instead of sticking to it', () => {
    const p = { x: 5, z: 2.1 }; // grazing the north wall
    L.clampCircle(p, 0.5);
    expect(p.z).toBeCloseTo(2.5);
    expect(p.x).toBeCloseTo(5);
  });

  it('gets a circle out of an outside corner', () => {
    const p = { x: 10.2, z: 6.2 }; // the wall block's corner at (10, 6)
    L.clampCircle(p, 0.5);
    expect(L.clear(p.x, p.z, 0.499)).toBe(true);
  });

  it('rescues a point stuck deep in rock', () => {
    const p = { x: 15, z: 3 }; // inside the wall mass
    L.clampCircle(p, 0.5);
    expect(L.floorAt(p.x, p.z)).toBe(true);
  });

  it('stops rays at walls and reports clear lines of sight', () => {
    expect(L.raycast(3, 3, 9, 3)).toBeNull();
    const t = L.raycast(3, 3, 3, 13); // south into the wall at z = 8
    expect(t).not.toBeNull();
    expect(3 + 10 * t!).toBeCloseTo(8, 0);
    expect(L.lineOfSight({ x: 3, z: 3 }, { x: 13, z: 11 })).toBe(false); // round the corner
  });

  it('measures walking distance round corners', () => {
    const field = L.distanceField(13, 11); // goal in the bottom right
    const at = (x: number, z: number) => field[L.row(z) * L.cols + L.col(x)];
    expect(at(13, 11)).toBe(0);
    expect(at(3, 3)).toBeGreaterThan(at(9, 7));
    expect(at(1, 1)).toBe(-1); // wall
  });

  it('leads round the corner with waypoints', () => {
    const field = L.distanceField(13, 11);
    let p = { x: 3, z: 3 };
    for (let i = 0; i < 40; i++) {
      const w = L.nextWaypoint(field, p.x, p.z, 0.5);
      if (!w) break;
      const d = Math.hypot(w.x - p.x, w.z - p.z);
      if (d < 0.1) break;
      const step = Math.min(d, 1);
      p = { x: p.x + ((w.x - p.x) / d) * step, z: p.z + ((w.z - p.z) / d) * step };
      L.clampCircle(p, 0.5);
    }
    expect(Math.hypot(p.x - 13, p.z - 11)).toBeLessThan(TILE);
  });

  it('builds simple shaped rooms', () => {
    const round = WalkMap.fromShape('circle', 20);
    expect(round.floorAt(0, 0)).toBe(true);
    expect(round.floorAt(18, 0)).toBe(true);
    expect(round.floorAt(16, 16)).toBe(false);
    const p = round.randomFloor(Math.random, 1, { x: 0, z: 0 }, 5, 10);
    expect(round.clear(p.x, p.z, 1)).toBe(true);
  });
});
