/**
 * Generates a level from its theme and a seed: a big tile map (2 m tiles) of halls joined by
 * corridors, or one wide open area of clearings — plus where the elf starts, the exit door, the
 * packs of monsters (the miniboss guarding the exit), chests and props (trees, pillars…).
 * Pure and deterministic: the same theme and seed always give the same level, so the familiar's
 * tablet rebuilds it from the seed alone. Unit tested.
 */
import { FLOOR, TILE, WALL, WalkMap, insideShape, type Shape } from '../game/walkmap';
import type { EnemyKind } from '../game/enemies';
import { mulberry32 } from '../util/rng';

/** Halls joined by corridors · one open area with clearings · a long approach to one vast hall. */
/**
 * halls: chambers joined by corridors · open: woods / flooded ground · cavern: winding natural caves
 * · crypt: a strict grid of straight halls lined with burial niches · fortress: courtyards behind
 * palisades with a keep · lair: a long approach to one vast hall.
 */
export type LayoutStyle = 'halls' | 'open' | 'cavern' | 'crypt' | 'fortress' | 'lair' | 'practice';

export type PropKind = 'tree' | 'crystal' | 'pillar' | 'brazier' | 'lavapit' | 'spire' | 'pool' | 'throne' | 'landmark' | 'stalagmite' | 'chasm' | 'sarcophagus' | 'candles' | 'tent' | 'campfire' | 'rack';

export interface LevelTheme {
  layout: LayoutStyle;
  /** Hall shapes this level uses. */
  shapes: Shape[];
  feature: string;
  /** Relative numbers of each monster in packs. */
  pool: Partial<Record<EnemyKind, number>>;
  /** The miniboss (or boss) guarding the exit, and who stands with it. */
  boss?: EnemyKind;
  escort: Partial<Record<EnemyKind, number>>;
  /** Monsters in packs around the level (not counting the boss and its escort). */
  foes: number;
  /** War camps: a waking pack raises the alarm for sleeping packs this close (m). */
  alarm?: number;
}

export interface Hall {
  x: number;
  z: number;
  /** Apothem (m). */
  r: number;
  shape: Shape;
  kind: 'start' | 'boss' | 'normal' | 'treasure';
}

export interface Pack {
  x: number;
  z: number;
  kinds: EnemyKind[];
  /** The boss's pack: the boss comes first in `kinds`. */
  boss: boolean;
}

export interface Prop {
  kind: PropKind;
  x: number;
  z: number;
  /** Blocking radius (m). */
  r: number;
  /** Facing (radians), for things that face a way (the throne). */
  angle?: number;
  /** A landmark's name ("the Great Oak"). */
  name?: string;
}

/** Named landmarks per level look (feature): unique, tall and lit, to find your way by. */
export const LANDMARK_NAMES: Record<string, string[]> = {
  woodland: ['the Great Oak', 'the Hollow Oak', 'the Ember Oak'],
  crystals: ['the Violet Geode', 'the Singing Crystal', 'the Moon Geode'],
  brazier: ['the Grave Obelisk', 'the Weeping Obelisk', 'the Bone Obelisk'],
  throne: ['the War Banner', 'the Chieftain’s Standard', 'the Blood Banner'],
  puddles: ['the Drowned Beacon', 'the Old Lamp Tower', 'the Tide Beacon'],
  lava: ['the Great Forge Stack', 'the Ember Chimney', 'the Smelter Stack'],
};

export interface Level {
  seed: number;
  map: WalkMap;
  halls: Hall[];
  /** Where the elf arrives (looking north). */
  start: { x: number; z: number };
  /** The exit doorway: centre of its threshold, in a north-facing wall (null in the final lair). */
  exit: { x: number; z: number } | null;
  packs: Pack[];
  props: Prop[];
  /** Treasure chests, with how far (m) off the shortest way to the guardian they lie (more detour, better loot). */
  chests: { x: number; z: number; detour: number }[];
  /** The level's named landmarks. */
  landmarks: { x: number; z: number; name: string }[];
  /** Sarcophagi that burst open with skeletons when the hero passes (index = place in `props`). */
  ambushes: number[];
}

/** Tiles across and from south to north: a tall rectangle, 200 m × 400 m. */
const COLS = 100;
const ROWS = 200;
const HALF_W = (COLS * TILE) / 2; // 100 m
const HALF_H = (ROWS * TILE) / 2; // 200 m
const BLOCKING: Record<PropKind, number> = { tree: 0.9, crystal: 1.4, pillar: 1.3, brazier: 1.3, lavapit: 3.6, spire: 1.6, pool: 3.3, throne: 3, landmark: 2.4, stalagmite: 0.9, chasm: 3.4, sarcophagus: 1.3, candles: 0.5, tent: 2.6, campfire: 1.1, rack: 0.9 };

export function generateLevel(theme: LevelTheme, seed: number): Level {
  const rng = mulberry32(seed);
  const map = new WalkMap(COLS, ROWS, -HALF_W, -HALF_H, new Uint8Array(COLS * ROWS));
  const g = new Gen(map, rng);
  switch (theme.layout) {
    case 'practice':
      return g.practice(theme, seed);
    case 'lair':
      return g.lair(theme, seed);
    case 'open':
      return g.open(theme, seed);
    case 'cavern':
      return g.cavern(theme, seed);
    case 'crypt':
      return g.crypt(theme, seed);
    case 'fortress':
      return g.fortress(theme, seed);
    default:
      return g.halls(theme, seed);
  }
}

