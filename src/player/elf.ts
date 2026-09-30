import * as THREE from 'three';
import { attachAtPivot, loadParts, take } from './rig';

const MODEL_SCALE = 0.42; // model is ~4.8 units tall → ~2 m
const ORIGIN = new THREE.Vector3();

interface Leg {
  pivot: THREE.Group;
  phase: number;
}

/**
 * The elf archer (public/models/elf.glb), rigged in code. Front faces local +Z, bow in the
 * +X hand. Legs walk, the free arm swings, cloak and ponytail trail behind, and while
 * aiming the bow arm swings forward and the other arm draws the string.
 */
export class Elf {
  readonly group = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly legs: Leg[] = [];
  private readonly bowArm: THREE.Group;
  private readonly drawArm: THREE.Group;
  private readonly cloak: THREE.Group;
  private readonly ponytail: THREE.Group;
  /** Called when a foot lands while walking; `strength` 0..1 follows speed. */
  onStep?: (strength: number) => void;
  private walkPhase = 0;
  private time = 0;
  private aim = 0; // 0 relaxed → 1 bow raised
  private recoil = 0;

  static async load(url: string): Promise<Elf> {
    return new Elf(await loadParts(url));
  }

  private constructor(parts: Map<string, THREE.Mesh>) {
    this.body.scale.setScalar(MODEL_SCALE);
    this.group.add(this.body);

    for (const side of [1, -1]) {
      const pivot = attachAtPivot(
        this.body,
        ORIGIN,
        new THREE.Vector3(side * 0.29, 2.35, 0),
        take(parts, `trousers_${side}0`, `trousers_${side}1`, `boot_shaft_${side}`, `boot_cuff_${side}`, `boot_foot_${side}`),
      );
      this.legs.push({ pivot, phase: side > 0 ? 0 : Math.PI });
    }

    this.drawArm = attachAtPivot(
      this.body,
      ORIGIN,
      new THREE.Vector3(-0.5, 3.5, 0),
      take(parts, 'left_sleeve', 'left_elbow', 'left_bracer', 'left_hand'),
    );
    const bowParts = Array.from({ length: 9 }, (_, i) => `wooden_bow${i}`);
    this.bowArm = attachAtPivot(
      this.body,
      ORIGIN,
      new THREE.Vector3(0.5, 3.5, 0),
      take(parts, 'right_sleeve', 'right_elbow', 'right_bracer', 'right_hand', 'bow_grip', 'bowstring', ...bowParts),
    );
    this.cloak = attachAtPivot(this.body, ORIGIN, new THREE.Vector3(0, 3.55, -0.35), take(parts, 'cloak'));
    this.ponytail = attachAtPivot(
      this.body,
      ORIGIN,
      new THREE.Vector3(0, 4.4, -0.2),
      take(parts, 'ponytail0', 'ponytail1', 'ponytail2', 'ponytail3'),
    );
    for (const mesh of parts.values()) this.body.add(mesh);
  }

  /** Kick the bow back a little when an arrow is released. */
  shoot(): void {
    this.recoil = 1;
  }

  update(dt: number, speed: number, aiming: boolean): void {
    this.time += dt;
    const move = Math.min(1, speed / 6);
    const before = Math.floor(this.walkPhase / Math.PI);
    this.walkPhase += dt * (2 + speed * 1.5);
    // Legs cross (a foot plants) every half cycle.
    if (move > 0.15 && Math.floor(this.walkPhase / Math.PI) !== before) this.onStep?.(move);
    this.aim += ((aiming ? 1 : 0) - this.aim) * (1 - Math.exp(-14 * dt));
    this.recoil = Math.max(0, this.recoil - dt * 6);

    for (const leg of this.legs) leg.pivot.rotation.x = Math.sin(this.walkPhase + leg.phase) * 0.6 * move;

    const bob = Math.abs(Math.sin(this.walkPhase)) * 0.06 * move;
    this.body.position.y = bob + Math.sin(this.time * 1.8) * 0.01;

    // Free arm swings opposite its leg; when aiming it comes forward to draw the string.
    const swing = Math.sin(this.walkPhase) * 0.45 * move;
    this.drawArm.rotation.set(swing * (1 - this.aim) - 1.35 * this.aim - 0.2 * this.recoil, 0.55 * this.aim, 0);
    // Bow arm sways at rest; swings round to point the bow forward when aiming.
    this.bowArm.rotation.set(-swing * 0.3 * (1 - this.aim) + 0.08 * this.recoil, (-Math.PI / 2) * this.aim, 0);

    // Cloth trails behind with speed and flutters a little.
    const flutter = Math.sin(this.time * 7) * 0.04 * move;
    this.cloak.rotation.x = 0.28 * move + flutter + Math.sin(this.time * 1.3) * 0.02;
    this.ponytail.rotation.x = 0.2 * move - flutter;
  }
}
