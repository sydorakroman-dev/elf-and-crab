import type { InvState, StockEntry } from '../game/inventory';
/**
 * World snapshots streamed from the hero (who runs the game) to the familiar's tablet, plus the
 * interpolation the tablet uses to render smoothly between them. Pure; unit tested.
 * Arrays instead of objects for the many-entity lists keep each snapshot small.
 */

import type { ZoneTuple } from '../game/zones';
import type { TelegraphTuple } from '../game/telegraph';
import type { RunPhase } from '../world/rooms';

export type GameState = 'ready' | 'playing' | 'paused' | 'over' | 'won';

export { ENEMY_KIND_LIST as SLIME_KIND_CODES } from '../game/enemyKinds';
export const POWER_CODES = ['multishot', 'rapid', 'pierce', 'shield', 'heart'] as const;
/** Pickup codes on the wire: the power-ups (0–4), then loot. Append only. */
export const PICKUP_CODES = [...POWER_CODES, 'gold', 'book', 'item_common', 'item_rare', 'item_epic', 'potion_health', 'potion_mana'] as const;

/** Any enemy: see EnemyTuple in game/enemies.ts. */
export type SlimeTuple = [number, number, number, number, number, number, number, number, number, number, number, number, number];
/** [poolIndex, x, z, yaw, pierce(0/1)] */
export type ArrowTuple = [number, number, number, number, number];
/** [poolIndex, x, z, projectile kind] */
export type GlobTuple = [number, number, number, number];
/** [id, power, x, z, visible(0/1)] */
export type PickupTuple = [number, number, number, number, number];

export interface HeroState {
  x: number;
  z: number;
  /** Facing yaw. */
  f: number;
  /** Ground speed. */
  s: number;
  /** Direction of travel yaw. */
  m: number;
  /** Aiming (0/1). */
  a: number;
  /** Dashing (0/1). */
  d: number;
  /** Visible (0 while blinking after a hit). */
  v: number;
  /** Invisible (Wind Walk): 1. */
  i?: number;
  /** Inside the iguana's Jade Ward: 1. */
  w?: number;
}

export interface FamState {
  /** Creature: index into FAMILIAR_KINDS. */
  k: number;
  x: number;
  z: number;
  /** Heading yaw. */
  h: number;
  s: number;
  /** Height above the floor (pouncing). */
  y: number;
}

/** One-off things that happened, so the tablet can play effects and sounds. */
export type GameEvent =
  | { e: 'splat'; x: number; z: number; c: number; big: boolean }
  | { e: 'hit'; x: number; z: number; c: number }
  | { e: 'spit' }
  | { e: 'twang' }
  | { e: 'glob'; x: number; z: number; k?: number }
  /** A familiar spell went off (id: index into SPELL_IDS). */
  | { e: 'spell'; id: number; x: number; z: number; h?: number; d?: number }
  | { e: 'bite' }
  | { e: 'land'; x: number; z: number }
  | { e: 'heal'; x: number; z: number }
  /** The familiar creature appeared / changed / left. */
  | { e: 'poof'; x: number; z: number }
  /** fam: the familiar grabbed it (at x, z); the elf's own burst comes as a second event. */
  | { e: 'pickup'; p: number; x: number; z: number; fam?: number }
  | { e: 'hurt' }
  /** A damage number: k 0 hit, 1 heavy hit, 2 the elf hurt. */
  | { e: 'num'; x: number; y: number; z: number; n: number; k: number }
  | { e: 'shield'; x: number; z: number }
  | { e: 'banner'; text: string }
  | { e: 'slam'; x: number; z: number; r: number }
  /** A coloured ring (an orc shaman healing its friends). */
  | { e: 'ring'; x: number; z: number; r: number; c: number }
  | { e: 'door' }
  /** A coloured burst of sparks (an elf spell). */
  | { e: 'burst'; x: number; z: number; c: number; n: number }
  /** Loot picked up: k 0 gold (n coins), 1 a spell book (t: what it taught), 2 gear or a potion (t: what). */
  | { e: 'loot'; k: number; x: number; z: number; n: number; t?: string }
  /** Sarcophagus prop `i` burst open (the dead rise). */
  | { e: 'ambush'; i: number; x: number; z: number }
  /** Something worth a note on the tablet too (a landmark seen). */
  | { e: 'note'; t: string }
  /** Chest `i` (in the level's list) was opened. */
  | { e: 'chest'; i: number }
  /** A Rune Seal answer: right (1) or wrong (0); done 1 when the seal breaks. */
  | { e: 'riddle'; ok: number; done?: number };

