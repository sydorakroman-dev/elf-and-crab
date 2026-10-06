import * as THREE from 'three';
import type { Point } from './combat';
import { POWER_UPS, type PowerUpType } from './powerups';
import { PICKUP_CODES, q, type PickupTuple } from '../net/snapshot';
import { glowTexture } from '../util/glow';

const LIFETIME = 14; // power-ups; loot stays until picked up
const BLINK_AT = 3; // seconds left when it starts blinking
const PICKUP_RADIUS = 1.4;
/** Coins fly to whoever comes within this many metres. */
const MAGNET_RADIUS = 3.5;
const MAGNET_SPEED = 14;

/** Anything lying on the floor to pick up: a power-up, or loot (gold, a spell book). */
export type PickupKind = PowerUpType | 'gold' | 'book';

export interface Collected {
  type: PickupKind;
  /** Which collector picked it up (0 the elf, 1 the familiar). */
  by: number;
  /** Gold in a coin pile. */
  amount: number;
  x: number;
  z: number;
}

const LOOT_COLORS: Record<'gold' | 'book', number> = { gold: 0xffc93d, book: 0xb78aff };
const colorOf = (k: PickupKind) => (k === 'gold' || k === 'book' ? LOOT_COLORS[k] : POWER_UPS[k].color);
const FLOAT_HEIGHT = 1.1;

interface Pickup {
  id: number;
  type: PickupKind;
  amount: number;
  group: THREE.Group;
  icon: THREE.Object3D;
  life: number;
  age: number;
}

/** Power-ups and loot lying about: glowing, spinning icons you walk over to collect. */
export class Pickups {
  readonly group = new THREE.Group();
  private readonly items: Pickup[] = [];
  private nextId = 1;
  private readonly icons: Record<PickupKind, () => THREE.Object3D>;
  private readonly ringGeo = new THREE.RingGeometry(0.85, 1.2, 32).rotateX(-Math.PI / 2);

