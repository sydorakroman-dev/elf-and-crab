import * as THREE from 'three';
import { BeastVisual, type BeastPose } from './beastVisual';
import { pushOutOfCircles, type Circle } from './combat';
import { glowTexture } from '../util/glow';
import type { WalkMap } from './walkmap';
import type { FoxPlan, FoxState } from './quests';

const FOX_ORANGE = new THREE.Color(0xe8782a);
const LANTERN = 0xffc45a;

/** A fox: the dire wolf's model, small and fox-orange, with a glowing lantern tail. */
function makeFox(scale: number): { visual: BeastVisual; tail: THREE.Sprite } {
  const visual = new BeastVisual('direwolf');
  visual.group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const m = mesh.material as THREE.MeshToonMaterial | undefined;
    if (!mesh.isMesh || !m || o.userData.outline) return;
    mesh.material = m.clone();
    (mesh.material as THREE.MeshToonMaterial).color.lerp(FOX_ORANGE, 0.75);
  });
  visual.group.scale.setScalar(scale);
  const tail = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: LANTERN, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  tail.scale.setScalar(1.6);
  tail.position.set(0, 1.1, -1.6); // behind (the model faces +z), at tail height before scaling
  visual.group.add(tail);
  return { visual, tail };
}

const SPEED = 6.5;
/** It trots this far behind whoever leads it. */
const HEEL = 1.6;

/**
 * Q01's lost fox kit: follows its leader (the familiar, or the hero playing solo) round the walls,
 * cowers and hides when monsters are near, and runs into its den once home. Invulnerable — foes
 * ignore it. The hero's browser moves it; the tablet shows it from the snapshot.
 */
export class FoxKit {
  private readonly fox = makeFox(0.36);
  private readonly pose: BeastPose = { x: 0, z: 0, yaw: Math.PI, y: 0, speed: 0, act: 0, mode: 0, flash: 0, stun: 0, death: 0, calm: 0 };
  private field: Int32Array | null = null;
  private fieldFor = { c: -1, r: -1 };
  private refieldIn = 0;
  private cower = 0;

  constructor(x: number, z: number) {
    this.pose.x = x;
    this.pose.z = z;
    this.fox.visual.apply(this.pose, 0, 0);
  }

  get group(): THREE.Group {
    return this.fox.visual.group;
  }
  get x(): number {
    return this.pose.x;
  }
  get z(): number {
    return this.pose.z;
  }

  /** Moves for this step: toward `leader` (following), still and cowering (hiding), or into the den (home). */
  update(dt: number, state: FoxState, leader: { x: number; z: number } | null, den: { x: number; z: number }, map: WalkMap, obstacles: readonly Circle[], time: number): void {
    const p = this.pose;
    p.speed = 0;
    const goal = state === 'following' ? leader : state === 'home' ? den : null;
    if (goal) {
      const near = state === 'following' ? HEEL : 0.3;
      const d = Math.hypot(goal.x - p.x, goal.z - p.z);
      if (d > near) {
        // Round the walls: follow a walking-distance field toward the goal (rebuilt as the goal moves).
        const c = map.col(goal.x);
        const r = map.row(goal.z);
        this.refieldIn -= dt;
        if (!this.field || ((c !== this.fieldFor.c || r !== this.fieldFor.r) && this.refieldIn <= 0)) {
          this.field = map.distanceField(goal.x, goal.z, this.field ?? undefined);
          this.fieldFor = { c, r };
          this.refieldIn = 0.4;
        }
        const way = d < 3 ? goal : (map.nextWaypoint(this.field, p.x, p.z, 0.4) ?? goal);
        const dx = way.x - p.x;
        const dz = way.z - p.z;
        const w = Math.hypot(dx, dz) || 1;
        const speed = Math.min(SPEED * (d > 8 ? 1.3 : 1), d * 5);
        p.x += (dx / w) * speed * dt;
        p.z += (dz / w) * speed * dt;
        p.yaw = Math.atan2(dx, dz);
        p.speed = speed;
      }
    }
    pushOutOfCircles(p, 0.35, obstacles.filter((o) => !o.low));
    map.clampCircle(p, 0.35);
    this.cower = THREE.MathUtils.damp(this.cower, state === 'hiding' ? 1 : 0, 8, dt);
    this.show(state, dt, time);
  }

