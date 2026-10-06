import type { LevelTheme } from './levelgen';

/** The levels of the dungeon run, as data: each is generated afresh every run from its theme (levelgen.ts). */

export type RoomFeature = 'woodland' | 'brazier' | 'puddles' | 'lava' | 'crystals' | 'throne' | 'dragonlair';

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

export interface RoomDef extends LevelTheme {
  name: string;
  feature: RoomFeature;
  /** Outdoors: hedges and woods instead of brick and torches, daylight and open sky. */
  outdoor?: boolean;
  /** Height of the level's walls (m). */
  wallHeight: number;
  /** Who lives here, for the level's intro card (with their illustration, public/art/<art>.jpg). */
  group: string;
  art: string;
  /** A painted scene of the level (public/art/<scene>.jpg), shown instead of the group sheet when there is one. */
  scene?: string;
  torchLight: number;
  torchFlame: number;
  floor: Hsl;
  wall: Hsl;
  stone: number;
  fog: number;
  moon: number;
  moonIntensity: number;
  hemiSky: number;
  hemiGround: number;
  /** The last level has no exit door: beat the boss to win. */
  hasExit: boolean;
}

export const ROOMS: RoomDef[] = [
  {
    name: 'The Woodland',
    group: 'Forest beasts and living plants',
    art: 'beasts',
    scene: 'scene-woodland',
    feature: 'woodland',
    outdoor: true,
    torchLight: 0xffe7b0,
    torchFlame: 0xfff3c0,
    floor: { h: 0.27, s: 0.42, l: 0.3 },
    wall: { h: 0.3, s: 0.45, l: 0.22 },
    stone: 0x6b4a2b,
    fog: 0x9fcbe0,
    moon: 0xfff1d6,
    moonIntensity: 2.4,
    hemiSky: 0xbfe3ff,
    hemiGround: 0x3a5a2a,
    hasExit: true,
    layout: 'open',
    shapes: ['circle'],
    wallHeight: 4,
    pool: { beetle: 14, snake: 4, vine: 3, direwolf: 2, boar: 1, treant: 1 },
    boss: 'bear',
    escort: { beetle: 3 },
    foes: 34,
  },
  {
    name: 'The Crystal Cave',
    group: 'Underworld dwellers',
    art: 'underworld',
    scene: 'scene-crystal-cave',
    feature: 'crystals',
    torchLight: 0xb070ff,
    torchFlame: 0xd0a0ff,
    floor: { h: 0.76, s: 0.1, l: 0.28 },
    wall: { h: 0.78, s: 0.12, l: 0.24 },
    stone: 0x6a6180,
    fog: 0x1d1924,
    moon: 0xc0a0ff,
    moonIntensity: 1.74,
    hemiSky: 0x8f83b3,
    hemiGround: 0x100a1a,
    hasExit: true,
    layout: 'halls',
    shapes: ['octagon', 'circle'],
    wallHeight: 5,
    pool: { spider: 12, ooze: 5, sporecrawler: 4, mushroom: 2, mold: 1 },
    boss: 'caveworm',
    escort: { spider: 3 },
    foes: 38,
  },
  {
    name: 'The Crypt',
    group: 'The undead',
    art: 'undead',
    scene: 'scene-crypt',
    feature: 'brazier',
    torchLight: 0xff8a3d,
    torchFlame: 0xff9a40,
    floor: { h: 0.07, s: 0.1, l: 0.31 },
    wall: { h: 0.74, s: 0.08, l: 0.27 },
    stone: 0x69636f,
    fog: 0x1a191d,
    moon: 0x9fb0ff,
    moonIntensity: 1.92,
    hemiSky: 0x83839f,
    hemiGround: 0x1a1010,
    hasExit: true,
    layout: 'halls',
    shapes: ['square', 'octagon'],
    wallHeight: 5,
    pool: { skeleton: 14, skelarcher: 4, ghost: 4, zombie: 2, knight: 1 },
    boss: 'necromancer',
    escort: { skeleton: 2, skelarcher: 1 },
    foes: 42,
  },
  {
    name: 'The Throne Room',
    group: 'Orcs',
    art: 'orcs',
    scene: 'scene-throne-room',
    feature: 'throne',
    torchLight: 0xffc060,
    torchFlame: 0xffd080,
    floor: { h: 0.08, s: 0.12, l: 0.33 },
    wall: { h: 0.06, s: 0.1, l: 0.26 },
    stone: 0x726560,
    fog: 0x1d1919,
    moon: 0xffd0a0,
    moonIntensity: 1.92,
    hemiSky: 0x9f876f,
    hemiGround: 0x1a0c08,
    hasExit: true,
    // The throne stands against the west wall (the north wall has the exit door).
    layout: 'halls',
    shapes: ['square'],
    wallHeight: 5.5,
    pool: { orcwarrior: 8, orcscout: 7, orcarcher: 4, shaman: 2, shieldguard: 1 },
    boss: 'chieftain',
    escort: { orcwarrior: 2, orcarcher: 1 },
    foes: 44,
  },
  {
    name: 'The Flooded Hall',
    group: 'Goblins and water elementals',
    art: 'goblins',
    scene: 'scene-flooded-hall',
    feature: 'puddles',
    torchLight: 0x5fc8ff,
    torchFlame: 0x9fe4ff,
    floor: { h: 0.58, s: 0.12, l: 0.29 },
    wall: { h: 0.6, s: 0.1, l: 0.25 },
    stone: 0x5a6976,
    fog: 0x191d23,
    moon: 0x9fc8ff,
    moonIntensity: 2.1,
    hemiSky: 0x778fa7,
    hemiGround: 0x0a1016,
    hasExit: true,
    layout: 'open',
    shapes: ['octagon', 'square'],
    wallHeight: 5,
    pool: { brawler: 14, riveter: 5, rotor: 4, lobber: 2, tinkerer: 2, water: 2 },
    boss: 'scrapboss',
    escort: { brawler: 2, riveter: 1, water: 1 },
    foes: 54,
  },
  {
    name: 'The Lava Chamber',
    group: 'Fire, wind and stone elementals',
    art: 'elementals',
    scene: 'scene-lava-chamber',
    feature: 'lava',
    torchLight: 0xff5a20,
    torchFlame: 0xff7a30,
    floor: { h: 0.02, s: 0.18, l: 0.25 },
    wall: { h: 0.03, s: 0.2, l: 0.22 },
    stone: 0x65514f,
    fog: 0x241918,
    moon: 0xff9a70,
    moonIntensity: 1.2,
    hemiSky: 0x9b6b5f,
    hemiGround: 0x1a0805,
    hasExit: true,
    layout: 'halls',
    shapes: ['circle', 'octagon'],
    wallHeight: 5.5,
    pool: { fire: 9, wind: 8, golem: 2 },
    boss: 'inferno',
    escort: { fire: 2, wind: 1 },
    foes: 40,
  },
  {
    name: "The Ash King's Lair",
    group: 'The Ash King',
    art: 'elementals',
    scene: 'scene-ash-king',
    feature: 'dragonlair',
    torchLight: 0xff4a10,
    torchFlame: 0xff6a20,
    floor: { h: 0.0, s: 0.15, l: 0.2 },
    wall: { h: 0.0, s: 0.22, l: 0.17 },
    stone: 0x4a3634,
    fog: 0x1c1010,
    moon: 0xff7a50,
    moonIntensity: 1.3,
    hemiSky: 0x8b4b3f,
    hemiGround: 0x1a0503,
    hasExit: false, // the final room: the Ash King waits here
    layout: 'lair',
    shapes: ['circle'],
    wallHeight: 8,
    pool: {},
    boss: 'ashking',
    escort: {},
    foes: 0,
  },
];


/** ready: in the first level, waiting for the hero to start · fight · cleared (exit open) · shop (the merchant, between levels) · transition (walking through). */
export type RunPhase = 'ready' | 'fight' | 'cleared' | 'shop' | 'transition';

/** Top-of-screen label for where the run is. `foes`: monsters still alive in the level. */
export function runLabel(room: number, foes: number, phase: RunPhase, bossName: string | null): string {
  const name = ROOMS[room]?.name ?? '';
  if (phase === 'cleared') return `${name} cleared — the exit door is open ↑`;
  if (phase === 'transition') return 'Onward…';
  if (phase === 'shop') return '🛒 The merchant’s camp';
  if (phase === 'ready') return `${name} · ready when you are`;
  if (bossName) return `${name} · ${bossName}`;
  const guard = ROOMS[room]?.hasExit ? 'its guardian waits by the exit, to the north' : 'the Ash King waits to the north';
  return `${name} · ${foes} ${foes === 1 ? 'foe' : 'foes'} about · ${guard}`;
}
