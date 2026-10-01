import * as THREE from 'three';
import { clampToArena, pushOutOfCircles, rangeIntent, waveSpec, type Circle, type WaveSpec } from './combat';
import { glowTexture } from '../util/glow';
import { SLIME_ATTACKS } from './balance';
import { q } from '../net/snapshot';
import { ENEMY_KIND_LIST } from './enemyKinds';
import { Beast } from './beasts';
import { Elemental } from './elementals';
import type { ProjectileKind } from './globs';

export type SlimeKind = 'small' | 'big' | 'spitter' | 'boss';
export type BeastKind = 'beetle' | 'snake' | 'direwolf' | 'boar' | 'bear';
export type ElementalKind = 'vine' | 'wind' | 'water' | 'fire' | 'treant' | 'golem';
export type EnemyKind = SlimeKind | BeastKind | ElementalKind;
export const SLIME_KIND_LIST: SlimeKind[] = ['small', 'big', 'spitter', 'boss'];
export const ELEMENTAL_KIND_LIST: ElementalKind[] = ['vine', 'wind', 'water', 'fire', 'treant', 'golem'];

/** `touch`: damage to the hero (of 100 HP) on contact. */
export const SLIME_KINDS: Record<SlimeKind, { radius: number; speed: number; color: number; score: number; hopRate: number; push: number; touch: number }> = {
  small: { radius: 0.7, speed: 3.6, color: 0x62d46a, score: 10, hopRate: 1.8, push: 9, touch: 20 },
  big: { radius: 1.25, speed: 2.6, color: 0xa35ee0, score: 40, hopRate: 1.3, push: 5, touch: 35 },
  spitter: { radius: 0.85, speed: 3.2, color: 0x4fb3ff, score: 25, hopRate: 1.6, push: 7, touch: 15 },
  boss: { radius: 2.8, speed: 2.2, color: 0xc0303a, score: 500, hopRate: 0.9, push: 0.6, touch: 30 },
};

// King Slime (boss) tuning.
export const BOSS_HP = 900;
const BOSS_FIRST_ACTION = 3;
const BOSS_ACTION_GAP = 3.2; // seconds of chasing between attacks
const SLAM_WINDUP = 0.9;
const SLAM_LEAP = 0.7;
const SLAM_RECOVER = 0.6;
export const SLAM_RADIUS = 4.5;
const VOLLEY_WINDUP = 0.6;
const VOLLEY_SPITS = 5;
const VOLLEY_SPREAD = 0.22; // radians between globs
/** Health fractions where the King Slime splits off small slimes. */
const SPLIT_AT = [2 / 3, 1 / 3];
export const SPLIT_COUNT = 4;

// Spitter tuning.
const SPIT_RANGE_MIN = 9;
const SPIT_RANGE_MAX = 14;
const SPIT_INTERVAL = 3.0;
const SPIT_WINDUP = 0.7;

const bodyGeo = new THREE.SphereGeometry(1, 12, 8).translate(0, 1, 0);
const eyeGeo = new THREE.SphereGeometry(0.2, 8, 6);
const pupilGeo = new THREE.SphereGeometry(0.11, 8, 6);
const mouthGeo = new THREE.TorusGeometry(0.16, 0.05, 6, 10);
const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
const pupilMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.2 });
const STUN_TINT = new THREE.Color(0xd8ecff);
const CALM_TINT = new THREE.Color(0xf3c6ff); // soft lavender-pink: sleepy, not angry

/**
 * Everything needed to draw a slime at one moment. The simulation produces it every step; the
 * familiar's tablet receives it over the network and draws the same thing.
 */
export interface SlimePose {
  x: number;
  z: number;
  yaw: number;
  /** Body lift while hopping. */
  y: number;
  sx: number;
  sy: number;
  sz: number;
  /** Hit flash 0..1. */
  flash: number;
  /** 1 while stunned. */
  stun: number;
  /** Death shrink 0 (alive) → 1 (gone). */
  death: number;
  /** 1 while calmed (wandering off, harmless). */
  calm: number;
}

/** A slime's meshes, driven entirely by a SlimePose. Shared by the game and the familiar view. */
export class SlimeVisual {
  readonly group = new THREE.Group();
  private readonly body: THREE.Mesh;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly baseColor: THREE.Color;
  private readonly stars: THREE.Group;
  private readonly radius: number;

