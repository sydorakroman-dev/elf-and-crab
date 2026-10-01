import * as THREE from 'three';
import { clampToArena, pushOutOfCircles, type Circle } from './combat';
import { steerMove } from './steer';
import { BeastVisual, type BeastPose } from './beastVisual';
import type { BeastKind, Enemy, EnemyTuple, Spit, Strike, Summon, Telegraph } from './enemies';
import { ENEMY_KIND_LIST } from './enemyKinds';
import { q } from '../net/snapshot';

/**
 * The forest beasts (all melee), by strength tier. HP and damage are on the hero's 100 HP scale.
 * `touch`: damage on contact. Special attacks have their own numbers below.
 */
export interface BeastDef {
  name: string;
  tier: 'weak' | 'normal' | 'tough' | 'elite' | 'mini-boss';
  hp: number;
  speed: number;
  radius: number;
  touch: number;
  /** How far hits push it back (lower = heavier). */
  push: number;
  score: number;
  color: number;
  /** Chance to drop a power-up when killed. */
  drop: number;
}

export const BEASTS: Record<BeastKind, BeastDef> = {
  beetle: { name: 'Armored Beetle', tier: 'weak', hp: 10, speed: 5.3, radius: 0.6, touch: 8, push: 9, score: 8, color: 0x1f6a6e, drop: 0.03 },
  snake: { name: 'Venomous Snake', tier: 'normal', hp: 30, speed: 3.5, radius: 0.7, touch: 10, push: 7, score: 15, color: 0x2f8f3a, drop: 0.06 },
  direwolf: { name: 'Dire Wolf', tier: 'tough', hp: 50, speed: 7.5, radius: 0.8, touch: 15, push: 5, score: 30, color: 0x3a4250, drop: 0.12 },
  boar: { name: 'Thorn Boar', tier: 'elite', hp: 90, speed: 4.2, radius: 1.0, touch: 15, push: 2.5, score: 60, color: 0x7a4a26, drop: 0.25 },
  bear: { name: 'The Crystal Bear', tier: 'mini-boss', hp: 450, speed: 4.0, radius: 1.7, touch: 22, push: 0.8, score: 300, color: 0x6b4226, drop: 0 },
};

// Snake: coils, then lunges.
export const SNAKE = { range: 3.4, coil: 0.45, lungeTime: 0.18, lungeDistance: 3.2, damage: 18, cooldown: 1.8 };
// Dire wolf: bites, then backs off before coming again.
export const DIREWOLF = { retreat: 0.9, retreatSpeed: 6.5 };
// Thorn boar: paws the ground, then charges in a straight line; dazed if it hits something.
export const BOAR = { minRange: 5, maxRange: 16, paw: 0.8, chargeSpeed: 15, chargeTime: 1.1, chargeDamage: 30, chargeKnock: 22, daze: 1.2, cooldown: 3.5 };
// Crystal bear: swipes up close; ground-pounds every few seconds, flinging a ring of crystal shards;
// charges from afar (dazed if it hits a tree or wall). At half health it roars in beetles and enrages:
// faster, pounding and charging more often.
export const BEAR = {
  swipeRange: 3.2, swipeWindup: 0.4, swipeRadius: 2.8, swipeDamage: 28,
  poundEvery: 6, poundWindup: 1.0, poundRadius: 4.5, poundDamage: 25, shards: 8,
  chargeMin: 6, chargeMax: 18, chargeWindup: 0.7, chargeSpeed: 16, chargeTime: 1.1, chargeDamage: 26, chargeKnock: 24, chargeDaze: 1.6, chargeEvery: 8.5, chargeFirst: 4,
  roar: 0.8, roarBeetles: 6,
  /** After the roar: speed ×, and pound / charge timers ×. */
  enragedSpeed: 1.2, enragedCooldown: 0.75,
};

let nextBeastId = 100000; // separate from other enemy ids

type Mode = 'chase' | 'windup' | 'attack' | 'recover' | 'retreat' | 'dazed';

