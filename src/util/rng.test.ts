import { describe, expect, it } from 'vitest';
import { hashSeed, mulberry32 } from './rng';

describe('mulberry32', () => {
  it('is deterministic for a seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('differs across seeds and stays in [0, 1)', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const va = Array.from({ length: 1000 }, a);
    expect(va).not.toEqual(Array.from({ length: 1000 }, b));
    for (const v of va) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('hashSeed is stable', () => {
    expect(hashSeed('island')).toBe(hashSeed('island'));
    expect(hashSeed('island')).not.toBe(hashSeed('islands'));
  });
});