  constructor(kind: SlimeKind) {
    const k = SLIME_KINDS[kind];
    this.radius = k.radius;
    this.baseColor = new THREE.Color(k.color);
    this.material = new THREE.MeshStandardMaterial({ color: k.color, roughness: 0.35, flatShading: true, emissive: 0xff2020, emissiveIntensity: 0 });
    this.body = new THREE.Mesh(bodyGeo, this.material);
    this.body.castShadow = true;
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(side * 0.35, 1.25, 0.82);
      const pupil = new THREE.Mesh(pupilGeo, pupilMat);
      pupil.position.set(side * 0.35, 1.25, 0.98);
      this.body.add(eye, pupil);
    }
    if (kind === 'boss') {
      // A golden crown, and a grumpy brow.
      const gold = new THREE.MeshStandardMaterial({ color: 0xe8b84a, metalness: 0.7, roughness: 0.3, flatShading: true });
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.18, 10, 1, true), gold);
      band.material.side = THREE.DoubleSide;
      band.position.y = 1.95;
      this.body.add(band);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.32, 4), gold);
        spike.position.set(Math.cos(a) * 0.42, 2.18, Math.sin(a) * 0.42);
        this.body.add(spike);
      }
      for (const side of [-1, 1]) {
        const brow = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.07, 0.06), pupilMat);
        brow.position.set(side * 0.35, 1.5, 0.92);
        brow.rotation.z = side * 0.35;
        this.body.add(brow);
      }
    }
    if (kind === 'spitter') {
      // A little round "o" mouth, for spitting.
      const mouth = new THREE.Mesh(mouthGeo, pupilMat);
      mouth.position.set(0, 0.85, 0.97);
      this.body.add(mouth);
    }
    // Dizzy stars circling the head while stunned.
    this.stars = new THREE.Group();
    const starMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xfff27a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Sprite(starMat);
      s.scale.setScalar(0.45);
      const a = (i / 3) * Math.PI * 2;
      s.position.set(Math.cos(a) * 0.75, 0, Math.sin(a) * 0.75);
      this.stars.add(s);
    }
    this.stars.position.y = 2.3;
    this.stars.visible = false;
    this.group.add(this.body, this.stars);
    this.group.scale.setScalar(this.radius);
  }

  apply(p: SlimePose, time: number): void {
    this.group.position.set(p.x, 0, p.z);
    this.group.rotation.y = p.yaw;
    this.body.position.y = p.y;
    this.body.scale.set(p.sx, p.sy, p.sz);
    const s = 1 - p.death;
    this.group.scale.set(this.radius * (1 + p.death * 0.6), this.radius * s, this.radius * (1 + p.death * 0.6));
    this.material.emissiveIntensity = p.flash * 1.5;
    const stunned = p.stun > 0.5 && p.death === 0;
    this.material.color.copy(this.baseColor);
    const calm = !stunned && p.calm > 0.5 && p.death === 0;
    if (stunned) this.material.color.lerp(STUN_TINT, 0.55);
    else if (calm) this.material.color.lerp(CALM_TINT, 0.65);
    this.stars.visible = stunned;
    this.body.rotation.z = stunned ? Math.sin(time * 11) * 0.18 : calm ? Math.sin(time * 2.5) * 0.08 : 0;
    if (stunned) this.stars.rotation.y = time * 4;
  }
}

export interface Spit {
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  /** What's being thrown (default: a slime glob). */
  kind?: ProjectileKind;
}

/** An area attack landing this step (a slam, a pounce, a swipe): the hero is hit if within `r` of (x, z). */
export interface Strike {
  x: number;
  z: number;
  r: number;
  damage: number;
  knock: number;
  /** Also slows the hero (the treant's roots). */
  slow?: { seconds: number; factor: number };
}

/** An enemy calling in reinforcements (the King splitting, the bear roaring). */
export interface Summon {
  kind: EnemyKind;
  count: number;
}

/**
 * Network form of any enemy: [id, kind, x, z, yaw, y, a, b, c, flash, stun, death, calm].
 * Slimes put their squash (sx, sy, sz) in a/b/c; beasts put speed, attack progress and mode.
 */
