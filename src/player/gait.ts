/** Pure animation math for the elf's walk cycle and secondary motion (no three.js; unit tested). */

/**
 * Pose of one leg at walk-cycle phase `phase` (radians) and effort `move` (0 idle → 1 full run).
 * `hip`: thigh swing, negative = forward. `knee`: flex, ≥ 0. The knee bends most while the leg
 * swings forward (cos φ > 0), lifting the foot clear, and stays nearly straight while planted.
 */
export function legPose(phase: number, move: number): { hip: number; knee: number } {
  const amplitude = 0.22 + 0.48 * move;
  const hip = -amplitude * Math.sin(phase) * Math.min(1, move * 3);
  const swing = Math.max(0, Math.cos(phase));
  const knee = (0.35 + 0.85 * move) * Math.pow(swing, 1.4) * Math.min(1, move * 3) + 0.06 * move;
  return { hip, knee };
}

/**
 * Splits the body when the elf faces one way (aiming) but moves another: returns how far the hips
 * turn from the torso (radians, clamped to ±70°) and whether the legs walk forward (+1) or
 * backpedal (-1). Moving mostly backwards backpedals instead of twisting the hips 180°.
 */
export function splitBody(facing: number, moveYaw: number): { hipYaw: number; direction: 1 | -1 } {
  const rel = angleDelta(facing, moveYaw);
  const backwards = Math.abs(rel) > (Math.PI * 2) / 3;
  const legYaw = backwards ? angleDelta(0, rel + Math.PI) : rel;
  const limit = (70 * Math.PI) / 180;
  return { hipYaw: Math.max(-limit, Math.min(limit, legYaw)), direction: backwards ? -1 : 1 };
}

/** Walk-cycle speed (radians of phase per second) for a ground speed in m/s. */
export function cadence(speed: number): number {
  return 2.2 + speed * 1.75;
}

/** A damped spring on one value, for cloth and hair that lag, overshoot and settle. */
export class Spring {
  value: number;
  velocity = 0;
  private readonly stiffness: number;
  private readonly damping: number;

  constructor(initial = 0, stiffness = 60, damping = 8) {
    this.value = initial;
    this.stiffness = stiffness;
    this.damping = damping;
  }

  update(target: number, dt: number): number {
    // Semi-implicit Euler, sub-stepped so stiff springs stay stable at large dt.
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.velocity += (this.stiffness * (target - this.value) - this.damping * this.velocity) * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }
}

/** Signed shortest rotation from angle `from` to angle `to`, in (-π, π]. */
export function angleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

/** Frame-rate independent exponential approach of `current` toward `target`. */
export function damp(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}
