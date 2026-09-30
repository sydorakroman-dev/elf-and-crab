import * as THREE from 'three';
import { angleDelta, sidewaysHeading, type Crab } from '../player/crab';
import { clampToArena, pushOutOfCircles, type Circle } from './combat';
import type { Slime } from './enemies';

const RADIUS = 0.6;
const FOLLOW_SPEED = 7;
const CHARGE_SPEED = 10;
const AGGRO_RANGE = 7; // from the crab
const LEASH = 12; // won't chase slimes further than this from the elf
const PINCH_RANGE = 0.5;
const PINCH_COOLDOWN = 0.9;
const TURN_RATE = 10;

/** The crab: trots after the elf and pinches slimes that come near. */
export class Companion {
  readonly position = new THREE.Vector3();
  private readonly crab: Crab;
  private readonly velocity = new THREE.Vector3();
  private readonly goal = new THREE.Vector3();
  private heading = 0;
  private cooldown = 0;

  constructor(crab: Crab) {
    this.crab = crab;
  }

  reset(x: number, z: number): void {
    this.position.set(x, 0, z);
    this.velocity.set(0, 0, 0);
    this.heading = 0;
    this.crab.group.position.copy(this.position);
  }

  /** Returns the slime pinched this step, if any. */
  update(
    dt: number,
    elf: THREE.Vector3,
    elfFacing: number,
    slimes: readonly Slime[],
    obstacles: readonly Circle[],
    half: number,
    active: boolean,
  ): Slime | null {
    this.cooldown = Math.max(0, this.cooldown - dt);
    let pinched: Slime | null = null;

    // Target: the nearest slime close to both crab and elf, else a spot beside and behind the elf.
    let prey: Slime | null = null;
    let preyDist = AGGRO_RANGE;
    if (active) {
      for (const s of slimes) {
        if (!s.alive || Math.hypot(s.x - elf.x, s.z - elf.z) > LEASH) continue;
        const d = Math.hypot(s.x - this.position.x, s.z - this.position.z) - s.radius;
        if (d < preyDist) {
          preyDist = d;
          prey = s;
        }
      }
    }

    let maxSpeed = FOLLOW_SPEED;
    if (prey) {
      this.goal.set(prey.x, 0, prey.z);
      maxSpeed = CHARGE_SPEED;
      if (preyDist < PINCH_RANGE + RADIUS && this.cooldown === 0) {
        this.cooldown = PINCH_COOLDOWN;
        this.crab.pinch();
        pinched = prey;
      }
    } else {
      const bx = -Math.sin(elfFacing) * 2.6 + Math.cos(elfFacing) * 1.8;
      const bz = -Math.cos(elfFacing) * 2.6 - Math.sin(elfFacing) * 1.8;
      this.goal.set(elf.x + bx, 0, elf.z + bz);
    }

    // Arrive: slow down near the goal (stop short of the prey so it doesn't overlap).
    const dx = this.goal.x - this.position.x;
    const dz = this.goal.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    const stop = prey ? prey.radius + RADIUS : 0;
    const want = dist > stop + 0.05 ? Math.min(maxSpeed, (dist - stop) * 3) : 0;
    const blend = 1 - Math.exp(-10 * dt);
    this.velocity.x += ((dist ? dx / dist : 0) * want - this.velocity.x) * blend;
    this.velocity.z += ((dist ? dz / dist : 0) * want - this.velocity.z) * blend;
    this.position.addScaledVector(this.velocity, dt);
    pushOutOfCircles(this.position, RADIUS, obstacles);
    clampToArena(this.position, half, RADIUS);

    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (speed > 0.4) this.heading = sidewaysHeading(this.heading, this.velocity.x, this.velocity.z, TURN_RATE * dt);
    else if (prey) {
      // Face the prey claws-first while pinching (the model's front is local +Z).
      const delta = angleDelta(this.heading, Math.atan2(prey.x - this.position.x, prey.z - this.position.z));
      this.heading += Math.max(-TURN_RATE * dt, Math.min(TURN_RATE * dt, delta));
    }

    const g = this.crab.group;
    g.position.copy(this.position);
    g.rotation.y = this.heading;
    this.crab.update(dt, speed, false);
    return pinched;
  }
}