export type EnemyTuple = [number, number, number, number, number, number, number, number, number, number, number, number, number];

/** What the game needs from any enemy, slime or beast. */
export interface Enemy {
  readonly id: number;
  readonly kind: EnemyKind;
  readonly radius: number;
  readonly score: number;
  readonly color: THREE.Color;
  readonly maxHp: number;
  hp: number;
  readonly group: THREE.Group;
  readonly x: number;
  readonly z: number;
  readonly alive: boolean;
  dying: boolean;
  removed: boolean;
  readonly stunned: boolean;
  readonly calmed: boolean;
  /** No contact damage right now (stunned, calmed…). */
  readonly harmless: boolean;
  /** Damage to the hero on contact right now (a charging boar hits harder). */
  readonly touchDamage: number;
  /** Knockback strength when it hits the hero by contact. */
  readonly touchKnock: number;
  /** Speed multiplier for this step, set by area effects (resets after each update). */
  slow: number;
  /** Mini-bosses and bosses get a health bar. */
  readonly bossName: string | null;
  /** Where an attack is about to land (warning ring), if any. */
  readonly telegraph: Telegraph | null;
  /** Set during update(): an area attack that landed this step. */
  strike: Strike | null;
  /** Set during update(): reinforcements to spawn. */
  summon: Summon | null;
  hurt(amount: number, dirX: number, dirZ: number): boolean;
  stun(seconds: number): void;
  calm(seconds: number): void;
  setPosition(x: number, z: number): void;
  /** Called when its contact hit the hero (e.g. the wolf backs off). */
  onHitTarget(): void;
  /** Moves / attacks; returns any globs it spits this step. */
  update(dt: number, target: THREE.Vector3, others: readonly Enemy[], obstacles: readonly Circle[], half: number): Spit[];
  tuple(): EnemyTuple;
}

/** Where a boss attack will land, for the warning ring: progress 0 → 1 until impact. */
export interface Telegraph {
  x: number;
  z: number;
  r: number;
  p: number;
}

type BossPhase = 'chase' | 'slam-windup' | 'slam-leap' | 'slam-recover' | 'volley-windup';

let nextSlimeId = 1;

export class Slime implements Enemy {
  readonly id = nextSlimeId++;
  readonly visual: SlimeVisual;
  readonly kind: SlimeKind;
  readonly radius: number;
  readonly score: number;
  /** Damage to the hero on contact. */
  readonly touchDamage: number;
  readonly color: THREE.Color;
  readonly pose: SlimePose;
  readonly maxHp: number;
  hp: number;
  /** Boss only: where its current attack will land (for the warning ring). */
  telegraph: Telegraph | null = null;
  strike: Strike | null = null;
  summon: Summon | null = null;
  readonly touchKnock = 16;
  /** Set once hp hits 0; the slime shrinks away, then `removed` is set. */
  dying = false;
  removed = false;
  private readonly speed: number;
  private readonly hopRate: number;
  private readonly push: number;
  private readonly knock = new THREE.Vector2();
  private hopPhase = Math.random();
  private flash = 0;
  private deathTimer = 0;
  private stunTimer = 0;
  private calmTimer = 0;
  private wanderAngle = Math.random() * Math.PI * 2;
  private time = 0;
  /** Speed multiplier for this step (set by area effects like the Soothing Spring; resets after each update). */
  slow = 1;
  private spitTimer = SPIT_INTERVAL * (0.5 + Math.random() * 0.5);
  private windup = 0; // > 0 while swelling up to spit
  private strafeSign = Math.random() < 0.5 ? -1 : 1;
  private bossPhase: BossPhase = 'chase';
  private bossTimer = BOSS_FIRST_ACTION;
  private nextAttack: 'slam' | 'volley' = 'slam';
  private leapFrom = { x: 0, z: 0 };
  private splitsDone = 0;

