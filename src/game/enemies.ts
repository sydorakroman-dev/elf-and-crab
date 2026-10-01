import * as THREE from 'three';
import { clampToArena, pushOutOfCircles, type Circle } from './combat';
import { Beast } from './beasts';
import { Elemental } from './elementals';
import { Monster } from './monsters';
import type { ProjectileKind } from './globs';

export type BeastKind = 'beetle' | 'snake' | 'direwolf' | 'boar' | 'bear';
export type ElementalKind = 'vine' | 'wind' | 'water' | 'fire' | 'treant' | 'golem';
export type MonsterKind =
  | 'brawler' | 'rotor' | 'riveter' | 'lobber' | 'tinkerer' | 'scrapboss'
  | 'skeleton' | 'skelarcher' | 'ghost' | 'zombie' | 'knight' | 'necromancer'
  | 'orcscout' | 'orcwarrior' | 'orcarcher' | 'shaman' | 'shieldguard' | 'chieftain'
  | 'spider' | 'ooze' | 'sporecrawler' | 'mushroom' | 'mold' | 'caveworm'
  | 'inferno';
export type EnemyKind = BeastKind | ElementalKind | MonsterKind;
export const BEAST_KIND_LIST: BeastKind[] = ['beetle', 'snake', 'direwolf', 'boar', 'bear'];
export const ELEMENTAL_KIND_LIST: ElementalKind[] = ['vine', 'wind', 'water', 'fire', 'treant', 'golem'];

export interface Spit {
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  kind: ProjectileKind;
}

/** An area attack landing this step (a slam, a lunge, a swipe, a bomb): the hero is hit if within `r` of (x, z). */
export interface Strike {
  x: number;
  z: number;
  r: number;
  damage: number;
  knock: number;
  /** Also slows the hero (roots, acid). */
  slow?: { seconds: number; factor: number };
  /** Leaves burning / poisonous ground behind. */
  zone?: 'fire' | 'poison';
}

/** An enemy calling in reinforcements (a boss's summons). */
export interface Summon {
  kind: EnemyKind;
  count: number;
}

/**
 * Network form of any enemy: [id, kind, x, z, yaw, y, speed, act, mode, flash, stun, death, calm].
 * mode: 0 moving, 1 winding up, 2 attacking, 3 dazed or retreating.
 */
export type EnemyTuple = [number, number, number, number, number, number, number, number, number, number, number, number, number];

/** What the game needs from any enemy. */
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
  /** Can't be hit or targeted right now (burrowed). */
  readonly hidden?: boolean;
  /** No contact damage right now (stunned, calmed…). */
  readonly harmless: boolean;
  /** Damage to the hero on contact right now (a charge hits harder). */
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
  /** Moves / attacks; returns any bolts it fires this step. */
  update(dt: number, target: THREE.Vector3, others: readonly Enemy[], obstacles: readonly Circle[], half: number): Spit[];
  tuple(): EnemyTuple;
}

/** Where an attack will land, for the warning ring: progress 0 → 1 until impact. */
export interface Telegraph {
  x: number;
  z: number;
  r: number;
  p: number;
}

/** One wave of a room: who comes through the gates, and (last wave) the room's boss. */
export interface RoomWave {
  mix: Partial<Record<EnemyKind, number>>;
  /** Appears at the north end when the wave starts; the rest are its escorts. */
  boss?: EnemyKind;
}

/** Makes an enemy of any kind. */
export function createEnemy(kind: EnemyKind, x: number, z: number): Enemy {
  if ((BEAST_KIND_LIST as EnemyKind[]).includes(kind)) return new Beast(kind as BeastKind, x, z);
  if ((ELEMENTAL_KIND_LIST as EnemyKind[]).includes(kind)) return new Elemental(kind as ElementalKind, x, z);
  return new Monster(kind as MonsterKind, x, z);
}

/** Spawns enemies wave by wave through the gates and updates them. */
export class Enemies {
  readonly group = new THREE.Group();
  /** Every enemy currently in the room. */
  readonly all: Enemy[] = [];
  private queue: EnemyKind[] = [];
  private spawnTimer = 0;
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

  /** Starts a wave; a boss appears at (bossX, bossZ) right away, its escorts trickle in later. */
  startRoomWave(w: RoomWave, bossX: number, bossZ: number): Enemy | null {
    this.queue = shuffle(Object.entries(w.mix).flatMap(([k, n]) => Array<EnemyKind>(n ?? 0).fill(k as EnemyKind)));
    this.packSize = 2;
    this.spawnInterval = w.boss ? 3 : 1.4;
    this.spawnTimer = w.boss ? 4 : 0.3;
    return w.boss ? this.add(createEnemy(w.boss, bossX, bossZ)) : null;
  }

  clear(): void {
    for (const s of this.all) this.group.remove(s.group);
    this.all.length = 0;
    this.queue = [];
  }

  /** Stuns every living enemy within `radius` of (x, z); returns those hit. */
  stunAround(x: number, z: number, radius: number, seconds: number): Enemy[] {
    const hit = this.all.filter((s) => s.alive && !s.hidden && Math.hypot(s.x - x, s.z - z) <= radius + s.radius);
    for (const s of hit) s.stun(seconds);
    return hit;
  }

  /** Calms every living enemy within `radius` of (x, z); returns those affected. */
  calmAround(x: number, z: number, radius: number, seconds: number): Enemy[] {
    const hit = this.all.filter((s) => s.alive && !s.hidden && Math.hypot(s.x - x, s.z - z) <= radius + s.radius);
    for (const s of hit) s.calm(seconds);
    return hit;
  }

  private add<T extends Enemy>(e: T): T {
    this.all.push(e);
    this.group.add(e.group);
    return e;
  }

  /** Spawns reinforcements in a ring around (x, z) (a boss calling for help). */
  private summon(kind: EnemyKind, x: number, z: number, count: number, obstacles: readonly Circle[], half: number): void {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random();
      const e = createEnemy(kind, x + Math.cos(a) * 3.5, z + Math.sin(a) * 3.5);
      const pos = { x: e.x, z: e.z };
      pushOutOfCircles(pos, e.radius, obstacles);
      clampToArena(pos, half, e.radius);
      e.setPosition(pos.x, pos.z);
      this.add(e);
    }
  }

  /** Updates every enemy; returns bolts fired and area attacks landed this step. */
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
        this.add(createEnemy(this.queue.pop()!, x, z));
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
