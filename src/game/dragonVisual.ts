import * as THREE from 'three';
import { attachAtPivot, bounds, loadParts } from '../player/rig';
import { MONSTER_NO_OUTLINE, toonifyMeshes } from '../player/toon';
import { glowTexture } from '../util/glow';
import type { BeastPose } from './beastVisual';

/** Small dragon parts that shouldn't get an outline (on top of the monster list). */
const NO_OUTLINE = new RegExp(`${MONSTER_NO_OUTLINE.source}|plate|nostril|jaw_mouth|spike|horn|claw|thumb|finger|tooth|membrane`);
const ORIGIN = new THREE.Vector3();
const NECK_BASE = new THREE.Vector3(0, 3.3, 1.3);
const JAW_HINGE = new THREE.Vector3(0, 5.0, 2.85);
const TAIL_BASE = new THREE.Vector3(0, 2.6, -1.6);
const STUN_TINT = new THREE.Color(0xd8ecff);
const FLASH = new THREE.Color(0xff2020);

let template: Map<string, THREE.Mesh> | null = null;

/** Loads the Ash King's model once; call before the boss is created. */
export async function loadDragonTemplate(base: string): Promise<void> {
  try {
    const parts = await loadParts(`${base}models/ashking.glb`);
    toonifyMeshes(parts.values(), NO_OUTLINE);
    template = parts;
  } catch {
    template = null; // shows a placeholder block
  }
}

/**
 * The Ash King (public/models/ashking.glb, built by scripts/models/build-dragon.mjs), rigged in
 * code by part name: four legs stride, the wings beat (and rise high to wind up a big attack), the
 * neck rears back and the jaw drops before fire, the tail sways. Model units are metres.
 */
export class DragonVisual {
  readonly group = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly legs: { pivot: THREE.Group; phase: number }[] = [];
  private readonly wings: { pivot: THREE.Group; side: number }[] = [];
  private neck: THREE.Group | null = null;
  private jaw: THREE.Group | null = null;
  private tail: THREE.Group | null = null;
  private readonly mats: { m: THREE.MeshToonMaterial; color: THREE.Color; emissive: THREE.Color; intensity: number }[] = [];
  private readonly stars = new THREE.Group();
  private phase = 0;

