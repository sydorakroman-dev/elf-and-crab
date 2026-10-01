import * as THREE from 'three';
import { clampToArena, pushOutOfCircles, rangeIntent, type Circle } from './combat';
import { steerMove } from './steer';
import type { BeastPose } from './beastVisual';
import { MonsterVisual } from './monsterVisual';
import { ElementalVisual } from './elementalVisual';
import type { Enemy, EnemyKind, EnemyTuple, MonsterKind, Spit, Strike, Summon, Telegraph } from './enemies';
import type { ProjectileKind } from './globs';
import { ENEMY_KIND_LIST } from './enemyKinds';
import { q } from '../net/snapshot';

/**
 * The dungeon's monsters (goblins, undead, orcs, underworld dwellers) and the final boss, as data:
 * stats plus a list of attacks built from a few shared moves. HP and damage are on the hero's
 * 100 HP scale; each room's group is tougher than the last.
 */
export type Attack =
  /** A swing / punch / slam just in front, after a wind-up. */
  | { type: 'melee'; range: number; windup: number; reach: number; radius: number; damage: number; knock: number; cooldown: number }
  /** Bolts (several in a fan with `count`). Damage per projectile kind is in balance.ts. */
  | { type: 'shoot'; range: number; windup: number; cooldown: number; shot: ProjectileKind; count?: number; spread?: number }
  /** An area attack with a warning ring: around itself, or where the hero stands (bombs, roots…). */
  | {
      type: 'area';
      at: 'self' | 'target';
      range: number;
      minRange?: number;
      windup: number;
      radius: number;
      damage: number;
      knock: number;
      cooldown: number;
      slow?: { seconds: number; factor: number };
      /** Leaves burning / poisonous ground where it lands. */
      zone?: 'fire' | 'poison';
    }
  /** A dash in a straight line (leap, dive, charge); hurts on contact while dashing. */
  | { type: 'lunge'; range: number; minRange?: number; windup: number; speed: number; time: number; damage: number; knock: number; cooldown: number }
  /** Sinks into the ground (can't be hit), then bursts up under the hero after a warning ring. */
  | { type: 'burrow'; range: number; cooldown: number; windup: number; radius: number; damage: number; knock: number };

export interface MonsterDef {
  name: string;
  tier: 'weak' | 'normal' | 'tough' | 'elite' | 'mini-boss' | 'boss';
  style: 'melee' | 'ranged';
  hp: number;
  speed: number;
  radius: number;
  touch: number;
  /** How far hits push it back (lower = heavier). */
  push: number;
  score: number;
  drop: number;
  attacks: Attack[];
  /** Ranged: the distance it keeps from the hero. */
  keepAway?: [number, number];
  /** Backs off for this long after a contact hit. */
  hitAndRun?: number;
  /** Heals nearby allies every `every` seconds. */
  heal?: { every: number; amount: number; radius: number };
  /** Regrows HP once it hasn't been hit for `delay` seconds. */
  regen?: { delay: number; rate: number };
  /** Damage multiplier for arrows hitting its front (a shield). */
  guard?: number;
  /** Drifts through pillars and walls of crystal. */
  phasing?: boolean;
  /** Calls in help as its health drops past these fractions. */
  summonAt?: { at: number[]; kind: EnemyKind; count: number };
  /** Calls in help every few seconds (up to `max` of them alive). */
  summonEvery?: { every: number; kind: EnemyKind; count: number; max: number };
  bossName?: string;
}

