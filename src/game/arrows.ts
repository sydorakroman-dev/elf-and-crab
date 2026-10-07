import * as THREE from 'three';
import { arenaExit, segmentCircleHit, type Circle } from './combat';
import type { Enemy } from './enemies';
import { glowTexture } from '../util/glow';
import { q, type ArrowTuple } from '../net/snapshot';

const SPEED = 42;
const LIFETIME = 1.4;
const STUCK_TIME = 4;
const HEIGHT = 1.3;
const POOL = 90; // rapid fire + multishot keeps a lot in the air

interface Arrow {
  mesh: THREE.Group;
  dir: THREE.Vector3;
  life: number;
  stuck: number; // > 0 while embedded in a wall or pillar
  active: boolean;
  /** Piercing arrows fly through slimes, hitting each one once. */
  pierce: boolean;
  enchant: number;
  /** 0 an arrow, 1 a magic bolt (the mage), 2 a spear (the beast master). */
  look: number;
  hitSlimes: Set<Enemy>;
}

export interface ArrowHit {
  slime: Enemy;
  dirX: number;
  dirZ: number;
  /** Spell enchantments the arrow carried (ENCHANT_* bits). */
  enchant: number;
}

/** Arrow enchantments from the elf's spells (bits). */
export const ENCHANT_FIRE = 1;
export const ENCHANT_FROST = 2;
export const ENCHANT_CHAIN = 4;
/** Glow colour for an arrow: piercing purple, or its enchantment's. */
function glowColor(pierce: boolean, enchant: number): number {
  if (enchant & ENCHANT_FIRE) return 0xff7a2a;
  if (enchant & ENCHANT_FROST) return 0x9fe4ff;
  if (enchant & ENCHANT_CHAIN) return 0xfff27a;
  return pierce ? 0xc77dff : 0xffffff;
}

/** Pooled arrows that fly flat at chest height, hit slimes, and stick in walls and pillars. */
export class Arrows {
  readonly group = new THREE.Group();
  private readonly arrows: Arrow[] = [];

