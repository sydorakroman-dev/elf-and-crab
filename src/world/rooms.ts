import type { RoomWave } from '../game/enemies';
import type { ArenaShape } from '../game/combat';

/** The rooms of the dungeon run, as data. The Dungeon builds whichever one is current. */

export type RoomFeature = 'woodland' | 'brazier' | 'puddles' | 'lava' | 'crystals' | 'throne' | 'dragonlair';

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

export interface RoomDef {
  name: string;
  /** Floor plan: square, circle or octagon. */
  shape: ArenaShape;
  /** Centre to the middle of each wall, m (the gates sit at ±half). Integer (tiles are 2 m). */
  half: number;
  /** Pillar positions; every pillar blocks movement and arrows. */
  pillars: [number, number][];
  feature: RoomFeature;
  /** Crystal clusters (crystal cave): positions; they block like pillars. */
  crystals?: [number, number][];
  /** Obsidian spires (dragon's lair): positions; they block like pillars. */
  spires?: [number, number][];
  /** Lava pools (dragon's lair): positions; walking is blocked, arrows fly over. */
  pools?: [number, number][];
  /** Trees (woodland): positions; they block like pillars. */
  trees?: [number, number][];
  /** Outdoors: hedge walls with wooden gates, daylight and open sky instead of brick and torches. */
  outdoor?: boolean;
  /** The room's waves (usually three); the last one brings its boss. */
  waves: RoomWave[];
  /** Who lives here, for the room's intro card (with their illustration, public/art/<art>.jpg). */
  group: string;
  art: string;
  /** A painted scene of the room (public/art/<scene>.jpg), shown instead of the group sheet when there is one. */
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
  /** The last room has no exit door: beat the boss to win. */
  hasExit: boolean;
  /** No gate in the west wall (the throne stands there). */
  solidWest?: boolean;
}

export const ROOMS: RoomDef[] = [
  {
    name: 'The Woodland',
    shape: 'circle',
    group: 'Forest beasts and living plants',
    art: 'beasts',
    scene: 'scene-woodland',
    half: 24,
    pillars: [],
    feature: 'woodland',
    trees: [[-12, -12], [11, -14], [-15, 2], [15, -2], [-8, 4], [9, 5], [-13, 15], [14, 14], [0, -6]],
    outdoor: true,
    waves: [
      { mix: { beetle: 8, snake: 2, vine: 2 } },
      { mix: { beetle: 6, snake: 2, direwolf: 2, boar: 1, vine: 1, treant: 1 } },
      { mix: { beetle: 6, vine: 2 }, boss: 'bear' },
    ],
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
  },
  {
    name: 'The Crystal Cave',
    shape: 'octagon',
    group: 'Underworld dwellers',
    art: 'underworld',
    scene: 'scene-crystal-cave',
    waves: [
      { mix: { spider: 6, ooze: 2, sporecrawler: 2 } },
      { mix: { spider: 6, ooze: 3, sporecrawler: 2, mushroom: 2, mold: 1 } },
      { mix: { spider: 4, ooze: 2, mushroom: 1 }, boss: 'caveworm' },
    ],
    half: 30,
    pillars: [[-7, -14], [7, 14]], // off the centre line so the entry view is clear
    feature: 'crystals',
    crystals: [[-12, -12], [12, -12], [-12, 12], [12, 12], [-20, 0], [20, 0], [-6, 2], [7, -3]],
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
  },
  {
    name: 'The Crypt',
    shape: 'square',
    group: 'The undead',
    art: 'undead',
    scene: 'scene-crypt',
    waves: [
      { mix: { skeleton: 8, skelarcher: 2, ghost: 2 } },
      { mix: { skeleton: 8, skelarcher: 3, ghost: 3, zombie: 2, knight: 1 } },
      { mix: { skeleton: 4, skelarcher: 2, zombie: 1 }, boss: 'necromancer' },
    ],
    half: 24,
    pillars: [[-9, -9], [9, -9], [-9, 9], [9, 9]],
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
  },
  {
    name: 'The Throne Room',
    shape: 'square',
    group: 'Orcs',
    art: 'orcs',
    scene: 'scene-throne-room',
    waves: [
      { mix: { orcwarrior: 4, orcscout: 4, orcarcher: 2 } },
      { mix: { orcwarrior: 5, orcscout: 4, orcarcher: 3, shaman: 2, shieldguard: 1 } },
      { mix: { orcwarrior: 3, orcarcher: 2, shaman: 1 }, boss: 'chieftain' },
    ],
    half: 30,
    pillars: [[-13, -16], [13, -16], [-13, -4], [13, -4], [-13, 8], [13, 8], [-13, 20], [13, 20]],
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
    solidWest: true,
  },
  {
    name: 'The Flooded Hall',
    shape: 'octagon',
    group: 'Goblins and water elementals',
    art: 'goblins',
    scene: 'scene-flooded-hall',
    waves: [
      { mix: { brawler: 8, riveter: 3, rotor: 2, water: 1 } },
      { mix: { brawler: 8, rotor: 3, riveter: 3, lobber: 2, tinkerer: 2, water: 2 } },
      { mix: { brawler: 6, riveter: 2, lobber: 2, water: 1 }, boss: 'scrapboss' },
    ],
    half: 28,
    pillars: [[-9, -15], [9, -15], [-9, -5], [9, -5], [-9, 5], [9, 5], [-9, 15], [9, 15]],
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
  },
  {
    name: 'The Lava Chamber',
    shape: 'circle',
    group: 'Fire, wind and stone elementals',
    art: 'elementals',
    scene: 'scene-lava-chamber',
    waves: [
      { mix: { fire: 4, wind: 4, golem: 1 } },
      { mix: { fire: 5, wind: 4, golem: 2 } },
      { mix: { fire: 3, wind: 2, golem: 1 }, boss: 'inferno' },
    ],
    half: 26,
    pillars: [[7.5, -13], [15, 0], [7.5, 13], [-7.5, 13], [-15, 0], [-7.5, -13]],
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
  },
  {
    name: "The Ash King's Lair",
    shape: 'circle',
    group: 'The Ash King',
    art: 'elementals',
    scene: 'scene-ash-king',
    waves: [
      // One wave: the Ash King alone (he calls in fire elementals himself).
      { mix: {}, boss: 'ashking' },
    ],
    half: 34,
    pillars: [],
    // A vast round hall: towering obsidian spires, lava pools, lavafalls down the walls, a rune circle.
    spires: [[-22, -10], [22, -10], [-13, -22], [13, -22], [-24, 8], [24, 8], [-12, 20], [12, 20]],
    pools: [[-16, -1], [16, -1], [-8, 9], [8, 9]],
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
  },
];


/** ready: in the first room, waiting for the hero to start · fight · cleared (door open) · transition (walking through). */
export type RunPhase = 'ready' | 'fight' | 'cleared' | 'transition';

/** Top-of-screen label for where the run is. */
export function runLabel(room: number, wave: number, remaining: number, phase: RunPhase, bossName: string | null): string {
  const name = ROOMS[room]?.name ?? '';
  if (phase === 'cleared') return `${name} cleared — through the north door ↑`;
  if (phase === 'transition') return 'Onward…';
  if (phase === 'ready') return `${name} · ready when you are`;
  if (wave === 0) return `${name} · get ready…`;
  if (bossName) return `${name} · ${bossName}`;
  return `${name} · Wave ${wave}/${ROOMS[room]?.waves.length ?? 0} · ${remaining} ${remaining === 1 ? 'foe' : 'foes'} left`;
}