const LONG = 99;
export const MONSTERS: Record<MonsterKind, MonsterDef> = {
  // ── Underworld dwellers (Crystal Cave): critters of the deep, poison and acid ──
  spider: {
    name: 'Cave Spider', tier: 'normal', style: 'melee', hp: 22, speed: 6, radius: 0.9, touch: 9, push: 7, score: 15, drop: 0.05,
    attacks: [{ type: 'lunge', range: 5, minRange: 1.5, windup: 0.45, speed: 17, time: 0.25, damage: 12, knock: 10, cooldown: 2.2 }],
  },
  ooze: {
    name: 'Cave Slime', tier: 'normal', style: 'ranged', hp: 28, speed: 3.1, radius: 0.8, touch: 8, push: 7, score: 15, drop: 0.06, keepAway: [9, 16.5],
    attacks: [{ type: 'shoot', range: 19.5, windup: 0.6, cooldown: 3, shot: 'acid' }],
  },
  sporecrawler: {
    name: 'Spore Crawler', tier: 'normal', style: 'ranged', hp: 25, speed: 4, radius: 0.8, touch: 8, push: 7, score: 18, drop: 0.07, keepAway: [12, 19.5],
    attacks: [{ type: 'area', at: 'target', range: 22.5, windup: 1.1, radius: 2.0, damage: 8, knock: 4, cooldown: 4.5, zone: 'poison' }],
  },
  mushroom: {
    name: 'Mushroom Monster', tier: 'tough', style: 'melee', hp: 55, speed: 2.9, radius: 1.0, touch: 10, push: 4, score: 30, drop: 0.15,
    attacks: [{ type: 'area', at: 'self', range: 3, windup: 0.85, radius: 3, damage: 14, knock: 12, cooldown: 3.8, zone: 'poison' }],
  },
  mold: {
    name: 'Living Mold', tier: 'elite', style: 'melee', hp: 80, speed: 2.4, radius: 1.0, touch: 12, push: 3, score: 45, drop: 0.25, regen: { delay: 2, rate: 3 },
    attacks: [{ type: 'melee', range: 2.4, windup: 0.7, reach: 1.2, radius: 1.8, damage: 18, knock: 18, cooldown: 2.4 }],
  },
  caveworm: {
    name: 'The Giant Cave Worm', tier: 'mini-boss', style: 'melee', hp: 420, speed: 1.8, radius: 1.6, touch: 12, push: 0.8, score: 300, drop: 0, bossName: 'The Giant Cave Worm',
    attacks: [
      { type: 'burrow', range: LONG, cooldown: 9, windup: 1.5, radius: 3, damage: 18, knock: 16 },
      { type: 'shoot', range: 27, windup: 0.8, cooldown: 4.5, shot: 'acid', count: 3, spread: 0.25 },
      { type: 'melee', range: 3, windup: 0.65, reach: 1.4, radius: 2.2, damage: 18, knock: 18, cooldown: 2.2 },
    ],
    summonAt: { at: [0.5], kind: 'spider', count: 3 },
  },

  // ── Undead (Crypt) ──
  skeleton: {
    name: 'Skeleton Warrior', tier: 'normal', style: 'melee', hp: 35, speed: 4.3, radius: 0.6, touch: 10, push: 7, score: 15, drop: 0.05,
    attacks: [{ type: 'melee', range: 2, windup: 0.45, reach: 1.1, radius: 1.3, damage: 14, knock: 10, cooldown: 1.6 }],
  },
  skelarcher: {
    name: 'Skeleton Archer', tier: 'normal', style: 'ranged', hp: 30, speed: 3.5, radius: 0.6, touch: 8, push: 7, score: 18, drop: 0.07, keepAway: [13.5, 21],
    attacks: [{ type: 'shoot', range: 24, windup: 0.6, cooldown: 2.6, shot: 'arrow' }],
  },
  ghost: {
    name: 'Ghost', tier: 'normal', style: 'melee', hp: 30, speed: 5, radius: 0.7, touch: 12, push: 8, score: 18, drop: 0.07, phasing: true,
    attacks: [],
  },
  zombie: {
    name: 'Zombie Brute', tier: 'tough', style: 'melee', hp: 105, speed: 2.5, radius: 0.9, touch: 14, push: 3, score: 40, drop: 0.15,
    attacks: [{ type: 'melee', range: 2.4, windup: 0.7, reach: 1.2, radius: 1.8, damage: 25, knock: 20, cooldown: 2.4 }],
  },
  knight: {
    name: 'Undead Knight', tier: 'elite', style: 'melee', hp: 150, speed: 3.3, radius: 0.8, touch: 14, push: 2.5, score: 60, drop: 0.25, guard: 0.5,
    attacks: [{ type: 'melee', range: 2.4, windup: 0.55, reach: 1.3, radius: 1.5, damage: 22, knock: 14, cooldown: 1.8 }],
  },
  necromancer: {
    name: 'The Necromancer', tier: 'mini-boss', style: 'ranged', hp: 575, speed: 3.3, radius: 1.1, touch: 15, push: 1, score: 400, drop: 0, bossName: 'The Necromancer',
    keepAway: [10.5, 18],
    attacks: [
      { type: 'shoot', range: 27, windup: 0.7, cooldown: 3.2, shot: 'soul', count: 5, spread: 0.22 },
      { type: 'area', at: 'target', range: 24, windup: 1.1, radius: 2.4, damage: 20, knock: 10, cooldown: 5.5 },
    ],
    summonEvery: { every: 10, kind: 'skeleton', count: 2, max: 6 },
  },

  // ── Orcs (Throne Room) ──
  orcscout: {
    name: 'Orc Scout', tier: 'normal', style: 'melee', hp: 40, speed: 6.8, radius: 0.7, touch: 12, push: 6, score: 20, drop: 0.07, hitAndRun: 0.9,
    attacks: [{ type: 'melee', range: 1.8, windup: 0.3, reach: 1, radius: 1.2, damage: 12, knock: 10, cooldown: 1.2 }],
  },
  orcwarrior: {
    name: 'Orc Warrior', tier: 'tough', style: 'melee', hp: 70, speed: 4, radius: 0.8, touch: 14, push: 4, score: 30, drop: 0.1,
    attacks: [{ type: 'melee', range: 2.2, windup: 0.5, reach: 1.2, radius: 1.5, damage: 20, knock: 14, cooldown: 1.8 }],
  },
  orcarcher: {
    name: 'Orc Archer', tier: 'normal', style: 'ranged', hp: 50, speed: 3.7, radius: 0.7, touch: 10, push: 5, score: 25, drop: 0.1, keepAway: [13.5, 21],
    attacks: [{ type: 'shoot', range: 24, windup: 0.55, cooldown: 2.4, shot: 'arrow' }],
  },
  shaman: {
    name: 'Orc Shaman', tier: 'tough', style: 'ranged', hp: 55, speed: 3.5, radius: 0.7, touch: 10, push: 5, score: 35, drop: 0.15, keepAway: [12, 19.5],
    attacks: [{ type: 'shoot', range: 22.5, windup: 0.6, cooldown: 3, shot: 'magic' }],
    heal: { every: 4, amount: 12, radius: 7 },
  },
  shieldguard: {
    name: 'Orc Shield Guard', tier: 'elite', style: 'melee', hp: 170, speed: 3.1, radius: 0.9, touch: 14, push: 2, score: 70, drop: 0.25, guard: 0.15,
    attacks: [{ type: 'melee', range: 2.4, windup: 0.6, reach: 1.3, radius: 1.6, damage: 22, knock: 16, cooldown: 2 }],
  },
  chieftain: {
    name: 'The Orc Chieftain', tier: 'mini-boss', style: 'melee', hp: 745, speed: 3.3, radius: 1.5, touch: 18, push: 0.8, score: 500, drop: 0, bossName: 'The Orc Chieftain',
    attacks: [
      { type: 'area', at: 'self', range: 5, windup: 1.1, radius: 4.8, damage: 30, knock: 20, cooldown: 7 },
      { type: 'lunge', range: 16, minRange: 6, windup: 0.8, speed: 14, time: 1.0, damage: 30, knock: 24, cooldown: 8 },
      { type: 'melee', range: 3.2, windup: 0.7, reach: 1.5, radius: 2.2, damage: 28, knock: 26, cooldown: 1.8 },
    ],
    summonAt: { at: [0.5], kind: 'orcwarrior', count: 3 },
  },

  // ── Goblins (Flooded Hall): quick, well-armed tinkerers with nasty gadgets ──
  brawler: {
    name: 'Scrap Brawler', tier: 'normal', style: 'melee', hp: 45, speed: 5.8, radius: 0.5, touch: 14, push: 6, score: 25, drop: 0.06,
    attacks: [{ type: 'melee', range: 1.6, windup: 0.32, reach: 0.9, radius: 1.2, damage: 18, knock: 14, cooldown: 1.3 }],
  },
  rotor: {
    name: 'Rotor Scout', tier: 'normal', style: 'melee', hp: 40, speed: 7.5, radius: 0.5, touch: 12, push: 6, score: 25, drop: 0.07,
    attacks: [{ type: 'lunge', range: 8, minRange: 2.5, windup: 0.45, speed: 18, time: 0.4, damage: 20, knock: 14, cooldown: 2.6 }],
  },
  riveter: {
    name: 'Rivet Shooter', tier: 'normal', style: 'ranged', hp: 50, speed: 4, radius: 0.5, touch: 10, push: 6, score: 30, drop: 0.1, keepAway: [10.5, 18],
    attacks: [{ type: 'shoot', range: 21, windup: 0.4, cooldown: 2, shot: 'rivet' }],
  },
  lobber: {
    name: 'Bomb Lobber', tier: 'tough', style: 'ranged', hp: 55, speed: 3.7, radius: 0.5, touch: 10, push: 6, score: 35, drop: 0.12, keepAway: [12, 19.5],
    attacks: [{ type: 'area', at: 'target', range: 22.5, windup: 0.9, radius: 2.6, damage: 26, knock: 18, cooldown: 3.2 }],
  },
  tinkerer: {
    name: 'Boiler Tinkerer', tier: 'elite', style: 'melee', hp: 130, speed: 3.3, radius: 0.6, touch: 15, push: 3, score: 60, drop: 0.25,
    attacks: [{ type: 'area', at: 'self', range: 3, windup: 0.65, radius: 3, damage: 24, knock: 20, cooldown: 2.8 }],
  },
  scrapboss: {
    name: 'The Scrap Boss', tier: 'mini-boss', style: 'melee', hp: 950, speed: 2.9, radius: 1.5, touch: 20, push: 0.5, score: 700, drop: 0, bossName: 'The Scrap Boss',
    attacks: [
      { type: 'area', at: 'self', range: 6, windup: 1.0, radius: 5, damage: 32, knock: 22, cooldown: 5.5 },
      { type: 'melee', range: 3, windup: 0.55, reach: 1.4, radius: 2.2, damage: 32, knock: 28, cooldown: 1.8 },
    ],
    summonAt: { at: [0.66, 0.33], kind: 'brawler', count: 4 },
  },

  // ── The final boss (Lava Chamber) ──
  inferno: {
    name: 'The Inferno', tier: 'boss', style: 'ranged', hp: 1380, speed: 2.6, radius: 2.0, touch: 20, push: 0.4, score: 1000, drop: 0, bossName: 'The Inferno',
    keepAway: [9, 18],
    attacks: [
      { type: 'area', at: 'self', range: 7, windup: 1.1, radius: 5.5, damage: 30, knock: 22, cooldown: 7, zone: 'fire' },
      { type: 'shoot', range: 30, windup: 0.7, cooldown: 3, shot: 'fire', count: 5, spread: 0.2 },
      { type: 'area', at: 'target', range: 30, windup: 1.0, radius: 2.5, damage: 22, knock: 12, cooldown: 4.5, zone: 'fire' },
    ],
    summonAt: { at: [2 / 3, 1 / 3], kind: 'fire', count: 2 },
  },
};