/** A forest beast. Melee: chases the hero, with a special move depending on its kind. */
export class Beast implements Enemy {
  readonly id = nextBeastId++;
  readonly kind: BeastKind;
  readonly def: BeastDef;
  readonly radius: number;
  readonly score: number;
  readonly color: THREE.Color;
  readonly maxHp: number;
  readonly visual: BeastVisual;
  hp: number;
  dying = false;
  removed = false;
  slow = 1;
  telegraph: Telegraph | null = null;
  strike: Strike | null = null;
  summon: Summon | null = null;
  private readonly pose: BeastPose;
  private readonly knock = new THREE.Vector2();
  private mode: Mode = 'chase';
  private timer = 0;
  private cooldown = 0;
  private poundTimer = BEAR.poundEvery;
  private chargeTimer = BEAR.chargeFirst;
  private bearMove: 'swipe' | 'pound' | 'charge' = 'swipe';
  private roared = false;
  /** Bolts to fire this step (the bear's crystal shards). */
  private spits: Spit[] = [];
  private lockDir = { x: 0, z: 1 };
  private flash = 0;
  private stunTimer = 0;
  private calmTimer = 0;
  private deathTimer = 0;
  private time = 0;
  private wander = Math.random() * Math.PI * 2;
  private readonly side = Math.random() < 0.5 ? -1 : 1;

