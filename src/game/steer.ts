import { clampToArena, type Circle, type Point } from './combat';

interface Body {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly dying: boolean;
}

/**
 * Moves `p` in direction (dx, dz) at `speed`, steering around obstacles in the way (turning
 * toward `side` when one is dead ahead) and away from crowding neighbours. Used by every enemy
 * that walks rather than hops.
 */
export function steerMove(
  p: Point,
  dx: number,
  dz: number,
  speed: number,
  dt: number,
  radius: number,
  self: unknown,
  others: readonly Body[],
  obstacles: readonly Circle[],
  side: number,
): void {
  for (const ob of obstacles) {
    const ox = ob.x - p.x;
    const oz = ob.z - p.z;
    const d = Math.hypot(ox, oz);
    const reach = ob.radius + radius + 2;
    if (d === 0 || d > reach) continue;
    const len0 = Math.hypot(dx, dz) || 1;
    const ahead = (ox * dx + oz * dz) / (d * len0);
    if (ahead < 0.35) continue;
    const cross = dx * oz - dz * ox;
    const turn = Math.abs(cross) < 1e-3 ? side : Math.sign(cross);
    const strength = ((ahead * (reach - d)) / reach) * 2.2;
    dx += (oz / d) * turn * strength;
    dz += (-ox / d) * turn * strength;
  }
  for (const o of others) {
    if (o === self || o.dying) continue;
    const ox = p.x - o.x;
    const oz = p.z - o.z;
    const d = Math.hypot(ox, oz);
    const min = radius + o.radius + 0.2;
    if (d > 0 && d < min) {
      dx += (ox / d) * (min - d) * 1.5;
      dz += (oz / d) * (min - d) * 1.5;
    }
  }
  const len = Math.hypot(dx, dz) || 1;
  p.x += (dx / len) * speed * dt;
  p.z += (dz / len) * speed * dt;
  clampToArena(p, radius);
}
