import * as THREE from 'three';
import { attachAtPivot, bounds, loadParts } from '../player/rig';
import { MONSTER_NO_OUTLINE, toonifyMeshes } from '../player/toon';
import { glowTexture } from '../util/glow';
import type { BeastKind } from './enemies';

/** Model files (public/models/beasts/) and how tall each beast stands in the world, in metres. */
export const BEAST_MODELS: Record<BeastKind, { file: string; height: number }> = {
  beetle: { file: 'armored-beetle.glb', height: 1.0 },
  snake: { file: 'venomous-snake.glb', height: 1.5 },
  direwolf: { file: 'dire-wolf.glb', height: 1.6 },
  boar: { file: 'thorn-boar.glb', height: 1.7 },
  bear: { file: 'crystal-bear.glb', height: 3.3 },
};
const MODEL_HEIGHT = 3.6; // the models are normalised to this

/** Everything needed to draw a beast at one moment (sim and familiar view alike). */
export interface BeastPose {
  x: number;
  z: number;
  yaw: number;
  y: number;
  /** Ground speed (drives the gait). */
  speed: number;
  /** Attack progress 0..1 (wind-up, lunge, pound). */
  act: number;
  /** 0 moving, 1 winding up, 2 attacking (lunge / charge / slam), 3 dazed or retreating. */
  mode: number;
  flash: number;
  stun: number;
  death: number;
  calm: number;
}

const templates = new Map<BeastKind, Map<string, THREE.Mesh>>();

/** Loads all beast models once; call before any beast is created. */
export async function loadBeastTemplates(base: string): Promise<void> {
  const kinds = Object.keys(BEAST_MODELS) as BeastKind[];
  const loaded = await Promise.all(kinds.map((k) => loadParts(`${base}models/beasts/${BEAST_MODELS[k].file}`).catch(() => null)));
  kinds.forEach((k, i) => {
    if (!loaded[i]) return;
    toonifyMeshes(loaded[i]!.values(), MONSTER_NO_OUTLINE); // the hero's cartoon look: toon bands + outlines
    templates.set(k, loaded[i]!);
  });
}

const HEAD = /^(head|muzzle|nose|nostril|snout|eye|pupil|angry_brow|ear|fang|tusk|blue_mark|great_horn|antenna)/;
const SNAKE_UPPER = /^(cobra_hood|golden_hood_front|golden_belly|head|open_mouth|eye|pupil|angry_brow|fang|venom_drop)/;
const TAIL = /^(curly_)?tail$/;
const CALM_TINT = new THREE.Color(0xf3c6ff);
const STUN_TINT = new THREE.Color(0xd8ecff);
const FLASH = new THREE.Color(0xff2020);
const ORIGIN = new THREE.Vector3();

interface Leg {
  pivot: THREE.Group;
  phase: number;
  /** Beetle legs splay sideways instead of swinging fore-aft. */
  splay: boolean;
}

/**
 * One beast's meshes, rigged in code from the shared model (cloned per beast so each can flash
 * and tint on its own): legs swing from the hips, the head nods for bites, the tail wags, the snake
 * sways and strikes. Driven entirely by a BeastPose.
 */
export class BeastVisual {
  readonly group = new THREE.Group();
  private readonly body = new THREE.Group();
  private head: THREE.Group | null = null;
  private tail: THREE.Group | null = null;
  private readonly legs: Leg[] = [];
  private readonly mats: { m: THREE.MeshToonMaterial | THREE.MeshStandardMaterial; color: THREE.Color; emissive: THREE.Color; intensity: number }[] = [];
  private readonly stars = new THREE.Group();
  private readonly kind: BeastKind;
  private readonly scale: number;
  private phase = Math.random() * 10;
  private headZ = 0;

