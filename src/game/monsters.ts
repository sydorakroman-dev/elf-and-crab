import * as THREE from 'three';
import { BOSS_DEATH_SECONDS, DEATH_SECONDS } from './reactions';
import { scaledHp } from './difficulty';
import { clampToArena, insideArena, pushOutOfCircles, rangeIntent, type Circle } from './combat';
import { steerMove } from './steer';
import type { BeastPose } from './beastVisual';
import { MonsterVisual } from './monsterVisual';
import { ElementalVisual } from './elementalVisual';
import { DragonVisual } from './dragonVisual';
import type { Enemy, EnemyKind, EnemyTuple, MonsterKind, Spit, Strike, Summon, Telegraph } from './enemies';
import { PROJECTILES, type ProjectileKind } from './globs';
import { ENEMY_KIND_LIST } from './enemyKinds';
import { q } from '../net/snapshot';

/**
 * The dungeon's monsters (goblins, undead, orcs, underworld dwellers) and the final boss, as data:
 * stats plus a list of attacks built from a few shared moves. HP and damage are on the hero's
 * 100 HP scale; each room's group is tougher than the last.
 */
/** Any attack can come as a chain: `repeat` more times straight after, each with a short `repeatWindup`. */
interface Chain {
  repeat?: number;
  repeatWindup?: number;
}

export type Attack = (
  /** A swing / punch / slam just in front, after a wind-up. */
  | { type: 'melee'; range: number; windup: number; reach: number; radius: number; damage: number; knock: number; cooldown: number }
  /**
   * Bolts (several in a fan with `count`). Damage per projectile kind is in balance.ts.
   * `ring`: all round instead of a fan (turning a little each time when chained: a spiral);
   * `lead`: aimed where the hero is heading; `speed`: projectile speed ×.
   */
  | { type: 'shoot'; range: number; windup: number; cooldown: number; shot: ProjectileKind; count?: number; spread?: number; ring?: boolean; lead?: boolean; speed?: number }
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
  /** Sinks into the ground (can't be hit), then bursts up under the hero after a warning ring (spraying `spray` all round). */
  | { type: 'burrow'; range: number; cooldown: number; windup: number; radius: number; damage: number; knock: number; spray?: { shot: ProjectileKind; count: number; speed?: number } }
  /** When the hero comes within `range`: vanishes and reappears `distance` away, firing a ring of `shot`. */
  | { type: 'blink'; range: number; windup: number; distance: number; cooldown: number; shot?: ProjectileKind; count?: number; speed?: number }
) &
  Chain;

/** At `at` of its health a boss roars (a shockwave that throws the hero back) and fights harder from then on. */
export interface Enrage {
  at: number;
  /** Move speed ×, and attack cooldowns ×. */
  speed: number;
  cooldown: number;
  /** New attacks it gains (tried before the old ones). */
  attacks: Attack[];
}

