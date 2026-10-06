/**
 * Where you can walk: a grid of 2 m tiles (wall or floor) laid over the level. Movement is kept
 * out of wall tiles (circles slide along them), and arrows, bolts and sight lines stop at them.
 * Pure 2D (XZ plane), no three.js — unit tested.
 */

export const TILE = 2;
export const WALL = 0;
export const FLOOR = 1;

export interface Pt {
  x: number;
  z: number;
}

export type Shape = 'square' | 'circle' | 'octagon';

/** Is (x, z) inside a shape of apothem `half` centred on the origin, `margin` in from its edge? */
export function insideShape(shape: Shape, half: number, x: number, z: number, margin = 0): boolean {
  const a = half - margin;
  if (shape === 'circle') return x * x + z * z <= a * a;
  if (Math.abs(x) > a || Math.abs(z) > a) return false;
  return shape === 'square' || Math.abs(x) + Math.abs(z) <= a * Math.SQRT2;
}

export class WalkMap {
  readonly cols: number;
  readonly rows: number;
  /** World position of the grid's (0, 0) corner (smallest x and z). */
  readonly originX: number;
  readonly originZ: number;
  /** cols × rows, row-major (index = row · cols + col): WALL or FLOOR. */
  readonly tiles: Uint8Array;

  constructor(cols: number, rows: number, originX: number, originZ: number, tiles: Uint8Array) {
    this.cols = cols;
    this.rows = rows;
    this.originX = originX;
    this.originZ = originZ;
    this.tiles = tiles;
  }

