import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CASTERS, ELEMENTALS, Elemental, GOLEM, TREANT, VINE } from './elementals';
import type { Spit, Strike } from './enemies';
import { ENEMY_KIND_LIST } from './enemyKinds';

const HALF = 24;
function run(e: Elemental, target: THREE.Vector3, seconds: number, onStep?: (e: Elemental, spits: Spit[]) => void) {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    const spits = e.update(1 / 60, target, [e], [], HALF);
    onStep?.(e, spits);
  }
}

describe('nature elementals', () => {
  it('melee ones walk up to the hero', () => {
    const e = new Elemental('golem', 0, 12);
    run(e, new THREE.Vector3(0, 0, 0), 3);
    expect(e.z).toBeLessThan(6);
  });

  it('the golem winds up, then punches hard', () => {
    const e = new Elemental('golem', 0, 3);
    let strike: Strike | null = null;
    run(e, new THREE.Vector3(0, 0, 0), 3 + GOLEM.windup, (s) => (strike ??= s.strike));
    expect(strike!.damage).toBe(GOLEM.damage);
    expect(strike!.knock).toBe(GOLEM.knock);
  });

  it('the thorn vine lashes from a few metres away', () => {
    const e = new Elemental('vine', 0, 3.2);
    let strike: Strike | null = null;
    run(e, new THREE.Vector3(0, 0, 0), 3 + VINE.windup, (s) => (strike ??= s.strike));
    expect(strike!.damage).toBe(VINE.damage);
  });

  it('the treant marks where the hero stood, then roots erupt there and slow', () => {
    const e = new Elemental('treant', 0, 10);
    const target = new THREE.Vector3(2, 0, 0);
    let ring = null as Elemental['telegraph'];
    let strike: Strike | null = null;
    run(e, target, 3 + TREANT.windup, (s) => {
      ring ??= s.telegraph ? { ...s.telegraph } : null;
      strike ??= s.strike;
    });
    expect(ring).toMatchObject({ x: 2, z: 0 });
    expect(strike).toMatchObject({ x: 2, z: 0, damage: TREANT.damage });
    expect(strike!.slow?.factor).toBe(TREANT.slowFactor);
  });

  it.each(['wind', 'water', 'fire'] as const)('the %s elemental keeps its distance and throws its bolt', (kind) => {
    const e = new Elemental(kind, 0, 4);
    const spits: Spit[] = [];
    run(e, new THREE.Vector3(0, 0, 0), 4, (_, s) => spits.push(...s));
    expect(Math.hypot(e.x, e.z)).toBeGreaterThan(5);
    expect(spits.length).toBeGreaterThan(0);
    expect(spits[0].kind).toBe(CASTERS[kind].shot);
  });

  it('stunning cancels a wind-up', () => {
    const e = new Elemental('treant', 0, 5);
    run(e, new THREE.Vector3(0, 0, 0), 2.6, () => {});
    e.stun(2);
    expect(e.telegraph).toBeNull();
    let strike: Strike | null = null;
    run(e, new THREE.Vector3(0, 0, 0), 1, (s) => (strike ??= s.strike));
    expect(strike).toBeNull();
  });

  it('elites are tougher than the rest, and every kind has a wire code', () => {
    for (const k of ['vine', 'wind', 'water', 'fire'] as const) expect(ELEMENTALS.golem.hp).toBeGreaterThan(ELEMENTALS[k].hp);
    for (const k of Object.keys(ELEMENTALS)) expect(ENEMY_KIND_LIST).toContain(k);
  });
});