class Gen {
  readonly map: WalkMap;
  readonly rng: () => number;
  readonly props: Prop[] = [];
  /** Natural caves: every corridor winds (tunnels) instead of running straight. */
  natural = false;

  constructor(map: WalkMap, rng: () => number) {
    this.map = map;
    this.rng = rng;
  }

  range(lo: number, hi: number): number {
    return lo + this.rng() * (hi - lo);
  }

  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.rng() * list.length)];
  }

  set(c: number, r: number, v: number): void {
    const m = this.map;
    if (c < 1 || r < 1 || c >= m.cols - 1 || r >= m.rows - 1) return; // keep a solid rim
    m.tiles[r * m.cols + c] = v;
  }

  /** Carves a hall of `shape` (apothem r m) centred on (x, z). */
  stamp(h: Hall): void {
    const m = this.map;
    for (let r = 0; r < m.rows; r++)
      for (let c = 0; c < m.cols; c++) {
        const p = m.centre(c, r);
        if (insideShape(h.shape, h.r, p.x - h.x, p.z - h.z)) this.set(c, r, FLOOR);
      }
  }

  /** Carves a straight run of floor `width` tiles wide between two tile coordinates (axis-aligned). */
  run(c0: number, r0: number, c1: number, r1: number, width: number): void {
    const lo = -Math.floor((width - 1) / 2);
    const hi = lo + width - 1;
    for (let c = Math.min(c0, c1) + lo; c <= Math.max(c0, c1) + hi; c++)
      for (let r = Math.min(r0, r1) + lo; r <= Math.max(r0, r1) + hi; r++) this.set(c, r, FLOOR);
  }

  /** An L-shaped corridor between two points. */
  corridor(a: { x: number; z: number }, b: { x: number; z: number }, width = 3): void {
    if (this.natural) {
      this.winding(a, b);
      return;
    }
    const m = this.map;
    const [ac, ar, bc, br] = [m.col(a.x), m.row(a.z), m.col(b.x), m.row(b.z)];
    if (this.rng() < 0.5) {
      this.run(ac, ar, bc, ar, width);
      this.run(bc, ar, bc, br, width);
    } else {
      this.run(ac, ar, ac, br, width);
      this.run(ac, br, bc, br, width);
    }
  }

  /** Joins halls along a minimum spanning tree, plus `extra` short loops. */
  connect(halls: Hall[], extra: number, width = 3): void {
    const linked = [0];
    const edges: [number, number][] = [];
    while (linked.length < halls.length) {
      let best: [number, number] | null = null;
      let bestD = Infinity;
      for (const i of linked)
        for (let j = 0; j < halls.length; j++) {
          if (linked.includes(j) || halls[j].kind === 'treasure') continue;
          const d = Math.hypot(halls[i].x - halls[j].x, halls[i].z - halls[j].z);
          if (d < bestD) {
            bestD = d;
            best = [i, j];
          }
        }
      if (!best) break;
      edges.push(best);
      linked.push(best[1]);
    }
    const others: [number, number, number][] = [];
    for (let i = 0; i < halls.length; i++)
      for (let j = i + 1; j < halls.length; j++) {
        if (halls[i].kind === 'treasure' || halls[j].kind === 'treasure') continue;
        if (edges.some(([a, b]) => (a === i && b === j) || (a === j && b === i))) continue;
        others.push([i, j, Math.hypot(halls[i].x - halls[j].x, halls[i].z - halls[j].z)]);
      }
    others.sort((a, b) => a[2] - b[2]);
    for (const [i, j] of others.slice(0, extra)) edges.push([i, j]);
    // Width 0: winding natural tunnels instead of straight corridors.
    for (const [i, j] of edges) {
      if (width === 0) this.winding(halls[i], halls[j]);
      else this.corridor(halls[i], halls[j], width);
    }
  }

  /**
   * Two ways north: a west lane and an east lane, each joining the start to the guardian through
   * the halls on its side, with a few crossings between them (so there's always a second route).
   */
  lanes(halls: Hall[], start: Hall, boss: Hall, width: number): void {
    const westLane = halls.filter((h) => h.kind === 'normal' && h.x < 0);
    const eastLane = halls.filter((h) => h.kind === 'normal' && h.x >= 0);
    this.connect([start, ...westLane, boss], 1, width);
    this.connect([start, ...eastLane, boss], 1, width);
    for (let i = 0; i < 3 && westLane.length && eastLane.length; i++) {
      const a = this.pick(westLane);
      const b = eastLane.slice().sort((p, q) => Math.abs(p.z - a.z) - Math.abs(q.z - a.z))[0];
      if (width === 0) this.winding(a, b);
      else this.corridor(a, b, width);
    }
  }

  /**
   * Makes sure there's a second way to the guardian: wall off (in a copy) a band along the
   * shortest way; if that cuts the guardian off, dig an outer road up the far side of the map
   * (leaving the start from its south side, which the usual way never uses), and check again.
   */
  ensureSecondRoute(start: Hall, boss: Hall, width: number): void {
    const m = this.map;
    let side = 0;
    for (let attempt = 0; attempt < 4; attempt++) {
      const { cut, meanX } = this.shortestWayCut(start, boss);
      if (!cut) return;
      side = attempt === 0 ? (meanX > 0 ? -1 : 1) : -side;
      const sc = m.col(side * (HALF_W - (attempt < 2 ? 10 : 22)));
      const south = m.row(Math.min(HALF_H - 6, start.z + start.r + 3));
      this.run(m.col(start.x), m.row(start.z), m.col(start.x), south, width);
      this.run(m.col(start.x), south, sc, south, width);
      this.run(sc, south, sc, m.row(boss.z), width);
      this.run(sc, m.row(boss.z), m.col(boss.x), m.row(boss.z), width);
    }
  }

  /** Walls off a band along the shortest way start → guardian (in a copy): is the guardian cut off? */
  shortestWayCut(start: Hall, boss: Hall): { cut: boolean; meanX: number } {
    const m = this.map;
    const field = m.distanceField(boss.x, boss.z);
    const tiles = new Uint8Array(m.tiles);
    let c = m.col(start.x);
    let r = m.row(start.z);
    let sumX = 0;
    let n = 0;
    for (let steps = 0; field[r * m.cols + c] > 0 && steps < 5000; steps++) {
      let best = [c, r];
      let low = field[r * m.cols + c];
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const d = field[(r + dr) * m.cols + c + dc];
          if (m.isFloor(c + dc, r + dr) && d >= 0 && d < low) {
            low = d;
            best = [c + dc, r + dr];
          }
        }
      [c, r] = best;
      const p = m.centre(c, r);
      sumX += p.x;
      n++;
      if (Math.hypot(p.x - start.x, p.z - start.z) > 25 && Math.hypot(p.x - boss.x, p.z - boss.z) > boss.r + 6)
        for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) if (m.isFloor(c + a, r + b)) tiles[(r + b) * m.cols + c + a] = WALL;
    }
    const after = new WalkMap(m.cols, m.rows, m.originX, m.originZ, tiles).distanceField(start.x, start.z);
    return { cut: after[m.row(boss.z) * m.cols + m.col(boss.x)] < 0, meanX: n ? sumX / n : 0 };
  }

  /** Is a hall at (x, z) of apothem r clear of the others (with a gap) and inside the map? */
  fits(halls: Hall[], x: number, z: number, r: number, gap: number): boolean {
    const pad = TILE * 2 + r * 1.42;
    if (Math.abs(x) > HALF_W - pad || Math.abs(z) > HALF_H - pad) return false;
    return halls.every((h) => Math.hypot(h.x - x, h.z - z) > (h.r + r) * 1.2 + gap);
  }

  /** A dead-end side room off one of the halls, with a chest. */
  treasureRooms(halls: Hall[], count: number): void {
    for (let n = 0, tries = 0; n < count && tries < 120; tries++) {
      const from = this.pick(halls.filter((h) => h.kind === 'normal'));
      if (!from) return;
      // Off any side of a hall (east, west, or into the gaps north and south).
      const a = this.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]) + this.range(-0.4, 0.4);
      const r = 6;
      const d = from.r + this.range(16, 26);
      const x = from.x + Math.cos(a) * d;
      const z = from.z + Math.sin(a) * d;
      const boss = halls.find((h) => h.kind === 'boss');
      if (boss && z < boss.z + boss.r) continue; // nothing beyond the guardian: its hall stays the top
      if (!this.fits(halls, x, z, r, 4)) continue;
      const room: Hall = { x, z, r, shape: 'square', kind: 'treasure' };
      halls.push(room);
      this.stamp(room);
      this.corridor(from, room, 3);
      n++;
    }
  }

  /** A short alcove north of the boss hall, walled in, ending in the exit door. */
  exitAlcove(boss: Hall): { x: number; z: number } {
    const m = this.map;
    const c = m.col(boss.x);
    let top = m.row(boss.z);
    const edge = m.row(boss.z - boss.r);
    while (top > edge && m.isFloor(c, top - 1)) top--;
    const doorRow = top - 3;
    // Solid rock round the alcove and behind the door (open ground can't sneak round it).
    for (let r = doorRow - 3; r < top; r++) for (let cc = c - 3; cc <= c + 3; cc++) this.set(cc, r, WALL);
    this.run(c, doorRow + 1, c, top, 3); // (the brush pads each end by a tile)
    return { x: m.centre(c, doorRow).x, z: m.originZ + doorRow * TILE };
  }

  /** Keeps only the floor reachable from (x, z) (no sealed-off pockets). */
  keepReachable(x: number, z: number): void {
    const m = this.map;
    const field = m.distanceField(x, z);
    for (let i = 0; i < m.tiles.length; i++) if (m.tiles[i] !== WALL && field[i] < 0) m.tiles[i] = WALL;
  }

  /** A prop at (x, z), if it's on clear floor and away from other props, the start and the exit. */
  prop(kind: PropKind, x: number, z: number, keepClear: { x: number; z: number; r: number }[], angle?: number, name?: string): boolean {
    const r = BLOCKING[kind];
    if (!this.map.clear(x, z, r + 0.8)) return false;
    if (this.props.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + r + 2.2)) return false;
    if (keepClear.some((k) => Math.hypot(k.x - x, k.z - z) < k.r + r)) return false;
    this.props.push({ kind, x, z, r, angle, ...(name ? { name } : {}) });
    return true;
  }

  /** Props for the level's look (and cover), inside halls and clearings. */
  decorate(theme: LevelTheme, halls: Hall[], keepClear: { x: number; z: number; r: number }[]): void {
    const inner = halls.filter((h) => h.kind !== 'start' && h.kind !== 'treasure');
    const scatter = (kind: PropKind, h: Hall, n: number, spread = 0.75) => {
      for (let i = 0, tries = 0; i < n && tries < n * 12; tries++) {
        const a = this.rng() * Math.PI * 2;
        const d = Math.sqrt(this.rng()) * h.r * spread;
        if (this.prop(kind, h.x + Math.cos(a) * d, h.z + Math.sin(a) * d, keepClear)) i++;
      }
    };
    const ring = (kind: PropKind, h: Hall, at: number) => {
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) this.prop(kind, h.x + sx * h.r * at, h.z + sz * h.r * at, keepClear);
    };
    switch (theme.feature) {
      case 'woodland': {
        // Trees everywhere in the open (not in the start clearing): woods to weave through.
        const m = this.map;
        for (let i = 0; i < 4500 && this.props.length < 360; i++) {
          const p = m.randomFloor(this.rng, 2.5);
          this.prop('tree', p.x, p.z, keepClear);
        }
        break;
      }
      case 'crystals': {
        // Glowing crystal clusters (the cave's only light), stalagmites, and chasms in some caverns.
        // Chasms first (they need room), then crystals and stalagmites round them.
        for (const h of inner) if (h.kind === 'normal' && h.r >= 9 && this.rng() < 0.5) this.prop('chasm', h.x + this.range(-2, 2), h.z + this.range(-2, 2), keepClear);
        for (const h of inner) {
          scatter('crystal', h, Math.max(2, Math.round(h.r / 3.5)), 0.85);
          scatter('stalagmite', h, Math.round(h.r / 3), 0.9);
        }
        // Crystals along the tunnels too, so the dark stretches between caverns glow here and there.
        for (let i = 0; i < 600 && this.props.filter((p) => p.kind === 'crystal').length < 110; i++) {
          const p = this.map.randomFloor(this.rng, 2.2);
          this.prop('crystal', p.x, p.z, keepClear);
        }
        break;
      }
      case 'brazier': {
        // The crypt: sarcophagi in rows (some burst open with skeletons), candles, a brazier in chapels.
        for (const h of inner) {
          if (h.kind === 'boss') {
            ring('pillar', h, 0.55);
            continue;
          }
          if (h.r >= 10) this.prop('brazier', h.x, h.z, keepClear);
          for (const sx of [-1, 1])
            for (const f of [-0.45, 0, 0.45]) {
              if (this.rng() < 0.6) this.prop('sarcophagus', h.x + sx * h.r * 0.55, h.z + f * h.r, keepClear, Math.PI / 2);
            }
          scatter('candles', h, 3, 0.85);
        }
        break;
      }
      case 'throne': {
        // The war camp: tents, campfires and weapon racks in the courtyards; the throne in the keep.
        for (const h of inner) {
          if (h.kind === 'boss') continue;
          this.prop('campfire', h.x, h.z, keepClear);
          scatter('tent', h, Math.round(h.r / 6) + 1, 0.8);
          scatter('rack', h, 2, 0.75);
        }
        const boss = halls.find((h) => h.kind === 'boss');
        if (boss) {
          // Against the west wall of the boss hall, facing east into it.
          this.prop('throne', boss.x - boss.r + 3, boss.z, [], Math.PI / 2);
          for (const sz of [-1, 1]) for (const f of [-0.2, 0.35]) this.prop('pillar', boss.x + boss.r * f, boss.z + sz * boss.r * 0.6, keepClear);
          scatter('rack', boss, 3, 0.8);
        }
        break;
      }
      case 'puddles':
        for (const h of inner) scatter('pillar', h, Math.round(h.r / 5), 0.7);
        break;
      case 'lava':
        for (const h of inner) {
          if (h.kind === 'boss') ring('pillar', h, 0.55);
          else this.prop('lavapit', h.x, h.z, keepClear);
          scatter('pillar', h, 1, 0.7);
        }
        break;
      case 'dragonlair': {
        const lair = halls.find((h) => h.kind === 'boss')!;
        const k = lair.r / 34; // the spots were laid out for a 34 m hall
        for (const [x, z] of [[-22, -10], [22, -10], [-13, -22], [13, -22], [-24, 8], [24, 8], [-12, 20], [12, 20]]) this.prop('spire', lair.x + x * k, lair.z + z * k, keepClear);
        for (const [x, z] of [[-16, -1], [16, -1], [-8, 9], [8, 9]]) this.prop('pool', lair.x + x * k, lair.z + z * k, keepClear);
        break;
      }
    }
  }

  /**
   * Three named landmarks, one in each third of the way north (in the biggest hall there), so you
   * can always tell where you are. Placed before other props; nothing else crowds them.
   */
  landmarks(theme: LevelTheme, halls: Hall[], keepClear: { x: number; z: number; r: number }[]): { x: number; z: number; name: string }[] {
    const names = LANDMARK_NAMES[theme.feature];
    if (!names || theme.layout === 'practice') return [];
    const out: { x: number; z: number; name: string }[] = [];
    const bands: [number, number][] = [[HALF_H * 0.33, HALF_H], [-HALF_H * 0.33, HALF_H * 0.33], [-HALF_H, -HALF_H * 0.33]];
    bands.forEach(([lo, hi], i) => {
      const pool = halls.filter((h) => h.kind === 'normal' && h.z >= lo && h.z < hi).sort((a, b) => b.r - a.r);
      for (const h of pool) {
        if (this.prop('landmark', h.x, h.z, keepClear, undefined, names[i])) {
          out.push({ x: h.x, z: h.z, name: names[i] });
          keepClear.push({ x: h.x, z: h.z, r: BLOCKING.landmark + 4 });
          break;
        }
      }
    });
    return out;
  }

  /** Packs of monsters around the level, the miniboss and its escort in the boss hall. */
  populate(theme: LevelTheme, halls: Hall[], start: { x: number; z: number }): Pack[] {
    const packs: Pack[] = [];
    const boss = halls.find((h) => h.kind === 'boss');
    if (boss && theme.boss) {
      const escort = Object.entries(theme.escort).flatMap(([k, n]) => Array<EnemyKind>(n ?? 0).fill(k as EnemyKind));
      packs.push({ x: boss.x, z: boss.z, kinds: [theme.boss, ...escort], boss: true });
    }
    const pool = Object.entries(theme.pool).filter(([, w]) => (w ?? 0) > 0) as [EnemyKind, number][];
    const total = pool.reduce((s, [, w]) => s + w, 0);
    const draw = (): EnemyKind => {
      let x = this.rng() * total;
      for (const [k, w] of pool) if ((x -= w) < 0) return k;
      return pool[pool.length - 1][0];
    };
    let left = theme.foes;
    // Open ground: more, smaller packs (more to meet along the way); halls: fewer, bigger ones.
    const [minPack, maxPack] = theme.layout === 'open' ? [2, 4] : [3, 6];
    if (!pool.length) return packs;
    const spots: { x: number; z: number }[] = [];
    const ok = (x: number, z: number) =>
      this.map.clear(x, z, 2) &&
      Math.hypot(x - start.x, z - start.z) > 30 &&
      !spots.some((s) => Math.hypot(s.x - x, s.z - z) < 14) &&
      !packs.some((p) => Math.hypot(p.x - x, p.z - z) < 14) &&
      !this.props.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + 2.5);
    // First the halls (a pack or two each, more in big ones), then the corridors between.
    for (const h of halls) {
      if (h.kind === 'start') continue;
      const n = h.kind === 'treasure' ? 1 : h.r >= 13 ? 2 : 1;
      for (let i = 0, tries = 0; i < n && tries < 30; tries++) {
        const a = this.rng() * Math.PI * 2;
        const d = this.rng() * h.r * 0.55;
        const x = h.x + Math.cos(a) * d;
        const z = h.z + Math.sin(a) * d;
        if (!ok(x, z)) continue;
        spots.push({ x, z });
        i++;
      }
    }
    for (let tries = 0; tries < 1500 && spots.length * ((minPack + maxPack) / 2) < theme.foes; tries++) {
      const p = this.map.randomFloor(this.rng, 2);
      if (ok(p.x, p.z)) spots.push(p);
    }
    // Share the foes out.
    for (let i = 0; i < spots.length && left > 0; i++) {
      const fair = Math.ceil(left / (spots.length - i));
      const size = Math.max(1, Math.min(left, Math.round(Math.min(maxPack, Math.max(minPack, fair + this.range(-1, 1))))));
      left -= size;
      packs.push({ ...spots[i], kinds: Array.from({ length: size }, draw), boss: false });
    }
    return packs;
  }

  halls(theme: LevelTheme, seed: number): Level {
    const halls: Hall[] = [];
    const shape = () => this.pick(theme.shapes);
    // Start at the bottom (south), the guardian at the very top (north).
    const start: Hall = { x: this.range(-30, 30), z: HALF_H - 22, r: 11, shape: 'square', kind: 'start' };
    const boss: Hall = { x: this.range(-24, 24), z: -HALF_H + 34, r: 19, shape: shape(), kind: 'boss' };
    halls.push(start, boss);
    const want = 24 + Math.floor(this.rng() * 6);
    for (let tries = 0; tries < 3000 && halls.length < want + 2; tries++) {
      const r = Math.round(this.range(9, 15));
      // Alternate sides, so both the west and the east lane get their halls.
      const west = halls.length % 2 === 0;
      const x = west ? this.range(-HALF_W + 16, -14) : this.range(14, HALF_W - 16);
      const z = this.range(-HALF_H + 60, HALF_H - 40);
      if (this.fits(halls, x, z, r, 5)) halls.push({ x, z, r, shape: shape(), kind: 'normal' });
    }
    for (const h of halls) this.stamp(h);
    this.lanes(halls, start, boss, 3);
    this.treasureRooms(halls, 3 + Math.floor(this.rng() * 3));
    const exit = this.exitAlcove(boss);
    this.ensureSecondRoute(start, boss, 3); // after the exit alcove, which walls off rock round it
    const begin = { x: this.map.centre(this.map.col(start.x), 0).x, z: start.z + 4 };
    this.keepReachable(begin.x, begin.z);
    return this.finish(theme, seed, halls, begin, exit);
  }

  open(theme: LevelTheme, seed: number): Level {
    const m = this.map;
    // Rough ground: random noise smoothed into caves / glades.
    for (let r = 2; r < m.rows - 2; r++)
      for (let c = 2; c < m.cols - 2; c++) if (this.rng() < 0.5) m.tiles[r * m.cols + c] = FLOOR; // ~half rock: woods and caverns, not one big field
    for (let pass = 0; pass < 4; pass++) {
      const next = new Uint8Array(m.tiles);
      for (let r = 1; r < m.rows - 1; r++)
        for (let c = 1; c < m.cols - 1; c++) {
          let n = 0;
          for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if ((dr || dc) && m.isFloor(c + dc, r + dr)) n++;
          next[r * m.cols + c] = n >= 5 || (n >= 4 && m.isFloor(c, r)) ? FLOOR : WALL;
        }
      m.tiles.set(next);
    }
    // Clearings: the start (south), the boss's (north), and some in between, joined by wide trails.
    const halls: Hall[] = [];
    const start: Hall = { x: this.range(-30, 30), z: HALF_H - 22, r: 12, shape: 'circle', kind: 'start' };
    const boss: Hall = { x: this.range(-24, 24), z: -HALF_H + 34, r: 19, shape: 'circle', kind: 'boss' };
    halls.push(start, boss);
    for (let tries = 0; tries < 2000 && halls.length < 30; tries++) {
      const r = Math.round(this.range(8, 13));
      const west = halls.length % 2 === 0;
      const x = west ? this.range(-HALF_W + 14, -12) : this.range(12, HALF_W - 14);
      const z = this.range(-HALF_H + 60, HALF_H - 40);
      if (this.fits(halls, x, z, r, 4)) halls.push({ x, z, r, shape: this.pick(theme.shapes), kind: 'normal' });
    }
    for (const h of halls) this.stamp(h);
    this.lanes(halls, start, boss, 4);
    this.treasureRooms(halls, 10); // candidate groves; only those well off the way keep a chest
    const exit = this.exitAlcove(boss);
    this.ensureSecondRoute(start, boss, 4); // after the exit alcove, which walls off rock round it
    const begin = { x: start.x, z: start.z + 4 };
    this.keepReachable(begin.x, begin.z);
    return this.finish(theme, seed, halls, begin, exit);
  }

  /**
   * Natural caverns: rough rock (noise, smoothed) with round chambers of every size joined by
   * winding tunnels that narrow and widen — no straight corridors, no square rooms.
   */
  cavern(theme: LevelTheme, seed: number): Level {
    const m = this.map;
    for (let r = 2; r < m.rows - 2; r++) for (let c = 2; c < m.cols - 2; c++) if (this.rng() < 0.42) m.tiles[r * m.cols + c] = FLOOR;
    for (let pass = 0; pass < 5; pass++) {
      const next = new Uint8Array(m.tiles);
      for (let r = 1; r < m.rows - 1; r++)
        for (let c = 1; c < m.cols - 1; c++) {
          let n = 0;
          for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if ((dr || dc) && m.isFloor(c + dc, r + dr)) n++;
          next[r * m.cols + c] = n >= 5 || (n >= 4 && m.isFloor(c, r)) ? FLOOR : WALL;
        }
      m.tiles.set(next);
    }
    const halls: Hall[] = [];
    const start: Hall = { x: this.range(-30, 30), z: HALF_H - 22, r: 11, shape: 'circle', kind: 'start' };
    const boss: Hall = { x: this.range(-24, 24), z: -HALF_H + 34, r: 19, shape: 'circle', kind: 'boss' };
    halls.push(start, boss);
    for (let tries = 0; tries < 2500 && halls.length < 30; tries++) {
      const r = Math.round(this.range(6, 15)); // every size, from pockets to great caverns
      const west = halls.length % 2 === 0;
      const x = west ? this.range(-HALF_W + 14, -10) : this.range(10, HALF_W - 14);
      const z = this.range(-HALF_H + 60, HALF_H - 40);
      if (this.fits(halls, x, z, r, 4)) halls.push({ x, z, r, shape: 'circle', kind: 'normal' });
    }
    for (const h of halls) this.stampRough(h);
    this.natural = true;
    // Winding tunnels, 2–4 tiles wide.
    this.lanes(halls, start, boss, 0);
    this.treasureRooms(halls, 5);
    const exit = this.exitAlcove(boss);
    this.ensureSecondRoute(start, boss, 3); // after the exit alcove, which walls off rock round it
    const begin = { x: start.x, z: start.z + 4 };
    this.keepReachable(begin.x, begin.z);
    return this.finish(theme, seed, halls, begin, exit);
  }

  /** A cavern: a circle with a ragged edge. */
  stampRough(h: Hall): void {
    const m = this.map;
    const bumps = [this.rng() * 6, this.rng() * 6, this.rng() * 6];
    for (let r = m.row(h.z - h.r * 1.4); r <= m.row(h.z + h.r * 1.4); r++)
      for (let c = m.col(h.x - h.r * 1.4); c <= m.col(h.x + h.r * 1.4); c++) {
        const p = m.centre(c, r);
        const a = Math.atan2(p.z - h.z, p.x - h.x);
        const edge = h.r * (1 + 0.18 * Math.sin(a * 3 + bumps[0]) + 0.1 * Math.sin(a * 5 + bumps[1]) + 0.06 * Math.sin(a * 9 + bumps[2]));
        if (Math.hypot(p.x - h.x, p.z - h.z) <= edge) this.set(c, r, FLOOR);
      }
  }

  /** A tunnel that wanders between two points, its width changing as it goes (2–4 tiles). */
  winding(a: { x: number; z: number }, b: { x: number; z: number }): void {
    const m = this.map;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(2, Math.ceil(len / 2));
    const nx = -(b.z - a.z) / (len || 1);
    const nz = (b.x - a.x) / (len || 1);
    const amp = Math.min(14, len * 0.18);
    const phase = this.rng() * 6;
    const waves = 1 + this.rng() * 1.5;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const off = Math.sin(t * Math.PI * waves * 2 + phase) * amp * Math.sin(t * Math.PI);
      const x = a.x + (b.x - a.x) * t + nx * off;
      const z = a.z + (b.z - a.z) * t + nz * off;
      const w = 1 + Math.round((Math.sin(t * 9 + phase) * 0.5 + 0.5) * 1.6); // half-width 1–2 tiles
      for (let dr = -w; dr <= w; dr++) for (let dc = -w; dc <= w; dc++) if (dr * dr + dc * dc <= w * w + 1) this.set(m.col(x) + dc, m.row(z) + dr, FLOOR);
    }
  }

  /**
   * The crypt: a strict grid of square chambers and cross-shaped chapels joined by long straight
   * halls; the halls are lined with burial niches (one-tile alcoves) every few metres.
   */
  crypt(theme: LevelTheme, seed: number): Level {
    const COLS_X = [-66, -22, 22, 66];
    const rowsZ: number[] = [];
    for (let z = HALF_H - 22; z > -HALF_H + 70; z -= 40) rowsZ.push(z);
    const halls: Hall[] = [];
    const grid: (Hall | null)[][] = [];
    rowsZ.forEach((z, ri) => {
      grid.push([]);
      COLS_X.forEach((x, ci) => {
        let h: Hall | null = null;
        if (ri === 0) h = ci === 1 || ci === 2 ? { x, z, r: ci === 1 ? 11 : 9, shape: 'square', kind: ci === 1 ? 'start' : 'normal' } : null;
        else if (this.rng() < 0.85) h = { x, z, r: Math.round(this.range(7, 11)), shape: 'square', kind: 'normal' };
        grid[ri].push(h);
        if (h) halls.push(h);
      });
    });
    const boss: Hall = { x: 0, z: -HALF_H + 34, r: 19, shape: 'square', kind: 'boss' };
    halls.push(boss);
    const start = halls.find((h) => h.kind === 'start')!;
    for (const h of halls) {
      this.stamp(h);
      // Chapels: a cross (two crossing arms through the chamber) on some of them.
      if (h.kind === 'normal' && this.rng() < 0.35) {
        const m = this.map;
        const arm = Math.round((h.r + 5) / TILE);
        this.run(m.col(h.x) - arm, m.row(h.z), m.col(h.x) + arm, m.row(h.z), 5);
        this.run(m.col(h.x), m.row(h.z) - arm, m.col(h.x), m.row(h.z) + arm, 5);
      }
    }
    // Straight halls between grid neighbours (east–west and north–south); always the north links
    // and two in three of the side links, so there are several ways up.
    const straight = (a: Hall, b: Hall) => {
      const m = this.map;
      this.run(m.col(a.x), m.row(a.z), m.col(b.x), m.row(b.z), 3);
      this.niches(a, b);
    };
    for (let ri = 0; ri < grid.length; ri++)
      for (let ci = 0; ci < COLS_X.length; ci++) {
        const h = grid[ri][ci];
        if (!h) continue;
        const east = grid[ri][ci + 1];
        if (east && (ri === 0 || this.rng() < 0.66)) straight(h, east);
        // North: the nearest chamber up the same column.
        for (let rj = ri + 1; rj < grid.length; rj++) {
          const n = grid[rj][ci];
          if (n) {
            straight(h, n);
            break;
          }
        }
      }
    // The top row of the grid opens into the guardian's ossuary through two long halls.
    const top = grid[grid.length - 1].filter((h): h is Hall => !!h);
    for (const h of [top[0], top[top.length - 1]]) if (h) this.corridor(h, boss, 3);
    this.treasureRooms(halls, 5);
    const exit = this.exitAlcove(boss);
    this.ensureSecondRoute(start, boss, 3); // after the exit alcove, which walls off rock round it
    const begin = { x: start.x, z: start.z + 4 };
    this.keepReachable(begin.x, begin.z);
    return this.finish(theme, seed, halls, begin, exit);
  }

  /** Burial niches: one-tile alcoves along both sides of a straight hall from a to b. */
  niches(a: Hall, b: Hall): void {
    const m = this.map;
    const horiz = Math.abs(b.x - a.x) > Math.abs(b.z - a.z);
    const [c0, r0, c1, r1] = [m.col(a.x), m.row(a.z), m.col(b.x), m.row(b.z)];
    if (horiz) {
      for (let c = Math.min(c0, c1) + Math.ceil(a.r / 2) + 1; c < Math.max(c0, c1) - Math.ceil(b.r / 2) - 1; c += 3) {
        this.set(c, r0 - 2, FLOOR);
        this.set(c, r0 + 2, FLOOR);
      }
    } else {
      for (let r = Math.min(r0, r1) + Math.ceil(a.r / 2) + 1; r < Math.max(r0, r1) - Math.ceil(b.r / 2) - 1; r += 3) {
        this.set(c0 - 2, r, FLOOR);
        this.set(c0 + 2, r, FLOOR);
      }
    }
  }

  /**
   * The orc war camp: big muddy courtyards behind palisades, joined by wide gates, with the
   * chieftain's stone keep at the top.
   */
  fortress(theme: LevelTheme, seed: number): Level {
    const COLS_X = [-60, 0, 60];
    const halls: Hall[] = [];
    const grid: Hall[][] = [];
    let ri = 0;
    for (let z = HALF_H - 26; z > -HALF_H + 80; z -= 50, ri++) {
      grid.push([]);
      for (const [ci, x] of COLS_X.entries()) {
        if (ri === 0 && ci !== 1) continue; // the camp gate: one courtyard to start in
        const h: Hall = { x: x + this.range(-6, 6), z: z + this.range(-5, 5), r: Math.round(this.range(13, 18)), shape: 'square', kind: ri === 0 ? 'start' : 'normal' };
        grid[ri].push(h);
        halls.push(h);
      }
    }
    const boss: Hall = { x: 0, z: -HALF_H + 34, r: 20, shape: 'square', kind: 'boss' };
    halls.push(boss);
    const start = halls[0];
    for (const h of halls) this.stamp(h);
    const gate = (a: Hall, b: Hall) => this.corridor(a, b, 5);
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c + 1 < grid[r].length; c++) if (r === 0 || this.rng() < 0.75) gate(grid[r][c], grid[r][c + 1]);
      if (r + 1 < grid.length) for (const h of grid[r]) gate(h, grid[r + 1].slice().sort((p, q) => Math.abs(p.x - h.x) - Math.abs(q.x - h.x))[0]);
    }
    const last = grid[grid.length - 1];
    gate(last[0], boss);
    gate(last[last.length - 1], boss);
    this.treasureRooms(halls, 5);
    const exit = this.exitAlcove(boss);
    this.ensureSecondRoute(start, boss, 5); // after the exit alcove, which walls off rock round it
    const begin = { x: start.x, z: start.z + 4 };
    this.keepReachable(begin.x, begin.z);
    return this.finish(theme, seed, halls, begin, exit);
  }

  lair(theme: LevelTheme, seed: number): Level {
    // A small antechamber in the south, a long approach north, then the vast round lair.
    const start: Hall = { x: 0, z: -HALF_H + 150, r: 9, shape: 'square', kind: 'start' };
    const lair: Hall = { x: 0, z: -HALF_H + 50, r: 38, shape: 'circle', kind: 'boss' };
    const halls = [start, lair];
    for (const h of halls) this.stamp(h);
    this.corridor(start, lair, 4);
    const begin = { x: 0, z: start.z + 2 };
    return this.finish(theme, seed, halls, begin, null);
  }

  practice(theme: LevelTheme, seed: number): Level {
    const room: Hall = { x: 0, z: 0, r: 24, shape: 'circle', kind: 'start' };
    this.stamp(room);
    const level = this.finish({ ...theme, foes: 0 }, seed, [room], { x: 0, z: 12 }, null);
    level.packs = [];
    return level;
  }

  finish(theme: LevelTheme, seed: number, halls: Hall[], start: { x: number; z: number }, exit: { x: number; z: number } | null): Level {
    const keepClear = [{ ...start, r: 9 }, ...(exit ? [{ x: exit.x, z: exit.z + 2, r: 7 }] : [])];
    const bossHall = halls.find((h) => h.kind === 'boss');
    // How far off the shortest way to the guardian each chest lies.
    const fromStart = this.map.distanceField(start.x, start.z);
    const fromBoss = bossHall ? this.map.distanceField(bossHall.x, bossHall.z) : fromStart;
    const at = (f: Int32Array, x: number, z: number) => f[this.map.row(z) * this.map.cols + this.map.col(x)];
    const shortest = bossHall ? at(fromStart, bossHall.x, bossHall.z) : 0;
    // A treasure room right on the way isn't off the path: it becomes an ordinary hall.
    const chests: { x: number; z: number; detour: number }[] = [];
    for (const h of halls) {
      if (h.kind !== 'treasure') continue;
      const detour = Math.max(0, (at(fromStart, h.x, h.z) + at(fromBoss, h.x, h.z) - shortest) * TILE);
      if (detour >= 30 && chests.length < 6) chests.push({ x: h.x, z: h.z, detour });
      else h.kind = 'normal';
    }
    // Too few? The halls / clearings furthest off the way become treasure spots too.
    if (theme.layout !== 'lair' && theme.layout !== 'practice' && chests.length < 3) {
      const far = halls
        .filter((h) => h.kind === 'normal')
        .map((h) => ({ h, detour: Math.max(0, (at(fromStart, h.x, h.z) + at(fromBoss, h.x, h.z) - shortest) * TILE) }))
        .filter((c) => c.detour >= 30)
        .sort((a, b) => b.detour - a.detour);
      for (const { h, detour } of far.slice(0, 3 - chests.length)) {
        h.kind = 'treasure';
        chests.push({ x: h.x, z: h.z, detour });
      }
    }
    for (const c of chests) keepClear.push({ ...c, r: 2.5 });
    const landmarks = this.landmarks(theme, halls, keepClear);
    // Room to fight the guardian (the lair keeps its spires and lava pools: the Ash King flies).
    if (bossHall) keepClear.push({ x: bossHall.x, z: bossHall.z, r: theme.layout === 'lair' ? 6 : bossHall.r * 0.7 });
    this.decorate(theme, halls, keepClear);
    const packs = this.populate(theme, halls, start);
    // Sarcophagi away from the start can burst open with skeletons (about half of them).
    const ambushes: number[] = [];
    this.props.forEach((p, i) => {
      if (p.kind === 'sarcophagus' && Math.hypot(p.x - start.x, p.z - start.z) > 40 && this.rng() < 0.5) ambushes.push(i);
    });
    return { seed, map: this.map, halls, start, exit, packs, props: this.props, chests, landmarks, ambushes };
  }
}
