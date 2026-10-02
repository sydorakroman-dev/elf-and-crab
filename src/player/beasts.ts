import * as THREE from 'three';
import type { FamiliarKind } from '../game/familiars';
import { Crab } from './crab';
import { attachAtPivot, bounds, loadParts } from './rig';
import { toonify } from './toon';

/** Anything that can be a familiar's body: the crab, the capybara, the wolf, the goldfish. */
export interface FamiliarBody {
  readonly group: THREE.Group;
  onStep?: (strength: number) => void;
  /** `speed` m/s drives the gait; `airborne` for leaps. */
  update(dt: number, speed: number, airborne: boolean): void;
  /** Attack animation (pinch / bite). */
  pinch(): void;
}

/** Small or thin parts that shouldn't get an outline (and the fishbowl's water, pebbles and bubbles). */
const NO_OUTLINE = /pupil|shine|nostril|mouth|smile|gem|clasp|circlet|magic_|brow|lid_|rune|rivet|bowl_(glass|water|surface|glint|pebble|weed|bubble)/;

/**
 * A capybara, wolf or goldfish (public/models/<kind>.glb, built by scripts/models/build-familiars.mjs),
 * rigged in code by part name: four legs swing from hip and shoulder in a diagonal gait, the head
 * lunges to bite, the tail wags, the cape flutters with speed; the body bobs. Front faces +Z;
 * origin at the feet; model units are metres.
 */
class Quadruped implements FamiliarBody {
  readonly group = new THREE.Group();
  onStep?: (strength: number) => void;
  private readonly body = new THREE.Group();
  private readonly head: THREE.Group;
  private readonly legs: { pivot: THREE.Group; phase: number; front: boolean }[] = [];
  private readonly cape: THREE.Group | null;
  private readonly tail: THREE.Group | null;
  private phase = 0;
  private time = 0;
  private bite = 0;

  constructor(parts: Map<string, THREE.Mesh>) {
    this.group.add(this.body);
    const grab = (test: (name: string) => boolean) => {
      const out: THREE.Mesh[] = [];
      for (const [name, mesh] of parts) if (test(name)) out.push(mesh);
      for (const mesh of out) parts.delete(mesh.name);
      return out;
    };
    const box = (meshes: THREE.Mesh[]) => meshes.reduce((b, m) => b.union(bounds(m)), new THREE.Box3());

    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const meshes = grab((n) => n.startsWith(`leg_${sx}_${sz}`));
        if (!meshes.length) continue;
        const b = bounds(meshes.find((m) => m.name === `leg_${sx}_${sz}`) ?? meshes[0]);
        const hip = new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y - 0.04, (b.min.z + b.max.z) / 2);
        // Diagonal pairs move together (front-left with back-right).
        this.legs.push({ pivot: attachAtPivot(this.body, ORIGIN, hip, meshes), phase: sx * sz > 0 ? 0 : Math.PI, front: sz > 0 });
      }

    const headMeshes = grab((n) => n.startsWith('head'));
    const hb = box(headMeshes);
    this.head = attachAtPivot(this.body, ORIGIN, new THREE.Vector3(0, hb.min.y + (hb.max.y - hb.min.y) * 0.3, hb.min.z), headMeshes);

    const tailMeshes = grab((n) => n.startsWith('tail'));
    const tb = box(tailMeshes);
    this.tail = tailMeshes.length ? attachAtPivot(this.body, ORIGIN, new THREE.Vector3(0, tb.min.y + 0.06, tb.max.z), tailMeshes) : null;

    const capeMeshes = grab((n) => n === 'cape');
    const cb = box(capeMeshes);
    this.cape = capeMeshes.length ? attachAtPivot(this.body, ORIGIN, new THREE.Vector3(0, cb.max.y, cb.max.z), capeMeshes) : null;

    for (const mesh of parts.values()) this.body.add(mesh);
    toonify(this.group, NO_OUTLINE);
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
      leg.pivot.rotation.x = airborne ? (leg.front ? -0.9 : 0.8) : Math.sin(this.phase + leg.phase) * 0.6 * move;
    }
    const bob = airborne ? 0 : Math.abs(Math.sin(this.phase)) * 0.04 * move;
    this.body.position.y = bob + Math.sin(this.time * 2) * 0.008;
    this.body.rotation.x = airborne ? -0.25 : 0.03 * move;
    // Bite: the head lunges forward and down; idle, it bobs and glances.
    const lunge = Math.sin(this.bite * Math.PI);
    this.head.position.z = (this.head.userData.baseZ ??= this.head.position.z) + lunge * 0.14;
    this.head.rotation.set(lunge * 0.35 + Math.sin(this.time * 1.5) * 0.04, Math.sin(this.time * 0.7) * 0.12 * (1 - move), 0);
    if (this.cape) this.cape.rotation.x = -(0.18 * move + Math.sin(this.time * 6) * 0.03 * move + (airborne ? 0.3 : 0));
    if (this.tail) this.tail.rotation.y = Math.sin(this.time * (4 + speed)) * (0.15 + 0.25 * move);
  }
}

const ORIGIN = new THREE.Vector3();

/** Loads a body for every familiar kind. */
export async function loadFamiliarBodies(base: string, crabScale: number): Promise<Record<FamiliarKind, FamiliarBody>> {
  const [crab, capy, wolf, fish] = await Promise.all([
    Crab.load(`${base}models/crab.glb`, crabScale),
    loadParts(`${base}models/capybara.glb`),
    loadParts(`${base}models/wolf.glb`),
    loadParts(`${base}models/fishbowl.glb`),
  ]);
  return { crab, capybara: new Quadruped(capy), wolf: new Quadruped(wolf), goldfish: new Quadruped(fish) };
}