  private show(state: FoxState, dt: number, time: number): void {
    const p = this.pose;
    // Hiding: crouched and trembling, the tail light flickering low.
    p.y = -0.12 * this.cower;
    this.fox.visual.apply(p, dt, time);
    if (this.cower > 0.05) this.group.rotation.z = Math.sin(time * 40) * 0.05 * this.cower;
    const flicker = this.cower > 0.5 ? 0.35 + Math.abs(Math.sin(time * 13)) * 0.3 : 0.85 + Math.sin(time * 3) * 0.1;
    this.fox.tail.material.opacity = flicker;
    // Gone into the den once home.
    this.group.visible = state !== 'closed' && !(state === 'home' && Math.hypot(p.x - this.denX, p.z - this.denZ) < 0.6);
  }

  private denX = Infinity;
  private denZ = Infinity;
  setDen(d: { x: number; z: number }): void {
    this.denX = d.x;
    this.denZ = d.z;
  }

  /** Network form: [x, z, yaw, speed]. */
  tuple(): number[] {
    const p = this.pose;
    return [p.x, p.z, p.yaw, p.speed].map((v) => Math.round(v * 100) / 100);
  }

  /** The tablet: shows it from the snapshot. */
  showFrom(t: readonly number[], state: FoxState, dt: number, time: number): void {
    const p = this.pose;
    [p.x, p.z, p.yaw, p.speed] = t;
    this.cower = THREE.MathUtils.damp(this.cower, state === 'hiding' ? 1 : 0, 8, dt);
    this.show(state, dt, time);
  }
}

/**
 * Q01's places: lantern paw prints along the way home (brighter while the kit is being led), the den
 * at the Hollow Oak's foot and the burrow's far end by the guardian's hall (both glowing once the
 * family opens them), and the mother fox, who comes out when her kit is home.
 */
export class FoxSite {
  readonly group = new THREE.Group();
  private readonly prints: THREE.InstancedMesh;
  private readonly printMat: THREE.MeshBasicMaterial;
  private readonly glows: THREE.Sprite[] = [];
  private readonly mother = makeFox(0.6);
  private readonly motherPose: BeastPose = { x: 0, z: 0, yaw: 0, y: 0, speed: 0, act: 0, mode: 0, flash: 0, stun: 0, death: 0, calm: 0 };
  private open = 0;

  constructor(plan: FoxPlan) {
    // Paw prints: pairs of little ovals, facing along the trail.
    const paw = new THREE.CircleGeometry(0.11, 10).scale(1, 1.4, 1).rotateX(-Math.PI / 2);
    this.printMat = new THREE.MeshBasicMaterial({ color: LANTERN, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false });
    this.prints = new THREE.InstancedMesh(paw, this.printMat, plan.trail.length * 2);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    plan.trail.forEach((t, i) => {
      const next = plan.trail[i + 1] ?? plan.den;
      const yaw = Math.atan2(next.x - t.x, next.z - t.z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      for (const side of [-1, 1]) {
        v.set(t.x + Math.cos(yaw) * 0.16 * side, 0.03, t.z - Math.sin(yaw) * 0.16 * side + (side > 0 ? 0.25 : 0));
        this.prints.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), m.compose(v, q, one));
      }
    });
    this.group.add(this.prints);
    // The two burrows: an earth mound with a dark mouth, and a lantern glow once open.
    for (const at of [plan.den, plan.exit]) {
      const burrow = new THREE.Group();
      const mound = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.45, 1), new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 1, flatShading: true }));
      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.5, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x120a04 }));
      hole.position.y = 0.5;
      hole.scale.set(1, 1, 0.8);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: LANTERN, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.scale.setScalar(3);
      glow.position.y = 0.9;
      burrow.add(mound, hole, glow);
      burrow.position.set(at.x, 0, at.z);
      mound.castShadow = mound.receiveShadow = true;
      this.glows.push(glow);
      this.group.add(burrow);
    }
    this.motherPose.x = plan.den.x + 1.4;
    this.motherPose.z = plan.den.z + 0.8;
    this.motherPose.yaw = Math.PI * 0.85;
    this.mother.visual.group.visible = false;
    this.group.add(this.mother.visual.group);
  }

  update(state: FoxState, dt: number, time: number): void {
    const led = state === 'following' || state === 'hiding';
    this.printMat.opacity = led ? 0.55 + Math.sin(time * 4) * 0.15 : state === 'waiting' ? 0.22 : 0.12;
    this.open = THREE.MathUtils.damp(this.open, state === 'home' ? 1 : 0, 3, dt);
    for (const g of this.glows) g.material.opacity = this.open * (0.7 + Math.sin(time * 3) * 0.15);
    this.mother.visual.group.visible = state === 'home';
    if (state === 'home') {
      this.mother.visual.apply(this.motherPose, dt, time);
      this.mother.tail.material.opacity = 0.8 + Math.sin(time * 2.5) * 0.15;
    }
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}
