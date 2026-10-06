import type { Point } from './combat';

export interface FireSource {
  position: Point;
  strength: number;
}

/** Distance (m) at which a strength-1 fire is heard at half loudness. */
const HALF_DISTANCE = 6;
/** Fires further than this (m) aren't heard at all. */
const MAX_DISTANCE = 25;
/** Only the nearest few fires count (a level has dozens of torches; they mustn't add up to a roar). */
const LOUDEST = 3;

/**
 * How loud nearby fires are for a listener (level 0..1) and where they sit left/right
 * (pan -1..1) relative to the listener's right-hand direction (rightX, rightZ).
 */
export function fireAmbience(listener: Point, rightX: number, rightZ: number, sources: readonly FireSource[]): { level: number; pan: number } {
  const heard: { w: number; side: number }[] = [];
  for (const s of sources) {
    const dx = s.position.x - listener.x;
    const dz = s.position.z - listener.z;
    const d = Math.hypot(dx, dz);
    if (d > MAX_DISTANCE) continue;
    // Fades out over the last 10 m to MAX_DISTANCE.
    const w = (s.strength / (1 + (d / HALF_DISTANCE) ** 2)) * Math.min(1, (MAX_DISTANCE - d) / 10);
    heard.push({ w, side: d > 0 ? (dx * rightX + dz * rightZ) / d : 0 });
  }
  heard.sort((a, b) => b.w - a.w);
  let level = 0;
  let pan = 0;
  for (const h of heard.slice(0, LOUDEST)) {
    level += h.w;
    pan += h.w * h.side;
  }
  return { level: Math.min(1, level), pan: level > 0 ? Math.max(-1, Math.min(1, pan / level)) : 0 };
}