/** The roar at the start of a boss's second phase. */
const ROAR: Attack = { type: 'area', at: 'self', range: 99, windup: 0.9, radius: 6, damage: 8, knock: 30, cooldown: 0 };

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
  /** A second phase (bosses). */
  enrage?: Enrage;
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
    name: 'The Giant Cave Worm', tier: 'mini-boss', style: 'melee', hp: 420, speed: 2.6, radius: 1.6, touch: 12, push: 0.8, score: 300, drop: 0, bossName: 'The Giant Cave Worm',
    attacks: [
      // Burrows and bursts up under the hero, spraying acid all round.
      { type: 'burrow', range: LONG, cooldown: 8, windup: 1.3, radius: 3, damage: 18, knock: 16, spray: { shot: 'acid', count: 10, speed: 1.3 } },
      { type: 'shoot', range: 27, windup: 0.7, cooldown: 4, shot: 'acid', count: 5, spread: 0.2, lead: true, speed: 1.5 },
      { type: 'melee', range: 3, windup: 0.6, reach: 1.4, radius: 2.2, damage: 18, knock: 18, cooldown: 2 },
    ],
    summonAt: { at: [0.5], kind: 'spider', count: 3 },
    // Phase two: burrows twice in a row, and spits acid in spinning rings.
    enrage: {
      at: 0.5, speed: 1.25, cooldown: 0.7,
      attacks: [
        { type: 'burrow', range: LONG, cooldown: 11, windup: 1.1, radius: 3, damage: 18, knock: 16, spray: { shot: 'acid', count: 12, speed: 1.4 }, repeat: 1 },
        { type: 'shoot', range: 22, windup: 0.6, cooldown: 7, shot: 'acid', count: 12, ring: true, speed: 1.3, repeat: 2, repeatWindup: 0.35 },
      ],
    },
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
    name: 'The Necromancer', tier: 'mini-boss', style: 'ranged', hp: 575, speed: 4.4, radius: 1.1, touch: 15, push: 1, score: 400, drop: 0, bossName: 'The Necromancer',
    keepAway: [10.5, 18],
    attacks: [
      // Get too close and he vanishes, reappearing across the hall in a burst of souls.
      { type: 'blink', range: 6, windup: 0.45, distance: 13, cooldown: 5, shot: 'soul', count: 8, speed: 1.3 },
      // Two quick fans of souls, aimed where you're going.
      { type: 'shoot', range: 27, windup: 0.6, cooldown: 3.2, shot: 'soul', count: 5, spread: 0.22, lead: true, speed: 1.6, repeat: 1, repeatWindup: 0.3 },
      { type: 'area', at: 'target', range: 24, windup: 1.0, radius: 2.4, damage: 20, knock: 10, cooldown: 5.5 },
    ],
    summonEvery: { every: 10, kind: 'skeleton', count: 2, max: 6 },
    // Phase two: a spiral of souls, and curses three at a time.
    enrage: {
      at: 0.5, speed: 1.2, cooldown: 0.75,
      attacks: [
        { type: 'shoot', range: 27, windup: 0.7, cooldown: 8, shot: 'soul', count: 10, ring: true, speed: 1.3, repeat: 4, repeatWindup: 0.22 },
        { type: 'area', at: 'target', range: 24, windup: 0.9, radius: 2.4, damage: 18, knock: 10, cooldown: 9, repeat: 2, repeatWindup: 0.5 },
      ],
    },
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
    name: 'The Orc Chieftain', tier: 'mini-boss', style: 'melee', hp: 745, speed: 4.6, radius: 1.5, touch: 18, push: 0.8, score: 500, drop: 0, bossName: 'The Orc Chieftain',
    attacks: [
      { type: 'area', at: 'self', range: 5, windup: 1.0, radius: 4.8, damage: 30, knock: 20, cooldown: 7 },
      { type: 'lunge', range: 16, minRange: 6, windup: 0.7, speed: 20, time: 0.8, damage: 30, knock: 24, cooldown: 7 },
      { type: 'melee', range: 3.2, windup: 0.6, reach: 1.5, radius: 2.2, damage: 28, knock: 26, cooldown: 1.8 },
      // Throwing axes, three at a time, aimed where you're heading.
      { type: 'shoot', range: 20, windup: 0.5, cooldown: 4, shot: 'rivet', count: 3, spread: 0.2, lead: true, speed: 1.4 },
    ],
    summonAt: { at: [0.5], kind: 'orcwarrior', count: 3 },
    // Phase two: charges three times in a row, and axes come in volleys.
    enrage: {
      at: 0.5, speed: 1.2, cooldown: 0.75,
      attacks: [
        { type: 'lunge', range: 20, minRange: 5, windup: 0.6, speed: 22, time: 0.8, damage: 28, knock: 24, cooldown: 10, repeat: 2, repeatWindup: 0.4 },
        { type: 'shoot', range: 20, windup: 0.4, cooldown: 5, shot: 'rivet', count: 3, spread: 0.25, lead: true, speed: 1.5, repeat: 2, repeatWindup: 0.25 },
      ],
    },
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
    name: 'The Scrap Boss', tier: 'mini-boss', style: 'melee', hp: 950, speed: 4.0, radius: 1.5, touch: 20, push: 0.5, score: 700, drop: 0, bossName: 'The Scrap Boss',
    attacks: [
      { type: 'area', at: 'self', range: 6, windup: 0.9, radius: 5, damage: 32, knock: 22, cooldown: 5.5 },
      { type: 'melee', range: 3, windup: 0.5, reach: 1.4, radius: 2.2, damage: 32, knock: 28, cooldown: 1.8 },
      // A rivet-gun burst.
      { type: 'shoot', range: 24, windup: 0.5, cooldown: 5, shot: 'rivet', lead: true, speed: 1.5, repeat: 5, repeatWindup: 0.12 },
      // A string of bombs that follows you.
      { type: 'area', at: 'target', range: 24, minRange: 6, windup: 0.8, radius: 2.6, damage: 22, knock: 16, cooldown: 6, repeat: 2, repeatWindup: 0.45 },
    ],
    summonAt: { at: [0.66, 0.33], kind: 'brawler', count: 4 },
    // Phase two: rings of rivets.
    enrage: {
      at: 0.5, speed: 1.25, cooldown: 0.7,
      attacks: [{ type: 'shoot', range: 14, windup: 0.6, cooldown: 7, shot: 'rivet', count: 14, ring: true, speed: 1.3, repeat: 2, repeatWindup: 0.3 }],
    },
  },

  // ── The Lava Chamber's boss ──
  inferno: {
    name: 'The Inferno', tier: 'boss', style: 'ranged', hp: 1380, speed: 3.6, radius: 2.0, touch: 20, push: 0.4, score: 1000, drop: 0, bossName: 'The Inferno',
    keepAway: [9, 18],
    attacks: [
      { type: 'area', at: 'self', range: 7, windup: 1.0, radius: 5.5, damage: 30, knock: 22, cooldown: 7, zone: 'fire' },
      { type: 'shoot', range: 30, windup: 0.6, cooldown: 3, shot: 'fire', count: 5, spread: 0.2, lead: true, speed: 1.5, repeat: 1, repeatWindup: 0.35 },
      { type: 'area', at: 'target', range: 30, windup: 0.9, radius: 2.5, damage: 22, knock: 12, cooldown: 5, zone: 'fire', repeat: 2, repeatWindup: 0.5 },
    ],
    summonAt: { at: [2 / 3, 1 / 3], kind: 'fire', count: 2 },
    // Phase two: a spiral of fire.
    enrage: {
      at: 0.5, speed: 1.2, cooldown: 0.75,
      attacks: [{ type: 'shoot', range: 30, windup: 0.7, cooldown: 9, shot: 'fire', count: 12, ring: true, speed: 1.2, repeat: 5, repeatWindup: 0.2 }],
    },
  },

  // ── The final boss (the Ash King's Lair): a volcanic dragon ──
  ashking: {
    name: 'The Ash King', tier: 'boss', style: 'melee', hp: 2600, speed: 4.0, radius: 2.6, touch: 22, push: 0.25, score: 2500, drop: 0, bossName: 'The Ash King',
    attacks: [
      // Wing slam: everything around him, with a warning ring; leaves fire behind.
      { type: 'area', at: 'self', range: 7, windup: 1.1, radius: 6.5, damage: 30, knock: 28, cooldown: 7, zone: 'fire' },
      // Swoop: a long rush across the lair.
      { type: 'lunge', range: 24, minRange: 9, windup: 0.9, speed: 24, time: 0.9, damage: 34, knock: 30, cooldown: 9 },
      // Fire breath: two wide fans of fast fireballs.
      { type: 'shoot', range: 28, windup: 0.8, cooldown: 3.4, shot: 'fire', count: 9, spread: 0.1, speed: 1.6, repeat: 1, repeatWindup: 0.4 },
      // Falling ash: meteors that follow you, leaving burning ground.
      { type: 'area', at: 'target', range: 28, windup: 0.9, radius: 2.8, damage: 24, knock: 12, cooldown: 6, zone: 'fire', repeat: 3, repeatWindup: 0.4 },
      // Bite.
      { type: 'melee', range: 3.6, windup: 0.55, reach: 1.8, radius: 2.6, damage: 30, knock: 26, cooldown: 2 },
    ],
    summonAt: { at: [2 / 3, 1 / 3], kind: 'fire', count: 3 },
    // Phase two: three swoops in a row, and rings of fire.
    enrage: {
      at: 0.5, speed: 1.25, cooldown: 0.75,
      attacks: [
        { type: 'lunge', range: 26, minRange: 8, windup: 0.8, speed: 26, time: 0.9, damage: 32, knock: 30, cooldown: 11, repeat: 2, repeatWindup: 0.45 },
        { type: 'shoot', range: 28, windup: 0.8, cooldown: 8, shot: 'fire', count: 16, ring: true, speed: 1.3, repeat: 3, repeatWindup: 0.3 },
      ],
    },
  },
};

