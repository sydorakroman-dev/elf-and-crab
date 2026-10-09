import * as THREE from 'three';
import type { BeastPose } from './beastVisual';
import { clampToArena, pushOutOfCircles, type Circle, type Point } from './combat';
import { ElementalVisual } from './elementalVisual';
import { TREANT_ALLY } from './progression';

const SPEED = 5.5;
const HEIGHT = 2.7;
/** Where it stands when there's nothing to fight: beside and behind the hero. */
const HEEL = 2.8;
/** Seconds to grow out of the ground / sink back. */
const GROW = 0.6;

/**
 * Call of the Forest: a treant (the woodland treant's model, tinted a friendly fresh green) that
 * rises beside the hero, stomps to the nearest awake foe close by and slams it (hurting everything
 * round where its fists land), then sinks back into the ground when its time is up. Invulnerable.
 */
export class TreantAlly {
  readonly visual = new ElementalVisual('treant', HEIGHT);
  private readonly pose: BeastPose = { x: 0, z: 0, yaw: 0, y: 0, speed: 0, act: 0, mode: 0, flash: 0, stun: 0, death: 0, calm: 0 };
  private slamTimer = 0.6;
  private age = 0;
  private grow = 0;
  /** Seconds left. */
  life: number;

  constructor(x: number, z: number, seconds: number) {
    this.pose.x = x;
    this.pose.z = z;
    this.life = seconds;
    this.visual.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const m = mesh.material as THREE.MeshToonMaterial | undefined;
      if (!mesh.isMesh || !m || o.userData.outline) return;
      mesh.material = m.clone();
      (mesh.material as THREE.MeshToonMaterial).color.lerp(new THREE.Color(0x7fe08a), 0.3);
    });
    this.apply(0, 0);
  }

  get group(): THREE.Group {
    return this.visual.group;
  }
  get x(): number {
    return this.pose.x;
  }
  get z(): number {
    return this.pose.z;
  }
  get done(): boolean {
    return this.life <= 0 && this.grow <= 0;
  }

  /**
   * Moves; returns where a slam lands this step (everything within TREANT_ALLY.radius takes the
   * hit), or null.
   */
  update(dt: number, hero: Point, foe: Point | null, obstacles: readonly Circle[], time: number): Point | null {
    const p = this.pose;
    this.age += dt;
    this.life -= dt;
    this.grow = THREE.MathUtils.clamp(this.life > 0 ? this.age / GROW : this.grow - dt / GROW, 0, 1);
    this.slamTimer = Math.max(0, this.slamTimer - dt);
    let slam: Point | null = null;
    p.mode = 0;
    p.speed = 0;
    if (this.life > 0 && this.grow >= 1) {
      const goal = foe ?? { x: hero.x - HEEL, z: hero.z - HEEL * 0.4 };
      const dx = goal.x - p.x;
      const dz = goal.z - p.z;
      const d = Math.hypot(dx, dz);
      const stop = foe ? TREANT_ALLY.reach : 1.5;
      if (Math.hypot(hero.x - p.x, hero.z - p.z) > 40) {
        p.x = hero.x - 2;
        p.z = hero.z - 1;
      } else if (d > stop) {
        const speed = Math.min(SPEED, d * 4);
        p.x += (dx / d) * speed * dt;
        p.z += (dz / d) * speed * dt;
        p.speed = speed;
      }
      if (d > 0.1) p.yaw = Math.atan2(dx, dz);
      if (foe && d <= TREANT_ALLY.reach + 0.6 && this.slamTimer === 0) {
        this.slamTimer = TREANT_ALLY.every;
        slam = { x: p.x + (dx / (d || 1)) * Math.min(d, TREANT_ALLY.reach), z: p.z + (dz / (d || 1)) * Math.min(d, TREANT_ALLY.reach) };
      }
      // Wind-up then the slam, shown by the arms.
      if (this.slamTimer > TREANT_ALLY.every - 0.35) p.mode = 2;
      p.act = p.mode === 2 ? 1 : 0;
    }
    pushOutOfCircles(p, 1, obstacles.filter((o) => !o.low));
    clampToArena(p, 1);
    this.apply(dt, time);
    return slam;
  }

  private apply(dt: number, time: number): void {
    // Rises out of the ground, and sinks back.
    this.pose.y = -(1 - this.grow) * HEIGHT;
    this.visual.apply(this.pose, dt, time);
  }

  /** Network form: [x, z, yaw, speed, mode, grow]. */
  tuple(): number[] {
    const p = this.pose;
    return [p.x, p.z, p.yaw, p.speed, p.mode, this.grow].map((v) => Math.round(v * 100) / 100);
  }

  /** Shows it from a network tuple (the familiar's tablet). */
  show(t: readonly number[], dt: number, time: number): void {
    const p = this.pose;
    [p.x, p.z, p.yaw, p.speed, p.mode, this.grow] = t;
    p.act = p.mode === 2 ? 1 : 0;
    this.apply(dt, time);
  }
}