  constructor(kind: SlimeKind, x: number, z: number, speedBonus: number, hp: number) {
    const k = SLIME_KINDS[kind];
    this.kind = kind;
    this.radius = k.radius;
    this.hp = hp;
    this.maxHp = hp;
    this.score = k.score;
    this.touchDamage = k.touch;
    this.speed = k.speed + speedBonus;
    this.hopRate = k.hopRate;
    this.push = k.push;
    this.color = new THREE.Color(k.color);
    this.visual = new SlimeVisual(kind);
    this.pose = { x, z, yaw: 0, y: 0, sx: 1, sy: 1, sz: 1, flash: 0, stun: 0, death: 0, calm: 0 };
    this.visual.apply(this.pose, 0);
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

  /** Harmless right now (stunned or calmed): no contact damage. */
  get harmless(): boolean {
    return this.stunned || this.calmed;
  }

  /** Teleport (used by tests and spawning). */
  setPosition(x: number, z: number): void {
    this.pose.x = x;
    this.pose.z = z;
    this.visual.apply(this.pose, this.time);
  }

  /** Returns true if this hit killed it. */
  hurt(amount: number, dirX: number, dirZ: number): boolean {
    if (this.dying) return false;
    this.hp -= amount;
    this.flash = 1;
    this.knock.set(dirX * this.push, dirZ * this.push);
    if (this.hp <= 0) {
      this.dying = true;
      this.telegraph = null;
    } else if (this.kind === 'boss') {
      // Split off small slimes as health drops past each threshold.
      while (this.splitsDone < SPLIT_AT.length && this.hp <= this.maxHp * SPLIT_AT[this.splitsDone]) {
        this.splitsDone++;
        this.summon = { kind: 'small', count: (this.summon?.count ?? 0) + SPLIT_COUNT };
      }
    }
    return this.dying;
  }

  /** Freezes the slime in place (no moving, spitting or contact damage) for `seconds`. */
  stun(seconds: number): void {
    if (this.dying) return;
    // The King shrugs most of it off, and can't be stunned out of a leap.
    if (this.kind === 'boss') {
      if (this.bossPhase === 'slam-leap') return;
      seconds *= 0.35;
    }
    this.stunTimer = Math.max(this.stunTimer, seconds);
    this.windup = 0; // an interrupted spit is lost
    if (this.kind === 'boss') this.resetBossAttack();
  }

  /** Makes the slime lose interest for `seconds`: it wanders away, won't spit or hurt anyone. */
  calm(seconds: number): void {
    if (this.dying || this.kind === 'boss') return; // the King cannot be calmed
    this.calmTimer = Math.max(this.calmTimer, seconds);
    this.windup = 0;
    this.wanderAngle = Math.random() * Math.PI * 2;
  }

  /** Moves the slime; returns any globs it spits this step. */
  get bossName(): string | null {
    return this.kind === 'boss' ? 'The King Slime' : null;
  }

  onHitTarget(): void {}

  tuple(): EnemyTuple {
    const o = this.pose;
    return [this.id, ENEMY_KIND_LIST.indexOf(this.kind), q(o.x), q(o.z), q(o.yaw), q(o.y), q(o.sx), q(o.sy), q(o.sz), q(o.flash), o.stun, q(o.death), o.calm];
  }

  update(dt: number, target: THREE.Vector3, others: readonly Enemy[], obstacles: readonly Circle[], half: number): Spit[] {
    this.time += dt;
    const spit = this.kind === 'boss' && !this.dying && this.stunTimer <= 0 ? this.bossStep(dt, target, others, obstacles, half) : this.step(dt, target, others, obstacles, half);
    this.pose.flash = this.flash;
    this.pose.stun = this.stunTimer > 0 ? 1 : 0;
    this.pose.calm = this.calmTimer > 0 ? 1 : 0;
    this.visual.apply(this.pose, this.time);
    this.slow = 1;
    return spit === null ? [] : Array.isArray(spit) ? spit : [spit];
  }

  private resetBossAttack(): void {
    this.bossPhase = 'chase';
    this.bossTimer = BOSS_ACTION_GAP;
    this.telegraph = null;
  }

  /** The King Slime: lumbers after the elf, then alternates a leaping slam and a spit volley. */
  private bossStep(dt: number, target: THREE.Vector3, others: readonly Enemy[], obstacles: readonly Circle[], half: number): Spit[] | null {
    if (this.bossPhase !== 'chase') this.flash = Math.max(0, this.flash - dt * 5); // step() fades it while chasing
    const p = this.pose;
    this.bossTimer -= dt;
    const tx = target.x - p.x;
    const tz = target.z - p.z;
    const dist = Math.hypot(tx, tz) || 1;

    switch (this.bossPhase) {
      case 'chase': {
        this.step(dt, target, others, obstacles, half);
        if (this.bossTimer <= 0) {
          if (this.nextAttack === 'slam') {
            this.bossPhase = 'slam-windup';
            this.bossTimer = SLAM_WINDUP;
            // Aim at where the elf is now (they have the windup + leap to get out).
            const land = { x: target.x, z: target.z };
            clampToArena(land, half, this.radius);
            this.telegraph = { x: land.x, z: land.z, r: SLAM_RADIUS, p: 0 };
          } else {
            this.bossPhase = 'volley-windup';
            this.bossTimer = VOLLEY_WINDUP;
          }
        }
        return null;
      }
      case 'slam-windup': {
        const k = 1 - this.bossTimer / SLAM_WINDUP;
        p.y = 0;
        p.sx = p.sz = 1 + k * 0.25;
        p.sy = 1 - k * 0.3;
        p.yaw = Math.atan2(this.telegraph!.x - p.x, this.telegraph!.z - p.z);
        this.telegraph!.p = k * 0.55;
        if (this.bossTimer <= 0) {
          this.bossPhase = 'slam-leap';
          this.bossTimer = SLAM_LEAP;
          this.leapFrom = { x: p.x, z: p.z };
        }
        return null;
      }
      case 'slam-leap': {
        const t = this.telegraph!;
        const k = 1 - this.bossTimer / SLAM_LEAP;
        p.x = this.leapFrom.x + (t.x - this.leapFrom.x) * k;
        p.z = this.leapFrom.z + (t.z - this.leapFrom.z) * k;
        p.y = Math.sin(k * Math.PI) * 4;
        p.sx = p.sz = 0.92;
        p.sy = 1.12;
        t.p = 0.55 + k * 0.45;
        if (this.bossTimer <= 0) {
          p.x = t.x;
          p.z = t.z;
          p.y = 0;
          pushOutOfCircles(p, this.radius, obstacles);
          this.strike = { x: p.x, z: p.z, r: SLAM_RADIUS, damage: SLIME_ATTACKS.kingSlam, knock: 16 };
          this.telegraph = null;
          this.bossPhase = 'slam-recover';
          this.bossTimer = SLAM_RECOVER;
          this.nextAttack = 'volley';
        }
        return null;
      }
      case 'slam-recover': {
        const k = this.bossTimer / SLAM_RECOVER;
        p.sx = p.sz = 1 + k * 0.35;
        p.sy = 1 - k * 0.35;
        if (this.bossTimer <= 0) this.resetBossAttack();
        return null;
      }
      case 'volley-windup': {
        const k = 1 - this.bossTimer / VOLLEY_WINDUP;
        p.y = 0;
        p.sx = p.sz = 1 + k * 0.15;
        p.sy = 1 + k * 0.3;
        p.yaw = Math.atan2(tx, tz);
        if (this.bossTimer > 0) return null;
        this.nextAttack = 'slam';
        this.resetBossAttack();
        const base = Math.atan2(tx / dist, tz / dist);
        return Array.from({ length: VOLLEY_SPITS }, (_, i) => {
          const a = base + (i - (VOLLEY_SPITS - 1) / 2) * VOLLEY_SPREAD;
          const dx = Math.sin(a);
          const dz = Math.cos(a);
          return { x: p.x + dx * this.radius, z: p.z + dz * this.radius, dirX: dx, dirZ: dz };
        });
      }
    }
  }

  private step(dt: number, target: THREE.Vector3, others: readonly Enemy[], obstacles: readonly Circle[], half: number): Spit | null {
    this.flash = Math.max(0, this.flash - dt * 5);
    const p = this.pose;

    if (this.dying) {
      this.deathTimer += dt;
      p.death = Math.min(1, this.deathTimer / 0.18);
      if (p.death === 1) this.removed = true;
      return null;
    }

    if (this.stunTimer > 0) {
      // Stunned: only knockback still slides it a little; squash settles to rest.
      this.stunTimer = Math.max(0, this.stunTimer - dt);
      p.x += this.knock.x * dt;
      p.z += this.knock.y * dt;
      this.knock.multiplyScalar(Math.exp(-8 * dt));
      pushOutOfCircles(p, this.radius, obstacles);
      clampToArena(p, half, this.radius);
      p.y = 0;
      p.sx = p.sz = 1.08;
      p.sy = 0.88;
      return null;
    }

    let tx = target.x - p.x;
    let tz = target.z - p.z;
    const dist = Math.hypot(tx, tz) || 1;
    tx /= dist;
    tz /= dist;
    const calm = this.calmTimer > 0;
    if (calm) this.calmTimer = Math.max(0, this.calmTimer - dt);

    // Spitters freeze and swell up, then spit at where the target is now.
    if (this.kind === 'spitter' && !calm) {
      if (this.windup > 0) {
        this.windup -= dt;
        const swell = 1 - this.windup / SPIT_WINDUP;
        p.y = 0;
        p.sx = p.sz = 1 + swell * 0.25;
        p.sy = 1 + swell * 0.35;
        p.yaw = Math.atan2(tx, tz);
        if (this.windup <= 0) {
          this.spitTimer = SPIT_INTERVAL * (0.8 + Math.random() * 0.4);
          return { x: p.x + tx * this.radius, z: p.z + tz * this.radius, dirX: tx, dirZ: tz };
        }
        return null;
      }
      this.spitTimer -= dt;
      if (this.spitTimer <= 0 && dist < SPIT_RANGE_MAX + 4) {
        this.windup = SPIT_WINDUP;
        return null;
      }
    }

    // Hop: fast while airborne, slow while squashed on the ground.
    this.hopPhase = (this.hopPhase + dt * this.hopRate) % 1;
    const t = this.hopPhase;
    const airborne = t < 0.6;
    const air = airborne ? Math.sin((t / 0.6) * Math.PI) : 0;
    const squash = airborne ? 0 : Math.sin(((t - 0.6) / 0.4) * Math.PI);

    // Melee slimes chase; spitters hold a distance band and circle inside it; calm ones meander off.
    let dx = tx;
    let dz = tz;
    if (calm) {
      this.wanderAngle += (Math.random() - 0.5) * dt * 3;
      dx = -tx * 0.6 + Math.sin(this.wanderAngle) * 0.8;
      dz = -tz * 0.6 + Math.cos(this.wanderAngle) * 0.8;
    } else if (this.kind === 'spitter') {
      const intent = rangeIntent(dist, SPIT_RANGE_MIN, SPIT_RANGE_MAX);
      if (intent === 0) {
        dx = -tz * this.strafeSign;
        dz = tx * this.strafeSign;
        if (Math.random() < dt * 0.3) this.strafeSign *= -1;
      } else {
        dx = tx * intent;
        dz = tz * intent;
      }
    }
    // Steer around pillars (and the brazier, lava…) that stand between the slime and its goal,
    // instead of pushing straight into them forever.
    for (const ob of obstacles) {
      const ox = ob.x - p.x;
      const oz = ob.z - p.z;
      const d = Math.hypot(ox, oz);
      const reach = ob.radius + this.radius + 2;
      if (d === 0 || d > reach) continue;
      const len0 = Math.hypot(dx, dz) || 1;
      const ahead = (ox * dx + oz * dz) / (d * len0);
      if (ahead < 0.35) continue;
      // Turn toward whichever side the goal already leans to (or this slime's habit if dead ahead).
      const cross = dx * oz - dz * ox;
      const side = Math.abs(cross) < 1e-3 ? this.strafeSign : Math.sign(cross);
      const strength = (ahead * (reach - d)) / reach * 2.2;
      dx += (oz / d) * side * strength;
      dz += (-ox / d) * side * strength;
    }
    // Keep slimes from stacking up on each other.
    for (const o of others) {
      if (o === this || o.dying) continue;
      const ox = p.x - o.x;
      const oz = p.z - o.z;
      const d = Math.hypot(ox, oz);
      const min = this.radius + o.radius + 0.2;
      if (d > 0 && d < min) {
        dx += (ox / d) * (min - d) * 1.5;
        dz += (oz / d) * (min - d) * 1.5;
      }
    }
    const len = Math.hypot(dx, dz) || 1;
    const speed = this.speed * (airborne ? 1.25 : 0.25) * this.slow * (calm ? 0.45 : 1);
    p.x += ((dx / len) * speed + this.knock.x) * dt;
    p.z += ((dz / len) * speed + this.knock.y) * dt;
    this.knock.multiplyScalar(Math.exp(-8 * dt));
    pushOutOfCircles(p, this.radius, obstacles);
    clampToArena(p, half, this.radius);

    p.yaw = calm ? Math.atan2(dx, dz) : Math.atan2(target.x - p.x, target.z - p.z);
    p.y = air * 0.7;
    p.sx = p.sz = 1 + squash * 0.25 - air * 0.08;
    p.sy = 1 - squash * 0.3 + air * 0.12;
    return null;
  }
}

/** A beast wave in the forest: which beasts, and (wave 3) the mini-boss. */
export interface BeastWave {
  beetle: number;
  snake: number;
  direwolf: number;
  boar: number;
  /** Spawns the Crystal Bear at the north end, with the rest as escorts. */
  bear: boolean;
}

/** The Woodland's three waves: beetles and snakes, then wolves and a boar, then the Crystal Bear. */
export const WOODLAND_WAVES: BeastWave[] = [
  { beetle: 8, snake: 2, direwolf: 0, boar: 0, bear: false },
  { beetle: 8, snake: 4, direwolf: 2, boar: 1, bear: false },
  { beetle: 6, snake: 0, direwolf: 2, boar: 0, bear: true },
];

/** Spawns enemies wave by wave through the gates (slimes in the dungeon, beasts in the forest) and updates them. */
export class Enemies {
  readonly group = new THREE.Group();
  /** Every enemy currently in the room. */
  readonly all: Enemy[] = [];
  private queue: EnemyKind[] = [];
  private spawnTimer = 0;
  private spec: WaveSpec = waveSpec(1);
  private packSize = 1;
  private spawnInterval = 1.5;
  private gates: THREE.Vector3[];

