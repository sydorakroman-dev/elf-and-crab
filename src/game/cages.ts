import * as THREE from 'three';
import { toonify, MONSTER_NO_OUTLINE } from '../player/toon';
import type { CampPlan, CageState } from './quests';

const TUNICS = [0x3f7fbf, 0xbf7a3f, 0x5aa05a, 0xa04a8a, 0xc9b23a, 0x6a6ab0];
const SKIN = [0xf0c8a0, 0xd8a070, 0xa0704a];

interface Captive {
  root: THREE.Group;
  arm: THREE.Object3D;
  /** Where it runs to once freed (away from the camp). */
  dir: THREE.Vector2;
}

interface Cage {
  group: THREE.Group;
  door: THREE.Group;
  ring: THREE.Mesh;
  /** The progress the ring was last drawn at. */
  ringAt: number;
  captives: Captive[];
  /** Seconds since it opened / the captives were taken. */
  since: number;
  shown: CageState;
}

/**
 * Q03's cages (docs/quests.md §6): iron-barred cages, two caravan folk in each, waving for help. A
 * golden ring fills as a player stands unlatching one; open, the door swings and they run off
 * south; taken to the keep, the cage stands empty. The same on the hero's browser and the tablet.
 */
export class CageSite {
  readonly group = new THREE.Group();
  private readonly cages: Cage[] = [];

  constructor(plan: CampPlan) {
    const iron = new THREE.MeshStandardMaterial({ color: 0x3a3632, metalness: 0.6, roughness: 0.5, flatShading: true });
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a3e22, roughness: 0.9, flatShading: true });
    const barGeo = new THREE.CylinderGeometry(0.05, 0.05, 2.2, 5).translate(0, 1.1, 0);
    plan.cages.forEach((at, i) => {
      const g = new THREE.Group();
      g.position.set(at.x, 0, at.z);
      // Facing the courtyard's centre: the door on that side.
      g.rotation.y = Math.atan2(plan.centre.x - at.x, plan.centre.z - at.z);
      const base = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.2, 2.2).translate(0, 0.1, 0), wood);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.18, 2.3).translate(0, 2.3, 0), wood);
      g.add(base, roof);
      // Bars on three sides; the fourth (front) is the door.
      for (let k = -2; k <= 2; k++)
        for (const [x, z] of [[k * 0.5, -1.05], [-1.05, k * 0.5], [1.05, k * 0.5]] as const) {
          const bar = new THREE.Mesh(barGeo, iron);
          bar.position.set(x, 0, z);
          g.add(bar);
        }
      const door = new THREE.Group();
      door.position.set(-1.05, 0, 1.05); // hinged at one corner
      for (let k = 0; k <= 4; k++) {
        const bar = new THREE.Mesh(barGeo, iron);
        bar.position.set(k * 0.525, 0, 0);
        door.add(bar);
      }
      const lock = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.28, 0.12), new THREE.MeshStandardMaterial({ color: 0xc9a040, metalness: 0.7, roughness: 0.3 }));
      lock.position.set(1.9, 1.1, 0.06);
      door.add(lock);
      g.add(door);
      // The unlatching ring on the ground in front of the door.
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.55, 0.75, 32, 1, 0, 0.001).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.9, depthWrite: false }),
      );
      ring.position.set(0, 0.05, 1.9);
      // Two captives.
      const captives: Captive[] = [];
      for (let c = 0; c < 2; c++) {
        const person = makeCaptive(TUNICS[(i * 2 + c) % TUNICS.length], SKIN[(i + c) % SKIN.length]);
        person.root.position.set(c ? 0.45 : -0.45, 0.2, c ? -0.2 : 0.25);
        g.add(person.root);
        captives.push({ ...person, dir: new THREE.Vector2(c ? 0.4 : -0.4, 1).normalize() });
      }
      toonify(g, MONSTER_NO_OUTLINE);
      g.add(ring); // after the cartoon look: the ring stays a plain glowing arc
      this.cages.push({ group: g, door, ring, ringAt: -1, captives, since: 0, shown: 'shut' });
      this.group.add(g);
    });
  }

  update(states: readonly CageState[], progress: readonly number[], dt: number, time: number): void {
    this.cages.forEach((c, i) => {
      const state = states[i] ?? 'shut';
      if (state !== c.shown) {
        c.shown = state;
        c.since = 0;
      }
      c.since += dt;
      // The unlatching ring: an arc that fills as the lock is worked.
      const p = state === 'shut' ? (progress[i] ?? 0) : 0;
      c.ring.visible = p > 0.01;
      if (c.ring.visible && Math.abs(p - c.ringAt) > 0.005) {
        c.ringAt = p;
        c.ring.geometry.dispose();
        c.ring.geometry = new THREE.RingGeometry(0.55, 0.75, 32, 1, Math.PI / 2, p * Math.PI * 2).rotateX(-Math.PI / 2);
      }
      // The door swings open.
      c.door.rotation.y = THREE.MathUtils.damp(c.door.rotation.y, state === 'open' ? -1.9 : 0, 6, dt);
      c.captives.forEach((m, k) => {
        if (state === 'shut') {
          // Waving for help, bobbing on their toes.
          m.root.visible = true;
          m.root.position.y = 0.2 + Math.abs(Math.sin(time * 5 + k * 2)) * 0.08;
          m.arm.rotation.z = -2.4 + Math.sin(time * 9 + k * 3) * 0.5;
        } else if (state === 'open') {
          // Out of the door and away, waving thanks, then gone.
          const run = Math.max(0, c.since - 0.4 - k * 0.25);
          m.root.position.set((k ? 0.45 : -0.45) + m.dir.x * run * 4.5, 0.2 + Math.abs(Math.sin(run * 14)) * 0.12, 2 * Math.min(1, run * 2) + m.dir.y * run * 4.5);
          m.root.rotation.y = run > 0 ? Math.atan2(m.dir.x, m.dir.y) : 0;
          m.arm.rotation.z = -2.4 + Math.sin(time * 12) * 0.6;
          m.root.visible = run < 3.5;
        } else m.root.visible = false; // taken to the keep
      });
    });
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}

/** A little caravan traveller: tunic, head, hood, and one waving arm. */
function makeCaptive(tunic: number, skin: number): { root: THREE.Group; arm: THREE.Object3D } {
  const root = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: tunic, roughness: 0.85, flatShading: true });
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.7, flatShading: true });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.28, 0.85, 8).translate(0, 0.55, 0), cloth);
  const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.3, 8).translate(0, 0.15, 0), new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 0.9 }));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), skinMat);
  head.position.y = 1.15;
  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), cloth);
  hood.position.y = 1.18;
  const shoulder = new THREE.Group();
  shoulder.position.set(0.22, 0.88, 0);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 6).translate(0, -0.25, 0), cloth);
  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), skinMat);
  hand.position.y = -0.52;
  shoulder.add(arm, hand);
  root.add(legs, body, head, hood, shoulder);
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  return { root, arm: shoulder };
}
