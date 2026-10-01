import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { FamiliarKind } from '../game/familiars';
import { Crab } from './crab';

/** Anything that can be a familiar's body: the crab, the capybara, the wolf. */
export interface FamiliarBody {
  readonly group: THREE.Group;
  onStep?: (strength: number) => void;
  /** `speed` m/s drives the gait; `airborne` for leaps. */
  update(dt: number, speed: number, airborne: boolean): void;
  /** Attack animation (pinch / bite). */
  pinch(): void;
}

const flat = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.8, ...extra });

interface QuadOptions {
  coat: number;
  belly: number;
  dark: number;
  length: number; // body length, m
  height: number; // hip height, m
  legLength: number;
  build: (head: THREE.Group, body: THREE.Group, m: Record<string, THREE.Material>) => void;
}

/**
 * A simple four-legged low-poly creature (placeholder until real models arrive), dressed to match
 * the card art: green cape with a silver leaf clasp, silver circlet with a teal gem.
 * Front faces +Z; origin at the feet.
 */
class Quadruped implements FamiliarBody {
  readonly group = new THREE.Group();
  onStep?: (strength: number) => void;
  private readonly body = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly legs: { pivot: THREE.Group; phase: number }[] = [];
  private readonly cape: THREE.Group;
  private readonly tail: THREE.Group | null;
  private phase = 0;
  private time = 0;
  private bite = 0;

  constructor(o: QuadOptions) {
    const m = {
      coat: flat(o.coat),
      belly: flat(o.belly),
      dark: flat(o.dark),
      cape: flat(0x3b7a52, { side: THREE.DoubleSide, roughness: 0.9 }),
      silver: flat(0xd8dde2, { metalness: 0.6, roughness: 0.3 }),
      gem: flat(0x3fe0c5, { emissive: 0x2bb59f, emissiveIntensity: 0.6 }),
      eye: flat(0x111111, { roughness: 0.2 }),
    };
    this.group.add(this.body);
    this.body.position.y = o.height;

    // Torso.
    const torso = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), m.coat);
    torso.scale.set(o.length * 0.33, o.height * 0.55, o.length * 0.52);
    const chest = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), m.belly);
    chest.scale.set(o.length * 0.26, o.height * 0.42, o.length * 0.3);
    chest.position.set(0, -o.height * 0.12, o.length * 0.22);
    this.body.add(torso, chest);

    // Legs: thigh+paw, pivoting at the hip/shoulder, diagonal pairs in phase.
    const legGeo = new THREE.CylinderGeometry(o.length * 0.07, o.length * 0.06, o.legLength, 6).translate(0, -o.legLength / 2, 0);
    const pawGeo = new THREE.BoxGeometry(o.length * 0.14, o.length * 0.07, o.length * 0.18).translate(0, -o.legLength, o.length * 0.03);
    const corners: [number, number, number][] = [
      [1, 1, 0],
      [-1, 1, Math.PI],
      [1, -1, Math.PI],
      [-1, -1, 0],
    ];
    for (const [sx, sz, phase] of corners) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * o.length * 0.2, -o.height * 0.15, sz * o.length * 0.32);
      pivot.add(new THREE.Mesh(legGeo, m.coat), new THREE.Mesh(pawGeo, m.dark));
      this.body.add(pivot);
      this.legs.push({ pivot, phase });
    }

    // Head (filled in per species), with circlet.
    this.head.position.set(0, o.height * 0.45, o.length * 0.5);
    this.body.add(this.head);
    o.build(this.head, this.body, m);

    // Cape over the shoulders and back.
    // Draped over the back, hinged at the shoulders so it can flutter.
    const hinge = new THREE.Vector3(0, o.height * 0.5, o.length * 0.26);
    this.cape = new THREE.Group();
    this.cape.position.copy(hinge);
    const capeMesh = new THREE.Mesh(capeGeometry(o.length, o.height).translate(-hinge.x, -hinge.y, -hinge.z), m.cape);
    this.cape.add(capeMesh);
    const clasp = new THREE.Mesh(new THREE.OctahedronGeometry(o.length * 0.06, 0), m.silver);
    clasp.position.set(0, o.height * 0.3, o.length * 0.45);
    this.body.add(this.cape, clasp);
    this.tail = (this.body.getObjectByName('tail') as THREE.Group) ?? null;

    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) obj.castShadow = true;
    });
  }

  pinch(): void {
    this.bite = 1;
  }

  update(dt: number, speed: number, airborne: boolean): void {
    this.time += dt;
    const move = Math.min(1, speed / 8);
    const before = Math.floor(this.phase / Math.PI);
    this.phase += dt * (3 + speed * 2.2);
    if (move > 0.15 && !airborne && Math.floor(this.phase / Math.PI) !== before) this.onStep?.(move);
    this.bite = Math.max(0, this.bite - dt * 4);

    for (const leg of this.legs) {
      // Airborne: front legs reach forward, back legs stretch back.
      const reach = airborne ? (leg.pivot.position.z > 0 ? -0.9 : 0.8) : 0;
      leg.pivot.rotation.x = airborne ? reach : Math.sin(this.phase + leg.phase) * 0.6 * move;
    }
    const bob = airborne ? 0 : Math.abs(Math.sin(this.phase)) * 0.05 * move;
    this.body.position.y = this.body.userData.baseY ?? (this.body.userData.baseY = this.body.position.y);
    this.body.position.y += bob + Math.sin(this.time * 2) * 0.01;
    this.body.rotation.x = airborne ? -0.25 : 0.04 * move;
    // Bite: the head lunges forward and down.
    const lunge = Math.sin(this.bite * Math.PI);
    this.head.position.z = (this.head.userData.baseZ ?? (this.head.userData.baseZ = this.head.position.z)) + lunge * 0.18;
    this.head.rotation.x = lunge * 0.35 + Math.sin(this.time * 1.5) * 0.03;
    this.cape.rotation.x = 0.3 * move + Math.sin(this.time * 6) * 0.04 * move + (airborne ? 0.4 : 0);
    if (this.tail) this.tail.rotation.y = Math.sin(this.time * (4 + speed)) * (0.15 + 0.25 * move);
  }
}