  constructor() {
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, flatShading: true });
    const steel = new THREE.MeshStandardMaterial({ color: 0xd8dde2, metalness: 0.6, roughness: 0.3, flatShading: true });
    const feather = new THREE.MeshStandardMaterial({ color: 0xf1ead8, side: THREE.DoubleSide });
    const shaftGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.1, 5).rotateX(Math.PI / 2);
    const headGeo = new THREE.ConeGeometry(0.07, 0.22, 5).rotateX(Math.PI / 2).translate(0, 0, 0.64);
    const pierceGlow = new THREE.SpriteMaterial({
      map: glowTexture(),
      color: 0xc77dff,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    const fletchGeo = new THREE.PlaneGeometry(0.16, 0.26).rotateX(Math.PI / 2).translate(0, 0, -0.42);
    for (let i = 0; i < POOL; i++) {
      const mesh = new THREE.Group();
      const f1 = new THREE.Mesh(fletchGeo, feather);
      const f2 = new THREE.Mesh(fletchGeo, feather);
      f2.rotation.z = Math.PI / 2;
      mesh.add(new THREE.Mesh(shaftGeo, wood), new THREE.Mesh(headGeo, steel), f1, f2);
      mesh.traverse((o) => (o.castShadow = true));
      const glow = new THREE.Sprite(pierceGlow.clone());
      glow.scale.set(0.9, 0.9, 1);
      glow.position.z = 0.5;
      glow.visible = false;
      mesh.add(glow);
      mesh.userData.glow = glow;
      mesh.visible = false;
      this.group.add(mesh);
      this.arrows.push({ mesh, dir: new THREE.Vector3(), life: 0, stuck: 0, active: false, pierce: false, enchant: 0, look: 0, hitSlimes: new Set() });
    }
  }

  fire(x: number, z: number, dir: { x: number; z: number }, pierce = false, enchant = 0, look = 0): void {
    // Reuse a free arrow, or the oldest stuck one.
    const a = this.arrows.find((a) => !a.active) ?? this.arrows.reduce((o, a) => (a.stuck && a.stuck < o.stuck ? a : o));
    a.active = true;
    a.life = LIFETIME;
    a.stuck = 0;
    a.pierce = pierce;
    a.enchant = enchant;
    a.look = look;
    a.hitSlimes.clear();
    a.dir.set(dir.x, 0, dir.z).normalize();
    this.setLook(a.mesh, look);
    this.setGlow(a.mesh, pierce, enchant, look);
    a.mesh.position.set(x, HEIGHT, z);
    a.mesh.rotation.set(0, Math.atan2(a.dir.x, a.dir.z), 0);
    a.mesh.visible = true;
  }

  /** Visible arrows (flying or stuck) for a network snapshot. */
  snapshot(): ArrowTuple[] {
    const out: ArrowTuple[] = [];
    this.arrows.forEach((a, i) => {
      if (a.active) out.push([i, q(a.mesh.position.x), q(a.mesh.position.z), q(a.mesh.rotation.y), (a.pierce ? 1 : 0) | (a.enchant << 1) | (a.look << 4)]);
    });
    return out;
  }

  /** Shows exactly these arrows (familiar's view; no simulation). */
  sync(list: readonly ArrowTuple[]): void {
    const seen = new Set<number>();
    for (const [i, x, z, yaw, pierce] of list) {
      const a = this.arrows[i];
      if (!a) continue;
      seen.add(i);
      a.mesh.visible = true;
      a.mesh.position.set(x, HEIGHT, z);
      a.mesh.rotation.set(0, yaw, 0);
      this.setLook(a.mesh, (pierce >> 4) & 3);
      this.setGlow(a.mesh, (pierce & 1) === 1, (pierce >> 1) & 7, (pierce >> 4) & 3);
    }
    this.arrows.forEach((a, i) => {
      if (!seen.has(i)) a.mesh.visible = false;
    });
  }

  private setGlow(mesh: THREE.Group, pierce: boolean, enchant: number, look = 0): void {
    const glow = mesh.userData.glow as THREE.Sprite;
    glow.visible = pierce || enchant > 0 || look === 1;
    if (glow.visible) glow.material.color.setHex(look === 1 && !enchant ? 0x8fb8ff : glowColor(pierce && look !== 1, enchant));
    glow.scale.setScalar(look === 1 ? 1.5 : 0.9);
  }

  /** An arrow, a magic bolt (just the glow), or a spear (long, no feathers). */
  private setLook(mesh: THREE.Group, look: number): void {
    const [shaft, head, f1, f2] = mesh.children;
    shaft.visible = head.visible = look !== 1;
    f1.visible = f2.visible = look === 0;
    mesh.scale.set(1, 1, look === 2 ? 1.8 : 1);
  }

  clear(): void {
    for (const a of this.arrows) {
      a.active = false;
      a.mesh.visible = false;
    }
  }

  /** Moves arrows and returns the slimes they hit this step. */
  update(dt: number, slimes: readonly Enemy[], obstacles: readonly Circle[]): ArrowHit[] {
    const hits: ArrowHit[] = [];
    for (const a of this.arrows) {
      if (!a.active) continue;
      if (a.stuck > 0) {
        a.stuck -= dt;
        if (a.stuck <= 0) {
          a.active = false;
          a.mesh.visible = false;
        }
        continue;
      }
      a.life -= dt;
      const p = a.mesh.position;
      const bx = p.x + a.dir.x * SPEED * dt;
      const bz = p.z + a.dir.z * SPEED * dt;

      // Nearest thing along this step: a slime, a pillar, or the wall.
      let bestT = Infinity;
      let hitSlime: Enemy | null = null;
      for (const s of slimes) {
        if (!s.alive || s.hidden || a.hitSlimes.has(s)) continue;
        const t = segmentCircleHit(p.x, p.z, bx, bz, { x: s.x, z: s.z, radius: s.radius + 0.15 });
        if (t !== null && t < bestT) {
          bestT = t;
          hitSlime = s;
        }
      }
      let solid = false;
      for (const o of obstacles) {
        if (o.low) continue; // arrows fly over pits
        const t = segmentCircleHit(p.x, p.z, bx, bz, o);
        if (t !== null && t < bestT) {
          bestT = t;
          hitSlime = null;
          solid = true;
        }
      }
      const wallT = arenaExit(p.x, p.z, bx, bz);
      if (wallT !== null && wallT < bestT) {
        bestT = wallT;
        hitSlime = null;
        solid = true;
      }

      if (hitSlime && a.pierce) {
        // Punch through: register the hit and keep flying from here this step.
        hits.push({ slime: hitSlime, dirX: a.dir.x, dirZ: a.dir.z, enchant: a.enchant });
        a.hitSlimes.add(hitSlime);
        p.x += (bx - p.x) * bestT;
        p.z += (bz - p.z) * bestT;
      } else if (hitSlime) {
        hits.push({ slime: hitSlime, dirX: a.dir.x, dirZ: a.dir.z, enchant: a.enchant });
        a.active = false;
        a.mesh.visible = false;
      } else if (solid) {
        // Embed the tip a little way into whatever it hit.
        p.x += (bx - p.x) * bestT + a.dir.x * 0.35;
        p.z += (bz - p.z) * bestT + a.dir.z * 0.35;
        a.stuck = STUCK_TIME;
      } else if (a.life <= 0) {
        a.active = false;
        a.mesh.visible = false;
      } else {
        p.x = bx;
        p.z = bz;
      }
    }
    return hits;
  }
}

