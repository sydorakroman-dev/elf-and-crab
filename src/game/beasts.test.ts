import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BEAR, BEASTS, BOAR, Beast, SNAKE } from './beasts';
import type { Enemy } from './enemies';

const HALF = 24;
function run(b: Beast, target: THREE.Vector3, seconds: number, onStep?: (b: Beast) => void, others: Enemy[] = [b]) {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    b.update(1 / 60, target, others, [], HALF);
    onStep?.(b);
  }
}

describe('forest beasts', () => {
  it('are tiered: tougher beasts have more HP and the bear is a mini-boss', () => {
    const order = ['beetle', 'snake', 'direwolf', 'boar', 'bear'] as const;
    for (let i = 1; i < order.length; i++) expect(BEASTS[order[i]].hp).toBeGreaterThan(BEASTS[order[i - 1]].hp);
    expect(new Beast('bear', 0, 0).bossName).toBe('The Crystal Bear');
  });

  it('beetles chase the hero', () => {
    const b = new Beast('beetle', 0, 10);
    run(b, new THREE.Vector3(0, 0, 0), 1.5);
    expect(b.z).toBeLessThan(5);
  });

  it('the snake coils, then lunges for a strike', () => {
    const b = new Beast('snake', 0, 3);
    let strike = null as Beast['strike'];
    run(b, new THREE.Vector3(0, 0, 0), SNAKE.coil + SNAKE.lungeTime + 0.2, (s) => (strike ??= s.strike));
    expect(strike?.damage).toBe(SNAKE.damage);
  });

  it('the dire wolf backs off after biting, and is harmless while it does', () => {
    const b = new Beast('direwolf', 0, 1);
    const target = new THREE.Vector3(0, 0, 0);
    b.onHitTarget();
    expect(b.harmless).toBe(true);
    run(b, target, 0.6);
    expect(Math.hypot(b.x, b.z)).toBeGreaterThan(2);
  });

  it('the boar paws, charges, and is dazed when it slams into a wall', () => {
    const b = new Beast('boar', 0, 8);
    const target = new THREE.Vector3(0, 0, 15); // the south wall is just beyond
    let maxTouch = 0;
    let dazed = false;
    run(b, target, BOAR.paw + BOAR.chargeTime + 0.5, (s) => {
      maxTouch = Math.max(maxTouch, s.touchDamage);
      if (s.harmless) dazed = true;
    });
    expect(maxTouch).toBe(BOAR.chargeDamage);
    expect(b.z).toBeGreaterThan(20); // it really charged, all the way to the wall
    expect(dazed).toBe(true);
  });

  it('the bear ground-pounds with a warning, and roars for beetles at half health', () => {
    const b = new Beast('bear', 0, 0);
    const target = new THREE.Vector3(10, 0, 0);
    let warned = false;
    let pound = null as Beast['strike'];
    run(b, target, BEAR.poundEvery + BEAR.poundWindup + 3, (s) => { // a swipe in progress can delay it a moment
      if (s.telegraph) warned = true;
      if (s.strike && s.strike.r === BEAR.poundRadius) pound = s.strike;
    });
    expect(warned).toBe(true);
    expect(pound?.damage).toBe(BEAR.poundDamage);

    b.hurt(BEASTS.bear.hp / 2 + 1, 0, 0);
    let summon = null as Beast['summon'];
    run(b, target, BEAR.roar + 0.2, (s) => (summon ??= s.summon));
    expect(summon).toEqual({ kind: 'beetle', count: BEAR.roarBeetles });
  });

  it('the bear shrugs off calm and half of any stun', () => {
    const b = new Beast('bear', 0, 0);
    b.calm(5);
    expect(b.calmed).toBe(false);
    b.stun(2);
    run(b, new THREE.Vector3(0, 0, 10), 1.1);
    expect(b.stunned).toBe(false);
  });
});