  constructor(gates: THREE.Vector3[]) {
    this.gates = gates;
  }

  /** New room, new gates. */
  setGates(gates: THREE.Vector3[]): void {
    this.gates = gates;
  }

  /** Enemies still to beat this wave (alive + not yet spawned). */
  get remaining(): number {
    return this.queue.length + this.all.filter((s) => s.alive).length;
  }

  /** The current boss or mini-boss, while it's alive. */
  get boss(): Enemy | null {
    return this.all.find((s) => s.bossName !== null && s.alive) ?? null;
  }

  /** Warning rings for every attack about to land. */
  get telegraphs(): Telegraph[] {
    return this.all.filter((s) => s.alive && s.telegraph).map((s) => s.telegraph!);
  }

  /** A slime wave at difficulty level `wave`, plus any elementals mixed in. */
  startWave(wave: number, elementals: readonly ElementalKind[] = []): void {
    this.spec = waveSpec(wave);
    const { small, big, spitters } = this.spec;
    this.queue = shuffle([...Array<EnemyKind>(small).fill('small'), ...Array<EnemyKind>(big).fill('big'), ...Array<EnemyKind>(spitters).fill('spitter'), ...elementals]);
    this.packSize = this.spec.packSize;
    this.spawnInterval = this.spec.spawnInterval;
    this.spawnTimer = 0.3;
  }

