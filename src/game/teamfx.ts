import * as THREE from 'three';
import { glowTexture } from '../util/glow';
import { PING, PINGS, ULT, type PingKind } from './teamplay';

/** An emoji drawn on a canvas, as a sprite texture. */
function emojiTexture(emoji: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.font = '96px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const textures = new Map<string, THREE.CanvasTexture>();
const texture = (emoji: string) => textures.get(emoji) ?? textures.set(emoji, emojiTexture(emoji)).get(emoji)!;

interface Ping {
  kind: PingKind;
  x: number;
  z: number;
  left: number;
  group: THREE.Group;
}

/**
 * The familiar's pings in the world (both screens): a big bobbing icon over the spot, a glow and a
 * pulsing ring on the ground, for PING.shows seconds. Hearts float up from the familiar instead.
 */
export class PingMarkers {
  readonly group = new THREE.Group();
  private readonly pings: Ping[] = [];
  private readonly ringGeo = new THREE.RingGeometry(0.85, 1, 40).rotateX(-Math.PI / 2);

  add(kind: PingKind, x: number, z: number): void {
    const def = PINGS[kind];
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture(def.icon), transparent: true, depthTest: false }));
    icon.scale.setScalar(kind === 'hearts' ? 1.1 : 1.6);
    icon.position.y = kind === 'hearts' ? 1.6 : 3.2;
    icon.renderOrder = 12;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: def.color, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.setScalar(3);
    glow.position.y = icon.position.y;
    const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.position.y = 0.06;
    g.add(glow, icon, ...(kind === 'hearts' ? [] : [ring]));
    this.group.add(g);
    this.pings.push({ kind, x, z, left: PING.shows, group: g });
  }

  update(dt: number, time: number): void {
    for (let i = this.pings.length - 1; i >= 0; i--) {
      const p = this.pings[i];
      p.left -= dt;
      const age = PING.shows - p.left;
      const fade = Math.min(1, p.left / 0.6, age / 0.15);
      const [glow, icon, ring] = p.group.children as [THREE.Sprite, THREE.Sprite, THREE.Mesh?];
      if (p.kind === 'hearts') {
        icon.position.y = glow.position.y = 1.6 + age * 0.9;
        icon.material.rotation = Math.sin(time * 6) * 0.2;
      } else {
        icon.position.y = glow.position.y = 3.2 + Math.sin(time * 4) * 0.2;
        if (ring) {
          const k = (age * 1.4) % 1;
          ring.scale.setScalar(1 + k * 2.5);
          (ring.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k) * fade;
        }
      }
      icon.material.opacity = fade;
      glow.material.opacity = 0.6 * fade;
      if (p.left <= 0) {
        this.group.remove(p.group);
        this.pings.splice(i, 1);
      }
    }
  }

  /** For the minimap. */
  list(): { x: number; z: number; color: string; icon: string }[] {
    return this.pings.filter((p) => p.kind !== 'hearts').map((p) => ({ x: p.x, z: p.z, color: `#${PINGS[p.kind].color.toString(16).padStart(6, '0')}`, icon: PINGS[p.kind].icon }));
  }

  clear(): void {
    for (const p of this.pings) this.group.remove(p.group);
    this.pings.length = 0;
  }
}

/**
 * The goldfish's Tidal Wave (both screens): a curling wall of water rolling ULT.goldfish.length
 * metres the way the goldfish faces, foam on its crest, then sinking away.
 */
export class TidalWave {
  readonly group = new THREE.Group();
  private readonly wall: THREE.Mesh;
  private readonly foam: THREE.Mesh;
  private age = 0;
  private readonly seconds: number;

  constructor(x: number, z: number, heading: number, seconds: number) {
    this.seconds = seconds;
    this.group.position.set(x, 0, z);
    this.group.rotation.y = heading;
    const w = ULT.goldfish.width;
    // A curved wall: a quarter-cylinder, its open side leaning forward like a breaking wave.
    const wallGeo = new THREE.CylinderGeometry(1.6, 1.6, w, 16, 1, true, Math.PI, Math.PI * 0.8).rotateZ(Math.PI / 2).translate(0, 1.4, 0);
    this.wall = new THREE.Mesh(wallGeo, new THREE.MeshStandardMaterial({ color: 0x2f9fd8, emissive: 0x0b4a66, emissiveIntensity: 0.6, transparent: true, opacity: 0.8, side: THREE.DoubleSide, roughness: 0.15 }));
    this.foam = new THREE.Mesh(new THREE.BoxGeometry(w, 0.25, 0.5).translate(0, 2.9, 0.6), new THREE.MeshBasicMaterial({ color: 0xf2fbff, transparent: true, opacity: 0.9 }));
    this.group.add(this.wall, this.foam);
  }

  /** Front of the wave (m from where it started) at this point. */
  get front(): number {
    return Math.min(1, this.age / this.seconds) * ULT.goldfish.length;
  }

  get done(): boolean {
    return this.age >= this.seconds + 0.5;
  }

  update(dt: number): void {
    this.age += dt;
    const t = Math.min(1, this.age / this.seconds);
    const sink = Math.max(0, (this.age - this.seconds) / 0.5);
    this.wall.position.z = this.foam.position.z = this.front;
    const rise = Math.min(1, this.age * 5) * (1 - sink);
    this.wall.scale.set(1, Math.max(0.01, rise), 1);
    this.foam.scale.set(1, Math.max(0.01, rise), 1);
    this.foam.position.y = 2.9 * (rise - 1);
    (this.wall.material as THREE.MeshStandardMaterial).opacity = 0.8 * (1 - sink) * (0.8 + t * 0.2);
  }
}
