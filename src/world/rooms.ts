/** The five rooms of the dungeon run, as data. The Dungeon builds whichever one is current. */

export type RoomFeature = 'brazier' | 'puddles' | 'lava' | 'crystals' | 'throne';

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
  /** The last room has a throne where the exit would be: beat the boss to win. */
  hasExit: boolean;
}

export const ROOMS: RoomDef[] = [
  {
    name: 'The Crypt',
    half: 24,
    pillars: [[-9, -9], [9, -9], [-9, 9], [9, 9]],
    feature: 'brazier',
    torchLight: 0xff8a3d,
    torchFlame: 0xff9a40,
    floor: { h: 0.07, s: 0.1, l: 0.22 },
    wall: { h: 0.74, s: 0.08, l: 0.19 },
    stone: 0x4f4856,
    fog: 0x07060a,
    moon: 0x9fb0ff,
    moonIntensity: 0.9,
    hemiSky: 0x5a5a80,
    hemiGround: 0x1a1010,
    hasExit: true,
  },
  {
    name: 'The Flooded Hall',
    half: 28,
    pillars: [[-9, -15], [9, -15], [-9, -5], [9, -5], [-9, 5], [9, 5], [-9, 15], [9, 15]],
    feature: 'puddles',
    torchLight: 0x5fc8ff,
    torchFlame: 0x9fe4ff,
    floor: { h: 0.58, s: 0.12, l: 0.2 },
    wall: { h: 0.6, s: 0.1, l: 0.17 },
    stone: 0x3e4f5e,
    fog: 0x050a10,
    moon: 0x9fc8ff,
    moonIntensity: 1.0,
    hemiSky: 0x4a6a8a,
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
    floor: { h: 0.02, s: 0.18, l: 0.16 },
    wall: { h: 0.03, s: 0.2, l: 0.14 },
    stone: 0x4a3330,
    fog: 0x120604,
    moon: 0xff9a70,
    moonIntensity: 0.5,
    hemiSky: 0x7a3a2a,
    hemiGround: 0x1a0805,
    hasExit: true,
  },
  {
    name: 'The Crystal Cave',
    half: 30,
    pillars: [[0, -14], [0, 14]],
    feature: 'crystals',
    crystals: [[-12, -12], [12, -12], [-12, 12], [12, 12], [-20, 0], [20, 0], [-6, 2], [7, -3]],
    torchLight: 0xb070ff,
    torchFlame: 0xd0a0ff,
    floor: { h: 0.76, s: 0.1, l: 0.19 },
    wall: { h: 0.78, s: 0.12, l: 0.16 },
    stone: 0x50466a,
    fog: 0x0a0612,
    moon: 0xc0a0ff,
    moonIntensity: 0.8,
    hemiSky: 0x6a5a9a,
    hemiGround: 0x100a1a,
    hasExit: true,
  },
  {
    name: 'The Throne Room',
    half: 30,
    pillars: [[-13, -16], [13, -16], [-13, -4], [13, -4], [-13, 8], [13, 8], [-13, 20], [13, 20]],
    feature: 'throne',
    torchLight: 0xffc060,
    torchFlame: 0xffd080,
    floor: { h: 0.08, s: 0.12, l: 0.24 },
    wall: { h: 0.06, s: 0.1, l: 0.18 },
    stone: 0x5a4a44,
    fog: 0x0a0605,
    moon: 0xffd0a0,
    moonIntensity: 0.9,
    hemiSky: 0x806040,
    hemiGround: 0x1a0c08,
    hasExit: false,
  },
];

export const WAVES_PER_ROOM = 3;

/** Difficulty level for wave `wave` (1-based) of room `room` (0-based), fed to waveSpec(). */
export function roomWaveDifficulty(room: number, wave: number): number {
  // Smooth ramp over the whole run: 1, 1.8, 2.6 | 2.6, 3.4, 4.2 | … | 7.4, 8.2 (+ boss).
  return 1 + room * 1.6 + (wave - 1) * 0.8;
}

/** The final room's last wave is the King Slime. */
export function isBossWave(room: number, wave: number): boolean {
  return room === ROOMS.length - 1 && wave === WAVES_PER_ROOM;
}

export type RunPhase = 'fight' | 'cleared' | 'transition';

/** Top-of-screen label for where the run is. */
export function runLabel(room: number, wave: number, remaining: number, phase: RunPhase, bossAlive: boolean): string {
  const name = ROOMS[room]?.name ?? '';
  if (phase === 'cleared') return `${name} cleared — through the north door ↑`;
  if (phase === 'transition') return 'Onward…';
  if (wave === 0) return `${name} · get ready…`;
  if (bossAlive) return `${name} · The King Slime`;
  return `${name} · Wave ${wave}/${WAVES_PER_ROOM} · ${remaining} slime${remaining === 1 ? '' : 's'} left`;
}
