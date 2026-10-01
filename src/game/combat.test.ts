import { describe, expect, it } from 'vitest';
import { clampToArena, pickAimTarget, pushOutOfCircles, rangeIntent, segmentCircleHit, waveSpec } from './combat';

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

describe('waveSpec', () => {
  it('starts gently', () => {
    expect(waveSpec(1)).toMatchObject({ small: 6, big: 0, spitters: 0, speedBonus: 0, smallHp: 10, bigHp: 40, spitterHp: 20, packSize: 1 });
    expect(waveSpec(2).spitters).toBe(0);
    expect(waveSpec(3).spitters).toBe(1);
  });

  it('gets harder every wave', () => {
    for (let w = 1; w < 12; w++) {
      const a = waveSpec(w);
      const b = waveSpec(w + 1);
      expect(b.small + b.big + b.spitters).toBeGreaterThanOrEqual(a.small + a.big + a.spitters);
      expect(b.speedBonus).toBeGreaterThanOrEqual(a.speedBonus);
      expect(b.spawnInterval).toBeLessThanOrEqual(a.spawnInterval);
    }
  });

  it('gives whole slime counts for fractional difficulty levels', () => {
    for (const w of [1.8, 2.6, 3.4, 7.4, 8.2]) {
      const s = waveSpec(w);
      for (const n of [s.small, s.big, s.spitters, s.packSize, s.smallHp, s.bigHp, s.spitterHp]) expect(Number.isInteger(n)).toBe(true);
    }
  });

  it('is capped', () => {
    expect(waveSpec(1000)).toMatchObject({ small: 30, big: 12, spitters: 8, speedBonus: 3, packSize: 5, spawnInterval: 0.7 });
  });
});

describe('rangeIntent', () => {
  it('closes in, backs off, or circles', () => {
    expect(rangeIntent(20, 9, 14)).toBe(1);
    expect(rangeIntent(5, 9, 14)).toBe(-1);
    expect(rangeIntent(11, 9, 14)).toBe(0);
  });
});
