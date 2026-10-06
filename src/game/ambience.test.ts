import { describe, expect, it } from 'vitest';
import { fireAmbience } from './ambience';

describe('fireAmbience', () => {
  const torch = (x: number, z: number, strength = 1) => ({ position: { x, z }, strength });

  it('is loud next to a fire and quiet far away', () => {
    expect(fireAmbience({ x: 0, z: 0 }, 1, 0, [torch(0.5, 0)]).level).toBeGreaterThan(0.9);
    expect(fireAmbience({ x: 0, z: 0 }, 1, 0, [torch(40, 0)]).level).toBeLessThan(0.05);
  });

  it('halves at the half distance', () => {
    expect(fireAmbience({ x: 0, z: 0 }, 1, 0, [torch(6, 0)]).level).toBeCloseTo(0.5);
  });

  it('pans toward the fire relative to the listener’s right', () => {
    expect(fireAmbience({ x: 0, z: 0 }, 1, 0, [torch(5, 0)]).pan).toBeCloseTo(1);
    expect(fireAmbience({ x: 0, z: 0 }, 1, 0, [torch(-5, 0)]).pan).toBeCloseTo(-1);
    expect(fireAmbience({ x: 0, z: 0 }, 1, 0, [torch(0, 5)]).pan).toBeCloseTo(0);
  });

  it('balances two equal fires on either side', () => {
    expect(fireAmbience({ x: 0, z: 0 }, 1, 0, [torch(5, 0), torch(-5, 0)]).pan).toBeCloseTo(0);
  });

  it('is silent with no fires', () => {
    expect(fireAmbience({ x: 0, z: 0 }, 1, 0, [])).toEqual({ level: 0, pan: 0 });
  });

  it("doesn't add up dozens of far torches into a roar", () => {
    const torches = Array.from({ length: 60 }, (_, i) => ({ position: { x: 14 + (i % 10) * 3, z: (Math.floor(i / 10) - 3) * 8 }, strength: 1 }));
    expect(fireAmbience({ x: 0, z: 0 }, 1, 0, torches).level).toBeLessThan(0.5); // summed, it was the full 1
    const far = Array.from({ length: 100 }, (_, i) => ({ position: { x: 30 + i, z: 0 }, strength: 1 }));
    expect(fireAmbience({ x: 0, z: 0 }, 1, 0, far).level).toBe(0);
  });
});