  constructor(kind: BeastKind) {
    this.kind = kind;
    this.scale = BEAST_MODELS[kind].height / MODEL_HEIGHT;
    this.group.add(this.body);
    this.body.scale.setScalar(this.scale);
    const template = templates.get(kind);
    if (template) this.build(template);
    else {
      // No model (e.g. unit tests): a simple block so everything still works.
      const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 3).translate(0, 1, 0), new THREE.MeshStandardMaterial({ color: 0x777777 }));
      this.body.add(box);
      this.trackMaterial(box);
    }
    // Dizzy stars above the head while stunned.
    const starMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xfff27a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Sprite(starMat);
      s.scale.setScalar(0.35);
      const a = (i / 3) * Math.PI * 2;
      s.position.set(Math.cos(a) * 0.55, 0, Math.sin(a) * 0.55);
      this.stars.add(s);
    }
    this.stars.position.y = BEAST_MODELS[kind].height + 0.3;
    this.stars.visible = false;
    this.group.add(this.stars);
  }

  private trackMaterial(mesh: THREE.Mesh): void {
    const m = (mesh.material as THREE.MeshToonMaterial | THREE.MeshStandardMaterial).clone();
    mesh.material = m;
    this.mats.push({ m, color: m.color.clone(), emissive: m.emissive.clone(), intensity: m.emissiveIntensity });
  }

  private build(template: Map<string, THREE.Mesh>): void {
    const parts = new Map<string, THREE.Mesh>();
    for (const [name, mesh] of template) {
      const clone = mesh.clone();
      clone.castShadow = true;
      this.trackMaterial(clone);
      parts.set(name, clone);
    }
    const take = (re: RegExp) => [...parts.keys()].filter((n) => re.test(n)).map((n) => {
      const m = parts.get(n)!;
      parts.delete(n);
      return m;
    });

    // Legs (with their paws), pivoting at the top of each leg.
    for (const name of [...parts.keys()]) {
      const quad = /^leg_(-?1)_(\d)$/.exec(name);
      const bug = /^leg_(-?1)(\d)$/.exec(name);
      const match = quad ?? bug;
      if (!match) continue;
      const side = Number(match[1]);
      const i = Number(match[2]);
      const leg = parts.get(name)!;
      parts.delete(name);
      const paw = quad ? parts.get(`paw_${side}_${i}`) : undefined;
      if (paw) parts.delete(`paw_${side}_${i}`);
      const b = bounds(leg);
      const at = new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2);
      const pivot = attachAtPivot(this.body, ORIGIN, at, paw ? [leg, paw] : [leg]);
      // Diagonal pairs for four legs; alternating tripods for six.
      const phase = quad ? (side > 0 ? 0 : Math.PI) + (i % 2 ? Math.PI : 0) : ((i + (side > 0 ? 0 : 1)) % 2) * Math.PI;
      this.legs.push({ pivot, phase, splay: !quad });
    }

    // Head (for the snake: the whole raised hood), pivoting at the neck.
    const headParts = take(this.kind === 'snake' ? SNAKE_UPPER : HEAD);
    if (headParts.length) {
      const anchor = headParts.find((m) => m.name === (this.kind === 'snake' ? 'golden_belly' : 'head')) ?? headParts[0];
      const b = bounds(anchor);
      const at =
        this.kind === 'snake'
          ? new THREE.Vector3((b.min.x + b.max.x) / 2, b.min.y, (b.min.z + b.max.z) / 2)
          : new THREE.Vector3((b.min.x + b.max.x) / 2, b.min.y + (b.max.y - b.min.y) * 0.35, b.min.z);
      this.head = attachAtPivot(this.body, ORIGIN, at, headParts);
      this.headZ = this.head.position.z;
    }

    const tailParts = take(TAIL);
    if (tailParts.length) {
      const b = bounds(tailParts[0]);
      this.tail = attachAtPivot(this.body, ORIGIN, new THREE.Vector3((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, b.max.z), tailParts);
    }
    for (const m of parts.values()) this.body.add(m);
  }

  apply(p: BeastPose, dt: number, time: number): void {
    const g = this.group;
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = p.yaw;
    const life = 1 - p.death;
    g.scale.setScalar(Math.max(0.001, life));
    g.rotation.z = p.death * 1.2; // topples over as it dies

    const move = Math.min(1, p.speed / 5);
    const stunned = p.stun > 0.5 && p.death === 0;
    const calm = !stunned && p.calm > 0.5 && p.death === 0;
    if (!stunned) this.phase += dt * (2 + p.speed * 2.6);

    for (const leg of this.legs) {
      const s = Math.sin(this.phase + leg.phase);
      if (leg.splay) {
        leg.pivot.rotation.y = s * 0.35 * move;
        leg.pivot.rotation.z = Math.max(0, Math.cos(this.phase + leg.phase)) * 0.25 * move;
      } else {
        leg.pivot.rotation.x = s * (p.mode === 2 ? 0.9 : 0.55) * move;
      }
    }

    // Body: bob while moving; rear up for a wind-up (bear pound), dazed wobble.
    const bob = Math.abs(Math.sin(this.phase)) * 0.06 * move;
    this.body.position.y = bob / this.scale;
    this.body.rotation.x = 0;
    this.body.rotation.z = 0;
    if (this.kind === 'snake') {
      // Slither: the coil sways side to side.
      this.body.rotation.z = Math.sin(this.phase * 0.8) * 0.08 * move;
    }
    if (this.kind === 'bear' && p.mode === 1) this.body.rotation.x = -p.act * 0.45; // rearing up
    if (this.kind === 'boar' && p.mode === 2) this.body.rotation.x = 0.12; // head-down charge
    if (stunned || p.mode === 3) this.body.rotation.z = Math.sin(time * 9) * 0.12;

    // Head: snake sways and strikes; others nod into a bite / lower for a charge.
    if (this.head) {
      if (this.kind === 'snake') {
        const coil = p.mode === 1 ? -p.act * 0.35 : 0;
        const strike = p.mode === 2 ? 0.7 : 0;
        this.head.rotation.set(coil + strike, Math.sin(time * 2.2) * 0.25 * (p.mode === 0 ? 1 : 0), 0);
      } else {
        const bite = p.mode === 2 ? 0.35 : p.mode === 1 ? p.act * 0.2 : 0;
        this.head.rotation.x = bite + Math.sin(time * 1.6) * 0.03;
        this.head.position.z = this.headZ + (p.mode === 2 ? 0.25 / this.scale : 0) * 0.3;
      }
    }
    if (this.tail) this.tail.rotation.y = Math.sin(time * (3 + p.speed)) * (0.15 + 0.3 * move);

    // Hit flash, stun / calm tint.
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