/** Splat / hit colour for each kind. */
const COLORS: Record<MonsterKind, number> = {
  brawler: 0x9cb03a, rotor: 0x9cb03a, riveter: 0x9cb03a, lobber: 0x9cb03a, tinkerer: 0x9cb03a, scrapboss: 0x9a6a3a,
  skeleton: 0xe0d6b8, skelarcher: 0xe0d6b8, ghost: 0x8fe0c0, zombie: 0x8a9a6a, knight: 0xe0d6b8, necromancer: 0x2f8a8a,
  orcscout: 0x7a9a3a, orcwarrior: 0x7a9a3a, orcarcher: 0x7a9a3a, shaman: 0x9a50c0, shieldguard: 0x7a9a3a, chieftain: 0x7a9a3a,
  spider: 0x6a5a9a, ooze: 0x9bd03a, sporecrawler: 0x9a7a3a, mushroom: 0xc04a40, mold: 0xa090c0, caveworm: 0x6a5a8a,
  inferno: 0xff7a2a,
};

/** The Inferno is a giant fire elemental. */
const INFERNO_HEIGHT = 5;

export interface MonsterLook {
  readonly group: THREE.Group;
  apply(p: BeastPose, dt: number, time: number): void;
}

/** The right visual for a monster kind (shared with the familiar's view). */
export function createMonsterVisual(kind: MonsterKind): MonsterLook {
  return kind === 'inferno' ? new ElementalVisual('fire', INFERNO_HEIGHT) : new MonsterVisual(kind);
}

