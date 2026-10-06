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
  hitSlimes: Set<Enemy>;
}

export interface ArrowHit {
  slime: Enemy;
  dirX: number;
  dirZ: number;
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
      const glow = new THREE.Sprite(pierceGlow);
      glow.scale.set(0.9, 0.9, 1);
      glow.position.z = 0.5;
      glow.visible = false;
      mesh.add(glow);
      mesh.userData.glow = glow;
      mesh.visible = false;
      this.group.add(mesh);
      this.arrows.push({ mesh, dir: new THREE.Vector3(), life: 0, stuck: 0, active: false, pierce: false, hitSlimes: new Set() });
    }
  }

  fire(x: number, z: number, dir: { x: number; z: number }, pierce = false): void {
    // Reuse a free arrow, or the oldest stuck one.
    const a = this.arrows.find((a) => !a.active) ?? this.arrows.reduce((o, a) => (a.stuck && a.stuck < o.stuck ? a : o));
    a.active = true;
    a.life = LIFETIME;
    a.stuck = 0;
    a.pierce = pierce;
    a.hitSlimes.clear();
    a.dir.set(dir.x, 0, dir.z).normalize();
    a.mesh.userData.glow.visible = pierce;
    a.mesh.position.set(x, HEIGHT, z);
    a.mesh.rotation.set(0, Math.atan2(a.dir.x, a.dir.z), 0);
    a.mesh.visible = true;
  }

  /** Visible arrows (flying or stuck) for a network snapshot. */
  snapshot(): ArrowTuple[] {
    const out: ArrowTuple[] = [];
    this.arrows.forEach((a, i) => {
      if (a.active) out.push([i, q(a.mesh.position.x), q(a.mesh.position.z), q(a.mesh.rotation.y), a.pierce ? 1 : 0]);
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
      a.mesh.userData.glow.visible = pierce === 1;
    }
    this.arrows.forEach((a, i) => {
      if (!seen.has(i)) a.mesh.visible = false;
    });
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
        hits.push({ slime: hitSlime, dirX: a.dir.x, dirZ: a.dir.z });
        a.hitSlimes.add(hitSlime);
        p.x += (bx - p.x) * bestT;
        p.z += (bz - p.z) * bestT;
      } else if (hitSlime) {
        hits.push({ slime: hitSlime, dirX: a.dir.x, dirZ: a.dir.z });
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

