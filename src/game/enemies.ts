import * as THREE from 'three';
import { clampToArena, pushOutOfCircles, walkMap, type Circle } from './combat';
import { BEASTS, Beast } from './beasts';
import { ELEMENTALS, Elemental } from './elementals';
import { MONSTERS, Monster } from './monsters';
import type { ProjectileKind } from './globs';

export type BeastKind = 'beetle' | 'snake' | 'direwolf' | 'boar' | 'bear';
export type ElementalKind = 'vine' | 'wind' | 'water' | 'fire' | 'treant' | 'golem';
export type MonsterKind =
  | 'brawler' | 'rotor' | 'riveter' | 'lobber' | 'tinkerer' | 'scrapboss'
  | 'skeleton' | 'skelarcher' | 'ghost' | 'zombie' | 'knight' | 'necromancer'
  | 'orcscout' | 'orcwarrior' | 'orcarcher' | 'shaman' | 'shieldguard' | 'chieftain'
  | 'spider' | 'ooze' | 'sporecrawler' | 'mushroom' | 'mold' | 'caveworm'
  | 'inferno'
  | 'ashking';
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
  /** Pushed about `metres` along (dirX, dirZ) — less for heavy foes. */
  shove(dirX: number, dirZ: number, metres: number): void;
  /** Slowed to `factor` of its speed for `seconds` (drenched). */
  soak(seconds: number, factor: number): void;
  setPosition(x: number, z: number): void;
  /** Called when its contact hit the hero (e.g. the wolf backs off). */
  onHitTarget(): void;
  /** Moves / attacks; returns any bolts it fires this step. */
  update(dt: number, target: THREE.Vector3, others: readonly Enemy[], obstacles: readonly Circle[]): Spit[];
  tuple(): EnemyTuple;
}

/** Where an attack will land, for the warning ring: progress 0 → 1 until impact. */
export interface Telegraph {
  x: number;
  z: number;
  r: number;
  p: number;
}

/** An enemy kind's display name ("Cave Spider", "The Necromancer"). */
export function enemyName(kind: EnemyKind): string {
  return (BEASTS as Record<string, { name: string }>)[kind]?.name ?? (ELEMENTALS as Record<string, { name: string }>)[kind]?.name ?? MONSTERS[kind as MonsterKind].name;
}

/** Makes an enemy of any kind. */
export function createEnemy(kind: EnemyKind, x: number, z: number): Enemy {
  if ((BEAST_KIND_LIST as EnemyKind[]).includes(kind)) return new Beast(kind as BeastKind, x, z);
  if ((ELEMENTAL_KIND_LIST as EnemyKind[]).includes(kind)) return new Elemental(kind as ElementalKind, x, z);
  return new Monster(kind as MonsterKind, x, z);
}

/** How close (m) the hero must come, in plain sight, to wake a sleeping pack. */
export const WAKE_RANGE = 17;
/** A pack also wakes when the hero is this close, seen or not (heard). */
const HEAR_RANGE = 7;
/** Sight lines and routes are rechecked this often (steps), staggered across enemies. */
const THINK_EVERY = 6;

interface Brain {
  pack: number;
  asleep: boolean;
  /** Last check: can it see the hero? And the way round if not. */
  sees: boolean;
  waypoint: { x: number; z: number } | null;
}

/**
 * The level's monsters: packs placed by the generator wait asleep until the hero comes close
 * (or hits one), then hunt — straight at the hero when in sight, otherwise round the walls along
 * the shortest way.
 */
export class Enemies {
  readonly group = new THREE.Group();
  /** Every enemy in the level. */
  readonly all: Enemy[] = [];
  private readonly brains = new Map<Enemy, Brain>();
  private nextPack = 1;
  private field: Int32Array | null = null;
  private fieldTile = -1;
  private step = 0;
  private readonly far = new THREE.Vector3();

  /** Monsters still alive in the level. */
  get remaining(): number {
    return this.all.filter((s) => s.alive).length;
  }

  /** Monsters awake and hunting. */
  get hunting(): number {
    return this.all.filter((s) => s.alive && !this.brains.get(s)?.asleep).length;
  }

  /** The mini-boss or boss, once it's awake (it gets a health bar then). */
  get boss(): Enemy | null {
    return this.all.find((s) => s.bossName !== null && s.alive && !this.brains.get(s)?.asleep) ?? null;
  }

  /** Is the level's guardian (any boss) still alive, awake or not? */
  get guardianAlive(): boolean {
    return this.all.some((s) => s.bossName !== null && s.alive);
  }

  isAsleep(e: Enemy): boolean {
    return !!this.brains.get(e)?.asleep;
  }

  /** Warning rings for every attack about to land. */
  get telegraphs(): Telegraph[] {
    return this.all.filter((s) => s.alive && s.telegraph).map((s) => s.telegraph!);
  }

