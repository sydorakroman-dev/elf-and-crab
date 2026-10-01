import * as THREE from 'three';
import { segmentCircleHit, type Circle, type Point } from './combat';
import type { Spit } from './enemies';
import { glowTexture } from '../util/glow';
import { q, type GlobTuple } from '../net/snapshot';

/** Enemy projectiles: the elementals' gusts / water / fire, and the monsters' acid, rivets, arrows and spells. */
export type ProjectileKind = 'acid' | 'gust' | 'water' | 'fire' | 'rivet' | 'arrow' | 'soul' | 'magic';
export const PROJECTILE_KINDS: ProjectileKind[] = ['acid', 'gust', 'water', 'fire', 'rivet', 'arrow', 'soul', 'magic'];
/** Kinds that fly point-first instead of tumbling. */
const POINTED: ProjectileKind[] = ['rivet', 'arrow'];

/** How each kind looks and flies. Damage and effects are applied by the game (see balance.ts). */
export const PROJECTILES: Record<ProjectileKind, { speed: number; radius: number; color: number }> = {
  acid: { speed: 15, radius: 0.3, color: 0x9be04a },
  gust: { speed: 20, radius: 0.35, color: 0xdfeaff },
  water: { speed: 17, radius: 0.3, color: 0x2f9fd8 },
  fire: { speed: 18, radius: 0.32, color: 0xff7a2a },
  rivet: { speed: 22, radius: 0.22, color: 0xc8ccd4 },
  arrow: { speed: 24, radius: 0.22, color: 0xd8c8a0 },
  soul: { speed: 14, radius: 0.32, color: 0x6ff0c8 },
  magic: { speed: 17, radius: 0.3, color: 0xb070ff },
};

const LIFETIME = 2.6;
const HEIGHT = 1.0;
const POOL = 40;

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
    const orb = (kind: ProjectileKind, core: number, size: number, glowSize: number) => {
      const g = new THREE.Group();
      g.add(
        new THREE.Mesh(new THREE.IcosahedronGeometry(size, 1), new THREE.MeshStandardMaterial({ color: core, emissive: PROJECTILES[kind].color, emissiveIntensity: 0.9, flatShading: true })),
        glow(PROJECTILES[kind].color, glowSize),
      );
      return g;
    };
    const rivet = () => {
      const g = new THREE.Group();
      const metal = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, metalness: 0.8, roughness: 0.3, flatShading: true });
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.4, 6).rotateX(Math.PI / 2), metal));
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.06, 8).rotateX(Math.PI / 2).translate(0, 0, -0.2), metal));
      g.add(glow(0xfff0c0, 0.6));
      return g;
    };
    const arrow = () => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 5).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x7a5a32 })));
      g.add(new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 5).rotateX(Math.PI / 2).translate(0, 0, 0.55), new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.6 })));
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.18).translate(0, 0, -0.45), new THREE.MeshStandardMaterial({ color: 0xe8e0d0 })));
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
      const looks = {
        acid: orb('acid', 0x7bc23a, 0.3, 1.4),
        gust: gust(),
        water: water(),
        fire: fire(),
        rivet: rivet(),
        arrow: arrow(),
        soul: orb('soul', 0xbff8e8, 0.26, 1.8),
        magic: orb('magic', 0xd8b0ff, 0.26, 1.6),
      };
      for (const l of Object.values(looks)) mesh.add(l);
      mesh.visible = false;
      this.group.add(mesh);
      this.globs.push({ mesh, looks, kind: 'acid', dirX: 0, dirZ: 0, life: 0, active: false });
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
    this.show(g, spit.kind);
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
      const kind = PROJECTILE_KINDS[k ?? 0] ?? 'acid';
      const was = g.mesh.visible && g.kind === kind ? { x: g.mesh.position.x, z: g.mesh.position.z } : null;
      this.show(g, kind);
      g.mesh.visible = true;
      g.mesh.position.set(x, HEIGHT + Math.sin(time * 18 + i) * 0.06, z);
      if (!POINTED.includes(kind)) g.mesh.rotation.y = time * 6;
      else if (was && Math.hypot(x - was.x, z - was.z) > 0.01) g.mesh.rotation.y = Math.atan2(x - was.x, z - was.z);
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
      if (!POINTED.includes(g.kind)) g.mesh.rotation.y += dt * (g.kind === 'gust' ? 14 : 6);
    }
    return impacts;
  }
}
