import { describe, expect, it } from 'vitest';
import { SnapshotBuffer, interpolate, q, type Snapshot } from './snapshot';

function snap(t: number, over: Partial<Snapshot> = {}): Snapshot {
  return {
    t,
    state: 'playing',
    hero: { x: 0, z: 0, f: 0, s: 0, m: 0, a: 0, d: 0, v: 1 },
    crab: null,
    slimes: [],
    arrows: [],
    globs: [],
    pickups: [],
    wave: 1,
    remaining: 3,
    health: 5,
    maxHealth: 5,
    score: 0,
    powers: [],
    burstCd: 0,
    ev: [],
    ...over,
  };
}

describe('q', () => {
  it('rounds to 2 decimals', () => {
    expect(q(1.23456)).toBe(1.23);
    expect(q(-0.005)).toBe(-0);
  });
});

describe('interpolate', () => {
  it('blends hero position and takes the shortest way round for angles', () => {
    const a = snap(0, { hero: { x: 0, z: 0, f: 3.0, s: 0, m: 0, a: 0, d: 0, v: 1 } });
    const b = snap(1, { hero: { x: 2, z: -4, f: -3.0, s: 4, m: 0, a: 1, d: 0, v: 1 } });
    const m = interpolate(a, b, 0.5);
    expect(m.hero.x).toBeCloseTo(1);
    expect(m.hero.z).toBeCloseTo(-2);
    expect(Math.abs(m.hero.f)).toBeGreaterThan(3.1); // via ±π, not through 0
    expect(m.hero.a).toBe(1);
  });

  it('matches slimes by id; new ones appear, removed ones vanish', () => {
    const a = snap(0, { slimes: [[1, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0], [2, 1, 5, 5, 0, 0, 1, 1, 1, 0, 0, 0]] });
    const b = snap(1, { slimes: [[1, 0, 4, 0, 0, 0, 1, 1, 1, 0, 0, 0], [3, 2, 9, 9, 0, 0, 1, 1, 1, 0, 0, 0]] });
    const m = interpolate(a, b, 0.25);
    expect(m.slimes.map((s) => s[0])).toEqual([1, 3]);
    expect(m.slimes[0][2]).toBeCloseTo(1);
    expect(m.slimes[1][2]).toBe(9);
  });

  it('snaps instead of sliding when something teleports', () => {
    const a = snap(0, { hero: { x: 0, z: 0, f: 0, s: 0, m: 0, a: 0, d: 0, v: 1 } });
    const b = snap(1, { hero: { x: 30, z: 0, f: 0, s: 0, m: 0, a: 0, d: 0, v: 1 } });
    expect(interpolate(a, b, 0.5).hero.x).toBe(30);
  });

  it('does not repeat events', () => {
    const b = snap(1, { ev: [{ e: 'spit' }] });
    expect(interpolate(snap(0), b, 0.5).ev).toEqual([]);
  });
});

describe('SnapshotBuffer', () => {
  it('renders slightly in the past, blending the surrounding pair', () => {
    const buf = new SnapshotBuffer(0.1);
    // Hero clock t, arriving 0.05 s later on the local clock (offset 1000.05).
    for (let i = 0; i <= 10; i++) buf.push(snap(i * 0.05, { hero: { x: i, z: 0, f: 0, s: 0, m: 0, a: 0, d: 0, v: 1 } }), 1000.05 + i * 0.05);
    // Local 1000.55 → hero 0.5 − 0.1 delay = 0.4 → x = 8.
    expect(buf.sample(1000.55)!.hero.x).toBeCloseTo(8);
    expect(buf.sample(1000.5625)!.hero.x).toBeCloseTo(8.25);
  });

  it('holds the newest when the stream stalls, and resets on a new run', () => {
    const buf = new SnapshotBuffer(0.1);
    buf.push(snap(10), 0);
    buf.push(snap(10.05), 0.05);
    expect(buf.sample(99)!.t).toBeCloseTo(10.05);
    buf.push(snap(0), 1); // hero restarted
    expect(buf.latest!.t).toBe(0);
    expect(buf.sample(1)!.t).toBe(0);
  });

  it('is empty before the first snapshot', () => {
    expect(new SnapshotBuffer().sample(0)).toBeNull();
  });
});