export interface Snapshot {
  /** Hero simulation time, seconds. */
  t: number;
  state: GameState;
  hero: HeroState;
  fam: FamState | null;
  slimes: SlimeTuple[];
  arrows: ArrowTuple[];
  globs: GlobTuple[];
  pickups: PickupTuple[];
  zones: ZoneTuple[];
  /** Room index (0-based), wave within the room, and where the run is (fighting / door open / walking through). */
  room: number;
  /** The level's seed: the familiar's tablet generates the same level from it. */
  lvl?: number;
  rw: number;
  phase: RunPhase;
  /** 1 in the practice room (code TEST). */
  practice?: number;
  /** Room whose intro card is up (-1: none). */
  card: number;
  /** Rune Seal on the exit door: the riddle to solve (a op b), the choices, solved so far / needed. */
  rid?: { a: number; op: string; b: number; c: number[]; n: number; t: number; /** wrong answers so far */ m?: number };
  /** The current boss or mini-boss, while it lives. */
  boss: { hp: number; max: number; name: string } | null;
  /** Warning rings for attacks about to land. */
  tels: TelegraphTuple[];
  wave: number;
  remaining: number;
  health: number;
  maxHealth: number;
  score: number;
  /** The party's gold. */
  gold?: number;
  /** Chests opened so far (bit i: chest i). */
  ch?: number;
  /** Sarcophagi that have burst open (prop indices). */
  amb?: number[];
  /** The party's gear and bag (sent when it changes). */
  inv?: InvState;
  /** The merchant's wares (while at the merchant's camp). */
  shop?: StockEntry[];
  /** [power, secondsLeft] */
  powers: [number, number][];
  /** Familiar spell cooldowns: [spell index, seconds left]. */
  cds: [number, number][];
  ev: GameEvent[];
}

/** Rounds to centimetres / centiradians to keep JSON short. */
export function q(v: number): number {
  return Math.round(v * 100) / 100;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}

/** Entities that jumped further than this between snapshots are snapped, not slid (pool reuse). */
const TELEPORT = 6;

/**
 * State between snapshots `a` and `b` at fraction `t` (0..1). Positions and angles blend;
 * entities are matched by id / pool index; ones present only in `b` appear as in `b`.
 * Events are not interpolated (the caller plays each snapshot's events once).
 */
