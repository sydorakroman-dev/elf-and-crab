import { describe, expect, it } from 'vitest';
import { Spring, cadence, legPose, splitBody } from './gait';

describe('legPose', () => {
  it('stands still at rest', () => {
    for (const phase of [0, 1, 2, 4]) {
      const { hip, knee } = legPose(phase, 0);
      expect(Math.abs(hip)).toBeCloseTo(0);
      expect(knee).toBeCloseTo(0);
    }
  });

  it('bends the knee on the forward swing, not while planted', () => {
    const swinging = legPose(0, 1); // cos φ = 1: mid-swing
    const planted = legPose(Math.PI, 1); // cos φ = -1: mid-stance
    expect(swinging.knee).toBeGreaterThan(0.8);
    expect(planted.knee).toBeLessThan(0.1);
  });

  it('never hyper-extends the knee and swings further when running', () => {
    for (let p = 0; p < Math.PI * 2; p += 0.1) expect(legPose(p, 0.7).knee).toBeGreaterThanOrEqual(0);
    expect(Math.abs(legPose(Math.PI / 2, 1).hip)).toBeGreaterThan(Math.abs(legPose(Math.PI / 2, 0.4).hip));
  });
});

describe('splitBody', () => {
  it('keeps hips aligned when moving where you face', () => {
    expect(splitBody(0, 0)).toEqual({ hipYaw: 0, direction: 1 });
  });

  it('turns the hips toward a sideways move, clamped', () => {
    const r = splitBody(0, Math.PI / 2);
    expect(r.direction).toBe(1);
    expect(r.hipYaw).toBeCloseTo((70 * Math.PI) / 180);
    expect(splitBody(0, 0.5).hipYaw).toBeCloseTo(0.5);
  });

  it('backpedals when moving away from the facing', () => {
    const r = splitBody(0, Math.PI);
    expect(r.direction).toBe(-1);
    expect(r.hipYaw).toBeCloseTo(0);
    const diag = splitBody(0, Math.PI - 0.3);
    expect(diag.direction).toBe(-1);
    expect(diag.hipYaw).toBeCloseTo(-0.3);
  });
});

describe('cadence', () => {
  it('speeds up with speed', () => {
    expect(cadence(7.5)).toBeGreaterThan(cadence(2));
  });
});

describe('Spring', () => {
  it('overshoots then settles on the target', () => {
    const s = new Spring(0, 60, 6);
    let peak = 0;
    for (let i = 0; i < 60; i++) peak = Math.max(peak, s.update(1, 1 / 60));
    expect(peak).toBeGreaterThan(1);
    for (let i = 0; i < 600; i++) s.update(1, 1 / 60);
    expect(s.value).toBeCloseTo(1, 3);
  });

  it('stays stable with a big time step', () => {
    const s = new Spring(0, 200, 10);
    s.update(1, 0.5);
    expect(Number.isFinite(s.value)).toBe(true);
    expect(Math.abs(s.value)).toBeLessThan(2);
  });
});
