import { describe, expect, it } from 'vitest';
import { joystickVector } from './joystick';

describe('joystickVector', () => {
  it('is zero at rest and inside the dead zone', () => {
    expect(joystickVector(0, 0, 60)).toEqual({ x: 0, y: 0 });
    expect(joystickVector(5, 0, 60)).toEqual({ x: 0, y: 0 });
  });

  it('maps up on screen to forward and right to right', () => {
    const up = joystickVector(0, -60, 60);
    expect(up.x).toBeCloseTo(0);
    expect(up.y).toBeCloseTo(1);
    const right = joystickVector(60, 0, 60);
    expect(right.x).toBeCloseTo(1);
    expect(right.y).toBeCloseTo(0);
  });

  it('clamps to length 1 past the rim', () => {
    const v = joystickVector(300, -300, 60);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1);
  });

  it('ramps smoothly from the dead zone edge', () => {
    const half = joystickVector(0, -(60 * (0.15 + 0.85 / 2)), 60);
    expect(half.y).toBeCloseTo(0.5);
  });
});
