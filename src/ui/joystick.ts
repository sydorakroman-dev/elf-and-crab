/**
 * Converts a thumb drag (screen pixels from where the touch started; +y is down) into a
 * movement vector: x right, y forward, length 0..1. Inside the dead zone it's zero, and the
 * rest of the range is rescaled so speed ramps smoothly from the edge of the dead zone.
 */
export function joystickVector(dx: number, dy: number, radius: number, deadZone = 0.15): { x: number; y: number } {
  const len = Math.hypot(dx, dy);
  const norm = Math.min(1, len / radius);
  if (norm <= deadZone || len === 0) return { x: 0, y: 0 };
  const scaled = (norm - deadZone) / (1 - deadZone);
  return { x: (dx / len) * scaled, y: (-dy / len) * scaled };
}
