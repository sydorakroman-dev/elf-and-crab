import { insideArena, walkMap, type Circle, type Point } from './combat';

/** Pure power-up rules: catalogue, timers, random choice and placement (no three.js; unit tested). */

/**
 * Every power-up works for every hero: multishot = Frenzy (three shots, or swings that hit all
 * around), rapid = Haste, pierce = Might (+50% damage; shots fly through), swift = Swiftness.
 * (The ids stay as they were: they're on the wire.)
 */
export type PowerUpType = 'multishot' | 'rapid' | 'pierce' | 'shield' | 'heart' | 'swift';

export interface PowerUpDef {
  label: string;
  icon: string;
  color: number;
  /** Seconds it lasts; 0 = instant (heart). The shield also ends when it absorbs a hit. */
  duration: number;
  /** Relative chance of appearing. */
  weight: number;
}

export const POWER_UPS: Record<PowerUpType, PowerUpDef> = {
  multishot: { label: 'Frenzy', icon: '🌀', color: 0xff9a3d, duration: 12, weight: 3 },
  rapid: { label: 'Haste', icon: '⚡', color: 0xffe14d, duration: 10, weight: 3 },
  pierce: { label: 'Might', icon: '💥', color: 0xc77dff, duration: 12, weight: 2 },
  shield: { label: 'Shield', icon: '🛡️', color: 0x5ee0ff, duration: 20, weight: 2 },
  heart: { label: 'Heart', icon: '❤️', color: 0xff4d5e, duration: 0, weight: 3 },
  swift: { label: 'Swiftness', icon: '👟', color: 0x7dffb0, duration: 12, weight: 2 },
};

/** Timed effects stack by extending, up to this many seconds. */
export const MAX_STACK = 25;

/** Which timed power-ups are running and for how long. */
export class ActivePowers {
  private readonly timers = new Map<PowerUpType, number>();

  /** Starts or extends a timed power-up (instant ones are ignored here). */
  /** Adds `seconds` (default: the power-up's own duration) to a timed power-up, up to the cap. */
  add(type: PowerUpType, seconds = POWER_UPS[type].duration): void {
    const d = seconds;
    if (d <= 0) return;
    this.timers.set(type, Math.min(MAX_STACK, (this.timers.get(type) ?? 0) + d));
  }

  has(type: PowerUpType): boolean {
    return (this.timers.get(type) ?? 0) > 0;
  }

  remaining(type: PowerUpType): number {
    return this.timers.get(type) ?? 0;
  }

  /** Ends one early (e.g. the shield absorbing a hit). */
  end(type: PowerUpType): void {
    this.timers.delete(type);
  }

  clear(): void {
    this.timers.clear();
  }

  tick(dt: number): void {
    for (const [type, t] of this.timers) {
      if (t - dt <= 0) this.timers.delete(type);
      else this.timers.set(type, t - dt);
    }
  }

  /** Active power-ups with seconds left, in catalogue order. */
  list(): { type: PowerUpType; remaining: number }[] {
    return (Object.keys(POWER_UPS) as PowerUpType[]).filter((t) => this.has(t)).map((t) => ({ type: t, remaining: this.remaining(t) }));
  }
}

/** Weighted random power-up. Hearts only show up when the player is hurt. */
export function pickPowerUp(rng: () => number, health: number, maxHealth: number): PowerUpType {
  const types = (Object.keys(POWER_UPS) as PowerUpType[]).filter((t) => t !== 'heart' || health < maxHealth);
  const total = types.reduce((s, t) => s + POWER_UPS[t].weight, 0);
  let r = rng() * total;
  for (const t of types) {
    r -= POWER_UPS[t].weight;
    if (r < 0) return t;
  }
  return types[types.length - 1];
}

/**
 * A random spot on the floor near `near` (6–18 m away), clear of obstacles and the walls, and
 * not too close to any point in `avoid` (e.g. the player, so pickups don't appear underfoot).
 */
export function randomSpawnPoint(
  rng: () => number,
  near: Point,
  obstacles: readonly Circle[],
  avoid: readonly Point[],
  avoidRadius: number,
): Point {
  const map = walkMap();
  let best: Point = map.nearestFloor(near.x, near.z);
  for (let attempt = 0; attempt < 50; attempt++) {
    const p = map.randomFloor(rng, 2, near, 6, 18);
    if (!insideArena(p.x, p.z, 2)) continue;
    best = p;
    const blocked = obstacles.some((o) => Math.hypot(p.x - o.x, p.z - o.z) < o.radius + 1.5);
    const crowded = avoid.some((a) => Math.hypot(p.x - a.x, p.z - a.z) < avoidRadius);
    if (!blocked && !crowded) return p;
  }
  return best;
}

/** `count` unit directions fanned evenly around (dx, dz), `spread` radians apart. */
export function spreadDirections(dx: number, dz: number, count: number, spread: number): Point[] {
  const base = Math.atan2(dx, dz);
  return Array.from({ length: count }, (_, i) => {
    const a = base + (i - (count - 1) / 2) * spread;
    return { x: Math.sin(a), z: Math.cos(a) };
  });
}