  /** A forest wave; with `bear`, the Crystal Bear appears at (bossX, bossZ). */
  startBeastWave(w: BeastWave, bossX: number, bossZ: number): void {
    this.queue = shuffle([
      ...Array<EnemyKind>(w.beetle).fill('beetle'),
      ...Array<EnemyKind>(w.snake).fill('snake'),
      ...Array<EnemyKind>(w.direwolf).fill('direwolf'),
      ...Array<EnemyKind>(w.boar).fill('boar'),
    ]);
    this.packSize = 2;
    this.spawnInterval = w.bear ? 3 : 1.4;
    this.spawnTimer = w.bear ? 4 : 0.3;
    if (w.bear) this.add(new Beast('bear', bossX, bossZ));
  }

  /** The King Slime at (x, z), with a few small slimes trickling in as escorts. */
  startBossWave(wave: number, x: number, z: number): Enemy {
    this.spec = waveSpec(wave);
    this.queue = Array<EnemyKind>(6).fill('small');
    this.packSize = this.spec.packSize;
    this.spawnInterval = this.spec.spawnInterval;
    this.spawnTimer = 4;
    return this.add(new Slime('boss', x, z, 0, BOSS_HP));
  }

  clear(): void {
    for (const s of this.all) this.group.remove(s.group);
    this.all.length = 0;
    this.queue = [];
  }

