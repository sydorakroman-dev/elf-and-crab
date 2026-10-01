import { describe, expect, it } from 'vitest';
import { floorPoint, overviewDistance } from './input';

describe('floorPoint', () => {
  it('hits the floor straight below', () => {
    expect(floorPoint({ x: 3, y: 10, z: -2 }, { x: 0, y: -1, z: 0 }, 28, 1)).toEqual({ x: 3, z: -2 });
  });

  it('follows a slanted ray', () => {
    const p = floorPoint({ x: 0, y: 10, z: 0 }, { x: 1, y: -1, z: 0 }, 28, 1)!;
    expect(p.x).toBeCloseTo(10);
    expect(p.z).toBeCloseTo(0);
  });

  it('clamps to inside the walls', () => {
    const p = floorPoint({ x: 0, y: 1, z: 0 }, { x: 1, y: -0.01, z: 0 }, 28, 1)!;
    expect(p.x).toBe(27);
  });

  it('returns null for rays that never reach the floor', () => {
    expect(floorPoint({ x: 0, y: 10, z: 0 }, { x: 1, y: 0, z: 0 }, 28, 1)).toBeNull();
    expect(floorPoint({ x: 0, y: 10, z: 0 }, { x: 0, y: 1, z: 0 }, 28, 1)).toBeNull();
  });
});

describe('overviewDistance', () => {
  it('backs off further on narrow (portrait) screens', () => {
    const landscape = overviewDistance(28, 40, 1.1, 4 / 3);
    const portrait = overviewDistance(28, 40, 1.1, 3 / 4);
    expect(portrait).toBeGreaterThan(landscape);
  });

  it('fits the arena width on a wide screen', () => {
    const d = overviewDistance(28, 40, 1.1, 16 / 9);
    const visibleWidth = 2 * d * Math.tan((40 * Math.PI) / 360) * (16 / 9);
    expect(visibleWidth).toBeGreaterThanOrEqual(60);
  });
});
