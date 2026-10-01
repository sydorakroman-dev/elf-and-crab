import * as THREE from 'three';
import { angleDelta, sidewaysHeading, type Crab } from '../player/crab';
import { clampToArena, pushOutOfCircles, type Circle } from './combat';
import type { Slime } from './enemies';
import type { FamiliarCommand } from '../net/protocol';

const RADIUS = 0.6;
const SPEED = 8;
const PINCH_REACH = 1.0; // gap between crab and slime edges
const PINCH_COOLDOWN = 1.0;
const TURN_RATE = 10;
export const BURST_RADIUS = 5.5;
export const BURST_STUN = 2.5;
export const BURST_COOLDOWN = 12;

export interface CompanionResult {
  /** Slime pinched this step, if any. */
  pinched: Slime | null;
  /** True on the step a Magic Burst goes off. */
  burst: boolean;
}

/**
 * The familiar's crab. A second player steers it from a tablet: it walks to wherever they tap,
 * pinches any slime within reach on its own, and fires a Magic Burst on request (cooldown is
 * enforced here, on the hero's machine, which runs the game). Only present while a familiar
 * is connected.
 */
export class Companion {
  readonly position = new THREE.Vector3();
  private readonly crab: Crab;
  private readonly velocity = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private hasTarget = false;
  private heading = 0;
  private pinchCooldown = 0;
  private burstQueued = false;
  private _burstCooldown = 0;
  private _present = false;

  constructor(crab: Crab) {
    this.crab = crab;
    crab.group.visible = false;
  }

  get present(): boolean {
    return this._present;
  }

  /** Seconds until the Magic Burst is ready again. */
  get burstCooldown(): number {
    return this._burstCooldown;
  }

  get speed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  get facing(): number {
    return this.heading;
  }

  appear(x: number, z: number): void {
    this._present = true;
    this.position.set(x, 0, z);
    this.velocity.set(0, 0, 0);
    this.hasTarget = false;
    this.burstQueued = false;
    this.crab.group.visible = true;
    this.crab.group.position.copy(this.position);
  }

  disappear(): void {
    this._present = false;
    this.crab.group.visible = false;
  }

  /** Reset between runs: keeps presence, clears cooldowns and orders. */
  reset(x: number, z: number): void {
    this._burstCooldown = 0;
    this.pinchCooldown = 0;
    if (this._present) this.appear(x, z);
  }

  /** Applies a command from the familiar's tablet (already validated as well-formed). */
  command(c: FamiliarCommand, half: number): void {
    if (!this._present) return;
    if (c.type === 'burst') {
      this.burstQueued = true;
      return;
    }
    this.target.set(c.x, 0, c.z);
    clampToArena(this.target, half, RADIUS);
    this.hasTarget = true;
  }

  update(dt: number, slimes: readonly Slime[], obstacles: readonly Circle[], half: number): CompanionResult {
    const result: CompanionResult = { pinched: null, burst: false };
    if (!this._present) return result;
    this.pinchCooldown = Math.max(0, this.pinchCooldown - dt);
    this._burstCooldown = Math.max(0, this._burstCooldown - dt);

    if (this.burstQueued) {
      this.burstQueued = false;
      if (this._burstCooldown === 0) {
        this._burstCooldown = BURST_COOLDOWN;
        result.burst = true;
        this.crab.pinch();
      }
    }

    // Walk to the tapped spot, easing in on arrival.
    let wantX = 0;
    let wantZ = 0;
    if (this.hasTarget) {
      const dx = this.target.x - this.position.x;
      const dz = this.target.z - this.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.15) this.hasTarget = false;
      else {
        const speed = Math.min(SPEED, dist * 4);
        wantX = (dx / dist) * speed;
        wantZ = (dz / dist) * speed;
      }
    }
    const blend = 1 - Math.exp(-12 * dt);
    this.velocity.x += (wantX - this.velocity.x) * blend;
    this.velocity.z += (wantZ - this.velocity.z) * blend;
    this.position.addScaledVector(this.velocity, dt);
    pushOutOfCircles(this.position, RADIUS, obstacles);
    clampToArena(this.position, half, RADIUS);

    // Pinch whatever's within reach, even on the move.
    let prey: Slime | null = null;
    let preyGap = PINCH_REACH;
    for (const s of slimes) {
      if (!s.alive) continue;
      const gap = Math.hypot(s.x - this.position.x, s.z - this.position.z) - s.radius - RADIUS;
      if (gap < preyGap) {
        preyGap = gap;
        prey = s;
      }
    }
    if (prey && this.pinchCooldown === 0) {
      this.pinchCooldown = PINCH_COOLDOWN;
      this.crab.pinch();
      result.pinched = prey;
    }

    // Scuttle sideways while moving; face the prey claws-first when standing and fighting.
    const speed = this.speed;
    if (speed > 0.4) this.heading = sidewaysHeading(this.heading, this.velocity.x, this.velocity.z, TURN_RATE * dt);
    else if (prey) {
      const delta = angleDelta(this.heading, Math.atan2(prey.x - this.position.x, prey.z - this.position.z));
      this.heading += Math.max(-TURN_RATE * dt, Math.min(TURN_RATE * dt, delta));
    }

    const g = this.crab.group;
    g.position.copy(this.position);
    g.rotation.y = this.heading;
    this.crab.update(dt, speed, false);
    return result;
  }
}