  /** Stuns every living enemy within `radius` of (x, z); returns those hit. */
  stunAround(x: number, z: number, radius: number, seconds: number): Enemy[] {
    const hit = this.all.filter((s) => s.alive && Math.hypot(s.x - x, s.z - z) <= radius + s.radius);
    for (const s of hit) s.stun(seconds);
    return hit;
  }

  /** Calms every living enemy within `radius` of (x, z); returns those affected. */
  calmAround(x: number, z: number, radius: number, seconds: number): Enemy[] {
    const hit = this.all.filter((s) => s.alive && Math.hypot(s.x - x, s.z - z) <= radius + s.radius);
    for (const s of hit) s.calm(seconds);
    return hit;
  }

  private add<T extends Enemy>(e: T): T {
    this.all.push(e);
    this.group.add(e.group);
    return e;
  }

  private create(kind: EnemyKind, x: number, z: number): Enemy {
    if ((SLIME_KIND_LIST as EnemyKind[]).includes(kind)) {
      const sk = kind as SlimeKind;
      const hp = sk === 'big' ? this.spec.bigHp : sk === 'spitter' ? this.spec.spitterHp : this.spec.smallHp;
      return new Slime(sk, x, z, this.spec.speedBonus, hp);
    }
    if ((ELEMENTAL_KIND_LIST as EnemyKind[]).includes(kind)) return new Elemental(kind as ElementalKind, x, z);
    return new Beast(kind as BeastKind, x, z);
  }