export function interpolate(a: Snapshot, b: Snapshot, t: number): Snapshot {
  const k = Math.max(0, Math.min(1, t));
  const byId = <T extends number[]>(list: T[]) => new Map(list.map((e) => [e[0], e]));

  const prevSlimes = byId(a.slimes);
  const slimes = b.slimes.map((s) => {
    const p = prevSlimes.get(s[0]);
    if (!p) return s;
    return [s[0], s[1], lerp(p[2], s[2], k), lerp(p[3], s[3], k), lerpAngle(p[4], s[4], k), lerp(p[5], s[5], k), lerp(p[6], s[6], k), lerp(p[7], s[7], k), lerp(p[8], s[8], k), lerp(p[9], s[9], k), s[10], lerp(p[11], s[11], k), s[12]] as SlimeTuple;
  });

  const prevArrows = byId(a.arrows);
  const arrows = b.arrows.map((r) => {
    const p = prevArrows.get(r[0]);
    if (!p || Math.hypot(p[1] - r[1], p[2] - r[2]) > TELEPORT * 2) return r;
    return [r[0], lerp(p[1], r[1], k), lerp(p[2], r[2], k), r[3], r[4]] as ArrowTuple;
  });

  const prevGlobs = byId(a.globs);
  const globs = b.globs.map((g) => {
    const p = prevGlobs.get(g[0]);
    if (!p || Math.hypot(p[1] - g[1], p[2] - g[2]) > TELEPORT) return g;
    return [g[0], lerp(p[1], g[1], k), lerp(p[2], g[2], k), g[3]] as GlobTuple;
  });

  const hero: HeroState = {
    ...b.hero,
    x: lerp(a.hero.x, b.hero.x, k),
    z: lerp(a.hero.z, b.hero.z, k),
    f: lerpAngle(a.hero.f, b.hero.f, k),
    m: lerpAngle(a.hero.m, b.hero.m, k),
    s: lerp(a.hero.s, b.hero.s, k),
  };
  if (Math.hypot(a.hero.x - b.hero.x, a.hero.z - b.hero.z) > TELEPORT) {
    hero.x = b.hero.x;
    hero.z = b.hero.z;
  }

  let fam = b.fam;
  // Pounces cover up to 10 m, so allow a larger jump before treating it as a teleport.
  if (a.fam && b.fam && a.fam.k === b.fam.k && Math.hypot(a.fam.x - b.fam.x, a.fam.z - b.fam.z) <= TELEPORT * 2) {
    fam = {
      k: b.fam.k,
      x: lerp(a.fam.x, b.fam.x, k),
      z: lerp(a.fam.z, b.fam.z, k),
      h: lerpAngle(a.fam.h, b.fam.h, k),
      s: lerp(a.fam.s, b.fam.s, k),
      y: lerp(a.fam.y, b.fam.y, k),
    };
  }

  return { ...b, t: lerp(a.t, b.t, k), hero, fam, slimes, arrows, globs, ev: [] };
}

/**
 * Buffers incoming snapshots and answers "what should be on screen now", rendering a little
 * in the past (`delay`) so there's always a pair to blend between despite network jitter.
 */
/** Snapshots the clock-offset estimate looks back over (~1 s at 20 Hz). */
const OFFSET_WINDOW = 20;

export class SnapshotBuffer {
  private readonly items: Snapshot[] = [];
  /** (local clock − hero clock) at each item's arrival. */
  private readonly offsets: number[] = [];
  /**
   * Estimated (local clock − hero clock): the least-delayed arrival among the recent ones. Recent
   * only, so if the hero's clock falls behind (a stall on its side) the estimate catches up
   * instead of leaving us forever "ahead of the newest" — which shows as stepping, not gliding.
   */
  private offset: number | null = null;
  private readonly delay: number;

  constructor(delay = 0.1) {
    this.delay = delay;
  }

  get latest(): Snapshot | null {
    return this.items.at(-1) ?? null;
  }

  push(s: Snapshot, localTime: number): void {
    // A restarted hero clock (new run / reconnect) resets the buffer.
    const last = this.items.at(-1);
    if (last && s.t < last.t - 1) {
      this.items.length = 0;
      this.offsets.length = 0;
    }
    this.items.push(s);
    this.offsets.push(localTime - s.t);
    if (this.items.length > 40) {
      this.items.shift();
      this.offsets.shift();
    }
    this.offset = Math.min(...this.offsets.slice(-OFFSET_WINDOW));
  }

  /** The interpolated snapshot to show at local time `now`, or null before anything arrived. */
  sample(now: number): Snapshot | null {
    if (!this.items.length || this.offset === null) return null;
    const target = now - this.offset - this.delay;
    const items = this.items;
    if (target <= items[0].t) return items[0];
    for (let i = items.length - 1; i > 0; i--) {
      const a = items[i - 1];
      const b = items[i];
      if (a.t <= target && target <= b.t) return interpolate(a, b, (target - a.t) / (b.t - a.t || 1));
    }
    return items[items.length - 1]; // ahead of the newest: hold the latest
  }
}
