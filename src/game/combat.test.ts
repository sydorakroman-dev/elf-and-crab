import { describe, expect, it } from 'vitest';
import { arenaExit, clampToArena, setWalkMap, insideArena, pickAimTarget, pushOutOfCircles, rangeIntent, segmentCircleHit } from './combat';
import { WalkMap, insideShape } from './walkmap';

describe('pushOutOfCircles', () => {
  it('moves a point out to the touching distance', () => {
    const p = { x: 1, z: 0 };
    expect(pushOutOfCircles(p, 0.5, [{ x: 0, z: 0, radius: 1 }])).toBe(true);
    expect(p.x).toBeCloseTo(1.5);
    expect(p.z).toBeCloseTo(0);
  });

  it('leaves points that are clear alone', () => {
    const p = { x: 3, z: 0 };
    expect(pushOutOfCircles(p, 0.5, [{ x: 0, z: 0, radius: 1 }])).toBe(false);
    expect(p).toEqual({ x: 3, z: 0 });
  });

  it('handles an exactly-centered point without NaN', () => {
    const p = { x: 0, z: 0 };
    pushOutOfCircles(p, 0.5, [{ x: 0, z: 0, radius: 1 }]);
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(1.5);
  });
});

describe('clampToArena', () => {
  it('keeps a circle inside the walls of the default open room', () => {
    const p = { x: 40, z: -3 };
    expect(clampToArena(p, 1)).toBe(true);
    expect(insideArena(p.x, p.z, 0.99)).toBe(true);
  });

  it('reports no clamp when inside', () => {
    expect(clampToArena({ x: 0, z: 0 }, 1)).toBe(false);
  });
});

describe('segmentCircleHit', () => {
  const c = { x: 5, z: 0, radius: 1 };

  it('finds the entry point along the segment', () => {
    expect(segmentCircleHit(0, 0, 10, 0, c)).toBeCloseTo(0.4);
  });

  it('misses when passing beside the circle or stopping short', () => {
    expect(segmentCircleHit(0, 2, 10, 2, c)).toBeNull();
    expect(segmentCircleHit(0, 0, 3, 0, c)).toBeNull();
  });

  it('hits at t=0 when starting inside', () => {
    expect(segmentCircleHit(5, 0, 9, 0, c)).toBe(0);
  });
});

describe('pickAimTarget', () => {
  const origin = { x: 0, z: 0 };
  const targets = [
    { x: 10, z: 3 }, // ~16.7° off
    { x: 10, z: 1 }, // ~5.7° off — best
    { x: -10, z: 0 }, // behind
    { x: 50, z: 0 }, // too far
  ];

  it('picks the target closest to the aim line', () => {
    expect(pickAimTarget(origin, 1, 0, targets, 0.35, 30)).toBe(1);
  });

  it('returns -1 when nothing is inside the cone', () => {
    expect(pickAimTarget(origin, 0, 1, targets, 0.35, 30)).toBe(-1);
  });
});

describe('rangeIntent', () => {
  it('closes in, backs off, or circles', () => {
    expect(rangeIntent(20, 9, 14)).toBe(1);
    expect(rangeIntent(5, 9, 14)).toBe(-1);
    expect(rangeIntent(11, 9, 14)).toBe(0);
  });
});

describe('arena shapes', () => {
  it('cuts the corners of an eight-sided room', () => {
    expect(insideShape('square', 20, 19, 19)).toBe(true);
    expect(insideShape('octagon', 20, 19, 19)).toBe(false);
    expect(insideShape('octagon', 20, 19, 0)).toBe(true); // the middle of a wall is as far as a square's
    expect(insideShape('circle', 20, 15, 15)).toBe(false);
  });

  it('finds where a shot hits the wall', () => {
    setWalkMap(WalkMap.fromShape('square', 20));
    expect(arenaExit(0, 0, 5, 0)).toBeNull();
    const t = arenaExit(0, 0, 40, 0)!;
    expect(t * 40).toBeCloseTo(20, 0);
  });
});
