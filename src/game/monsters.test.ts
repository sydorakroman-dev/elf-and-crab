import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MONSTERS, Monster } from './monsters';
import type { Enemy, Spit, Strike } from './enemies';
import { ENEMY_KIND_LIST } from './enemyKinds';
import type { MonsterKind } from './enemies';

function run(e: Monster, target: THREE.Vector3, seconds: number, onStep?: (e: Monster, spits: Spit[]) => void, others: Enemy[] = [e]) {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    const spits = e.update(1 / 60, target, others, []);
    onStep?.(e, spits);
  }
}
const origin = () => new THREE.Vector3(0, 0, 0);

describe('monsters', () => {
  it('every kind has a wire code, and bosses have names', () => {
    for (const [k, d] of Object.entries(MONSTERS)) {
      expect(ENEMY_KIND_LIST).toContain(k);
      if (d.tier === 'mini-boss' || d.tier === 'boss') expect(d.bossName).toBeTruthy();
    }
  });

  it('melee monsters walk up and swing', () => {
    const e = new Monster('orcwarrior', 0, 8);
    let strike: Strike | null = null;
    run(e, origin(), 4, (m) => (strike ??= m.strike));
    expect(strike!.damage).toBe(20);
  });

  it('archers keep their distance and shoot arrows', () => {
    const e = new Monster('skelarcher', 0, 5);
    const spits: Spit[] = [];
    run(e, origin(), 5, (_, s) => spits.push(...s));
    expect(Math.hypot(e.x, e.z)).toBeGreaterThan(7);
    expect(spits[0]?.kind).toBe('arrow');
  });

  it('bomb lobbers mark where the hero stands, then the bomb lands there', () => {
    const e = new Monster('lobber', 0, 10);
    let ring = null as Monster['telegraph'];
    let strike: Strike | null = null;
    run(e, new THREE.Vector3(1, 0, 0), 5, (m) => {
      ring ??= m.telegraph ? { ...m.telegraph } : null;
      strike ??= m.strike;
    });
    expect(ring).toMatchObject({ x: 1, z: 0 });
    expect(strike).toMatchObject({ x: 1, z: 0, damage: (MONSTERS.lobber.attacks[0] as { damage: number }).damage });
  });

  it('spore crawlers leave poison behind', () => {
    const e = new Monster('sporecrawler', 0, 10);
    let strike: Strike | null = null;
    run(e, origin(), 6, (m) => (strike ??= m.strike));
    expect(strike!.zone).toBe('poison');
  });

  it('shield guards shrug off arrows to the front, not the back', () => {
    const e = new Monster('shieldguard', 0, 0); // faces +z
    const full = MONSTERS.shieldguard.hp;
    e.hurt(10, 0, -1); // arrow flying toward its face
    expect(e.hp).toBeCloseTo(full - 1.5);
    e.hurt(10, 0, 1); // from behind
    expect(e.hp).toBeCloseTo(full - 11.5);
  });

  it('living mold regrows when left alone', () => {
    const e = new Monster('mold', 0, 30);
    e.hurt(e.maxHp / 2, 0, 1);
    const hurt = e.hp;
    run(e, new THREE.Vector3(0, 0, -30), 6);
    expect(e.hp).toBeGreaterThan(hurt + 5);
  });

  it('orc shamans heal hurt friends nearby', () => {
    const shaman = new Monster('shaman', 0, 20);
    const friend = new Monster('orcwarrior', 2, 20);
    friend.hurt(30, 0, 1);
    const before = friend.hp;
    shaman.stun(10); // keep it standing next to its friend (healing still happens)
    run(shaman, origin(), 4.5, undefined, [shaman, friend]);
    expect(friend.hp).toBeGreaterThan(before);
  });

  it('bosses call for help as their health drops', () => {
    const boss = new Monster('scrapboss', 0, 20);
    boss.hurt(boss.maxHp * 0.25, 0, 1);
    expect(boss.summon).toBeNull();
    boss.hurt(boss.maxHp * 0.3, 0, 1); // past half
    expect(boss.summon).toEqual({ kind: 'brawler', count: 4 });
  });

  it('the Necromancer raises skeletons every so often', () => {
    const e = new Monster('necromancer', 0, 10);
    let summoned = false;
    run(e, origin(), 11, (m) => (summoned ||= m.summon?.kind === 'skeleton'));
    expect(summoned).toBe(true);
  });

  it('the cave worm burrows (can’t be hit), then bursts up under the hero', () => {
    const worm = new Monster('caveworm', 0, 12);
    let hidden = false;
    let strike: Strike | null = null;
    run(worm, new THREE.Vector3(3, 0, -2), 4, (m) => {
      if (m.hidden) {
        hidden = true;
        expect(m.hurt(50, 0, 1)).toBe(false);
      }
      strike ??= m.strike;
    });
    expect(hidden).toBe(true);
    expect(strike).toMatchObject({ x: 3, z: -2, damage: (MONSTERS.caveworm.attacks[0] as { damage: number }).damage });
    expect(worm.hp).toBe(MONSTERS.caveworm.hp);
  });

  it('spiders leap and hit hard while leaping', () => {
    const e = new Monster('spider', 0, 4);
    let max = 0;
    run(e, origin(), 1.5, (m) => (max = Math.max(max, m.touchDamage)));
    expect(max).toBe((MONSTERS.spider.attacks[0] as { damage: number }).damage);
  });

  it('ghosts drift straight through pillars', () => {
    const e = new Monster('ghost', 0, -10);
    for (let i = 0; i < 60 * 3; i++) e.update(1 / 60, new THREE.Vector3(0, 0, 10), [e], [{ x: 0, z: 0, radius: 2 }]);
    expect(Math.abs(e.x)).toBeLessThan(0.5); // didn't steer around
    expect(e.z).toBeGreaterThan(0);
  });

  it('every boss has a second phase', () => {
    for (const d of Object.values(MONSTERS)) if (d.bossName) expect(d.enrage?.attacks.length).toBeGreaterThan(0);
  });

  it('at half health a boss roars (throwing the hero back), speeds up and gains new moves', () => {
    const e = new Monster('chieftain', 0, 30);
    run(e, origin(), 0.5);
    e.hurt(e.maxHp * 0.55, 0, -1);
    let roar: Strike | null = null;
    run(e, origin(), 2, (m) => (roar ??= m.strike));
    expect(e.enraged).toBe(true);
    expect(roar!.knock).toBeGreaterThanOrEqual(30);
    // Faster than before: it covers more ground in a second (the hero far off, nothing to attack yet).
    const far = new THREE.Vector3(0, 0, -200);
    const calm = new Monster('chieftain', 0, 22);
    const angry = new Monster('chieftain', 0, 22);
    angry.hurt(angry.maxHp * 0.55, 0, -1);
    run(angry, far, 2); // the roar, then it sets off
    run(calm, far, 2);
    const [a0, c0] = [angry.z, calm.z];
    run(angry, far, 1);
    run(calm, far, 1);
    expect(a0 - angry.z).toBeGreaterThan((c0 - calm.z) * 1.1);
  });

  it('chained attacks go off several times in a row (the Scrap Boss’s rivet burst)', () => {
    const e = new Monster('scrapboss', 0, 14);
    const rivets: Spit[] = [];
    run(e, origin(), 3, (_, s) => rivets.push(...s.filter((x) => x.kind === 'rivet')));
    expect(rivets.length).toBe(6); // the burst: one, then five more
    expect(rivets[0].speed).toBeGreaterThan(1); // boss shots fly faster
  });

  it('leading shots aim where the hero is heading', () => {
    const e = new Monster('scrapboss', 0, 14);
    const target = new THREE.Vector3(0, 0, 0);
    let first: Spit | null = null;
    for (let i = 0; i < 60 * 3 && !first; i++) {
      target.x += 6 / 60; // running sideways at 6 m/s
      first = e.update(1 / 60, target, [e], []).find((s) => s.kind === 'rivet') ?? null;
    }
    const aimX = first!.dirX / -first!.dirZ; // sideways per metre forward
    const straightX = (target.x - e.x) / (e.z - target.z);
    expect(aimX).toBeGreaterThan(straightX + 0.05);
  });

  it('rings fly out all round', () => {
    const e = new Monster('inferno', 0, 14);
    e.hurt(e.maxHp * 0.55, 0, -1);
    let ring: Spit[] = [];
    run(e, origin(), 8, (_, s) => {
      if (s.length >= 12 && !ring.length) ring = s;
    });
    expect(ring.length).toBe(12);
    const angles = ring.map((s) => Math.atan2(s.dirX, s.dirZ));
    expect(Math.max(...angles) - Math.min(...angles)).toBeGreaterThan(Math.PI * 1.6);
  });

  it('the Necromancer blinks away when the hero stays close, in a burst of souls', () => {
    const e = new Monster('necromancer', 0, 3);
    const hero = new THREE.Vector3();
    let souls = 0;
    let jump = 0;
    for (let i = 0; i < 60 * 4 && !souls; i++) {
      hero.set(e.x, 0, e.z - 3); // the hero keeps on its heels
      const before = { x: e.x, z: e.z };
      const s = e.update(1 / 60, hero, [e], []);
      if (s.length === 8) {
        souls = s.length;
        jump = Math.hypot(e.x - before.x, e.z - before.z);
      }
    }
    expect(souls).toBe(8);
    expect(jump).toBeGreaterThan(8);
  });

  it.each(Object.keys(MONSTERS) as MonsterKind[])('%s runs without errors', (k) => {
    const e = new Monster(k, 0, 10);
    run(e, origin(), 5);
    expect(e.alive).toBe(true);
  });
});
