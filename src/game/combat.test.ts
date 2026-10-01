import { describe, expect, it } from 'vitest';
import { arenaExit, clampToArena, insideArena, pickAimTarget, pushOutOfCircles, rangeIntent, segmentCircleHit } from './combat';

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
  it('clamps each axis to the inner edge', () => {
    const p = { x: 40, z: -3 };
    expect(clampToArena(p, 28, 1)).toBe(true);
    expect(p).toEqual({ x: 27, z: -3 });
  });

  it('reports no clamp when inside', () => {
    expect(clampToArena({ x: 0, z: 0 }, 28, 1)).toBe(false);
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
  it('keeps things inside a round room', () => {
    const p = { x: 30, z: 30 };
    expect(clampToArena(p, 20, 1, 'circle')).toBe(true);
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(19);
  });

  it('cuts the corners of an eight-sided room', () => {
    expect(insideArena(19, 19, 20, 0, 'square')).toBe(true);
    expect(insideArena(19, 19, 20, 0, 'octagon')).toBe(false);
    expect(insideArena(19, 0, 20, 0, 'octagon')).toBe(true); // the middle of a wall is as far as a square's
    const p = { x: 19, z: 19 };
    clampToArena(p, 20, 0, 'octagon');
    expect(Math.abs(p.x) + Math.abs(p.z)).toBeCloseTo(20 * Math.SQRT2);
  });

  it('finds where a shot leaves the room', () => {
    expect(arenaExit(0, 0, 5, 0, 20)).toBeNull();
    const t = arenaExit(0, 0, 40, 0, 20, 0)!;
    expect(t * 40).toBeCloseTo(20, 1);
  });
});
