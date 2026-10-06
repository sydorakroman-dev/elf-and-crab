import * as THREE from 'three';
import { BOSS_DEATH_SECONDS, DEATH_SECONDS } from './reactions';
import { scaledHp } from './difficulty';
import { clampToArena, pushOutOfCircles, rangeIntent, type Circle } from './combat';
import { steerMove } from './steer';
import type { BeastPose } from './beastVisual';
import { ElementalVisual } from './elementalVisual';
import type { ElementalKind, Enemy, EnemyTuple, Spit, Strike, Summon, Telegraph } from './enemies';
import type { ProjectileKind } from './globs';
import { ENEMY_KIND_LIST } from './enemyKinds';
import { q } from '../net/snapshot';

/**
 * The nature elementals: thorn vines and treants in the Woodland, water elementals in the Flooded Hall,
 * fire, wind and rock golems in the Lava Chamber and the Ash King's Lair. Melee ones walk up and hit hard; ranged ones hold a
 * distance and throw bolts (gust / water / fire, see globs.ts; effects in balance.ts).
 */
export interface ElementalDef {
  name: string;
  tier: 'normal' | 'tough' | 'elite';
  style: 'melee' | 'ranged';
  hp: number;
  speed: number;
  radius: number;
  touch: number;
  push: number;
  score: number;
  color: number;
  drop: number;
}

export const ELEMENTALS: Record<ElementalKind, ElementalDef> = {
  vine: { name: 'Thorn Vine', tier: 'normal', style: 'melee', hp: 22, speed: 3.9, radius: 0.8, touch: 8, push: 6, score: 20, color: 0x4f9a3a, drop: 0.08 },
  wind: { name: 'Wind Elemental', tier: 'normal', style: 'ranged', hp: 65, speed: 4.8, radius: 0.85, touch: 8, push: 7, score: 25, color: 0xcfe6f2, drop: 0.08 },
  water: { name: 'Water Elemental', tier: 'normal', style: 'ranged', hp: 65, speed: 3.3, radius: 0.9, touch: 10, push: 6, score: 30, color: 0x3fa8e0, drop: 0.1 },
  fire: { name: 'Fire Elemental', tier: 'tough', style: 'ranged', hp: 105, speed: 3.5, radius: 0.85, touch: 15, push: 5, score: 45, color: 0xff7a2a, drop: 0.15 },
  treant: { name: 'Treant', tier: 'elite', style: 'melee', hp: 90, speed: 2.6, radius: 1.3, touch: 12, push: 2, score: 70, color: 0x7a5a32, drop: 0.25 },
  golem: { name: 'Rock Golem', tier: 'elite', style: 'melee', hp: 255, speed: 2.4, radius: 1.3, touch: 15, push: 1.5, score: 80, color: 0x8a8378, drop: 0.25 },
};

// Thorn vine: rears back, then lashes a vine out in front.
export const VINE = { range: 3.0, windup: 0.55, reach: 2.0, radius: 1.4, damage: 10, knock: 10, cooldown: 2.0 };
// Rock golem: raises both fists, then punches with huge knockback.
export const GOLEM = { range: 3.0, windup: 0.75, reach: 1.6, radius: 2.2, damage: 30, knock: 34, cooldown: 2.4 };
// Treant: roots burst out of the ground under the hero (warning ring first).
export const TREANT = { range: 14, windup: 1.2, radius: 2.2, damage: 16, knock: 6, slowSeconds: 1.5, slowFactor: 0.5, cooldown: 5 };
// Ranged elementals: distance band, time between shots, cast wind-up.
export const CASTERS: Record<'wind' | 'water' | 'fire', { min: number; max: number; interval: number; windup: number; shot: ProjectileKind }> = {
  wind: { min: 10.5, max: 18, interval: 2.4, windup: 0.5, shot: 'gust' },
  water: { min: 12, max: 19.5, interval: 3.0, windup: 0.6, shot: 'water' },
  fire: { min: 13.5, max: 21, interval: 3.2, windup: 0.7, shot: 'fire' },
};

let nextElementalId = 200000; // separate from beast ids

type Mode = 'chase' | 'windup' | 'recover';

export class Elemental implements Enemy {
  readonly id = nextElementalId++;
  readonly kind: ElementalKind;
  readonly def: ElementalDef;
  readonly radius: number;
  readonly score: number;
  readonly color: THREE.Color;
  readonly maxHp: number;
  readonly visual: ElementalVisual;
  readonly bossName = null;
  hp: number;
  dying = false;
  removed = false;
  slow = 1;
  /** Drenched (the goldfish's Water Jet): slowed to `soakFactor` for a while. */
  private soakTimer = 0;
  private soakFactor = 1;
  telegraph: Telegraph | null = null;
  strike: Strike | null = null;
  summon: Summon | null = null;
  private readonly pose: BeastPose;
  private readonly knock = new THREE.Vector2();
  private mode: Mode = 'chase';
  private timer = 0;
  private cooldown: number;
  private flash = 0;
  private stunTimer = 0;
  private calmTimer = 0;
  private deathTimer = 0;
  private time = 0;
  private wander = Math.random() * Math.PI * 2;
  private readonly side = Math.random() < 0.5 ? -1 : 1;

