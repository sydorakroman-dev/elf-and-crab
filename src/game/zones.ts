import * as THREE from 'three';
import { glowTexture } from '../util/glow';

/**
 * [id, x, z, radius, secondsLeft, kind] — kind 0: a Soothing Spring pool, 1: burning ground, 2: poison
 * spores, 3: a Thorn Trap (the elf's), 4: Rain of Arrows (the elf's).
 */
export type ZoneTuple = [number, number, number, number, number, number?];
export const ZONE_SPRING = 0;
export const ZONE_FIRE = 1;
export const ZONE_POISON = 2;
export const ZONE_THORN = 3;
export const ZONE_RAIN = 4;
/** Disc, rim and particle colours for the harmful zones. */
const HAZARD: Record<number, { disc: number; rim: number; mote: number }> = {
  [ZONE_FIRE]: { disc: 0x7a2008, rim: 0xff7a2a, mote: 0xff8a3d },
  [ZONE_POISON]: { disc: 0x2f5a12, rim: 0x9be04a, mote: 0xb8f070 },
  [ZONE_THORN]: { disc: 0x24330f, rim: 0x9ccf5a, mote: 0x8fe060 },
  [ZONE_RAIN]: { disc: 0x3a2e18, rim: 0xffe0a0, mote: 0xfff0c0 },
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
 * Ground zones: Soothing Spring pools (warm water, rising steam), burning ground (embers),
 * poison spores (green motes), thorn traps (a ring of thorns) and Rain of Arrows (falling glints). Driven entirely by a list of zone tuples (hero sim and familiar view alike).
 */
export class SpringPools {
  readonly group = new THREE.Group();
  private readonly pools = new Map<number, PoolVisual>();
  private readonly discGeo = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);
  private readonly rimGeo = new THREE.RingGeometry(0.93, 1.05, 48).rotateX(-Math.PI / 2);
  private readonly thornGeo = new THREE.ConeGeometry(0.06, 0.32, 5);
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
      const trap = p.kind === ZONE_THORN;
      (p.water.material as THREE.MeshBasicMaterial).opacity = (trap ? 0.35 : fire ? 0.75 : 0.6) * fade * (0.9 + Math.sin(time * (fire ? 9 : 3)) * 0.1);
      (p.rim.material as THREE.MeshBasicMaterial).opacity = (fire ? 0.8 : 0.45) * fade * (trap ? 0.6 + Math.sin(time * 3) * 0.2 : 1);
      if (p.kind === ZONE_RAIN) {
        // Arrows falling all over the circle: bright streaks dropping from on high.
        p.steam.forEach((s, i) => {
          const k = (time * 2.2 + i * 0.37) % 1;
          const a = i * 2.39996;
          const d = Math.sqrt(((i * 0.618) % 1));
          s.position.set(Math.cos(a + Math.floor(time * 2.2 + i * 0.37)) * d * 0.9, (1 - k) * 6 / r, Math.sin(a + Math.floor(time * 2.2 + i * 0.37)) * d * 0.9);
          s.material.opacity = 0.9 * fade * Math.min(1, k * 4);
          s.scale.set(0.12 / r, 0.9 / r, 1);
        });
        continue;
      }
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
    const steam = Array.from({ length: kind === ZONE_RAIN ? 22 : fire ? 9 : 6 }, () => new THREE.Sprite(steamMat.clone()));
    group.add(water, rim, ...steam);
    if (kind === ZONE_THORN) {
      // A ring of thorns round the trap.
      const thornMat = new THREE.MeshStandardMaterial({ color: 0x5a6a2a, roughness: 0.8, flatShading: true });
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const thorn = new THREE.Mesh(this.thornGeo, thornMat);
        thorn.position.set(Math.cos(a) * 0.85, 0.12, Math.sin(a) * 0.85);
        thorn.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
        group.add(thorn);
      }
    }
    this.group.add(group);
    const p = { kind, group, water, rim, steam, age: 0 };
    this.pools.set(id, p);
    return p;
  }
}
