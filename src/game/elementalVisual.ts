import * as THREE from 'three';
import { attachAtPivot, bounds, loadParts } from '../player/rig';
import { glowTexture } from '../util/glow';
import type { BeastPose } from './beastVisual';
import type { ElementalKind } from './enemies';

/** Model files (public/models/elementals/) and how tall each stands in the world, in metres. */
export const ELEMENTAL_MODELS: Record<ElementalKind, { file: string; height: number; hover: boolean }> = {
  vine: { file: 'thorn-vine.glb', height: 2.1, hover: false },
  golem: { file: 'rock-golem.glb', height: 2.7, hover: false },
  treant: { file: 'treant.glb', height: 3.1, hover: false },
  wind: { file: 'wind-elemental.glb', height: 2.5, hover: true },
  water: { file: 'water-elemental.glb', height: 2.3, hover: true },
  fire: { file: 'fire-elemental.glb', height: 2.1, hover: false },
};
const MODEL_HEIGHT = 3.6;

const templates = new Map<ElementalKind, Map<string, THREE.Mesh>>();

/** Loads all elemental models once; call before any elemental is created. */
export async function loadElementalTemplates(base: string): Promise<void> {
  const kinds = Object.keys(ELEMENTAL_MODELS) as ElementalKind[];
  const loaded = await Promise.all(kinds.map((k) => loadParts(`${base}models/elementals/${ELEMENTAL_MODELS[k].file}`).catch(() => null)));
  kinds.forEach((k, i) => {
    if (loaded[i]) templates.set(k, loaded[i]!);
  });
}

const LEG = /^(leg|foot|boot|root|thorn_leg)_(-?1)(_|$)/;
const ARM = /^(arm|fist|hand|finger|claw|thumb|thorn_arm|gust)_(-?1)(_|$)/;
const HEAD = /^(head|eye|pupil|angry_brow|face_glow|flame|bud_tip|petal|crest)/;
const CALM_TINT = new THREE.Color(0xf3c6ff);
const STUN_TINT = new THREE.Color(0xd8ecff);
const FLASH = new THREE.Color(0xff2020);
const ORIGIN = new THREE.Vector3();

/**
 * One elemental's meshes, rigged in code from its model (cloned per enemy): legs swing from the
 * hips, arms from the shoulders, the head bobs; wind and water hover, the tornado spins, fire
 * flickers. Attacks raise the arms (casting / winding up) and punch or slam them forward.
 */
export class ElementalVisual {
  readonly group = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly legs: { pivot: THREE.Group; side: number }[] = [];
  private readonly arms: { pivot: THREE.Group; side: number }[] = [];
  private head: THREE.Group | null = null;
  private spin: THREE.Object3D | null = null;
  private readonly flames: THREE.Object3D[] = [];
  private readonly mats: { m: THREE.MeshStandardMaterial; color: THREE.Color; emissive: THREE.Color; intensity: number }[] = [];
  private readonly stars = new THREE.Group();
  private readonly kind: ElementalKind;
  private readonly scale: number;
  private phase = Math.random() * 10;

