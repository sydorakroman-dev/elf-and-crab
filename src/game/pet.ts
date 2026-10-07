import * as THREE from 'three';
import { BeastVisual, type BeastPose } from './beastVisual';
import { clampToArena, pushOutOfCircles, type Circle, type Point } from './combat';

const SPEED = 9.5;
const BITE_RANGE = 1.9;
const BITE_EVERY = 0.85;
/** Where it trots when there's nothing to fight: beside and a little behind the hero. */
const HEEL = 2.6;

/**
 * The beast master's wolf (the dire wolf's model, tinted a friendly grey-blue): heels by the
 * hero, runs at the nearest awake foe close by and bites it; Sic 'Em makes it leap at one.
 * Invulnerable — it's part of the hero's kit.
 */
export class Pet {
  readonly visual = new BeastVisual('direwolf');
  private readonly pose: BeastPose = { x: 0, z: 0, yaw: 0, y: 0, speed: 0, act: 0, mode: 0, flash: 0, stun: 0, death: 0, calm: 0 };
  private biteTimer = 0;
  private leap = 0;
  private readonly leapFrom = new THREE.Vector3();
  private readonly leapEnd = new THREE.Vector3();

  constructor(x: number, z: number) {
    this.pose.x = x;
    this.pose.z = z;
    this.visual.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshToonMaterial | undefined;
      if (!m || !(o as THREE.Mesh).isMesh || o.userData.outline) return;
      (o as THREE.Mesh).material = m.clone();
      ((o as THREE.Mesh).material as THREE.MeshToonMaterial).color.lerp(new THREE.Color(0x9ab8e0), 0.35);
    });
    this.visual.apply(this.pose, 0, 0);
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

  /** Puts it at (x, z) (a new level). */
  place(x: number, z: number): void {
    this.pose.x = x;
    this.pose.z = z;
    this.leap = 0;
  }

  /** Network form: [x, z, yaw, speed, mode, y]. */
  tuple(): number[] {
    const p = this.pose;
    return [p.x, p.z, p.yaw, p.speed, p.mode, p.y].map((v) => Math.round(v * 100) / 100);
  }

  /** Shows it from a network tuple (the familiar's tablet). */
  show(t: readonly number[], dt: number, time: number): void {
    const p = this.pose;
    [p.x, p.z, p.yaw, p.speed, p.mode, p.y] = t;
    p.act = p.mode === 2 ? 1 : 0;
    this.visual.apply(p, dt, time);
  }

  /** Sic 'Em: a long leap onto (x, z). */
  leapTo(x: number, z: number): void {
    this.leap = 1;
    this.leapFrom.set(this.pose.x, 0, this.pose.z);
    this.leapEnd.set(x, 0, z);
  }

  /** Moves, and returns true on a step where it bit `foe`. */
  update(dt: number, hero: Point, foe: Point | null, obstacles: readonly Circle[], time: number): boolean {
    const p = this.pose;
    let bit = false;
    if (this.leap > 0) {
      this.leap = Math.max(0, this.leap - dt * 2.5);
      const t = 1 - this.leap;
      p.x = this.leapFrom.x + (this.leapEnd.x - this.leapFrom.x) * t;
      p.z = this.leapFrom.z + (this.leapEnd.z - this.leapFrom.z) * t;
      p.y = Math.sin(t * Math.PI) * 1.4;
      p.mode = 2;
      p.speed = SPEED;
      p.yaw = Math.atan2(this.leapEnd.x - this.leapFrom.x, this.leapEnd.z - this.leapFrom.z);
    } else {
      p.y = 0;
      this.biteTimer = Math.max(0, this.biteTimer - dt);
      // Heel beside the hero, or go for the foe.
      const goal = foe ?? { x: hero.x + HEEL, z: hero.z + HEEL * 0.5 };
      const dx = goal.x - p.x;
      const dz = goal.z - p.z;
      const d = Math.hypot(dx, dz);
      const stop = foe ? BITE_RANGE * 0.8 : 1.2;
      // Too far behind (left in another hall): catch up at once.
      if (Math.hypot(hero.x - p.x, hero.z - p.z) > 40) {
        p.x = hero.x + 1.5;
        p.z = hero.z + 1;
      } else if (d > stop) {
        const speed = Math.min(SPEED * (d > 8 ? 1.2 : 1), d * 6);
        p.x += (dx / d) * speed * dt;
        p.z += (dz / d) * speed * dt;
        p.yaw = Math.atan2(dx, dz);
        p.speed = speed;
      } else {
        p.speed = 0;
        if (foe) p.yaw = Math.atan2(dx, dz);
      }
      p.mode = 0;
      if (foe && d <= BITE_RANGE && this.biteTimer === 0) {
        this.biteTimer = BITE_EVERY;
        bit = true;
      }
      if (this.biteTimer > BITE_EVERY - 0.25) {
        p.mode = 2; // the snap
        p.act = 1;
      }
    }
    pushOutOfCircles(p, 0.7, obstacles.filter((o) => !o.low));
    clampToArena(p, 0.7);
    this.visual.apply(p, dt, time);
    return bit;
  }
}
