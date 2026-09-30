import * as THREE from 'three';
import { attachAtPivot, bounds, loadParts, take } from './rig';

interface Limb {
  pivot: THREE.Group;
  side: number;
  phase: number;
}

/**
 * The magical crab model (public/models/crab.glb), rigged in code: legs, claws and
 * pincers are re-parented under pivots at their hips/shoulders and animated procedurally. Front faces local +Z; it walks along local ±X
 * (sideways, like a real crab). The group's origin sits at its feet.
 */
export class Crab {
  readonly group = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly legs: Limb[] = [];
  private readonly arms: Limb[] = [];
  private readonly pincers: Limb[] = [];
  private readonly magic: THREE.Object3D[] = [];
  /** Called on each scuttle step while moving; `strength` 0..1 follows speed. */
  onStep?: (strength: number) => void;
  private walkPhase = 0;
  private time = 0;
  private pinchTimer = 0;

  static async load(url: string, scale: number): Promise<Crab> {
    return new Crab(await loadParts(url), scale);
  }

  private constructor(parts: Map<string, THREE.Mesh>, scale: number) {
    this.body.scale.setScalar(scale);
    this.group.add(this.body);

    for (const side of [1, -1]) {
      for (let i = 0; i < 4; i++) {
        const upper = take(parts, `leg_${side}_${i}0`);
        const lower = take(parts, `leg_${side}_${i}1`);
        if (!upper.length) continue;
        const b = bounds(upper[0]);
        const hip = new THREE.Vector3(side > 0 ? b.min.x : b.max.x, (b.min.y + b.max.y) / 2 + 0.1, (b.min.z + b.max.z) / 2);
        const pivot = attachAtPivot(this.body, new THREE.Vector3(), hip, [...upper, ...lower]);
        // Alternate gait between neighbouring legs and between sides.
        this.legs.push({ pivot, side, phase: ((i + (side > 0 ? 0 : 1)) % 2) * Math.PI });
      }

      const arm = take(parts, `arm_${side}0`);
      if (arm.length) {
        const b = bounds(arm[0]);
        const shoulder = new THREE.Vector3(side > 0 ? b.min.x : b.max.x, b.min.y + 0.2, (b.min.z + b.max.z) / 2);
        const claw = [...arm, ...take(parts, `arm_${side}1`, `claw_palm_${side}`, `outer_pincer_${side}0`, `outer_pincer_${side}1`)];
        const pivot = attachAtPivot(this.body, new THREE.Vector3(), shoulder, claw);
        this.arms.push({ pivot, side, phase: side });

        const inner = take(parts, `inner_pincer_${side}0`, `inner_pincer_${side}1`);
        if (inner.length) {
          const pb = bounds(inner[0]);
          const base = new THREE.Vector3((pb.min.x + pb.max.x) / 2, pb.min.y, (pb.min.z + pb.max.z) / 2);
          this.pincers.push({ pivot: attachAtPivot(pivot, shoulder, base, inner), side, phase: side * 1.7 });
        }
      }
    }

    for (const [name, mesh] of parts) {
      if (name.startsWith('magic_')) {
        // Make the floating gems glow a little, especially noticeable at night.
        const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
        mat.emissive.copy(mat.color);
        mat.emissiveIntensity = 0.7;
        mesh.material = mat;
        mesh.castShadow = false;
        this.magic.push(mesh);
      }
      this.body.add(mesh);
    }
  }

  /** Snap both claws shut (used when the crab attacks). */
  pinch(): void {
    this.pinchTimer = 0.35;
  }

  /** `speed` in m/s drives the gait; legs tuck up while airborne. */
  update(dt: number, speed: number, airborne: boolean): void {
    this.time += dt;
    this.pinchTimer = Math.max(0, this.pinchTimer - dt);
    const move = Math.min(1, speed / 6);
    const before = Math.floor(this.walkPhase / Math.PI);
    this.walkPhase += dt * (3 + speed * 2.4);
    if (move > 0.15 && !airborne && Math.floor(this.walkPhase / Math.PI) !== before) this.onStep?.(move);

    for (const leg of this.legs) {
      const cycle = this.walkPhase + leg.phase;
      const lift = airborne ? 0.35 : Math.max(0, Math.sin(cycle)) * 0.4 * move;
      leg.pivot.rotation.z = lift * leg.side;
      leg.pivot.rotation.y = Math.cos(cycle) * 0.28 * move;
    }

    this.body.position.y = Math.abs(Math.sin(this.walkPhase)) * 0.05 * move + Math.sin(this.time * 2) * 0.02;
    this.body.rotation.z = Math.sin(this.walkPhase) * 0.04 * move;

    for (const arm of this.arms) {
      const wave = Math.sin(this.time * 1.6 + arm.phase) * 0.07 + (airborne ? 0.25 : 0) - (this.pinchTimer > 0 ? 0.3 : 0);
      arm.pivot.rotation.z = wave * arm.side;
    }
    for (const p of this.pincers) {
      const idle = Math.pow(Math.max(0, Math.sin(this.time * 2.3 + p.phase)), 6);
      const snap = this.pinchTimer > 0 ? 1 : idle;
      p.pivot.rotation.z = -p.side * snap * 0.5;
    }
    this.magic.forEach((m, i) => {
      m.position.y = Math.sin(this.time * 1.8 + i) * 0.12;
      m.rotation.y = this.time * 0.8;
    });
  }
}

/**
 * Crabs walk sideways: returns a new heading that turns (by at most `maxStep`) so the crab's
 * local X axis lines up with velocity (vx, vz), using whichever side needs the smaller turn.
 */
export function sidewaysHeading(heading: number, vx: number, vz: number, maxStep: number): number {
  const target = Math.atan2(-vz, vx);
  const a = angleDelta(heading, target);
  const b = angleDelta(heading, target + Math.PI);
  const delta = Math.abs(a) < Math.abs(b) ? a : b;
  return heading + Math.max(-maxStep, Math.min(maxStep, delta));
}

/** Signed shortest rotation from angle `from` to angle `to`, in (-π, π]. */
export function angleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}