  /** Places the level's packs, asleep: members stand round the pack's spot. */
  spawnPacks(packs: readonly { x: number; z: number; kinds: readonly EnemyKind[]; boss: boolean }[], obstacles: readonly Circle[]): void {
    for (const pack of packs) {
      const id = this.nextPack++;
      pack.kinds.forEach((kind, i) => {
        // The boss stands in the middle; the rest in a loose ring.
        const lead = pack.boss && i === 0;
        const a = (i / pack.kinds.length) * Math.PI * 2 + id;
        const d = lead ? 0 : pack.boss ? 5 : 1.5 + (i % 2) * 1.5;
        const e = createEnemy(kind, pack.x + Math.cos(a) * d, pack.z + Math.sin(a) * d);
        const pos = { x: e.x, z: e.z };
        pushOutOfCircles(pos, e.radius, obstacles);
        clampToArena(pos, e.radius);
        e.setPosition(pos.x, pos.z);
        this.add(e, id, true);
      });
    }
  }

  /** The practice room's showcase: replaces everything with one monster of `kind`, awake and behaving as usual. */
  showcase(kind: EnemyKind, x: number, z: number): Enemy {
    this.clear();
    return this.add(createEnemy(kind, x, z), 0, false);
  }

  clear(): void {
    for (const s of this.all) this.group.remove(s.group);
    this.all.length = 0;
    this.brains.clear();
    this.field = null;
    this.fieldTile = -1;
  }

  /** Draws only the enemies within `range` m of `focus` (the level is big; fog hides the rest). */
  cull(focus: { x: number; z: number }, range: number): void {
    for (const s of this.all) s.group.visible = Math.abs(s.x - focus.x) < range && Math.abs(s.z - focus.z) < range;
  }

  /** Wakes `e` and its whole pack (it was hit, or saw the hero). */
  wake(e: Enemy): void {
    const b = this.brains.get(e);
    if (!b?.asleep) return;
    for (const ob of this.brains.values()) if (ob.pack === b.pack) ob.asleep = false;
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

  private add<T extends Enemy>(e: T, pack: number, asleep: boolean): T {
    this.all.push(e);
    this.group.add(e.group);
    this.brains.set(e, { pack, asleep, sees: false, waypoint: null });
    return e;
  }

  /** Spawns reinforcements in a ring around (x, z) (a boss calling for help), awake. */
  private summon(kind: EnemyKind, x: number, z: number, count: number, obstacles: readonly Circle[], pack: number): void {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random();
      const e = createEnemy(kind, x + Math.cos(a) * 3.5, z + Math.sin(a) * 3.5);
      const pos = { x: e.x, z: e.z };
      pushOutOfCircles(pos, e.radius, obstacles);
      clampToArena(pos, e.radius);
      e.setPosition(pos.x, pos.z);
      this.add(e, pack, false);
    }
  }

  /**
   * Updates every awake enemy; returns bolts fired and area attacks landed this step. `target` is
   * where they think the hero is; `hero` where the hero really is (sleepers wake on seeing it).
   */
  update(dt: number, target: THREE.Vector3, obstacles: readonly Circle[], hero: THREE.Vector3 = target): { spits: Spit[]; strikes: Strike[] } {
    const map = walkMap();
    this.step++;
    // The way to the hero round the walls, redone when the hero moves to another tile.
    const tile = map.row(target.z) * map.cols + map.col(target.x);
    if (tile !== this.fieldTile || !this.field) {
      this.field = map.distanceField(target.x, target.z, this.field ?? undefined);
      this.fieldTile = tile;
    }
    const spits: Spit[] = [];
    const strikes: Strike[] = [];
    for (const s of [...this.all]) {
      const b = this.brains.get(s)!;
      if (b.asleep) {
        if (!s.alive || (this.step + s.id) % THINK_EVERY) continue;
        const d = Math.hypot(hero.x - s.x, hero.z - s.z);
        if (s.hp < s.maxHp || d < HEAR_RANGE || (d < WAKE_RANGE && map.lineOfSight(s, hero))) this.wake(s); // hurt, heard or seen
        continue;
      }
      if (s.alive && ((this.step + s.id) % THINK_EVERY === 0 || dt === 0)) {
        b.sees = map.raycast(s.x, s.z, target.x, target.z, Math.min(0.6, s.radius * 0.7)) === null;
        b.waypoint = b.sees ? null : map.nextWaypoint(this.field, s.x, s.z, s.radius);
      }
      let goal = target;
      if (s.alive && !b.sees && b.waypoint) {
        // Out of sight: head round the walls. The goal is set far along that way, so nothing
        // attacks thin air on the way.
        const dx = b.waypoint.x - s.x;
        const dz = b.waypoint.z - s.z;
        const len = Math.hypot(dx, dz) || 1;
        goal = this.far.set(s.x + (dx / len) * 300, 0, s.z + (dz / len) * 300);
      }
      spits.push(...s.update(dt, goal, this.all, obstacles));
      if (s.strike) strikes.push(s.strike);
      if (s.summon) {
        this.summon(s.summon.kind, s.x, s.z, s.summon.count, obstacles, b.pack);
        s.summon = null;
      }
    }
    for (let i = this.all.length - 1; i >= 0; i--) {
      if (!this.all[i].removed) continue;
      this.group.remove(this.all[i].group);
      this.brains.delete(this.all[i]);
      this.all.splice(i, 1);
    }
    return { spits, strikes };
  }
}
