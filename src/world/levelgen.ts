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
export type LayoutStyle = 'halls' | 'open' | 'lair' | 'practice';

export type PropKind = 'tree' | 'crystal' | 'pillar' | 'brazier' | 'lavapit' | 'spire' | 'pool' | 'throne';

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
}

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
  chests: { x: number; z: number }[];
}

const SIZE = 80; // tiles a side (160 m)
const BLOCKING: Record<PropKind, number> = { tree: 0.9, crystal: 1.4, pillar: 1.3, brazier: 1.3, lavapit: 3.6, spire: 1.6, pool: 3.3, throne: 3 };

export function generateLevel(theme: LevelTheme, seed: number): Level {
  const rng = mulberry32(seed);
  const map = new WalkMap(SIZE, SIZE, -(SIZE * TILE) / 2, -(SIZE * TILE) / 2, new Uint8Array(SIZE * SIZE));
  const g = new Gen(map, rng);
  switch (theme.layout) {
    case 'practice':
      return g.practice(theme, seed);
    case 'lair':
      return g.lair(theme, seed);
    case 'open':
      return g.open(theme, seed);
    default:
      return g.halls(theme, seed);
  }
}

class Gen {
  readonly map: WalkMap;
  readonly rng: () => number;
  readonly props: Prop[] = [];

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
    for (const [i, j] of edges) this.corridor(halls[i], halls[j], width);
  }

  /** Is a hall at (x, z) of apothem r clear of the others (with a gap) and inside the map? */
  fits(halls: Hall[], x: number, z: number, r: number, gap: number): boolean {
    const lim = (SIZE * TILE) / 2 - TILE * 2 - r * 1.42;
    if (Math.abs(x) > lim || Math.abs(z) > lim) return false;
    return halls.every((h) => Math.hypot(h.x - x, h.z - z) > (h.r + r) * 1.2 + gap);
  }

  /** A dead-end side room off one of the halls, with a chest. */
  treasureRooms(halls: Hall[], count: number): void {
    for (let n = 0, tries = 0; n < count && tries < 40; tries++) {
      const from = this.pick(halls.filter((h) => h.kind === 'normal'));
      if (!from) return;
      const dir = this.pick([-1, 1]);
      const r = 6;
      const x = from.x + dir * (from.r + 20);
      const z = from.z + this.range(-6, 6);
      if (!this.fits(halls, x, z, r, 6)) continue;
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
  prop(kind: PropKind, x: number, z: number, keepClear: { x: number; z: number; r: number }[], angle?: number): boolean {
    const r = BLOCKING[kind];
    if (!this.map.clear(x, z, r + 0.8)) return false;
    if (this.props.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + r + 2.2)) return false;
    if (keepClear.some((k) => Math.hypot(k.x - x, k.z - z) < k.r + r)) return false;
    this.props.push({ kind, x, z, r, angle });
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
        for (let i = 0; i < 1400 && this.props.length < 120; i++) {
          const p = m.randomFloor(this.rng, 2.5);
          this.prop('tree', p.x, p.z, keepClear);
        }
        break;
      }
      case 'crystals':
        for (const h of inner) scatter('crystal', h, Math.round(h.r / 4), 0.8);
        break;
      case 'brazier':
        for (const h of inner) {
          this.prop('brazier', h.x, h.z, keepClear);
          if (h.r >= 11) ring('pillar', h, 0.55);
        }
        break;
      case 'throne': {
        for (const h of inner) if (h.kind !== 'boss') ring('pillar', h, 0.6);
        const boss = halls.find((h) => h.kind === 'boss');
        if (boss) {
          // Against the west wall of the boss hall, facing east into it.
          this.prop('throne', boss.x - boss.r + 3, boss.z, [], Math.PI / 2);
          for (const sz of [-1, 1]) for (const f of [-0.2, 0.35]) this.prop('pillar', boss.x + boss.r * f, boss.z + sz * boss.r * 0.6, keepClear);
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
    for (let tries = 0; tries < 400 && spots.length * 4.5 < theme.foes; tries++) {
      const p = this.map.randomFloor(this.rng, 2);
      if (ok(p.x, p.z)) spots.push(p);
    }
    // Share the foes out: 3–6 a pack.
    for (let i = 0; i < spots.length && left > 0; i++) {
      const fair = Math.ceil(left / (spots.length - i));
      const size = Math.max(1, Math.min(left, Math.round(Math.min(6, Math.max(3, fair + this.range(-1, 1))))));
      left -= size;
      packs.push({ ...spots[i], kinds: Array.from({ length: size }, draw), boss: false });
    }
    return packs;
  }

  halls(theme: LevelTheme, seed: number): Level {
    const halls: Hall[] = [];
    const shape = () => this.pick(theme.shapes);
    const start: Hall = { x: this.range(-24, 24), z: 58, r: 11, shape: 'square', kind: 'start' };
    const boss: Hall = { x: this.range(-18, 18), z: -46, r: 19, shape: shape(), kind: 'boss' };
    halls.push(start, boss);
    const want = 8 + Math.floor(this.rng() * 3);
    for (let tries = 0; tries < 600 && halls.length < want + 2; tries++) {
      const r = Math.round(this.range(9, 15));
      const x = this.range(-64, 64);
      const z = this.range(-44, 44);
      if (this.fits(halls, x, z, r, 5)) halls.push({ x, z, r, shape: shape(), kind: 'normal' });
    }
    for (const h of halls) this.stamp(h);
    this.connect(halls, 2);
    this.treasureRooms(halls, 1 + Math.floor(this.rng() * 2));
    const exit = this.exitAlcove(boss);
    const begin = { x: this.map.centre(this.map.col(start.x), 0).x, z: start.z + 4 };
    this.keepReachable(begin.x, begin.z);
    return this.finish(theme, seed, halls, begin, exit);
  }

  open(theme: LevelTheme, seed: number): Level {
    const m = this.map;
    // Rough ground: random noise smoothed into caves / glades.
    for (let r = 2; r < m.rows - 2; r++)
      for (let c = 2; c < m.cols - 2; c++) if (this.rng() < 0.56) m.tiles[r * m.cols + c] = FLOOR;
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
    const start: Hall = { x: this.range(-24, 24), z: 60, r: 12, shape: 'circle', kind: 'start' };
    const boss: Hall = { x: this.range(-18, 18), z: -48, r: 19, shape: 'circle', kind: 'boss' };
    halls.push(start, boss);
    for (let tries = 0; tries < 400 && halls.length < 11; tries++) {
      const r = Math.round(this.range(8, 13));
      const x = this.range(-62, 62);
      const z = this.range(-46, 46);
      if (this.fits(halls, x, z, r, 4)) halls.push({ x, z, r, shape: this.pick(theme.shapes), kind: 'normal' });
    }
    for (const h of halls) this.stamp(h);
    this.connect(halls, 3, 4);
    const exit = this.exitAlcove(boss);
    const begin = { x: start.x, z: start.z + 4 };
    this.keepReachable(begin.x, begin.z);
    return this.finish(theme, seed, halls, begin, exit);
  }

  lair(theme: LevelTheme, seed: number): Level {
    // A small antechamber in the south, a long approach north, then the vast round lair.
    const start: Hall = { x: 0, z: 62, r: 9, shape: 'square', kind: 'start' };
    const lair: Hall = { x: 0, z: -20, r: 38, shape: 'circle', kind: 'boss' };
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
    const chests = halls.filter((h) => h.kind === 'treasure').map((h) => ({ x: h.x, z: h.z }));
    for (const c of chests) keepClear.push({ ...c, r: 2.5 });
    const bossHall = halls.find((h) => h.kind === 'boss');
    // Room to fight the guardian (the lair keeps its spires and lava pools: the Ash King flies).
    if (bossHall) keepClear.push({ x: bossHall.x, z: bossHall.z, r: theme.layout === 'lair' ? 6 : bossHall.r * 0.7 });
    this.decorate(theme, halls, keepClear);
    const packs = this.populate(theme, halls, start);
    return { seed, map: this.map, halls, start, exit, packs, props: this.props, chests };
  }
}
