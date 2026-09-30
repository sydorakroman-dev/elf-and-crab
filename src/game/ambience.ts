import type { Point } from './combat';

export interface FireSource {
  position: Point;
  strength: number;
}

/** Distance (m) at which a strength-1 fire is heard at half loudness. */
const HALF_DISTANCE = 6;

/**
 * How loud nearby fires are for a listener (level 0..1) and where they sit left/right
 * (pan -1..1) relative to the listener's right-hand direction (rightX, rightZ).
 */
export function fireAmbience(listener: Point, rightX: number, rightZ: number, sources: readonly FireSource[]): { level: number; pan: number } {
  let level = 0;
  let pan = 0;
  for (const s of sources) {
    const dx = s.position.x - listener.x;
    const dz = s.position.z - listener.z;
    const d = Math.hypot(dx, dz);
    const w = s.strength / (1 + (d / HALF_DISTANCE) ** 2);
    level += w;
    if (d > 0) pan += w * ((dx * rightX + dz * rightZ) / d);
  }
  return { level: Math.min(1, level), pan: level > 0 ? Math.max(-1, Math.min(1, pan / level)) : 0 };
}