  /** Spawns reinforcements in a ring around (x, z) (the King splitting, the bear roaring). */
  private summon(kind: EnemyKind, x: number, z: number, count: number, obstacles: readonly Circle[], half: number): void {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random();
      const e = this.create(kind, x + Math.cos(a) * 3.5, z + Math.sin(a) * 3.5);
      const pos = { x: e.x, z: e.z };
      pushOutOfCircles(pos, e.radius, obstacles);
      clampToArena(pos, half, e.radius);
      e.setPosition(pos.x, pos.z);
      this.add(e);
    }
  }

  /** Updates every enemy; returns globs spat and area attacks landed this step. */
  update(dt: number, target: THREE.Vector3, obstacles: readonly Circle[], half: number): { spits: Spit[]; strikes: Strike[] } {
    this.spawnTimer -= dt;
    if (this.queue.length && this.spawnTimer <= 0 && this.gates.length) {
      // A pack pours out of one gate at a time.
      this.spawnTimer = this.spawnInterval;
      const gate = this.gates[Math.floor(Math.random() * this.gates.length)];
      const alongX = Math.abs(gate.z) > Math.abs(gate.x);
      for (let n = 0; n < this.packSize && this.queue.length; n++) {
        const jitter = (Math.random() - 0.5) * 3.5;
        const inward = n * 0.8; // stagger the pack so it doesn't spawn overlapping
        const x = gate.x + (alongX ? jitter : -Math.sign(gate.x) * inward);
        const z = gate.z + (alongX ? -Math.sign(gate.z) * inward : jitter);
        this.add(this.create(this.queue.pop()!, x, z));
      }
    }
    const spits: Spit[] = [];
    const strikes: Strike[] = [];
    for (const s of [...this.all]) {
      spits.push(...s.update(dt, target, this.all, obstacles, half));
      if (s.strike) strikes.push(s.strike);
      if (s.summon) {
        this.summon(s.summon.kind, s.x, s.z, s.summon.count, obstacles, half);
        s.summon = null;
      }
    }
    for (let i = this.all.length - 1; i >= 0; i--) {
      if (!this.all[i].removed) continue;
      this.group.remove(this.all[i].group);
      this.all.splice(i, 1);
    }
    return { spits, strikes };
  }
}

function shuffle<T>(list: T[]): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}