  constructor() {
    this.group.add(this.body);
    if (template) this.build(template);
    else {
      const box = new THREE.Mesh(new THREE.BoxGeometry(3, 4, 5).translate(0, 2, 0), new THREE.MeshToonMaterial({ color: 0xc8322a }));
      this.body.add(box);
      this.track(box);
    }
    const starMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xfff27a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Sprite(starMat);
      s.scale.setScalar(0.6);
      const a = (i / 4) * Math.PI * 2;
      s.position.set(Math.cos(a) * 1.1, 0, Math.sin(a) * 1.1);
      this.stars.add(s);
    }
    this.stars.position.set(0, 6.6, 2.8);
    this.stars.visible = false;
    this.group.add(this.stars);
  }

  private track(mesh: THREE.Mesh): void {
    mesh.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || o.userData.outline) return;
      const m = (o.material as THREE.MeshToonMaterial).clone();
      o.material = m;
      this.mats.push({ m, color: m.color.clone(), emissive: m.emissive.clone(), intensity: m.emissiveIntensity });
    });
  }

  private build(src: Map<string, THREE.Mesh>): void {
    const parts = new Map<string, THREE.Mesh>();
    for (const [name, mesh] of src) {
      const clone = mesh.clone();
      clone.castShadow = true;
      this.track(clone);
      parts.set(name, clone);
    }
    const take = (test: (n: string) => boolean) => {
      const out = [...parts.keys()].filter(test).map((n) => parts.get(n)!);
      for (const m of out) parts.delete(m.name);
      return out;
    };
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const meshes = take((n) => n.startsWith(`leg_${sx}_${sz}`));
        const top = meshes.find((m) => m.name === `leg_${sx}_${sz}`);
        if (!top) continue;
        const b = bounds(top);
        const hip = new THREE.Vector3((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2 + 0.2, (b.min.z + b.max.z) / 2);
        this.legs.push({ pivot: attachAtPivot(this.body, ORIGIN, hip, meshes), phase: sx * sz > 0 ? 0 : Math.PI });
      }
    for (const side of [-1, 1]) {
      const meshes = take((n) => n.startsWith(`wing_${side}_`));
      if (meshes.length) this.wings.push({ pivot: attachAtPivot(this.body, ORIGIN, new THREE.Vector3(side * 1.0, 3.7, 0.5), meshes), side });
    }
    const jawMeshes = take((n) => n.startsWith('jaw'));
    const neckMeshes = take((n) => n.startsWith('neck') || n.startsWith('head'));
    if (neckMeshes.length) {
      this.neck = attachAtPivot(this.body, ORIGIN, NECK_BASE, neckMeshes);
      if (jawMeshes.length) this.jaw = attachAtPivot(this.neck, NECK_BASE, JAW_HINGE, jawMeshes);
    }
    const tailMeshes = take((n) => n.startsWith('tail'));
    if (tailMeshes.length) this.tail = attachAtPivot(this.body, ORIGIN, TAIL_BASE, tailMeshes);
    for (const m of parts.values()) this.body.add(m);
  }

  apply(p: BeastPose, dt: number, time: number): void {
    const g = this.group;
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = p.yaw;
    g.scale.setScalar(Math.max(0.001, 1 - p.death));
    g.rotation.z = p.death * 0.6;

    const move = Math.min(1, p.speed / 4);
    const stunned = p.stun > 0.5 && p.death === 0;
    if (!stunned) this.phase += dt * (1.6 + Math.min(p.speed, 18) * 1.1);
    const s = Math.sin(this.phase);
    const windup = p.mode === 1 ? p.act : 0;
    const attack = p.mode === 2 ? 1 : 0;

    for (const leg of this.legs) leg.pivot.rotation.x = Math.sin(this.phase + leg.phase) * 0.45 * move;
    this.body.position.y = Math.abs(s) * 0.08 * move + Math.sin(time * 1.4) * 0.04;
    this.body.rotation.x = -0.12 * windup + 0.1 * attack;

    // Wings: slow idle beats; flap hard while moving fast; raised high to wind up.
    const beat = Math.sin(time * (1.6 + move * 3)) * (0.12 + 0.25 * move);
    for (const w of this.wings) {
      w.pivot.rotation.z = w.side * (beat - 0.55 * windup + 0.25 * attack);
      w.pivot.rotation.y = -w.side * 0.15 * windup;
    }
    if (this.neck) {
      // Rear back to wind up, lunge forward to strike / breathe; idle sway.
      this.neck.rotation.x = -0.35 * windup + 0.3 * attack + Math.sin(time * 1.1) * 0.04;
      this.neck.rotation.y = Math.sin(time * 0.7) * 0.12 * (1 - move);
    }
    if (this.jaw) this.jaw.rotation.x = 0.5 * Math.max(windup, attack) + Math.max(0, Math.sin(time * 2.3)) * 0.05;
    if (this.tail) this.tail.rotation.y = Math.sin(time * 1.5 + this.phase * 0.3) * (0.18 + 0.15 * move);

    for (const { m, color, emissive, intensity } of this.mats) {
      m.color.copy(color);
      if (stunned) m.color.lerp(STUN_TINT, 0.45);
      if (p.flash > 0) {
        m.emissive.copy(emissive).lerp(FLASH, p.flash);
        m.emissiveIntensity = Math.max(intensity, p.flash * 1.2);
      } else {
        m.emissive.copy(emissive);
        m.emissiveIntensity = intensity;
      }
    }
    this.stars.visible = stunned;
    if (stunned) this.stars.rotation.y = time * 4;
  }
}
