import * as THREE from 'three';
import { segmentCircleHit, type Circle, type Point } from './combat';
import type { Spit } from './enemies';
import { glowTexture } from '../util/glow';

const SPEED = 11;
const RADIUS = 0.3;
const LIFETIME = 2.2;
const HEIGHT = 1.0;
const POOL = 24;
export const GLOB_COLOR = new THREE.Color(0x6fd0ff);

interface Glob {
  mesh: THREE.Group;
  dirX: number;
  dirZ: number;
  life: number;
  active: boolean;
}

export interface GlobImpact {
  x: number;
  z: number;
  /** True if it hit the player (vs. a wall or pillar). */
  hitPlayer: boolean;
}

/** Pooled slime globs spat by spitters: fly flat, splash on the player, walls or pillars. */
export class Globs {
  readonly group = new THREE.Group();
  private readonly globs: Glob[] = [];

  constructor() {
    const coreGeo = new THREE.IcosahedronGeometry(RADIUS, 1);
    const coreMat = new THREE.MeshStandardMaterial({ color: 0x5cc8ff, emissive: GLOB_COLOR, emissiveIntensity: 0.8, flatShading: true });
    const glowMat = new THREE.SpriteMaterial({
      map: glowTexture(),
      color: GLOB_COLOR,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    for (let i = 0; i < POOL; i++) {
      const mesh = new THREE.Group();
      const glow = new THREE.Sprite(glowMat);
      glow.scale.setScalar(1.6);
      mesh.add(new THREE.Mesh(coreGeo, coreMat), glow);
      mesh.visible = false;
      this.group.add(mesh);
      this.globs.push({ mesh, dirX: 0, dirZ: 0, life: 0, active: false });
    }
  }

  fire(spit: Spit): void {
    const g = this.globs.find((g) => !g.active);
    if (!g) return;
    g.active = true;
    g.life = LIFETIME;
    g.dirX = spit.dirX;
    g.dirZ = spit.dirZ;
    g.mesh.position.set(spit.x, HEIGHT, spit.z);
    g.mesh.visible = true;
  }

  clear(): void {
    for (const g of this.globs) {
      g.active = false;
      g.mesh.visible = false;
    }
  }

  /**
   * Moves globs. `player` is null while it can't be hit (dashing / invulnerable), in which
   * case globs fly straight through. Returns where globs burst this step.
   */
  update(dt: number, time: number, player: (Point & { radius: number }) | null, obstacles: readonly Circle[], half: number): GlobImpact[] {
    const impacts: GlobImpact[] = [];
    for (const g of this.globs) {
      if (!g.active) continue;
      g.life -= dt;
      const p = g.mesh.position;
      const bx = p.x + g.dirX * SPEED * dt;
      const bz = p.z + g.dirZ * SPEED * dt;

      let bestT = Infinity;
      let hitPlayer = false;
      if (player) {
        const t = segmentCircleHit(p.x, p.z, bx, bz, { x: player.x, z: player.z, radius: player.radius + RADIUS });
        if (t !== null) {
          bestT = t;
          hitPlayer = true;
        }
      }
      for (const o of obstacles) {
        const t = segmentCircleHit(p.x, p.z, bx, bz, { x: o.x, z: o.z, radius: o.radius + RADIUS });
        if (t !== null && t < bestT) {
          bestT = t;
          hitPlayer = false;
        }
      }
      const lim = half - RADIUS;
      const outside = Math.abs(bx) > lim || Math.abs(bz) > lim;

      if (bestT !== Infinity || outside || g.life <= 0) {
        const t = bestT === Infinity ? 1 : bestT;
        impacts.push({ x: p.x + (bx - p.x) * t, z: p.z + (bz - p.z) * t, hitPlayer });
        g.active = false;
        g.mesh.visible = false;
        continue;
      }
      p.x = bx;
      p.z = bz;
      p.y = HEIGHT + Math.sin(time * 18 + g.dirX * 10) * 0.06;
      g.mesh.rotation.y += dt * 6;
    }
    return impacts;
  }
}