  constructor(kind: ElementalKind, x: number, z: number) {
    this.kind = kind;
    this.def = ELEMENTALS[kind];
    this.radius = this.def.radius;
    this.score = this.def.score;
    this.color = new THREE.Color(this.def.color);
    this.maxHp = this.hp = scaledHp(this.def.hp); // per difficulty
    // Casters open fire a little after arriving, staggered so a group doesn't fire in unison;
    // brawlers swing as soon as they reach the hero.
    this.cooldown = this.def.style === 'ranged' ? 1 + Math.random() * 1.5 : 0.3;
    this.visual = new ElementalVisual(kind);
    this.pose = { x, z, yaw: 0, y: 0, speed: 0, act: 0, mode: 0, flash: 0, stun: 0, death: 0, calm: 0 };
    this.visual.apply(this.pose, 0, 0);
  }

  get group(): THREE.Group {
    return this.visual.group;
  }
  get x(): number {
    return this.pose.x;
  }
  get z(): number {
    return this.pose.z;
  }
  get alive(): boolean {
    return !this.dying;
  }
  get stunned(): boolean {
    return this.stunTimer > 0;
  }
  get calmed(): boolean {
    return this.calmTimer > 0;
  }
  get harmless(): boolean {
    return this.stunned || this.calmed;
  }
  get touchDamage(): number {
    return this.def.touch;
  }
  get touchKnock(): number {
    return this.kind === 'golem' ? 20 : 12;
  }

  setPosition(x: number, z: number): void {
    this.pose.x = x;
    this.pose.z = z;
    this.visual.apply(this.pose, 0, this.time);
  }

  hurt(amount: number, dirX: number, dirZ: number): boolean {
    if (this.dying) return false;
    this.hp -= amount;
    this.flash = 1;
    this.knock.set(dirX * this.def.push, dirZ * this.def.push);
    if (this.hp <= 0) {
      this.dying = true;
      this.telegraph = null;
    }
    return this.dying;
  }

  stun(seconds: number): void {
    if (this.dying) return;
    if (this.def.tier === 'elite') seconds *= 0.7;
    this.stunTimer = Math.max(this.stunTimer, seconds);
    this.cancel();
  }

  /** Shoved about `metres` along (dirX, dirZ) (heavier foes go less far). */
  shove(dirX: number, dirZ: number, metres: number): void {
    if (this.dying) return;
    const v = metres * 8 * Math.min(1, this.def.push / 6); // knockback decays at 8/s: it travels ≈ v / 8
    this.knock.set(dirX * v, dirZ * v);
  }

  soak(seconds: number, factor: number): void {
    if (this.dying) return;
    this.soakTimer = Math.max(this.soakTimer, seconds);
    this.soakFactor = factor;
  }

  calm(seconds: number): void {
    if (this.dying) return;
    this.calmTimer = Math.max(this.calmTimer, seconds);
    this.cancel();
  }

  onHitTarget(): void {}

  tuple(): EnemyTuple {
    const o = this.pose;
    return [this.id, ENEMY_KIND_LIST.indexOf(this.kind), q(o.x), q(o.z), q(o.yaw), q(o.y), q(o.speed), q(o.act), o.mode, q(o.flash), o.stun, q(o.death), o.calm];
  }

  private cancel(): void {
    this.telegraph = null;
    if (this.mode === 'windup') this.setMode('chase', 0);
  }

  update(dt: number, target: THREE.Vector3, others: readonly Enemy[], obstacles: readonly Circle[]): Spit[] {
    this.time += dt;
    this.strike = null;
    this.flash = Math.max(0, this.flash - dt * 5);
    const p = this.pose;
    p.flash = this.flash;

    if (this.dying) {
      this.deathTimer += dt;
      p.death = Math.min(1, this.deathTimer / (this.bossName ? BOSS_DEATH_SECONDS : DEATH_SECONDS));
      p.speed = 0;
      if (p.death === 1) this.removed = true;
      this.visual.apply(p, dt, this.time);
      return [];
    }

    p.x += this.knock.x * dt;
    p.z += this.knock.y * dt;
    this.knock.multiplyScalar(Math.exp(-8 * dt));
    if (this.soakTimer > 0) {
      this.soakTimer = Math.max(0, this.soakTimer - dt);
      this.slow = Math.min(this.slow, this.soakFactor);
    }

    let speed = 0;
    let spits: Spit[] = [];
    if (this.stunTimer > 0) {
      this.stunTimer = Math.max(0, this.stunTimer - dt);
    } else if (this.calmTimer > 0) {
      this.calmTimer = Math.max(0, this.calmTimer - dt);
      this.wander += (Math.random() - 0.5) * dt * 3;
      const away = Math.atan2(p.x - target.x, p.z - target.z);
      const dir = away * 0.4 + this.wander * 0.6;
      speed = this.def.speed * 0.45 * this.slow;
      this.move(Math.sin(dir), Math.cos(dir), speed, dt, others, obstacles);
    } else {
      [speed, spits] = this.think(dt, target, others, obstacles);
    }

    pushOutOfCircles(p, this.radius, obstacles);
    clampToArena(p, this.radius);
    p.speed = speed;
    p.stun = this.stunTimer > 0 ? 1 : 0;
    p.calm = this.calmTimer > 0 ? 1 : 0;
    p.mode = this.mode === 'windup' ? 1 : this.mode === 'recover' && p.act > 0 ? 2 : 0;
    this.visual.apply(p, dt, this.time);
    this.slow = 1;
    return spits;
  }