/** Splat / hit colour for each kind. */
const COLORS: Record<MonsterKind, number> = {
  brawler: 0x9cb03a, rotor: 0x9cb03a, riveter: 0x9cb03a, lobber: 0x9cb03a, tinkerer: 0x9cb03a, scrapboss: 0x9a6a3a,
  skeleton: 0xe0d6b8, skelarcher: 0xe0d6b8, ghost: 0x8fe0c0, zombie: 0x8a9a6a, knight: 0xe0d6b8, necromancer: 0x2f8a8a,
  orcscout: 0x7a9a3a, orcwarrior: 0x7a9a3a, orcarcher: 0x7a9a3a, shaman: 0x9a50c0, shieldguard: 0x7a9a3a, chieftain: 0x7a9a3a,
  spider: 0x6a5a9a, ooze: 0x9bd03a, sporecrawler: 0x9a7a3a, mushroom: 0xc04a40, mold: 0xa090c0, caveworm: 0x6a5a8a,
  inferno: 0xff7a2a,
  ashking: 0xd23a2c,
};

/** The Inferno is a giant fire elemental. */
const INFERNO_HEIGHT = 5;

export interface MonsterLook {
  readonly group: THREE.Group;
  apply(p: BeastPose, dt: number, time: number): void;
}

/** The right visual for a monster kind (shared with the familiar's view). */
export function createMonsterVisual(kind: MonsterKind): MonsterLook {
  if (kind === 'ashking') return new DragonVisual();
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
  /** Drenched (the goldfish's Water Jet): slowed to `soakFactor` for a while. */
  private soakTimer = 0;
  private soakFactor = 1;
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
  /** Its attacks (a boss's second phase adds some, in front). */
  private attacks: Attack[];
  private current: Attack | null = null;
  /** Second phase: the roar is still to come / has come; and how much faster it is since. */
  private roarPending = false;
  enraged = false;
  private speedMul = 1;
  private cooldownMul = 1;
  /** A chained attack: how many more times it goes, and this wind-up's length. */
  private repeatsLeft = 0;
  private windupLen = 1;
  /** Rings turn a little with each one in a chain (a spiral). */
  private spin = 0;
  /** The hero's last position and smoothed velocity (for leading shots). */
  private readonly lastTarget = new THREE.Vector2(NaN, NaN);
  private readonly targetVel = new THREE.Vector2();
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
    this.maxHp = this.hp = scaledHp(this.def.hp); // per difficulty
    this.bossName = this.def.bossName ?? null;
    this.attacks = [...this.def.attacks];
    this.cooldowns = this.attacks.map(() => 0);
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
    const en = this.def.enrage;
    if (en && !this.enraged && !this.roarPending && this.hp / this.maxHp <= en.at) this.roarPending = true;
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

  /** Shoved about `metres` along (dirX, dirZ) (heavier foes go less far). */
  shove(dirX: number, dirZ: number, metres: number): void {
    if (this.dying || this.hidden) return;
    const v = metres * 8 * Math.min(1, this.def.push / 6); // knockback decays at 8/s: it travels ≈ v / 8
    this.knock.set(dirX * v, dirZ * v);
  }

  soak(seconds: number, factor: number): void {
    if (this.dying) return;
    this.soakTimer = Math.max(this.soakTimer, seconds);
    this.soakFactor = factor;
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

  update(dt: number, target: THREE.Vector3, others: readonly Enemy[], obstacles: readonly Circle[]): Spit[] {
    this.time += dt;
    this.strike = null;
    this.healPulse = null;
    if (dt > 0 && !Number.isNaN(this.lastTarget.x)) {
      const k = Math.min(1, dt * 6);
      this.targetVel.x += ((target.x - this.lastTarget.x) / dt - this.targetVel.x) * k;
      this.targetVel.y += ((target.z - this.lastTarget.y) / dt - this.targetVel.y) * k;
      if (this.targetVel.length() > 12) this.targetVel.setLength(12); // a dash or a teleport isn't a heading
    }
    this.lastTarget.set(target.x, target.z);
    this.flash = Math.max(0, this.flash - dt * 5);
    const p = this.pose;
    p.flash = this.flash;

    if (this.dying) {
      this.deathTimer += dt;
      p.death = Math.min(1, this.deathTimer / (this.bossName ? BOSS_DEATH_SECONDS : DEATH_SECONDS));
      p.speed = 0;
      p.y = Math.min(0, p.y + dt * 8);
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
      speed = this.def.speed * this.speedMul * 0.45 * this.slow;
      this.move(Math.sin(dir), Math.cos(dir), speed, dt, others, walls);
    } else {
      [speed, spits] = this.think(dt, target, others, walls);
    }

    if (!this.def.phasing) pushOutOfCircles(p, this.radius, obstacles);
    clampToArena(p, this.radius);
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
      case 'blink':
        return dist <= a.range;
    }
  }

  /** Starts attack `atk` (its wind-up, or the worm's dive). */
  private begin(atk: Attack, windup: number, target: THREE.Vector3, tx: number, tz: number): void {
    const p = this.pose;
    this.current = atk;
    p.yaw = Math.atan2(tx, tz);
    if (atk.type === 'burrow') {
      this.setMode('sink', 0.6);
      return;
    }
    if (atk.type === 'area') this.telegraph = atk.at === 'self' ? { x: p.x, z: p.z, r: atk.radius, p: 0 } : { x: target.x, z: target.z, r: atk.radius, p: 0 };
    if (atk.type === 'blink') this.telegraph = { x: p.x, z: p.z, r: this.radius + 1, p: 0 };
    if (atk.type === 'lunge') this.lockDir = { x: tx, z: tz };
    this.windupLen = Math.max(0.05, windup);
    this.setMode('windup', this.windupLen);
  }

  /** After an attack: the next one in its chain, if any (else back to the chase). */
  private chainOrChase(target: THREE.Vector3, tx: number, tz: number): void {
    const a = this.current;
    if (a && this.repeatsLeft > 0) {
      this.repeatsLeft--;
      this.begin(a, a.repeatWindup ?? 0.3, target, tx, tz);
      return;
    }
    this.pose.act = 0;
    this.setMode('chase', 0);
  }

  /** Projectiles in a ring round (x, z), `count` of them, turned by `turn`. */
  private ring(x: number, z: number, count: number, shot: ProjectileKind, speed: number | undefined, turn: number): Spit[] {
    const out: Spit[] = [];
    for (let i = 0; i < count; i++) {
      const ang = turn + (i / count) * Math.PI * 2;
      const dx = Math.sin(ang);
      const dz = Math.cos(ang);
      out.push({ x: x + dx * (this.radius + 0.4), z: z + dz * (this.radius + 0.4), dirX: dx, dirZ: dz, kind: shot, speed });
    }
    return out;
  }

  /** Where to reappear after a blink: about `distance` from the hero, inside the level, away from rocks. */
  private blinkSpot(target: THREE.Vector3, distance: number, obstacles: readonly Circle[]): { x: number; z: number } | null {
    const p = this.pose;
    const away = Math.atan2(p.x - target.x, p.z - target.z);
    for (let i = 0; i < 16; i++) {
      const ang = away + (Math.random() - 0.5) * Math.PI * (0.6 + i * 0.1);
      const d = distance * (0.8 + Math.random() * 0.4);
      const x = target.x + Math.sin(ang) * d;
      const z = target.z + Math.cos(ang) * d;
      if (!insideArena(x, z, this.radius + 0.5)) continue;
      if (obstacles.some((o) => !o.low && Math.hypot(o.x - x, o.z - z) < o.radius + this.radius + 0.3)) continue;
      return { x, z };
    }
    return null;
  }

  private think(dt: number, target: THREE.Vector3, others: readonly Enemy[], obstacles: readonly Circle[]): [number, Spit[]] {
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
        p.act = 1 - Math.max(0, this.timer) / this.windupLen;
        if (a!.type === 'lunge') face(this.lockDir.x, this.lockDir.z);
        else face(tx, tz);
        if (this.telegraph) this.telegraph.p = p.act;
        if (this.timer <= 0) return [0, this.release(target, tx, tz, dist, obstacles)];
        return [0, []];
      }
      case 'attack': {
        // Dashing (lunge / charge).
        const l = a as Extract<Attack, { type: 'lunge' }>;
        const before = { x: p.x, z: p.z };
        p.x += this.lockDir.x * l.speed * dt;
        p.z += this.lockDir.z * l.speed * dt;
        const hitWall = clampToArena(p, this.radius);
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
          if (b.spray) return [0, this.ring(t.x, t.z, b.spray.count, b.spray.shot, b.spray.speed, Math.random() * Math.PI)];
        }
        return [0, []];
      }
      case 'rise': {
        p.y = -Math.max(0, this.timer) / 0.6 * 5;
        face(tx, tz);
        if (this.timer <= 0) {
          p.y = 0;
          this.chainOrChase(target, tx, tz);
        }
        return [0, []];
      }
      case 'recover': {
        if (this.timer <= 0) this.chainOrChase(target, tx, tz);
        return [0, []];
      }
      case 'retreat': {
        const speed = this.def.speed * this.speedMul * 1.1 * this.slow;
        this.move(-tx + this.side * tz * 0.6, -tz - this.side * tx * 0.6, speed, dt, others, obstacles);
        face(-tx, -tz);
        if (this.timer <= 0) this.setMode('chase', 0);
        return [speed, []];
      }
      case 'chase':
        break;
    }

    p.act = 0;
    // The second phase begins with a roar that throws the hero back.
    if (this.roarPending) {
      this.roarPending = false;
      this.enraged = true;
      const en = this.def.enrage!;
      this.speedMul = en.speed;
      this.cooldownMul = en.cooldown;
      this.attacks = [...en.attacks, ...this.attacks];
      this.cooldowns.unshift(...en.attacks.map(() => 2.5)); // the new moves come a moment after the roar
      this.repeatsLeft = 0;
      this.begin(ROAR, ROAR.windup, target, tx, tz);
      return [0, []];
    }
    // Pick the first attack that's ready.
    if (this.gap === 0) {
      for (let i = 0; i < this.attacks.length; i++) {
        const atk = this.attacks[i];
        if (this.cooldowns[i] > 0 || !this.ready(atk, dist)) continue;
        this.cooldowns[i] = atk.cooldown * this.cooldownMul;
        this.repeatsLeft = atk.repeat ?? 0;
        this.begin(atk, atk.windup, target, tx, tz);
        return [0, []];
      }
    }

    // Close in (melee) or hold a distance band and circle (ranged).
    const speed = this.def.speed * this.speedMul * this.slow;
    face(tx, tz);
    if (this.def.keepAway) {
      const [min, max] = this.def.keepAway;
      const intent = rangeIntent(dist, min, max);
      const mx = intent === 0 ? tz * this.side : tx * intent + tz * this.side * 0.3;
      const mz = intent === 0 ? -tx * this.side : tz * intent - tx * this.side * 0.3;
      const s = intent === 0 ? speed * 0.5 : speed;
      this.move(mx, mz, s, dt, others, obstacles);
      return [s, []];
    }
    this.move(tx, tz, speed, dt, others, obstacles);
    return [speed, []];
  }

  /** The wind-up is over: the attack lands, the bolts fly, or the dash starts. */
  private release(target: THREE.Vector3, tx: number, tz: number, dist: number, obstacles: readonly Circle[]): Spit[] {
    const p = this.pose;
    const a = this.current!;
    p.act = 1;
    this.gap = GAP;
    if (this.repeatsLeft > 0) this.gap = 0; // a chain goes straight on
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
        this.setMode('recover', this.repeatsLeft > 0 ? 0.05 : 0.3);
        const n = a.count ?? 1;
        if (a.ring) {
          this.spin += 0.35;
          return this.ring(p.x, p.z, n, a.shot, a.speed, this.spin);
        }
        let base = Math.atan2(tx, tz);
        if (a.lead) {
          // Aim where the hero will be when the shot gets there.
          const flight = dist / (PROJECTILES[a.shot].speed * (a.speed ?? 1));
          base = Math.atan2(target.x + this.targetVel.x * flight - p.x, target.z + this.targetVel.y * flight - p.z);
        }
        const out = this.radius + 0.4;
        const spits: Spit[] = [];
        for (let i = 0; i < n; i++) {
          const ang = base + (i - (n - 1) / 2) * (a.spread ?? 0);
          const dx = Math.sin(ang);
          const dz = Math.cos(ang);
          spits.push({ x: p.x + dx * out, z: p.z + dz * out, dirX: dx, dirZ: dz, kind: a.shot, speed: a.speed });
        }
        return spits;
      }
      case 'blink': {
        this.telegraph = null;
        this.setMode('recover', 0.35);
        const spot = this.blinkSpot(target, a.distance, obstacles);
        if (!spot) return [];
        p.x = spot.x;
        p.z = spot.z;
        p.yaw = Math.atan2(target.x - p.x, target.z - p.z);
        return a.shot ? this.ring(p.x, p.z, a.count ?? 8, a.shot, a.speed, Math.random() * Math.PI) : [];
      }
      case 'burrow':
        return [];
    }
  }

  private move(dx: number, dz: number, speed: number, dt: number, others: readonly Enemy[], obstacles: readonly Circle[]): void {
    steerMove(this.pose, dx, dz, speed, dt, this.radius, this, others, obstacles, this.side);
  }
}