  /** A single open room of the given shape (apothem `half` m), centred on the origin. */
  static fromShape(shape: Shape, half: number): WalkMap {
    const n = Math.ceil(half / TILE) * 2 + 2;
    const origin = -(n * TILE) / 2;
    const tiles = new Uint8Array(n * n);
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) {
        const x = origin + (c + 0.5) * TILE;
        const z = origin + (r + 0.5) * TILE;
        if (insideShape(shape, half, x, z)) tiles[r * n + c] = FLOOR;
      }
    return new WalkMap(n, n, origin, origin, tiles);
  }

  col(x: number): number {
    return Math.floor((x - this.originX) / TILE);
  }

  row(z: number): number {
    return Math.floor((z - this.originZ) / TILE);
  }

  /** World centre of tile (c, r). */
  centre(c: number, r: number): Pt {
    return { x: this.originX + (c + 0.5) * TILE, z: this.originZ + (r + 0.5) * TILE };
  }

  isFloor(c: number, r: number): boolean {
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows && this.tiles[r * this.cols + c] !== WALL;
  }

  floorAt(x: number, z: number): boolean {
    return this.isFloor(this.col(x), this.row(z));
  }

  /** Is a circle of radius `r` at (x, z) entirely clear of wall tiles? */
  clear(x: number, z: number, r: number): boolean {
    if (!this.floorAt(x, z)) return false;
    const c0 = this.col(x - r);
    const c1 = this.col(x + r);
    const r0 = this.row(z - r);
    const r1 = this.row(z + r);
    for (let rr = r0; rr <= r1; rr++)
      for (let cc = c0; cc <= c1; cc++) {
        if (this.isFloor(cc, rr)) continue;
        const minX = this.originX + cc * TILE;
        const minZ = this.originZ + rr * TILE;
        const qx = Math.max(minX, Math.min(x, minX + TILE));
        const qz = Math.max(minZ, Math.min(z, minZ + TILE));
        if ((x - qx) ** 2 + (z - qz) ** 2 < r * r) return false;
      }
    return true;
  }

  /** Pushes a circle of radius `r` at `p` out of the walls (sliding along them). Returns true if it moved. */
  clampCircle(p: Pt, r: number): boolean {
    const sx = p.x;
    const sz = p.z;
    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      const c0 = this.col(p.x - r);
      const c1 = this.col(p.x + r);
      const r0 = this.row(p.z - r);
      const r1 = this.row(p.z + r);
      for (let rr = r0; rr <= r1; rr++)
        for (let cc = c0; cc <= c1; cc++) {
          if (this.isFloor(cc, rr)) continue;
          const minX = this.originX + cc * TILE;
          const minZ = this.originZ + rr * TILE;
          const maxX = minX + TILE;
          const maxZ = minZ + TILE;
          const qx = Math.max(minX, Math.min(p.x, maxX));
          const qz = Math.max(minZ, Math.min(p.z, maxZ));
          const dx = p.x - qx;
          const dz = p.z - qz;
          const d2 = dx * dx + dz * dz;
          if (d2 >= r * r) continue;
          if (d2 > 1e-12) {
            const d = Math.sqrt(d2);
            p.x = qx + (dx / d) * r;
            p.z = qz + (dz / d) * r;
          } else {
            // Centre inside the wall tile: out through the nearest face that leads to floor.
            const faces: [number, number, number, number][] = [
              [p.x - minX, -1, 0, cc - 1],
              [maxX - p.x, 1, 0, cc + 1],
              [p.z - minZ, 0, -1, rr - 1],
              [maxZ - p.z, 0, 1, rr + 1],
            ];
            faces.sort((a, b) => a[0] - b[0]);
            const open = faces.find((f) => (f[1] !== 0 ? this.isFloor(f[3], rr) : this.isFloor(cc, f[3]))) ?? faces[0];
            if (open[1] < 0) p.x = minX - r;
            else if (open[1] > 0) p.x = maxX + r;
            else if (open[2] < 0) p.z = minZ - r;
            else p.z = maxZ + r;
          }
          moved = true;
        }
      if (!moved) break;
    }
    if (!this.floorAt(p.x, p.z)) {
      // Deep inside rock (shouldn't happen): back to the nearest floor.
      const f = this.nearestFloor(p.x, p.z);
      p.x = f.x;
      p.z = f.z;
    }
    return p.x !== sx || p.z !== sz;
  }

  /**
   * Fraction t ∈ [0, 1) along A→B just before it runs into a wall (a circle of radius `margin`
   * touching one), or null if the whole segment is clear.
   */
  raycast(ax: number, az: number, bx: number, bz: number, margin = 0): number | null {
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(len / 0.25));
    const ok = (t: number) => {
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      return margin > 0 ? this.clear(x, z, margin) : this.floorAt(x, z);
    };
    let prev = 0;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (ok(t)) {
        prev = t;
        continue;
      }
      let lo = prev;
      let hi = t;
      for (let k = 0; k < 8; k++) {
        const mid = (lo + hi) / 2;
        if (ok(mid)) lo = mid;
        else hi = mid;
      }
      return lo;
    }
    return null;
  }

  /** Can you see (or shoot) from A to B without a wall in between? */
  lineOfSight(a: Pt, b: Pt): boolean {
    return this.raycast(a.x, a.z, b.x, b.z) === null;
  }

  /** The centre of the floor tile nearest (x, z). */
  nearestFloor(x: number, z: number): Pt {
    const c0 = this.col(x);
    const r0 = this.row(z);
    for (let ring = 0; ring < Math.max(this.cols, this.rows); ring++)
      for (let dr = -ring; dr <= ring; dr++)
        for (let dc = -ring; dc <= ring; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
          if (this.isFloor(c0 + dc, r0 + dr)) return this.centre(c0 + dc, r0 + dr);
        }
    return { x, z };
  }

  /**
   * A random point on the floor, clear of the walls by `margin`, between `minDist` and `maxDist`
   * from `near` (anywhere if no `near`). Falls back to the last candidate tried.
   */
  randomFloor(rng: () => number, margin: number, near?: Pt, minDist = 0, maxDist = Infinity): Pt {
    let last: Pt = near ? { ...near } : this.centre(this.cols >> 1, this.rows >> 1);
    for (let i = 0; i < 80; i++) {
      let x: number;
      let z: number;
      if (near && Number.isFinite(maxDist)) {
        const a = rng() * Math.PI * 2;
        const d = minDist + rng() * (maxDist - minDist);
        x = near.x + Math.cos(a) * d;
        z = near.z + Math.sin(a) * d;
      } else {
        x = this.originX + rng() * this.cols * TILE;
        z = this.originZ + rng() * this.rows * TILE;
      }
      if (!this.clear(x, z, margin)) continue;
      last = { x, z };
      if (!near || Math.hypot(x - near.x, z - near.z) >= minDist) return last;
    }
    return last;
  }

  /**
   * Walking distance (in tiles, 8-way, no corner cutting) from (x, z) to every tile; -1 where it
   * can't reach. Used to steer enemies round walls toward the hero.
   */
  distanceField(x: number, z: number, out?: Int32Array): Int32Array {
    const n = this.cols * this.rows;
    const dist = out && out.length === n ? out : new Int32Array(n);
    dist.fill(-1);
    const start = this.nearestFloorTile(this.col(x), this.row(z));
    if (start < 0) return dist;
    const queue = new Int32Array(n);
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    dist[start] = 0;
    while (head < tail) {
      const i = queue[head++];
      const c = i % this.cols;
      const r = (i - c) / this.cols;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const nc = c + dc;
          const nr = r + dr;
          if (!this.isFloor(nc, nr)) continue;
          if (dr && dc && (!this.isFloor(c + dc, r) || !this.isFloor(c, r + dr))) continue; // no corner cutting
          const j = nr * this.cols + nc;
          if (dist[j] >= 0) continue;
          dist[j] = dist[i] + 1;
          queue[tail++] = j;
        }
    }
    return dist;
  }

  /** Index of the floor tile at or nearest (c, r), or -1. */
  private nearestFloorTile(c: number, r: number): number {
    if (this.isFloor(c, r)) return r * this.cols + c;
    const p = this.nearestFloor(this.originX + (c + 0.5) * TILE, this.originZ + (r + 0.5) * TILE);
    const nc = this.col(p.x);
    const nr = this.row(p.z);
    return this.isFloor(nc, nr) ? nr * this.cols + nc : -1;
  }

  /**
   * Next point to head for from (x, z) along `field` (a distanceField toward the goal): the
   * farthest of the next few tiles downhill that is still in a straight, clear line. null if
   * (x, z) can't reach the goal.
   */
  nextWaypoint(field: Int32Array, x: number, z: number, radius: number): Pt | null {
    let c = this.col(x);
    let r = this.row(z);
    if (!this.isFloor(c, r) || field[r * this.cols + c] < 0) {
      const i = this.nearestFloorTile(c, r);
      if (i < 0) return null;
      c = i % this.cols;
      r = (i - c) / this.cols;
    }
    let best: Pt | null = null;
    for (let step = 0; step < 6; step++) {
      const here = field[r * this.cols + c];
      if (here <= 0) {
        if (!best) best = this.centre(c, r);
        break;
      }
      let nc = c;
      let nr = r;
      let low = here;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const tc = c + dc;
          const tr = r + dr;
          if (!this.isFloor(tc, tr)) continue;
          const d = field[tr * this.cols + tc];
          if (d >= 0 && d < low) {
            low = d;
            nc = tc;
            nr = tr;
          }
        }
      if (nc === c && nr === r) break;
      c = nc;
      r = nr;
      const p = this.centre(c, r);
      if (step > 0 && this.raycast(x, z, p.x, p.z, radius * 0.9) !== null) break;
      best = p;
    }
    return best;
  }
}