/**
 * A cape draped over a quadruped's back: a fine grid (so it reads as cloth, with facets catching
 * the light) that follows the torso's curve, falls over the flanks and ripples into soft folds.
 */
function capeGeometry(length: number, height: number): THREE.BufferGeometry {
  const width = length * 0.78;
  const depth = length * 0.74;
  const front = length * 0.27;
  const geo = new THREE.PlaneGeometry(width, depth, 12, 10);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) / (width / 2); // -1 (left) … 1 (right)
    const v = 0.5 - pos.getY(i) / depth; // 0 (shoulders) … 1 (back hem)
    const x = u * (width / 2);
    const z = front - v * depth;
    // Height of the torso's top surface here (it's an ellipsoid), then drape past its sides.
    const ex = x / (length * 0.36);
    const ez = z / (length * 0.56);
    const inside = 1 - ex * ex - ez * ez;
    let y = inside > 0 ? height * 0.58 * Math.sqrt(inside) : 0;
    y -= Math.max(0, Math.abs(u) - 0.6) * height * 0.6; // hang over the flanks
    y -= v * v * height * 0.12; // the hem dips toward the tail
    // Folds: ripples running front-to-back, deeper toward the hem.
    y += Math.sin(u * Math.PI * 3 + v * 1.7) * length * 0.022 * (0.25 + v);
    pos.setXYZ(i, x * (1 + v * 0.12), y + height * 0.04, z);
  }
  geo.computeVertexNormals();
  return geo;
}

function circlet(head: THREE.Group, m: Record<string, THREE.Material>, radius: number, y: number, z: number): void {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, radius * 0.08, 4, 12), m.silver);
  ring.rotation.x = Math.PI / 2 - 0.25;
  ring.position.set(0, y, z);
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(radius * 0.22, 0), m.gem);
  gem.position.set(0, y + radius * 0.1, z + radius * 0.95);
  head.add(ring, gem);
}

function eyes(head: THREE.Group, m: Record<string, THREE.Material>, x: number, y: number, z: number, r: number): void {
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), m.eye);
    eye.position.set(s * x, y, z);
    head.add(eye);
  }
}

/** Capybara: round, tan, square-snouted, small ears. ~1.1 m long. */
function capybara(): FamiliarBody {
  return new Quadruped({
    coat: 0xc98a4b,
    belly: 0xd9a066,
    dark: 0x6e4528,
    length: 1.1,
    height: 0.62,
    legLength: 0.3,
    build: (head, _body, m) => {
      const skull = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.4, 0.46), m.coat);
      const snout = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.32, 0.22), m.dark);
      snout.position.set(0, -0.04, 0.3);
      head.add(skull, snout);
      for (const s of [-1, 1]) {
        const ear = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 4), m.dark);
        ear.position.set(s * 0.16, 0.22, -0.12);
        head.add(ear);
      }
      eyes(head, m, 0.16, 0.08, 0.16, 0.045);
      circlet(head, m, 0.2, 0.2, 0.02);
    },
  });
}

