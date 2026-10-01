import * as THREE from 'three';
import { angleDelta, sidewaysHeading } from '../player/crab';
import type { FamiliarBody } from '../player/beasts';
import { clampToArena, pushOutOfCircles, type Circle } from './combat';
import type { Slime } from './enemies';
import type { FamiliarCommand } from '../net/protocol';
import { FAMILIARS, POUNCE_WIDTH, SPELLS, SpellCooldowns, distanceToSegment, pounceLanding, type FamiliarKind, type SpellId } from './familiars';

const BITE_REACH = 1.0; // gap between body edges
const TURN_RATE = 10;
const LEAP_HEIGHT = 1.3;

export interface CompanionResult {
  /** Slime bitten / pinched this step, and how hard. */
  bitten: Slime | null;
  biteDamage: number;
  /** Spells that went off this step (cooldowns already started). */
  cast: SpellId[];
  /** Slimes struck by an in-progress pounce this step (each once per pounce). */
  pounceHits: Slime[];
  /** True on the step a pounce lands. */
  landed: boolean;
}

/**
 * The familiar: a creature (crab, capybara or wolf) a second player steers from a tablet.
 * It walks to wherever they tap, bites slimes in reach on its own, and casts its spells on
 * request (cooldowns enforced here, on the hero's machine, which runs the game). Only present
 * while a familiar is connected and has picked a creature.
 */
export class Companion {
  readonly position = new THREE.Vector3();
  readonly cooldowns = new SpellCooldowns();
  private readonly bodies: Record<FamiliarKind, FamiliarBody>;
  private readonly velocity = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private hasTarget = false;
  /** Last tapped spot (kept after arriving, used to aim a pounce). */
  private lastTap: { x: number; z: number } | null = null;
  private heading = 0;
  private biteCooldown = 0;
  private queued: SpellId[] = [];
  private _kind: FamiliarKind | null = null;
  private leap: { from: THREE.Vector3; to: THREE.Vector3; t: number; hit: Set<Slime> } | null = null;
  private _height = 0;

  constructor(bodies: Record<FamiliarKind, FamiliarBody>) {
    this.bodies = bodies;
    for (const b of Object.values(bodies)) b.group.visible = false;
  }

  get present(): boolean {
    return this._kind !== null;
  }

  get kind(): FamiliarKind | null {
    return this._kind;
  }

  get speed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  get facing(): number {
    return this.heading;
  }

  /** Height above the floor (during a pounce). */
  get height(): number {
    return this._height;
  }

  get body(): FamiliarBody | null {
    return this._kind ? this.bodies[this._kind] : null;
  }

  /** Brings in (or swaps to) a creature at (x, z). */
  appear(kind: FamiliarKind, x: number, z: number): void {
    if (this.body) this.body.group.visible = false;
    this._kind = kind;
    this.position.set(x, 0, z);
    this.velocity.set(0, 0, 0);
    this.hasTarget = false;
    this.lastTap = null;
    this.queued = [];
    this.leap = null;
    this._height = 0;
    const g = this.bodies[kind].group;
    g.visible = true;
    g.position.copy(this.position);
  }

  disappear(): void {
    if (this.body) this.body.group.visible = false;
    this._kind = null;
    this.leap = null;
  }

  /** Reset between runs: clears cooldowns and orders, keeps the creature. */
  reset(x: number, z: number): void {
    this.cooldowns.clear();
    this.biteCooldown = 0;
    if (this._kind) this.appear(this._kind, x, z);
  }

  /** Applies a move or spell command from the familiar's tablet (already validated as well-formed). */
  command(c: FamiliarCommand, half: number): void {
    if (!this._kind) return;
    if (c.type === 'spell') {
      if (FAMILIARS[this._kind].spells.includes(c.id)) this.queued.push(c.id);
      return;
    }
    if (c.type !== 'move') return;
    this.target.set(c.x, 0, c.z);
    clampToArena(this.target, half, FAMILIARS[this._kind].radius);
    this.hasTarget = true;
    this.lastTap = { x: this.target.x, z: this.target.z };
  }