  constructor() {
    const mat = (type: PowerUpType) =>
      new THREE.MeshStandardMaterial({
        color: POWER_UPS[type].color,
        emissive: POWER_UPS[type].color,
        emissiveIntensity: 0.9,
        roughness: 0.3,
        flatShading: true,
      });
    const extrude = (shape: THREE.Shape, depth = 0.18) => {
      const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 1 });
      return g.center();
    };

    // Multishot: three arrowheads fanned out.
    const multishot = () => {
      const g = new THREE.Group();
      const m = mat('multishot');
      const head = new THREE.ConeGeometry(0.16, 0.5, 5);
      const shaft = new THREE.CylinderGeometry(0.035, 0.035, 0.45, 5).translate(0, -0.45, 0);
      for (const a of [-0.45, 0, 0.45]) {
        const arrow = new THREE.Group();
        arrow.add(new THREE.Mesh(head, m), new THREE.Mesh(shaft, m));
        arrow.position.y = 0.15;
        arrow.rotation.z = a;
        g.add(arrow);
      }
      return g;
    };

    // Rapid fire: a lightning bolt.
    const bolt = new THREE.Shape();
    bolt.moveTo(0.12, 0.6);
    bolt.lineTo(-0.28, -0.02);
    bolt.lineTo(-0.02, -0.02);
    bolt.lineTo(-0.14, -0.6);
    bolt.lineTo(0.3, 0.1);
    bolt.lineTo(0.04, 0.1);
    bolt.closePath();
    const rapidGeo = extrude(bolt);
    const rapid = () => new THREE.Mesh(rapidGeo, mat('rapid'));

    // Piercing: one long arrow, tilted.
    const pierce = () => {
      const g = new THREE.Group();
      const m = mat('pierce');
      g.add(
        new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.1, 6), m),
        new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.4, 6).translate(0, 0.72, 0), m),
        new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.02).translate(0, -0.5, 0), m),
      );
      g.rotation.z = -0.6;
      return g;
    };

    // Shield: a hexagonal plate with a boss.
    const shieldGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.12, 6).rotateX(Math.PI / 2);
    const bossGeo = new THREE.SphereGeometry(0.14, 8, 6).translate(0, 0, 0.08);
    const shield = () => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(shieldGeo, mat('shield')), new THREE.Mesh(bossGeo, mat('shield')));
      return g;
    };

    // Heart.
    const h = new THREE.Shape();
    h.moveTo(0, -0.45);
    h.bezierCurveTo(-0.1, -0.35, -0.5, -0.1, -0.5, 0.15);
    h.bezierCurveTo(-0.5, 0.4, -0.2, 0.5, 0, 0.28);
    h.bezierCurveTo(0.2, 0.5, 0.5, 0.4, 0.5, 0.15);
    h.bezierCurveTo(0.5, -0.1, 0.1, -0.35, 0, -0.45);
    const heartGeo = extrude(h, 0.22);
    const heart = () => new THREE.Mesh(heartGeo, mat('heart'));

    // Gold: a little pile of coins.
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xffc93d, emissive: 0x8a5a00, emissiveIntensity: 0.6, metalness: 0.7, roughness: 0.3, flatShading: true });
    const coinGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.06, 12);
    const gold = () => {
      const g = new THREE.Group();
      [[0, 0, 0, 0], [0.18, 0.07, 0.05, 0.4], [-0.12, 0.13, -0.08, -0.3], [0.02, 0.19, 0.12, 0.8]].forEach(([x, y, z, tilt]) => {
        const c = new THREE.Mesh(coinGeo, goldMat);
        c.position.set(x, y - 0.25, z);
        c.rotation.set(tilt, 0, tilt * 0.5);
        g.add(c);
      });
      return g;
    };
    // Spell book: a purple tome with a glowing rune.
    const coverMat = new THREE.MeshStandardMaterial({ color: 0x5a2e8f, roughness: 0.6, flatShading: true });
    const pageMat = new THREE.MeshStandardMaterial({ color: 0xf6ead0, flatShading: true });
    const runeMat = new THREE.MeshBasicMaterial({ color: 0xe8d4ff });
    const book = () => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.8, 0.16), coverMat));
      const pages = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.74, 0.12), pageMat);
      pages.position.x = 0.04;
      g.add(pages);
      const rune = new THREE.Mesh(new THREE.OctahedronGeometry(0.14, 0), runeMat);
      rune.position.z = 0.1;
      rune.scale.z = 0.3;
      g.add(rune);
      return g;
    };

    this.icons = { multishot, rapid, pierce, shield, heart, gold, book };
  }

  /** Power-ups on the floor (loot doesn't count). */
  get count(): number {
    return this.items.filter((p) => p.type !== 'gold' && p.type !== 'book').length;
  }

  /** Puts a pickup on the floor; loot (gold, books) never expires. Returns its id. */
  spawn(type: PickupKind, x: number, z: number, id = this.nextId++, amount = 0): number {
    const color = colorOf(type);
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    const icon = this.icons[type]();
    icon.scale.setScalar(type === 'gold' ? 1.6 : 1.35); // readable from the default camera distance
    icon.traverse((o) => (o.castShadow = true));
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8 }),
    );
    glow.scale.setScalar(3);
    glow.position.y = FLOAT_HEIGHT;
    const ring = new THREE.Mesh(
      this.ringGeo,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    ring.position.y = 0.03;
    group.add(icon, glow, ring);
    group.scale.setScalar(0.01);
    this.group.add(group);
    if (type === 'gold') glow.scale.setScalar(2);
    const loot = type === 'gold' || type === 'book';
    this.items.push({ id, type, amount, group, icon, life: loot ? Infinity : LIFETIME, age: 0 });
    return id;
  }

  snapshot(): PickupTuple[] {
    return this.items.map((p) => [p.id, PICKUP_CODES.indexOf(p.type), q(p.group.position.x), q(p.group.position.z), p.group.visible ? 1 : 0]);
  }

  /** Shows exactly these pickups (familiar's view): creates new ones, removes gone ones, animates. */
  sync(list: readonly PickupTuple[], dt: number, time: number): void {
    const wanted = new Map(list.map((t) => [t[0], t]));
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (wanted.has(this.items[i].id)) continue;
      this.group.remove(this.items[i].group);
      this.items.splice(i, 1);
    }
    for (const [id, code, x, z, visible] of list) {
      if (!this.items.some((p) => p.id === id)) this.spawn(PICKUP_CODES[code] ?? 'multishot', x, z, id);
      const p = this.items.find((it) => it.id === id)!;
      p.group.position.x = x;
      p.group.position.z = z;
      p.age += dt;
      p.group.scale.setScalar(Math.min(1, p.age / 0.25));
      p.icon.position.y = FLOAT_HEIGHT + Math.sin(time * 2.4 + x) * 0.15;
      p.icon.rotation.y = time * 2;
      p.group.visible = visible === 1;
    }
  }

  clear(): void {
    for (const p of this.items) this.group.remove(p.group);
    this.items.length = 0;
  }

  /**
   * Animates, expires, and returns what was collected this step: the type, and which of
   * `collectors` (the elf first, then the familiar) touched it.
   */
  update(dt: number, time: number, collectors: readonly Point[]): Collected[] {
    const collected: Collected[] = [];
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      p.age += dt;
      p.life -= dt;
      const gp = p.group.position;
      if (p.type === 'gold' && p.age > 0.4) {
        // Coins fly to whoever's near.
        let best: Point | null = null;
        let bestD = MAGNET_RADIUS;
        for (const c of collectors) {
          const d = Math.hypot(gp.x - c.x, gp.z - c.z);
          if (d < bestD) {
            bestD = d;
            best = c;
          }
        }
        if (best && bestD > 0.01) {
          const step = Math.min(bestD, MAGNET_SPEED * dt);
          gp.x += ((best.x - gp.x) / bestD) * step;
          gp.z += ((best.z - gp.z) / bestD) * step;
        }
      }
      const by = p.age > 0.25 ? collectors.findIndex((c) => Math.hypot(gp.x - c.x, gp.z - c.z) < PICKUP_RADIUS) : -1;
      if (by >= 0) {
        collected.push({ type: p.type, by, amount: p.amount, x: gp.x, z: gp.z });
        this.group.remove(p.group);
        this.items.splice(i, 1);
        continue;
      }
      if (p.life <= 0) {
        this.group.remove(p.group);
        this.items.splice(i, 1);
        continue;
      }
      // Pop in, bob and spin; blink faster and faster before vanishing.
      p.group.scale.setScalar(Math.min(1, p.age / 0.25) * (1 + Math.max(0, 0.3 - p.age) * 0.8));
      p.icon.position.y = FLOAT_HEIGHT + Math.sin(time * 2.4 + gp.x) * 0.15;
      p.icon.rotation.y = time * 2;
      p.group.visible = p.life > BLINK_AT || Math.sin(p.life * (22 - p.life * 4)) > -0.3;
    }
    return collected;
  }
}