/** Wolf: grey with a cream chest, pointed ears, long snout and a bushy tail. ~1.3 m long. */
function wolf(): FamiliarBody {
  return new Quadruped({
    coat: 0x8a8580,
    belly: 0xd9cbb0,
    dark: 0x55504c,
    length: 1.3,
    height: 0.82,
    legLength: 0.48,
    build: (head, body, m) => {
      const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(0.24, 1), m.coat);
      skull.scale.set(1, 0.9, 1.05);
      const snout = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.4, 6).rotateX(Math.PI / 2), m.belly);
      snout.position.set(0, -0.06, 0.32);
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 4), m.eye);
      nose.position.set(0, -0.04, 0.52);
      head.add(skull, snout, nose);
      for (const s of [-1, 1]) {
        const ear = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.24, 4), m.coat);
        ear.position.set(s * 0.13, 0.27, -0.02);
        ear.rotation.z = -s * 0.2;
        head.add(ear);
      }
      eyes(head, m, 0.11, 0.07, 0.18, 0.04);
      circlet(head, m, 0.19, 0.17, 0.0);
      // Bushy tail, raised.
      const tail = new THREE.Group();
      tail.name = 'tail';
      const brush = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.6, 6).translate(0, 0.3, 0), m.coat);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 6).translate(0, 0.62, 0), m.belly);
      tail.add(brush, tip);
      tail.position.set(0, 0.12, -0.62);
      tail.rotation.x = -2.2;
      body.add(tail);
    },
  });
}

/**
 * A real model dropped into public/models/<kind>.glb, scaled to `length` metres and animated as a
 * whole (bob, waddle, lunge) since we don't know its parts.
 */
class ModelBody implements FamiliarBody {
  readonly group = new THREE.Group();
  onStep?: (strength: number) => void;
  private readonly inner: THREE.Object3D;
  private phase = 0;
  private bite = 0;

  constructor(model: THREE.Object3D, length: number) {
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const scale = length / Math.max(size.x, size.z, 1e-3);
    model.scale.multiplyScalar(scale);
    model.position.set(-((box.min.x + box.max.x) / 2) * scale, -box.min.y * scale, -((box.min.z + box.max.z) / 2) * scale);
    model.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    this.inner = new THREE.Group();
    this.inner.add(model);
    this.group.add(this.inner);
  }

  pinch(): void {
    this.bite = 1;
  }

  update(dt: number, speed: number, airborne: boolean): void {
    const move = Math.min(1, speed / 8);
    const before = Math.floor(this.phase / Math.PI);
    this.phase += dt * (3 + speed * 2.2);
    if (move > 0.15 && !airborne && Math.floor(this.phase / Math.PI) !== before) this.onStep?.(move);
    this.bite = Math.max(0, this.bite - dt * 4);
    this.inner.position.y = airborne ? 0 : Math.abs(Math.sin(this.phase)) * 0.06 * move;
    this.inner.rotation.z = Math.sin(this.phase) * 0.06 * move;
    this.inner.rotation.x = airborne ? -0.25 : Math.sin(this.bite * Math.PI) * 0.15;
    this.inner.position.z = Math.sin(this.bite * Math.PI) * 0.15;
  }
}

async function tryModel(url: string, length: number): Promise<FamiliarBody | null> {
  try {
    const gltf = await new GLTFLoader().loadAsync(url);
    return new ModelBody(gltf.scene, length);
  } catch {
    return null; // no model yet (or not a valid glb): use the placeholder
  }
}

/** Loads a body for every familiar kind: real models where present, placeholders otherwise. */
export async function loadFamiliarBodies(base: string, crabScale: number): Promise<Record<FamiliarKind, FamiliarBody>> {
  const [crab, capy, wolfModel] = await Promise.all([
    Crab.load(`${base}models/crab.glb`, crabScale),
    tryModel(`${base}models/capybara.glb`, 1.1),
    tryModel(`${base}models/wolf.glb`, 1.3),
  ]);
  return { crab, capybara: capy ?? capybara(), wolf: wolfModel ?? wolf() };
}