  constructor(kind: BeastKind, x: number, z: number) {
    this.kind = kind;
    this.def = BEASTS[kind];
    this.radius = this.def.radius;
    this.score = this.def.score;
    this.color = new THREE.Color(this.def.color);
    this.maxHp = this.hp = this.def.hp;
    this.visual = new BeastVisual(kind);
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
    return this.stunned || this.calmed || this.mode === 'dazed' || this.mode === 'retreat';
  }
  private get charging(): boolean {
    return this.mode === 'attack' && (this.kind === 'boar' || (this.kind === 'bear' && this.bearMove === 'charge'));
  }
  get touchDamage(): number {
    if (!this.charging) return this.def.touch;
    return this.kind === 'bear' ? BEAR.chargeDamage : BOAR.chargeDamage;
  }
  get touchKnock(): number {
    if (!this.charging) return 12;
    return this.kind === 'bear' ? BEAR.chargeKnock : BOAR.chargeKnock;
  }
  get bossName(): string | null {
    return this.kind === 'bear' ? this.def.name : null;
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
    } else if (this.kind === 'bear' && !this.roared && this.hp <= this.maxHp / 2) {
      this.roared = true;
      this.telegraph = null; // the roar cuts off whatever it was winding up
      this.setMode('windup', BEAR.roar);
      this.pose.act = 0;
      this.roaring = true;
    }
    return this.dying;
  }
  private roaring = false;

  stun(seconds: number): void {
    if (this.dying) return;
    if (this.kind === 'bear') seconds *= 0.5;
    if (this.charging) return; // a charge can't be stopped
    this.stunTimer = Math.max(this.stunTimer, seconds);
    this.telegraph = null;
    if (this.mode !== 'chase') this.setMode('chase', 0);
  }

  calm(seconds: number): void {
    if (this.dying || this.kind === 'bear') return; // the bear can't be calmed
    this.calmTimer = Math.max(this.calmTimer, seconds);
    if (this.mode !== 'chase') this.setMode('chase', 0);
  }

  onHitTarget(): void {
    if (this.kind === 'direwolf') this.setMode('retreat', DIREWOLF.retreat);
  }

  tuple(): EnemyTuple {
    const o = this.pose;
    return [this.id, ENEMY_KIND_LIST.indexOf(this.kind), q(o.x), q(o.z), q(o.yaw), q(o.y), q(o.speed), q(o.act), o.mode, q(o.flash), o.stun, q(o.death), o.calm];
  }

  update(dt: number, target: THREE.Vector3, others: readonly Enemy[], obstacles: readonly Circle[], half: number): Spit[] {
    this.time += dt;
    this.strike = null;
    this.flash = Math.max(0, this.flash - dt * 5);
    const p = this.pose;
    p.flash = this.flash;

    if (this.dying) {
      this.deathTimer += dt;
      p.death = Math.min(1, this.deathTimer / 0.35);
      p.speed = 0;
      if (p.death === 1) this.removed = true;
      this.visual.apply(p, dt, this.time);
      return [];
    }

    // Knockback always slides it a little.
    p.x += this.knock.x * dt;
    p.z += this.knock.y * dt;
    this.knock.multiplyScalar(Math.exp(-8 * dt));

    let speed = 0;
    if (this.stunTimer > 0) {
      this.stunTimer = Math.max(0, this.stunTimer - dt);
    } else if (this.calmTimer > 0) {
      this.calmTimer = Math.max(0, this.calmTimer - dt);
      // Wander off, unbothered.
      this.wander += (Math.random() - 0.5) * dt * 3;
      const away = Math.atan2(p.x - target.x, p.z - target.z);
      const dir = away * 0.4 + this.wander * 0.6;
      speed = this.def.speed * 0.45 * this.slow;
      this.move(Math.sin(dir), Math.cos(dir), speed, dt, others, obstacles, half);
    } else {
      speed = this.think(dt, target, others, obstacles, half);
    }

    pushOutOfCircles(p, this.radius, obstacles);
    clampToArena(p, half, this.radius);
    p.speed = speed;
    p.stun = this.stunTimer > 0 ? 1 : 0;
    p.calm = this.calmTimer > 0 ? 1 : 0;
    p.mode = this.mode === 'windup' ? 1 : this.mode === 'attack' ? 2 : this.mode === 'dazed' || this.mode === 'retreat' ? 3 : 0;
    this.visual.apply(p, dt, this.time);
    this.slow = 1;
    const spits = this.spits;
    this.spits = [];
    return spits;
  }

  private setMode(mode: Mode, time: number): void {
    this.mode = mode;
    this.timer = time;
  }

  /** The beast's brain: returns how fast it moved this step. */
  private think(dt: number, target: THREE.Vector3, others: readonly Enemy[], obstacles: readonly Circle[], half: number): number {
    const p = this.pose;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.timer -= dt;
    let tx = target.x - p.x;
    let tz = target.z - p.z;
    const dist = Math.hypot(tx, tz) || 1;
    tx /= dist;
    tz /= dist;
    const chase = this.def.speed * this.slow * (this.roared ? BEAR.enragedSpeed : 1);
    const face = (x: number, z: number) => (p.yaw = Math.atan2(x, z));
    // The bear's pound and charge come every few seconds whatever it's doing (at the next chance).
    if (this.kind === 'bear') {
      this.poundTimer -= dt;
      this.chargeTimer -= dt;
    }

    // Bear: the roar at half health summons beetles.
    if (this.roaring) {
      p.act = 1 - Math.max(0, this.timer) / BEAR.roar;
      if (this.timer <= 0) {
        this.roaring = false;
        this.summon = { kind: 'beetle', count: BEAR.roarBeetles };
        this.setMode('recover', 0.4);
      }
      return 0;
    }

    switch (this.mode) {
      case 'chase': {
        this.move(tx, tz, chase, dt, others, obstacles, half);
        face(tx, tz);
        p.act = 0;
        this.startSpecial(dist, tx, tz);
        return chase;
      }
      case 'windup': {
        p.act = 1 - Math.max(0, this.timer) / this.windupTime();
        if (this.kind === 'snake' || (this.kind === 'bear' && this.bearMove !== 'charge')) face(tx, tz);
        else face(this.lockDir.x, this.lockDir.z); // a charge keeps its aim
        if (this.telegraph) this.telegraph.p = p.act;
        if (this.timer <= 0) this.release(tx, tz);
        return 0;
      }
      case 'attack': {
        if (this.kind === 'snake') {
          this.move(this.lockDir.x, this.lockDir.z, SNAKE.lungeDistance / SNAKE.lungeTime, dt, others, [], half);
          if (this.timer <= 0) {
            // The fangs land just ahead of the head.
            this.strike = { x: p.x + this.lockDir.x * 0.9, z: p.z + this.lockDir.z * 0.9, r: 1.3, damage: SNAKE.damage, knock: 10 };
            this.cooldown = SNAKE.cooldown;
            this.setMode('recover', 0.5);
          }
          return SNAKE.lungeDistance / SNAKE.lungeTime;
        }
        if (this.charging) {
          // Boar or bear charge: a straight rush; dazed if it smacks into something.
          const bear = this.kind === 'bear';
          const speed = bear ? BEAR.chargeSpeed : BOAR.chargeSpeed;
          const before = { x: p.x, z: p.z };
          p.x += this.lockDir.x * speed * dt;
          p.z += this.lockDir.z * speed * dt;
          const hitWall = clampToArena(p, half, this.radius);
          const hitRock = pushOutOfCircles(p, this.radius, obstacles.filter((o) => !o.low));
          if (!bear) this.cooldown = BOAR.cooldown;
          if (hitWall || hitRock || Math.hypot(p.x - before.x, p.z - before.z) < 0.01) {
            this.setMode('dazed', bear ? BEAR.chargeDaze : BOAR.daze);
          } else if (this.timer <= 0) {
            this.setMode('recover', 0.5);
          }
          return speed;
        }
        this.setMode('recover', 0.4);
        return 0;
      }
      case 'recover':
      case 'dazed': {
        p.act = 0;
        if (this.timer <= 0) this.setMode('chase', 0);
        return 0;
      }
      case 'retreat': {
        // Back off away from the hero, then come again.
        const speed = DIREWOLF.retreatSpeed * this.slow;
        this.move(-tx + this.side * tz * 0.6, -tz - this.side * tx * 0.6, speed, dt, others, obstacles, half);
        face(-tx, -tz);
        if (this.timer <= 0) this.setMode('chase', 0);
        return speed;
      }
    }
  }

  private windupTime(): number {
    if (this.kind === 'snake') return SNAKE.coil;
    if (this.kind === 'boar') return BOAR.paw;
    return this.bearMove === 'pound' ? BEAR.poundWindup : this.bearMove === 'charge' ? BEAR.chargeWindup : BEAR.swipeWindup;
  }

  /** Decides whether to start this kind's special move. */
  private startSpecial(dist: number, tx: number, tz: number): void {
    if (this.kind === 'snake' && this.cooldown === 0 && dist < SNAKE.range) {
      this.lockDir = { x: tx, z: tz };
      this.setMode('windup', SNAKE.coil);
    } else if (this.kind === 'boar' && this.cooldown === 0 && dist > BOAR.minRange && dist < BOAR.maxRange) {
      this.lockDir = { x: tx, z: tz };
      this.setMode('windup', BOAR.paw);
      this.telegraph = { x: this.pose.x, z: this.pose.z, r: 1.6, p: 0 };
    } else if (this.kind === 'bear') {
      const faster = this.roared ? BEAR.enragedCooldown : 1;
      if (this.poundTimer <= 0) {
        this.poundTimer = BEAR.poundEvery * faster;
        this.bearMove = 'pound';
        this.telegraph = { x: this.pose.x, z: this.pose.z, r: BEAR.poundRadius, p: 0 };
        this.setMode('windup', BEAR.poundWindup);
      } else if (this.chargeTimer <= 0 && dist > BEAR.chargeMin && dist < BEAR.chargeMax) {
        this.chargeTimer = BEAR.chargeEvery * faster;
        this.bearMove = 'charge';
        this.lockDir = { x: tx, z: tz };
        this.telegraph = { x: this.pose.x, z: this.pose.z, r: 2.4, p: 0 };
        this.setMode('windup', BEAR.chargeWindup);
      } else if (this.cooldown === 0 && dist < BEAR.swipeRange) {
        this.bearMove = 'swipe';
        this.lockDir = { x: tx, z: tz };
        this.setMode('windup', BEAR.swipeWindup);
      }
    }
  }

  /** The wind-up is over: let the attack go. */
  private release(tx: number, tz: number): void {
    const p = this.pose;
    if (this.kind === 'snake') {
      this.setMode('attack', SNAKE.lungeTime);
    } else if (this.kind === 'boar') {
      this.telegraph = null;
      this.setMode('attack', BOAR.chargeTime);
    } else if (this.kind === 'bear') {
      if (this.bearMove === 'charge') {
        this.telegraph = null;
        this.setMode('attack', BEAR.chargeTime);
      } else if (this.bearMove === 'pound') {
        // Ground pound: everything around the bear, and crystal shards fly out in a ring.
        this.strike = { x: p.x, z: p.z, r: BEAR.poundRadius, damage: BEAR.poundDamage, knock: 18 };
        this.telegraph = null;
        const turn = Math.random() * Math.PI;
        for (let i = 0; i < BEAR.shards; i++) {
          const a = turn + (i / BEAR.shards) * Math.PI * 2;
          const dx = Math.sin(a);
          const dz = Math.cos(a);
          this.spits.push({ x: p.x + dx * (this.radius + 0.6), z: p.z + dz * (this.radius + 0.6), dirX: dx, dirZ: dz, kind: 'magic' });
        }
        this.setMode('recover', 0.6);
      } else {
        // Swipe: a big paw in front.
        this.strike = { x: p.x + tx * 1.6, z: p.z + tz * 1.6, r: BEAR.swipeRadius, damage: BEAR.swipeDamage, knock: 14 };
        this.cooldown = 1.2;
        this.setMode('recover', 0.4);
      }
      p.act = 1;
    }
  }

  /** Walks in direction (dx, dz), steering around obstacles and other enemies. */
  private move(dx: number, dz: number, speed: number, dt: number, others: readonly Enemy[], obstacles: readonly Circle[], half: number): void {
    steerMove(this.pose, dx, dz, speed, dt, this.radius, this, others, obstacles, half, this.side);
  }
}
