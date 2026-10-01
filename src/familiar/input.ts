/** Pure helpers for the familiar's tap controls (unit tested). */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Where a camera ray hits the floor (y = 0), clamped inside the arena (keeping `margin` from the
 * walls). Null if the ray points up or along the floor, so it can never reach it.
 */
export function floorPoint(origin: Vec3, dir: Vec3, half: number, margin: number): { x: number; z: number } | null {
  if (dir.y > -1e-6) return null;
  const t = -origin.y / dir.y;
  if (t < 0) return null;
  const lim = half - margin;
  return {
    x: Math.max(-lim, Math.min(lim, origin.x + dir.x * t)),
    z: Math.max(-lim, Math.min(lim, origin.z + dir.z * t)),
  };
}

/**
 * Camera distance (along its view direction) that fits a square arena of half-size `half`
 * on screen for the given vertical FOV, view pitch and aspect ratio.
 */
export function overviewDistance(half: number, fovDeg: number, pitch: number, aspect: number): number {
  const tanV = Math.tan((fovDeg * Math.PI) / 360);
  // Depth of the arena as seen at this pitch, and its width.
  const depth = 2 * half * Math.sin(pitch) + 6;
  const width = 2 * half + 4;
  const forHeight = depth / (2 * tanV);
  const forWidth = width / (2 * tanV * aspect);
  return Math.max(forHeight, forWidth);
}
