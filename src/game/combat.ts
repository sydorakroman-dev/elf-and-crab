/** Pure 2D (XZ-plane) geometry and rules for combat — no three.js, easy to test. */
import { WalkMap, type Shape } from './walkmap';

export interface Circle {
  x: number;
  z: number;
  radius: number;
  /** Low obstacles (e.g. a lava pit) block walking but not arrows or globs. */
  low?: boolean;
}

export interface Point {
  x: number;
  z: number;
}

/** Pushes a circle of `radius` at `p` out of every obstacle circle. Returns true if it moved. */
export function pushOutOfCircles(p: Point, radius: number, circles: readonly Circle[]): boolean {
  let moved = false;
  for (const c of circles) {
    const dx = p.x - c.x;
    const dz = p.z - c.z;
    const min = c.radius + radius;
    const d2 = dx * dx + dz * dz;
    if (d2 >= min * min) continue;
    const d = Math.sqrt(d2) || 1e-6;
    const nx = d2 === 0 ? 1 : dx / d;
    const nz = d2 === 0 ? 0 : dz / d;
    p.x = c.x + nx * min;
    p.z = c.z + nz * min;
    moved = true;
  }
  return moved;
}

/** Hall floor plans (the generator stamps halls in these shapes). */
export type ArenaShape = Shape;

let currentMap = WalkMap.fromShape('square', 28);

/** The level every walkability check uses (set when a level is built). */
export function setWalkMap(map: WalkMap): void {
  currentMap = map;
}

export function walkMap(): WalkMap {
  return currentMap;
}

/** True if (x, z) is on the floor, at least `margin` from any wall. */
export function insideArena(x: number, z: number, margin = 0): boolean {
  return margin > 0 ? currentMap.clear(x, z, margin) : currentMap.floorAt(x, z);
}

/** Keeps a circle out of the walls (sliding along them). Returns true if it was moved. */
export function clampToArena(p: Point, radius: number): boolean {
  return currentMap.clampCircle(p, radius);
}

/** Fraction along A→B (A on the floor) just before it hits a wall, `margin` in from it; null if the way is clear. */
export function arenaExit(ax: number, az: number, bx: number, bz: number, margin = 0): number | null {
  return currentMap.raycast(ax, az, bx, bz, margin);
}

/**
 * First contact of segment A→B with a circle, as a fraction t ∈ [0, 1] along the segment,
 * or null if it misses. A start point already inside the circle hits at t = 0.
 */
export function segmentCircleHit(ax: number, az: number, bx: number, bz: number, c: Circle): number | null {
  const dx = bx - ax;
  const dz = bz - az;
  const fx = ax - c.x;
  const fz = az - c.z;
  const cc = fx * fx + fz * fz - c.radius * c.radius;
  if (cc <= 0) return 0;
  const a = dx * dx + dz * dz;
  if (a === 0) return null;
  const b = 2 * (fx * dx + fz * dz);
  const disc = b * b - 4 * a * cc;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

/**
 * Aim assist: index of the target closest in angle to direction (dx, dz) from `origin`,
 * within `maxAngle` radians and `maxDist`; -1 if none qualifies.
 */
export function pickAimTarget(origin: Point, dx: number, dz: number, targets: readonly Point[], maxAngle: number, maxDist: number): number {
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len;
  const uz = dz / len;
  let best = -1;
  let bestAngle = maxAngle;
  targets.forEach((t, i) => {
    const tx = t.x - origin.x;
    const tz = t.z - origin.z;
    const dist = Math.hypot(tx, tz);
    if (dist === 0 || dist > maxDist) return;
    const angle = Math.acos(Math.max(-1, Math.min(1, (tx * ux + tz * uz) / dist)));
    if (angle <= bestAngle) {
      bestAngle = angle;
      best = i;
    }
  });
  return best;
}

/**
 * Ranged enemies hold a distance band: +1 to close in (too far), -1 to back off (too close),
 * 0 to circle (in range).
 */
export function rangeIntent(distance: number, min: number, max: number): -1 | 0 | 1 {
  if (distance > max) return 1;
  if (distance < min) return -1;
  return 0;
}