  private setMode(mode: Mode, time: number): void {
    this.mode = mode;
    this.timer = time;
  }

  private windupTime(): number {
    switch (this.kind) {
      case 'vine':
        return VINE.windup;
      case 'golem':
        return GOLEM.windup;
      case 'treant':
        return TREANT.windup;
      default:
        return CASTERS[this.kind].windup;
    }
  }

  private think(dt: number, target: THREE.Vector3, others: readonly Enemy[], obstacles: readonly Circle[]): [number, Spit[]] {
    const p = this.pose;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.timer -= dt;
    let tx = target.x - p.x;
    let tz = target.z - p.z;
    const dist = Math.hypot(tx, tz) || 1;
    tx /= dist;
    tz /= dist;
    const face = (x: number, z: number) => (p.yaw = Math.atan2(x, z));

    if (this.mode === 'windup') {
      p.act = 1 - Math.max(0, this.timer) / this.windupTime();
      face(tx, tz);
      if (this.telegraph) this.telegraph.p = p.act;
      if (this.timer <= 0) return [0, this.release(tx, tz, dist)];
      return [0, []];
    }
    if (this.mode === 'recover') {
      if (this.timer <= 0) {
        p.act = 0;
        this.setMode('chase', 0);
      }
      return [0, []];
    }

    // Chase (melee) or hold a distance band and circle (ranged).
    const speed = this.def.speed * this.slow;
    face(tx, tz);
    p.act = 0;
    if (this.def.style === 'ranged') {
      const c = CASTERS[this.kind as 'wind' | 'water' | 'fire'];
      const intent = rangeIntent(dist, c.min, c.max);
      const mx = intent === 0 ? tz * this.side : tx * intent + tz * this.side * 0.3;
      const mz = intent === 0 ? -tx * this.side : tz * intent - tx * this.side * 0.3;
      const s = intent === 0 ? speed * 0.5 : speed;
      this.move(mx, mz, s, dt, others, obstacles);
      if (this.cooldown === 0 && dist <= c.max + 2) this.setMode('windup', c.windup);
      return [s, []];
    }
    if (this.kind === 'treant' && this.cooldown === 0 && dist < TREANT.range) {
      // Roots will erupt where the hero stands now.
      this.telegraph = { x: target.x, z: target.z, r: TREANT.radius, p: 0 };
      this.setMode('windup', TREANT.windup);
      return [0, []];
    }
    const melee = this.kind === 'golem' ? GOLEM : this.kind === 'vine' ? VINE : null;
    if (melee && this.cooldown === 0 && dist < melee.range + this.radius) {
      this.setMode('windup', melee.windup);
      return [0, []];
    }
    this.move(tx, tz, speed, dt, others, obstacles);
    return [speed, []];
  }

  /** The wind-up is over: the attack lands (melee) or the bolt flies (ranged). */
  private release(tx: number, tz: number, dist: number): Spit[] {
    const p = this.pose;
    p.act = 1;
    if (this.kind === 'treant') {
      const t = this.telegraph!;
      this.strike = { x: t.x, z: t.z, r: TREANT.radius, damage: TREANT.damage, knock: TREANT.knock, slow: { seconds: TREANT.slowSeconds, factor: TREANT.slowFactor } };
      this.telegraph = null;
      this.cooldown = TREANT.cooldown;
      this.setMode('recover', 0.5);
      return [];
    }
    if (this.kind === 'golem' || this.kind === 'vine') {
      const m = this.kind === 'golem' ? GOLEM : VINE;
      const reach = Math.min(this.radius + m.reach, Math.max(0, dist - 0.6)); // land just short of the hero, so it shoves them away
      this.strike = { x: p.x + tx * reach, z: p.z + tz * reach, r: m.radius, damage: m.damage, knock: m.knock };
      this.cooldown = m.cooldown;
      this.setMode('recover', 0.45);
      return [];
    }
    const c = CASTERS[this.kind];
    this.cooldown = c.interval;
    this.setMode('recover', 0.3);
    const out = this.radius + 0.4;
    return [{ x: p.x + tx * out, z: p.z + tz * out, dirX: tx, dirZ: tz, kind: c.shot }];
  }

  private move(dx: number, dz: number, speed: number, dt: number, others: readonly Enemy[], obstacles: readonly Circle[]): void {
    steerMove(this.pose, dx, dz, speed, dt, this.radius, this, others, obstacles, this.side);
  }
}
