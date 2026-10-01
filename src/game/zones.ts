import * as THREE from 'three';
import { glowTexture } from '../util/glow';

/** [id, x, z, radius, secondsLeft] — a Soothing Spring pool. */
export type ZoneTuple = [number, number, number, number, number];

const WATER = 0x2fa6d0;
const FADE = 0.4; // seconds to fade in / out

interface PoolVisual {
  group: THREE.Group;
  water: THREE.Mesh;
  rim: THREE.Mesh;
  steam: THREE.Sprite[];
  age: number;
}

/**
 * Visuals for Soothing Spring pools: a shimmering disc of warm water with a glowing rim and
 * rising steam. Driven entirely by a list of zone tuples (hero sim and familiar view alike).
 */
export class SpringPools {
  readonly group = new THREE.Group();
  private readonly pools = new Map<number, PoolVisual>();
  private readonly discGeo = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);
  private readonly rimGeo = new THREE.RingGeometry(0.93, 1.05, 48).rotateX(-Math.PI / 2);
  private readonly steamMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xe8fbff, transparent: true, opacity: 0.35, depthWrite: false });

  sync(list: readonly ZoneTuple[], dt: number, time: number): void {
    const seen = new Set<number>();
    for (const [id, x, z, r, left] of list) {
      seen.add(id);
      let p = this.pools.get(id);
      if (!p) p = this.create(id);
      p.age += dt;
      p.group.position.set(x, 0.05, z);
      p.group.scale.setScalar(r);
      const fade = Math.min(1, p.age / FADE, left / FADE);
      (p.water.material as THREE.MeshBasicMaterial).opacity = 0.6 * fade * (0.9 + Math.sin(time * 3) * 0.1);
      (p.rim.material as THREE.MeshBasicMaterial).opacity = 0.45 * fade;
      p.steam.forEach((s, i) => {
        const k = (time * 0.5 + i / p!.steam.length) % 1;
        const a = i * 2.4;
        s.position.set(Math.cos(a) * 0.55, 0.2 + k * 1.6 / r, Math.sin(a) * 0.55);
        s.material.opacity = 0.35 * fade * Math.sin(k * Math.PI);
        s.scale.setScalar((0.5 + k * 0.6) / r);
      });
    }
    for (const [id, p] of this.pools) {
      if (seen.has(id)) continue;
      this.group.remove(p.group);
      this.pools.delete(id);
    }
  }

  private create(id: number): PoolVisual {
    const group = new THREE.Group();
    const water = new THREE.Mesh(this.discGeo, new THREE.MeshBasicMaterial({ color: WATER, transparent: true, opacity: 0, depthWrite: false }));
    const rim = new THREE.Mesh(this.rimGeo, new THREE.MeshBasicMaterial({ color: 0x6fdcf5, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    rim.position.y = 0.01;
    const steam = Array.from({ length: 6 }, () => new THREE.Sprite(this.steamMat.clone()));
    group.add(water, rim, ...steam);
    this.group.add(group);
    const p = { group, water, rim, steam, age: 0 };
    this.pools.set(id, p);
    return p;
  }
}
