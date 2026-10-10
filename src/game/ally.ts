import * as THREE from 'three';
import type { BeastPose } from './beastVisual';
import { clampToArena, pushOutOfCircles, type Circle, type Point } from './combat';
import { ElementalVisual } from './elementalVisual';
import { MonsterVisual } from './monsterVisual';
import { TREANT_ALLY } from './progression';
import { KNIGHT } from './quests';

/**
 * Who fights beside the hero:
 * - **treant:** Call of the Forest, the elf's skill tree.
 * - **aldric:** Sir Aldric's spirit, freed in the Crypt (Q02, docs/quests.md).
 */
export type AllyKind = 'treant' | 'aldric';
export const ALLY_KINDS: AllyKind[] = ['treant', 'aldric']; // index = wire code

interface AllyLook {
  /** Builds its visual. */
  make: () => { group: THREE.Group; apply: (p: BeastPose, dt: number, time: number) => void };
  height: number;
  speed: number;
  /** Its strike: every `every` s, reaching `reach` m, hurting everything within `radius` of where it lands. */
  every: number;
  reach: number;
  radius: number;
  /** Seconds to rise into the world / fade away. */
  grow: number;
  /** Rises out of the ground (the treant), or fades in like a ghost (Sir Aldric). */
  ghost: boolean;
  /** Tint: colour, and how far toward it. */
  tint: [number, number];
}

const LOOKS: Record<AllyKind, AllyLook> = {
  treant: { make: () => new ElementalVisual('treant', 2.7), height: 2.7, speed: 5.5, every: TREANT_ALLY.every, reach: TREANT_ALLY.reach, radius: TREANT_ALLY.radius, grow: 0.6, ghost: false, tint: [0x7fe08a, 0.3] },
  aldric: { make: () => new MonsterVisual('knight'), height: 2.4, speed: 6.5, every: KNIGHT.ally.every, reach: 1.8, radius: KNIGHT.ally.radius, grow: 0.9, ghost: true, tint: [0x8fc8ff, 0.65] },
};

/** Where it stands when there's nothing to fight: beside and behind the hero. */
const HEEL = 2.8;

/**
 * An ally: rises (or fades in) beside the hero, goes for the nearest awake foe close by and strikes
 * it (hurting everything round where the blow lands), and leaves when its time is up. It can't be
 * hurt. The hero's browser runs it; the tablet shows it from the snapshot.
 */
export class Ally {
  readonly kind: AllyKind;
  private readonly look: AllyLook;
  private readonly visual: ReturnType<AllyLook['make']>;
  private readonly mats: THREE.Material[] = [];
  private readonly pose: BeastPose = { x: 0, z: 0, yaw: 0, y: 0, speed: 0, act: 0, mode: 0, flash: 0, stun: 0, death: 0, calm: 0 };
  private strikeTimer = 0.6;
  private age = 0;
  private grow = 0;
  /** Seconds left (Infinity: until told to go). */
  life: number;

  constructor(kind: AllyKind, x: number, z: number, seconds: number) {
    this.kind = kind;
    this.look = LOOKS[kind];
    this.visual = this.look.make();
    this.pose.x = x;
    this.pose.z = z;
    this.life = seconds;
    const [color, k] = this.look.tint;
    this.visual.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const m = mesh.material as THREE.MeshToonMaterial | undefined;
      if (!mesh.isMesh || !m) return;
      if (o.userData.outline) {
        if (this.look.ghost) o.visible = false; // a ghost has no hard outline
        return;
      }
      const c = m.clone();
      c.color.lerp(new THREE.Color(color), k);
      if (this.look.ghost) {
        c.transparent = true;
        c.depthWrite = false;
        if ('emissive' in c) c.emissive.setHex(0x2a5a9a);
      }
      mesh.material = c;
      this.mats.push(c);
    });
    this.apply(0, 0);
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
  get done(): boolean {
    return this.life <= 0 && this.grow <= 0;
  }

  /** Tells it to go (fading / sinking away). */
  dismiss(): void {
    this.life = Math.min(this.life, 0);
  }

  /** Moves; returns where its blow lands this step, or null. */
  update(dt: number, hero: Point, foe: Point | null, obstacles: readonly Circle[], time: number): Point | null {
    const p = this.pose;
    const look = this.look;
    this.age += dt;
    this.life -= dt;
    this.grow = THREE.MathUtils.clamp(this.life > 0 ? this.age / look.grow : this.grow - dt / look.grow, 0, 1);
    this.strikeTimer = Math.max(0, this.strikeTimer - dt);
    let strike: Point | null = null;
    p.mode = 0;
    p.speed = 0;
    if (this.life > 0 && this.grow >= 1) {
      const goal = foe ?? { x: hero.x - HEEL, z: hero.z - HEEL * 0.4 };
      const dx = goal.x - p.x;
      const dz = goal.z - p.z;
      const d = Math.hypot(dx, dz);
      const stop = foe ? look.reach : 1.5;
      if (Math.hypot(hero.x - p.x, hero.z - p.z) > 40) {
        p.x = hero.x - 2;
        p.z = hero.z - 1;
      } else if (d > stop) {
        const speed = Math.min(look.speed, d * 4);
        p.x += (dx / d) * speed * dt;
        p.z += (dz / d) * speed * dt;
        p.speed = speed;
      }
      if (d > 0.1) p.yaw = Math.atan2(dx, dz);
      if (foe && d <= look.reach + 0.6 && this.strikeTimer === 0) {
        this.strikeTimer = look.every;
        const r = Math.min(d, look.reach);
        strike = { x: p.x + (dx / (d || 1)) * r, z: p.z + (dz / (d || 1)) * r };
      }
      // The blow, shown by the arms.
      if (this.strikeTimer > look.every - 0.35) p.mode = 2;
      p.act = p.mode === 2 ? 1 : 0;
    }
    pushOutOfCircles(p, 1, obstacles.filter((o) => !o.low));
    clampToArena(p, 1);
    this.apply(dt, time);
    return strike;
  }

  private apply(dt: number, time: number): void {
    if (this.look.ghost) {
      // Fades in and out, and floats a little.
      this.pose.y = 0.15 + Math.sin(time * 2) * 0.08;
      for (const m of this.mats) (m as THREE.MeshToonMaterial).opacity = 0.62 * this.grow;
      this.visual.group.visible = this.grow > 0.01;
    } else this.pose.y = -(1 - this.grow) * this.look.height; // rises out of the ground, and sinks back
    this.visual.apply(this.pose, dt, time);
  }

  /** Network form: [kind, x, z, yaw, speed, mode, grow]. */
  tuple(): number[] {
    const p = this.pose;
    return [ALLY_KINDS.indexOf(this.kind), ...[p.x, p.z, p.yaw, p.speed, p.mode, this.grow].map((v) => Math.round(v * 100) / 100)];
  }

  /** Shows it from a network tuple (the familiar's tablet). */
  show(t: readonly number[], dt: number, time: number): void {
    const p = this.pose;
    [, p.x, p.z, p.yaw, p.speed, p.mode, this.grow] = t;
    p.act = p.mode === 2 ? 1 : 0;
    this.apply(dt, time);
  }
}