  /** `height` overrides the model's usual size (the giant Inferno). */
  constructor(kind: ElementalKind, height = ELEMENTAL_MODELS[kind].height) {
    this.kind = kind;
    this.scale = height / MODEL_HEIGHT;
    this.group.add(this.body);
    this.body.scale.setScalar(this.scale);
    const template = templates.get(kind);
    if (template) this.build(template);
    else {
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.5, 3.4, 1).translate(0, 1.7, 0), new THREE.MeshStandardMaterial({ color: 0x777777 }));
      this.body.add(box);
      this.track(box);
    }
    const starMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xfff27a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Sprite(starMat);
      s.scale.setScalar(0.35);
      const a = (i / 3) * Math.PI * 2;
      s.position.set(Math.cos(a) * 0.55, 0, Math.sin(a) * 0.55);
      this.stars.add(s);
    }
    this.stars.position.y = height + 0.3;
    this.stars.visible = false;
    this.group.add(this.stars);
  }

  private track(mesh: THREE.Mesh): void {
    const m = (mesh.material as THREE.MeshStandardMaterial).clone();
    mesh.material = m;
    this.mats.push({ m, color: m.color.clone(), emissive: m.emissive.clone(), intensity: m.emissiveIntensity });
  }

  private build(template: Map<string, THREE.Mesh>): void {
    const parts = new Map<string, THREE.Mesh>();
    for (const [name, mesh] of template) {
      const clone = mesh.clone();
      clone.castShadow = true;
      this.track(clone);
      parts.set(name, clone);
    }
    const take = (test: (n: string) => boolean) => [...parts.keys()].filter(test).map((n) => {
      const m = parts.get(n)!;
      parts.delete(n);
      return m;
    });

    for (const side of [-1, 1]) {
      const legParts = take((n) => LEG.exec(n)?.[2] === String(side));
      const main = legParts.find((m) => m.name === `leg_${side}_0`);
      if (main) {
        const b = bounds(main);
        this.legs.push({ pivot: attachAtPivot(this.body, ORIGIN, new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2), legParts), side });
      } else for (const m of legParts) this.body.add(m);

      const armParts = take((n) => ARM.exec(n)?.[2] === String(side));
      const anchor = armParts.find((m) => m.name === `arm_${side}_0` || m.name === `gust_${side}`);
      if (anchor) {
        const b = bounds(anchor);
        // Shoulder: the arm's inner, upper end.
        const at = new THREE.Vector3(side > 0 ? b.min.x : b.max.x, b.max.y - (b.max.y - b.min.y) * 0.1, (b.min.z + b.max.z) / 2);
        this.arms.push({ pivot: attachAtPivot(this.body, ORIGIN, at, armParts), side });
      } else for (const m of armParts) this.body.add(m);
    }

    const headParts = take((n) => HEAD.test(n));
    if (headParts.length) {
      const anchor = headParts.find((m) => m.name === 'head') ?? headParts[0];
      const b = bounds(anchor);
      this.head = attachAtPivot(this.body, ORIGIN, new THREE.Vector3((b.min.x + b.max.x) / 2, b.min.y, (b.min.z + b.max.z) / 2), headParts);
      for (const m of headParts) if (m.name.startsWith('flame_')) this.flames.push(m);
    }
    for (const m of parts.values()) {
      if (m.name === 'vortex_body') this.spin = m;
      this.body.add(m);
    }
  }

  apply(p: BeastPose, dt: number, time: number): void {
    const g = this.group;
    const hover = ELEMENTAL_MODELS[this.kind].hover;
    g.position.set(p.x, p.y + (hover ? 0.25 + Math.sin(time * 2.2 + this.phase) * 0.12 : 0), p.z);
    g.rotation.y = p.yaw;
    const life = 1 - p.death;
    g.scale.setScalar(Math.max(0.001, life));
    g.rotation.z = p.death * 0.9;

    const move = Math.min(1, p.speed / 4);
    const stunned = p.stun > 0.5 && p.death === 0;
    const calm = !stunned && p.calm > 0.5 && p.death === 0;
    if (!stunned) this.phase += dt * (2 + p.speed * 2.2);
    const s = Math.sin(this.phase);

    for (const leg of this.legs) leg.pivot.rotation.x = s * leg.side * 0.55 * move;

    // Arms: swing while walking; raise to wind up (cast / lift for a slam), thrust forward to attack.
    for (const arm of this.arms) {
      let x = -s * arm.side * 0.4 * move;
      if (p.mode === 1) x = -1.6 * p.act; // raised overhead
      else if (p.mode === 2) x = -1.25; // thrown forward
      arm.pivot.rotation.x = x;
      arm.pivot.rotation.z = (hover ? Math.sin(time * 3 + arm.side) * 0.15 : 0) * arm.side;
    }
    if (this.head) this.head.rotation.x = Math.sin(time * 1.7 + this.phase) * 0.05 + (p.mode === 2 ? 0.15 : 0);
    this.body.position.y = (Math.abs(s) * 0.05 * move) / this.scale;
    if (stunned || p.mode === 3) this.body.rotation.z = Math.sin(time * 9) * 0.1;
    else this.body.rotation.z = 0;
    if (this.spin) this.spin.rotation.y += dt * (4 + p.speed);
    for (const [i, f] of this.flames.entries()) f.scale.y = 0.85 + Math.abs(Math.sin(time * 9 + i * 1.7)) * 0.3;

    for (const { m, color, emissive, intensity } of this.mats) {
      m.color.copy(color);
      if (stunned) m.color.lerp(STUN_TINT, 0.5);
      else if (calm) m.color.lerp(CALM_TINT, 0.55);
      if (p.flash > 0) {
        m.emissive.copy(emissive).lerp(FLASH, p.flash);
        m.emissiveIntensity = Math.max(intensity, p.flash * 1.4);
      } else {
        m.emissive.copy(emissive);
        m.emissiveIntensity = intensity;
      }
    }
    this.stars.visible = stunned;
    if (stunned) this.stars.rotation.y = time * 4;
  }
}
