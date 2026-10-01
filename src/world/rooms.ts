/** The five rooms of the dungeon run, as data. The Dungeon builds whichever one is current. */

export type RoomFeature = 'woodland' | 'brazier' | 'puddles' | 'lava' | 'crystals' | 'throne';

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

export interface RoomDef {
  name: string;
  /** Playable floor is [-half, half]². Integer (tiles are 2 m). */
  half: number;
  /** Pillar positions; every pillar blocks movement and arrows. */
  pillars: [number, number][];
  feature: RoomFeature;
  /** Crystal clusters (crystal cave): positions; they block like pillars. */
  crystals?: [number, number][];
  /** Trees (woodland): positions; they block like pillars. */
  trees?: [number, number][];
  /** Outdoors: hedge walls with wooden gates, daylight and open sky instead of brick and torches. */
  outdoor?: boolean;
  /** Who lives here: forest beasts or (default) slimes. */
  enemies?: 'beasts' | 'slimes';
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
    half: 24,
    pillars: [],
    feature: 'woodland',
    trees: [[-12, -12], [11, -14], [-15, 2], [15, -2], [-8, 4], [9, 5], [-13, 15], [14, 14], [0, -6]],
    outdoor: true,
    enemies: 'beasts',
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
    hasExit: false, // the final room: the King Slime waits here
  },
];

export const WAVES_PER_ROOM = 3;

/** Difficulty level for wave `wave` (1-based) of room `room` (0-based), fed to waveSpec(). */
export function roomWaveDifficulty(room: number, wave: number): number {
  // Smooth ramp over the whole run: 1, 1.65, 2.3 | 2.3, 2.95, 3.6 | … | 7.5, 8.15 (+ boss).
  return 1 + room * 1.3 + (wave - 1) * 0.65;
}

/** The final room's last wave is the King Slime. */
export function isBossWave(room: number, wave: number): boolean {
  return room === ROOMS.length - 1 && wave === WAVES_PER_ROOM;
}

export type RunPhase = 'fight' | 'cleared' | 'transition';

/** Top-of-screen label for where the run is. */
export function runLabel(room: number, wave: number, remaining: number, phase: RunPhase, bossName: string | null): string {
  const name = ROOMS[room]?.name ?? '';
  if (phase === 'cleared') return `${name} cleared — through the north door ↑`;
  if (phase === 'transition') return 'Onward…';
  if (wave === 0) return `${name} · get ready…`;
  if (bossName) return `${name} · ${bossName}`;
  const foes = ROOMS[room]?.enemies === 'beasts' ? (remaining === 1 ? 'beast' : 'beasts') : remaining === 1 ? 'slime' : 'slimes';
  return `${name} · Wave ${wave}/${WAVES_PER_ROOM} · ${remaining} ${foes} left`;
}
