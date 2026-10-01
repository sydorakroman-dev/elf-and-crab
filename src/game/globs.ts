import * as THREE from 'three';
import { segmentCircleHit, type Circle, type Point } from './combat';
import type { Spit } from './enemies';
import { glowTexture } from '../util/glow';
import { q, type GlobTuple } from '../net/snapshot';

/** Enemy projectiles: spitter globs, and the wind / water / fire elementals' bolts. */
export type ProjectileKind = 'glob' | 'gust' | 'water' | 'fire';
export const PROJECTILE_KINDS: ProjectileKind[] = ['glob', 'gust', 'water', 'fire'];

/** How each kind looks and flies. Damage and effects are applied by the game (see balance.ts). */
export const PROJECTILES: Record<ProjectileKind, { speed: number; radius: number; color: number }> = {
  glob: { speed: 11, radius: 0.3, color: 0x6fd0ff },
  gust: { speed: 14, radius: 0.35, color: 0xdfeaff },
  water: { speed: 12, radius: 0.3, color: 0x2f9fd8 },
  fire: { speed: 13, radius: 0.32, color: 0xff7a2a },
};

const LIFETIME = 2.2;
const HEIGHT = 1.0;
const POOL = 40;
export const GLOB_COLOR = new THREE.Color(PROJECTILES.glob.color);

interface Glob {
  mesh: THREE.Group;
  looks: Record<ProjectileKind, THREE.Object3D>;
  kind: ProjectileKind;
  dirX: number;
  dirZ: number;
  life: number;
  active: boolean;
}

export interface GlobImpact {
  x: number;
  z: number;
  kind: ProjectileKind;
  /** True if it hit the player (vs. a wall or pillar). */
  hitPlayer: boolean;
}

/** Pooled enemy projectiles: fly flat, burst on the player, walls or pillars. */
export class Globs {
  readonly group = new THREE.Group();
  private readonly globs: Glob[] = [];

  constructor() {
    const glow = (color: number, size: number) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      s.scale.setScalar(size);
      return s;
    };
    const glob = () => {
      const g = new THREE.Group();
      g.add(
        new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 1), new THREE.MeshStandardMaterial({ color: 0x5cc8ff, emissive: GLOB_COLOR, emissiveIntensity: 0.8, flatShading: true })),
        glow(PROJECTILES.glob.color, 1.6),
      );
      return g;
    };
    const gust = () => {
      // A little whirl of air.
      const g = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: 0xeef4ff, transparent: true, opacity: 0.85 });
      for (let i = 0; i < 2; i++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.28 - i * 0.1, 0.05, 4, 12), mat);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = i * 0.12;
        g.add(ring);
      }
      g.add(glow(PROJECTILES.gust.color, 1.4));
      return g;
    };
    const water = () => {
      const g = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: 0x2f9fd8, roughness: 0.15, metalness: 0.2, flatShading: true });
      const drop = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), mat);
      drop.scale.set(1, 1, 1.4);
      g.add(drop, glow(0x7fd8ff, 1.2));
      return g;
    };
    const fire = () => {
      const g = new THREE.Group();
      g.add(
        new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 1), new THREE.MeshStandardMaterial({ color: 0xffb04a, emissive: 0xff5a10, emissiveIntensity: 1.6, flatShading: true })),
        glow(0xff8a3d, 2.0),
      );
      return g;
    };
    for (let i = 0; i < POOL; i++) {
      const mesh = new THREE.Group();
      const looks = { glob: glob(), gust: gust(), water: water(), fire: fire() };
      for (const l of Object.values(looks)) mesh.add(l);
      mesh.visible = false;
      this.group.add(mesh);
      this.globs.push({ mesh, looks, kind: 'glob', dirX: 0, dirZ: 0, life: 0, active: false });
    }
  }

  private show(g: Glob, kind: ProjectileKind): void {
    g.kind = kind;
    for (const [k, l] of Object.entries(g.looks)) l.visible = k === kind;
  }

  fire(spit: Spit): void {
    const g = this.globs.find((g) => !g.active);
    if (!g) return;
    g.active = true;
    g.life = LIFETIME;
    g.dirX = spit.dirX;
    g.dirZ = spit.dirZ;
    this.show(g, spit.kind ?? 'glob');
    g.mesh.position.set(spit.x, HEIGHT, spit.z);
    g.mesh.rotation.y = Math.atan2(spit.dirX, spit.dirZ);
    g.mesh.visible = true;
  }

  snapshot(): GlobTuple[] {
    const out: GlobTuple[] = [];
    this.globs.forEach((g, i) => {
      if (g.active) out.push([i, q(g.mesh.position.x), q(g.mesh.position.z), PROJECTILE_KINDS.indexOf(g.kind)]);
    });
    return out;
  }

  /** Shows exactly these projectiles (familiar's view; no simulation). */
  sync(list: readonly GlobTuple[], time: number): void {
    const seen = new Set<number>();
    for (const [i, x, z, k] of list) {
      const g = this.globs[i];
      if (!g) continue;
      seen.add(i);
      this.show(g, PROJECTILE_KINDS[k ?? 0] ?? 'glob');
      g.mesh.visible = true;
      g.mesh.position.set(x, HEIGHT + Math.sin(time * 18 + i) * 0.06, z);
      g.mesh.rotation.y = time * 6;
    }
    this.globs.forEach((g, i) => {
      if (!seen.has(i)) g.mesh.visible = false;
    });
  }

  clear(): void {
    for (const g of this.globs) {
      g.active = false;
      g.mesh.visible = false;
    }
  }

  /**
   * Moves projectiles. `player` is null while it can't be hit (dashing / invulnerable), in which
   * case they fly straight through. Returns where projectiles burst this step.
   */
  update(dt: number, time: number, player: (Point & { radius: number }) | null, obstacles: readonly Circle[], half: number): GlobImpact[] {
    const impacts: GlobImpact[] = [];
    for (const g of this.globs) {
      if (!g.active) continue;
      const { speed, radius } = PROJECTILES[g.kind];
      g.life -= dt;
      const p = g.mesh.position;
      const bx = p.x + g.dirX * speed * dt;
      const bz = p.z + g.dirZ * speed * dt;

      let bestT = Infinity;
      let hitPlayer = false;
      if (player) {
        const t = segmentCircleHit(p.x, p.z, bx, bz, { x: player.x, z: player.z, radius: player.radius + radius });
        if (t !== null) {
          bestT = t;
          hitPlayer = true;
        }
      }
      for (const o of obstacles) {
        if (o.low) continue;
        const t = segmentCircleHit(p.x, p.z, bx, bz, { x: o.x, z: o.z, radius: o.radius + radius });
        if (t !== null && t < bestT) {
          bestT = t;
          hitPlayer = false;
        }
      }
      const lim = half - radius;
      const outside = Math.abs(bx) > lim || Math.abs(bz) > lim;

      if (bestT !== Infinity || outside || g.life <= 0) {
        const t = bestT === Infinity ? 1 : bestT;
        impacts.push({ x: p.x + (bx - p.x) * t, z: p.z + (bz - p.z) * t, kind: g.kind, hitPlayer });
        g.active = false;
        g.mesh.visible = false;
        continue;
      }
      p.x = bx;
      p.z = bz;
      p.y = HEIGHT + Math.sin(time * 18 + g.dirX * 10) * 0.06;
      g.mesh.rotation.y += dt * (g.kind === 'gust' ? 14 : 6);
    }
    return impacts;
  }
}