let nextMonsterId = 300000; // separate from beast / elemental ids
const GAP = 0.6; // seconds between one attack and the next

type Mode = 'chase' | 'windup' | 'attack' | 'recover' | 'retreat' | 'sink' | 'under' | 'rise';

export class Monster implements Enemy {
  readonly id = nextMonsterId++;
  readonly kind: MonsterKind;
  readonly def: MonsterDef;
  readonly radius: number;
  readonly score: number;
  readonly color: THREE.Color;
  readonly maxHp: number;
  readonly visual: MonsterLook;
  readonly bossName: string | null;
  hp: number;
  dying = false;
  removed = false;
  slow = 1;
  telegraph: Telegraph | null = null;
  strike: Strike | null = null;
  summon: Summon | null = null;
  /** Set for one step when it heals its allies (for the effect). */
  healPulse: { x: number; z: number; r: number } | null = null;
  private readonly pose: BeastPose;
  private readonly knock = new THREE.Vector2();
  private mode: Mode = 'chase';
  private timer = 0;
  private gap: number;
  private readonly cooldowns: number[];
  private current: Attack | null = null;
  private lockDir = { x: 0, z: 1 };
  private flash = 0;
  private stunTimer = 0;
  private calmTimer = 0;
  private deathTimer = 0;
  private sinceHurt = 0;
  private healTimer: number;
  private summonTimer: number;
  private time = 0;
  private wander = Math.random() * Math.PI * 2;
  private readonly side = Math.random() < 0.5 ? -1 : 1;

