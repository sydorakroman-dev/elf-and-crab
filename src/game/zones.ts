import * as THREE from 'three';
import { glowTexture } from '../util/glow';

/** [id, x, z, radius, secondsLeft, kind] — kind 0: a Soothing Spring pool, 1: burning ground, 2: poison spores. */
export type ZoneTuple = [number, number, number, number, number, number?];
export const ZONE_SPRING = 0;
export const ZONE_FIRE = 1;
export const ZONE_POISON = 2;
/** Disc, rim and particle colours for the harmful zones. */
const HAZARD: Record<number, { disc: number; rim: number; mote: number }> = {
  [ZONE_FIRE]: { disc: 0x7a2008, rim: 0xff7a2a, mote: 0xff8a3d },
  [ZONE_POISON]: { disc: 0x2f5a12, rim: 0x9be04a, mote: 0xb8f070 },
};

const WATER = 0x2fa6d0;
const FADE = 0.4; // seconds to fade in / out

interface PoolVisual {
  kind: number;
  group: THREE.Group;
  water: THREE.Mesh;
  rim: THREE.Mesh;
  steam: THREE.Sprite[];
  age: number;
}

/**
 * Ground zones: Soothing Spring pools (warm water, rising steam), burning ground (embers) and
 * poison spores (green motes). Driven entirely by a list of zone tuples (hero sim and familiar view alike).
 */
export class SpringPools {
  readonly group = new THREE.Group();
  private readonly pools = new Map<number, PoolVisual>();
  private readonly discGeo = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);
  private readonly rimGeo = new THREE.RingGeometry(0.93, 1.05, 48).rotateX(-Math.PI / 2);
  private readonly steamMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xe8fbff, transparent: true, opacity: 0.35, depthWrite: false });

  sync(list: readonly ZoneTuple[], dt: number, time: number): void {
    const seen = new Set<number>();
    for (const [id, x, z, r, left, kind] of list) {
      seen.add(id);
      let p = this.pools.get(id);
      if (!p) p = this.create(id, kind ?? ZONE_SPRING);
      p.age += dt;
      p.group.position.set(x, 0.05, z);
      p.group.scale.setScalar(r);
      const fade = Math.min(1, p.age / FADE, left / FADE);
      const fire = p.kind !== ZONE_SPRING;
      (p.water.material as THREE.MeshBasicMaterial).opacity = (fire ? 0.75 : 0.6) * fade * (0.9 + Math.sin(time * (fire ? 9 : 3)) * 0.1);
      (p.rim.material as THREE.MeshBasicMaterial).opacity = (fire ? 0.8 : 0.45) * fade;
      p.steam.forEach((s, i) => {
        const k = (time * (fire ? 1.1 : 0.5) + i / p!.steam.length) % 1;
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

  private create(id: number, kind: number): PoolVisual {
    const hazard = HAZARD[kind];
    const fire = !!hazard;
    const group = new THREE.Group();
    const water = new THREE.Mesh(this.discGeo, new THREE.MeshBasicMaterial({ color: hazard?.disc ?? WATER, transparent: true, opacity: 0, depthWrite: false }));
    const rim = new THREE.Mesh(this.rimGeo, new THREE.MeshBasicMaterial({ color: hazard?.rim ?? 0x6fdcf5, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    rim.position.y = 0.01;
    const steamMat = this.steamMat.clone();
    if (hazard) {
      // Embers / spores instead of steam.
      steamMat.color.setHex(hazard.mote);
      steamMat.blending = THREE.AdditiveBlending;
    }
    const steam = Array.from({ length: fire ? 9 : 6 }, () => new THREE.Sprite(steamMat.clone()));
    group.add(water, rim, ...steam);
    this.group.add(group);
    const p = { kind, group, water, rim, steam, age: 0 };
    this.pools.set(id, p);
    return p;
  }
}