  update(dt: number, slimes: readonly Slime[], obstacles: readonly Circle[], half: number): CompanionResult {
    const result: CompanionResult = { bitten: null, biteDamage: 0, cast: [], pounceHits: [], landed: false };
    const kind = this._kind;
    if (!kind) return result;
    const def = FAMILIARS[kind];
    const body = this.bodies[kind];
    this.cooldowns.tick(dt);
    this.biteCooldown = Math.max(0, this.biteCooldown - dt);

    // Spells requested since last step.
    for (const id of this.queued) {
      if (this.leap) continue; // can't cast mid-air
      if (!this.cooldowns.tryCast(id)) continue;
      result.cast.push(id);
      body.pinch();
      if (id === 'pounce') this.startPounce();
    }
    this.queued = [];

    if (this.leap) {
      this.updateLeap(dt, slimes, def.radius, half, obstacles, result);
    } else {
      this.walk(dt, def.speed, def.radius, obstacles, half);
    }

    // Bite whatever's within reach, even on the move (not mid-leap).
    let prey: Slime | null = null;
    if (!this.leap) {
      let best = BITE_REACH;
      for (const s of slimes) {
        if (!s.alive) continue;
        const gap = Math.hypot(s.x - this.position.x, s.z - this.position.z) - s.radius - def.radius;
        if (gap < best) {
          best = gap;
          prey = s;
        }
      }
      if (prey && this.biteCooldown === 0) {
        this.biteCooldown = def.biteCooldown;
        body.pinch();
        result.bitten = prey;
        result.biteDamage = def.biteDamage;
      }
    }

    // Facing: crabs scuttle sideways; others face where they're going; all face prey when fighting.
    const speed = this.speed;
    const step = TURN_RATE * dt;
    if (this.leap) {
      this.heading = Math.atan2(this.leap.to.x - this.leap.from.x, this.leap.to.z - this.leap.from.z);
    } else if (speed > 0.4) {
      if (def.gait === 'sideways') this.heading = sidewaysHeading(this.heading, this.velocity.x, this.velocity.z, step);
      else this.heading += clamp(angleDelta(this.heading, Math.atan2(this.velocity.x, this.velocity.z)), -step, step);
    } else if (prey) {
      this.heading += clamp(angleDelta(this.heading, Math.atan2(prey.x - this.position.x, prey.z - this.position.z)), -step, step);
    }

    const g = body.group;
    g.position.set(this.position.x, this._height, this.position.z);
    g.rotation.y = this.heading;
    body.update(dt, this.leap ? 0 : speed, this.leap !== null);
    return result;
  }

  private walk(dt: number, maxSpeed: number, radius: number, obstacles: readonly Circle[], half: number): void {
    let wantX = 0;
    let wantZ = 0;
    if (this.hasTarget) {
      const dx = this.target.x - this.position.x;
      const dz = this.target.z - this.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.15) this.hasTarget = false;
      else {
        const speed = Math.min(maxSpeed, dist * 4);
        wantX = (dx / dist) * speed;
        wantZ = (dz / dist) * speed;
      }
    }
    const blend = 1 - Math.exp(-12 * dt);
    this.velocity.x += (wantX - this.velocity.x) * blend;
    this.velocity.z += (wantZ - this.velocity.z) * blend;
    this.position.addScaledVector(this.velocity, dt);
    pushOutOfCircles(this.position, radius, obstacles);
    clampToArena(this.position, half, radius);
  }

  private startPounce(): void {
    const land = pounceLanding(this.position, this.lastTap, this.heading);
    this.leap = { from: this.position.clone(), to: new THREE.Vector3(land.x, 0, land.z), t: 0, hit: new Set() };
    this.hasTarget = false;
    this.velocity.set(0, 0, 0);
  }

  private updateLeap(dt: number, slimes: readonly Slime[], radius: number, half: number, obstacles: readonly Circle[], result: CompanionResult): void {
    const leap = this.leap!;
    const prev = { x: this.position.x, z: this.position.z };
    leap.t = Math.min(1, leap.t + dt / SPELLS.pounce.duration);
    this.position.lerpVectors(leap.from, leap.to, leap.t);
    clampToArena(this.position, half, radius);
    this._height = Math.sin(leap.t * Math.PI) * LEAP_HEIGHT;
    // Everything along this step's stretch of the path gets hit once.
    for (const s of slimes) {
      if (!s.alive || leap.hit.has(s)) continue;
      if (distanceToSegment(s, prev, this.position) <= s.radius + radius + POUNCE_WIDTH) {
        leap.hit.add(s);
        result.pounceHits.push(s);
      }
    }
    if (leap.t >= 1) {
      this.leap = null;
      this._height = 0;
      pushOutOfCircles(this.position, radius, obstacles);
      result.landed = true;
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
