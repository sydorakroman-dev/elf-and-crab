/** Pure 2D (XZ-plane) geometry and rules for combat — no three.js, easy to test. */

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

/** Keeps a circle inside the square arena [-half, half]². Returns true if it was clamped. */
export function clampToArena(p: Point, half: number, radius: number): boolean {
  const lim = half - radius;
  const x = Math.max(-lim, Math.min(lim, p.x));
  const z = Math.max(-lim, Math.min(lim, p.z));
  const clamped = x !== p.x || z !== p.z;
  p.x = x;
  p.z = z;
  return clamped;
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