  constructor(kind: MonsterKind, x: number, z: number) {
    this.kind = kind;
    this.def = MONSTERS[kind];
    this.radius = this.def.radius;
    this.score = this.def.score;
    this.color = new THREE.Color(COLORS[kind]);
    this.maxHp = this.hp = this.def.hp;
    this.bossName = this.def.bossName ?? null;
    this.cooldowns = this.def.attacks.map(() => 0);
    // Shooters open fire a little after arriving, staggered so a group doesn't fire in unison.
    this.gap = this.def.style === 'ranged' ? 1 + Math.random() * 1.5 : 0.3;
    this.healTimer = this.def.heal?.every ?? 0;
    this.summonTimer = this.def.summonEvery?.every ?? 0;
    this.visual = createMonsterVisual(kind);
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
  /** Underground (the worm): can't be hit or targeted. */
  get hidden(): boolean {
    return this.mode === 'under' || (this.mode === 'sink' && this.timer < 0.3) || (this.mode === 'rise' && this.timer > 0.35);
  }
  get stunned(): boolean {
    return this.stunTimer > 0;
  }
  get calmed(): boolean {
    return this.calmTimer > 0;
  }
  get harmless(): boolean {
    return this.stunned || this.calmed || this.mode === 'retreat' || this.mode === 'sink' || this.mode === 'under' || this.mode === 'rise';
  }
  private get lunging(): Extract<Attack, { type: 'lunge' }> | null {
    return this.mode === 'attack' && this.current?.type === 'lunge' ? this.current : null;
  }
  get touchDamage(): number {
    return this.lunging?.damage ?? this.def.touch;
  }
  get touchKnock(): number {
    return this.lunging?.knock ?? (this.def.tier === 'mini-boss' || this.def.tier === 'boss' ? 20 : 12);
  }

  setPosition(x: number, z: number): void {
    this.pose.x = x;
    this.pose.z = z;
    this.visual.apply(this.pose, 0, this.time);
  }

  hurt(amount: number, dirX: number, dirZ: number): boolean {
    if (this.dying || this.hidden) return false;
    if (this.def.guard !== undefined) {
      // Hit from the front (travelling against its facing): the shield takes most of it.
      const fx = Math.sin(this.pose.yaw);
      const fz = Math.cos(this.pose.yaw);
      if (dirX * fx + dirZ * fz < -0.3 && !this.stunned) amount *= this.def.guard;
    }
    const before = this.hp / this.maxHp;
    this.hp -= amount;
    this.flash = 1;
    this.sinceHurt = 0;
    this.knock.set(dirX * this.def.push, dirZ * this.def.push);
    if (this.hp <= 0) {
      this.dying = true;
      this.telegraph = null;
      return true;
    }
    const s = this.def.summonAt;
    if (s) {
      const after = this.hp / this.maxHp;
      const crossed = s.at.filter((f) => before > f && after <= f).length;
      if (crossed) this.summon = { kind: s.kind, count: s.count * crossed };
    }
    return false;
  }

  /** An ally's healing (the shaman). */
  heal(amount: number): void {
    if (!this.dying) this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  stun(seconds: number): void {
    if (this.dying || this.hidden) return;
    if (this.bossName) seconds *= 0.5;
    else if (this.def.tier === 'elite') seconds *= 0.7;
    if (this.lunging && this.bossName) return; // a boss's charge can't be stopped
    this.stunTimer = Math.max(this.stunTimer, seconds);
    this.cancel();
  }

  calm(seconds: number): void {
    if (this.dying || this.bossName || this.hidden) return; // bosses can't be calmed
    this.calmTimer = Math.max(this.calmTimer, seconds);
    this.cancel();
  }

  onHitTarget(): void {
    if (this.def.hitAndRun) this.setMode('retreat', this.def.hitAndRun);
    else if (this.lunging) this.setMode('recover', 0.4); // the dash ends on impact
  }

  tuple(): EnemyTuple {
    const o = this.pose;
    return [this.id, ENEMY_KIND_LIST.indexOf(this.kind), q(o.x), q(o.z), q(o.yaw), q(o.y), q(o.speed), q(o.act), o.mode, q(o.flash), o.stun, q(o.death), o.calm];
  }

  private cancel(): void {
    if (this.mode === 'sink' || this.mode === 'under' || this.mode === 'rise') return;
    this.telegraph = null;
    if (this.mode === 'windup' || this.mode === 'attack') this.setMode('chase', 0);
  }

  private setMode(mode: Mode, time: number): void {
    this.mode = mode;
    this.timer = time;
  }

  update(dt: number, target: THREE.Vector3, others: readonly Enemy[], obstacles: readonly Circle[], half: number): Spit[] {
    this.time += dt;
    this.strike = null;
    this.healPulse = null;
    this.flash = Math.max(0, this.flash - dt * 5);
    const p = this.pose;
    p.flash = this.flash;

    if (this.dying) {
      this.deathTimer += dt;
      p.death = Math.min(1, this.deathTimer / 0.35);
      p.speed = 0;
      p.y = Math.min(0, p.y + dt * 8);
      if (p.death === 1) this.removed = true;
      this.visual.apply(p, dt, this.time);
      return [];
    }

    p.x += this.knock.x * dt;
    p.z += this.knock.y * dt;
    this.knock.multiplyScalar(Math.exp(-8 * dt));
    this.sinceHurt += dt;
    if (this.def.regen && this.sinceHurt > this.def.regen.delay) this.hp = Math.min(this.maxHp, this.hp + this.def.regen.rate * dt);
    this.support(dt, others);

    let speed = 0;
    let spits: Spit[] = [];
    const walls = this.def.phasing ? [] : obstacles;
    if (this.stunTimer > 0) {
      this.stunTimer = Math.max(0, this.stunTimer - dt);
    } else if (this.calmTimer > 0) {
      this.calmTimer = Math.max(0, this.calmTimer - dt);
      this.wander += (Math.random() - 0.5) * dt * 3;
      const away = Math.atan2(p.x - target.x, p.z - target.z);
      const dir = away * 0.4 + this.wander * 0.6;
      speed = this.def.speed * 0.45 * this.slow;
      this.move(Math.sin(dir), Math.cos(dir), speed, dt, others, walls, half);
    } else {
      [speed, spits] = this.think(dt, target, others, walls, half);
    }

    if (!this.def.phasing) pushOutOfCircles(p, this.radius, obstacles);
    clampToArena(p, half, this.radius);
    p.speed = speed;
    p.stun = this.stunTimer > 0 ? 1 : 0;
    p.calm = this.calmTimer > 0 ? 1 : 0;
    p.mode = this.mode === 'windup' ? 1 : this.mode === 'attack' || (this.mode === 'recover' && p.act > 0) ? 2 : this.mode === 'retreat' ? 3 : 0;
    this.visual.apply(p, dt, this.time);
    this.slow = 1;
    return spits;
  }

  /** Healing allies and calling in help. */
  private support(dt: number, others: readonly Enemy[]): void {
    const h = this.def.heal;
    if (h) {
      this.healTimer -= dt;
      if (this.healTimer <= 0) {
        this.healTimer = h.every;
        let any = false;
        for (const o of others) {
          if (o === this || !o.alive || o.hp >= o.maxHp || !(o instanceof Monster)) continue;
          if (Math.hypot(o.x - this.x, o.z - this.z) > h.radius) continue;
          o.heal(h.amount);
          any = true;
        }
        if (any) this.healPulse = { x: this.x, z: this.z, r: h.radius };
      }
    }
    const s = this.def.summonEvery;
    if (s) {
      this.summonTimer -= dt;
      if (this.summonTimer <= 0) {
        this.summonTimer = s.every;
        const alive = others.filter((o) => o.alive && o.kind === s.kind).length;
        const count = Math.min(s.count, s.max - alive);
        if (count > 0) this.summon = { kind: s.kind, count };
      }
    }
  }

  /** Can attack `a` start now, at distance `dist`? */
  private ready(a: Attack, dist: number): boolean {
    switch (a.type) {
      case 'melee':
        return dist < a.range + this.radius;
      case 'shoot':
        return dist <= a.range;
      case 'area':
        return dist <= (a.at === 'self' ? a.range + this.radius : a.range) && dist >= (a.minRange ?? 0);
      case 'lunge':
        return dist <= a.range && dist >= (a.minRange ?? 0);
      case 'burrow':
        return dist <= a.range;
    }
  }

  private think(dt: number, target: THREE.Vector3, others: readonly Enemy[], obstacles: readonly Circle[], half: number): [number, Spit[]] {
    const p = this.pose;
    for (let i = 0; i < this.cooldowns.length; i++) this.cooldowns[i] = Math.max(0, this.cooldowns[i] - dt);
    this.gap = Math.max(0, this.gap - dt);
    this.timer -= dt;
    let tx = target.x - p.x;
    let tz = target.z - p.z;
    const dist = Math.hypot(tx, tz) || 1;
    tx /= dist;
    tz /= dist;
    const face = (x: number, z: number) => (p.yaw = Math.atan2(x, z));
    const a = this.current;

    switch (this.mode) {
      case 'windup': {
        p.act = 1 - Math.max(0, this.timer) / a!.windup;
        if (a!.type === 'lunge') face(this.lockDir.x, this.lockDir.z);
        else face(tx, tz);
        if (this.telegraph) this.telegraph.p = p.act;
        if (this.timer <= 0) return [0, this.release(tx, tz, dist)];
        return [0, []];
      }
      case 'attack': {
        // Dashing (lunge / charge).
        const l = a as Extract<Attack, { type: 'lunge' }>;
        const before = { x: p.x, z: p.z };
        p.x += this.lockDir.x * l.speed * dt;
        p.z += this.lockDir.z * l.speed * dt;
        const hitWall = clampToArena(p, half, this.radius);
        const hitRock = pushOutOfCircles(p, this.radius, obstacles.filter((o) => !o.low));
        if (hitWall || hitRock || Math.hypot(p.x - before.x, p.z - before.z) < 0.01 || this.timer <= 0) this.setMode('recover', 0.5);
        return [l.speed, []];
      }
      case 'sink': {
        p.y = -(1 - Math.max(0, this.timer) / 0.6) * 5;
        if (this.timer <= 0) {
          // Underground: a ring follows the hero, then locks on.
          const b = a as Extract<Attack, { type: 'burrow' }>;
          this.telegraph = { x: target.x, z: target.z, r: b.radius, p: 0 };
          this.setMode('under', b.windup);
        }
        return [0, []];
      }
      case 'under': {
        const b = a as Extract<Attack, { type: 'burrow' }>;
        const t = this.telegraph!;
        t.p = 1 - Math.max(0, this.timer) / b.windup;
        if (t.p < 0.5) {
          t.x = target.x;
          t.z = target.z;
        }
        p.x = t.x;
        p.z = t.z;
        if (this.timer <= 0) {
          this.strike = { x: t.x, z: t.z, r: b.radius, damage: b.damage, knock: b.knock };
          this.telegraph = null;
          p.act = 1;
          this.setMode('rise', 0.6);
        }
        return [0, []];
      }
      case 'rise': {
        p.y = -Math.max(0, this.timer) / 0.6 * 5;
        face(tx, tz);
        if (this.timer <= 0) {
          p.y = 0;
          p.act = 0;
          this.setMode('chase', 0);
        }
        return [0, []];
      }
      case 'recover': {
        if (this.timer <= 0) {
          p.act = 0;
          this.setMode('chase', 0);
        }
        return [0, []];
      }
      case 'retreat': {
        const speed = this.def.speed * 1.1 * this.slow;
        this.move(-tx + this.side * tz * 0.6, -tz - this.side * tx * 0.6, speed, dt, others, obstacles, half);
        face(-tx, -tz);
        if (this.timer <= 0) this.setMode('chase', 0);
        return [speed, []];
      }
      case 'chase':
        break;
    }

    // Pick the first attack that's ready.
    p.act = 0;
    if (this.gap === 0) {
      for (let i = 0; i < this.def.attacks.length; i++) {
        const atk = this.def.attacks[i];
        if (this.cooldowns[i] > 0 || !this.ready(atk, dist)) continue;
        this.cooldowns[i] = atk.cooldown;
        this.current = atk;
        face(tx, tz);
        if (atk.type === 'burrow') {
          this.setMode('sink', 0.6);
          return [0, []];
        }
        if (atk.type === 'area') this.telegraph = atk.at === 'self' ? { x: p.x, z: p.z, r: atk.radius, p: 0 } : { x: target.x, z: target.z, r: atk.radius, p: 0 };
        if (atk.type === 'lunge') this.lockDir = { x: tx, z: tz };
        this.setMode('windup', atk.windup);
        return [0, []];
      }
    }

    // Close in (melee) or hold a distance band and circle (ranged).
    const speed = this.def.speed * this.slow;
    face(tx, tz);
    if (this.def.keepAway) {
      const [min, max] = this.def.keepAway;
      const intent = rangeIntent(dist, min, max);
      const mx = intent === 0 ? tz * this.side : tx * intent + tz * this.side * 0.3;
      const mz = intent === 0 ? -tx * this.side : tz * intent - tx * this.side * 0.3;
      const s = intent === 0 ? speed * 0.5 : speed;
      this.move(mx, mz, s, dt, others, obstacles, half);
      return [s, []];
    }
    this.move(tx, tz, speed, dt, others, obstacles, half);
    return [speed, []];
  }

  /** The wind-up is over: the attack lands, the bolts fly, or the dash starts. */
  private release(tx: number, tz: number, dist: number): Spit[] {
    const p = this.pose;
    const a = this.current!;
    p.act = 1;
    this.gap = GAP;
    switch (a.type) {
      case 'melee': {
        const reach = Math.min(this.radius + a.reach, Math.max(0, dist - 0.6)); // just short of the hero, so it shoves them away
        this.strike = { x: p.x + tx * reach, z: p.z + tz * reach, r: a.radius, damage: a.damage, knock: a.knock };
        this.setMode('recover', 0.45);
        return [];
      }
      case 'area': {
        const t = this.telegraph!;
        this.strike = { x: t.x, z: t.z, r: a.radius, damage: a.damage, knock: a.knock, slow: a.slow, zone: a.zone };
        this.telegraph = null;
        this.setMode('recover', 0.5);
        return [];
      }
      case 'lunge':
        this.setMode('attack', a.time);
        return [];
      case 'shoot': {
        this.setMode('recover', 0.3);
        const n = a.count ?? 1;
        const out = this.radius + 0.4;
        const base = Math.atan2(tx, tz);
        const spits: Spit[] = [];
        for (let i = 0; i < n; i++) {
          const ang = base + (i - (n - 1) / 2) * (a.spread ?? 0);
          const dx = Math.sin(ang);
          const dz = Math.cos(ang);
          spits.push({ x: p.x + dx * out, z: p.z + dz * out, dirX: dx, dirZ: dz, kind: a.shot });
        }
        return spits;
      }
      case 'burrow':
        return [];
    }
  }

  private move(dx: number, dz: number, speed: number, dt: number, others: readonly Enemy[], obstacles: readonly Circle[], half: number): void {
    steerMove(this.pose, dx, dz, speed, dt, this.radius, this, others, obstacles, half, this.side);
  }
}
