import * as THREE from 'three';
import type { Circle } from '../game/combat';
import { glowTexture } from '../util/glow';
import { mulberry32 } from '../util/rng';
import type { RoomDef } from './rooms';

export const WALL_HEIGHT = 7;
const TILE = 2;
export const GATE_HALF_WIDTH = 2.2;
const GATE_HEIGHT = 4;
const PILLAR_RADIUS = 1.3;
const WALL_DEPTH = 1.4;

/** Walls by direction. North is the exit (−Z), south the entry (+Z). */
type Side = 'north' | 'west' | 'south' | 'east';
const SIDES: Side[] = ['north', 'west', 'south', 'east'];

interface Flame {
  light: THREE.PointLight;
  sprite: THREE.Sprite;
  base: number;
  seed: number;
}

/**
 * One room of the dungeon, built from a RoomDef: tiled floor, brick walls with a gate on each side,
 * pillars, a centrepiece (brazier, puddles, lava pit, crystals or a throne), torches and lights.
 * Slimes come in through the west, east and north gates; the elf enters by the south gate and
 * leaves by the north door once it opens. Static geometry is instanced; dispose() frees it all.
 */
export class Dungeon {
  readonly group = new THREE.Group();
  readonly room: RoomDef;
  readonly half: number;
  readonly obstacles: Circle[] = [];
  /** Just inside each enemy gate — where slimes enter. */
  readonly gates: THREE.Vector3[] = [];
  /** Where the elf arrives (inside the south gate). */
  readonly entry = new THREE.Vector3();
  /** Centre of the exit doorway on the floor (north wall). */
  readonly exit = new THREE.Vector3();
  /** Fire positions and loudness, for positional ambience. */
  readonly fireSources: { position: THREE.Vector3; strength: number }[] = [];
  private readonly flames: Flame[] = [];
  private readonly glowing: THREE.MeshStandardMaterial[] = [];
  private exitBars: THREE.Group | null = null;
  private exitPortal: THREE.Mesh | null = null;
  private exitLight: THREE.PointLight | null = null;
  private exitOpen = 0; // 0 closed → 1 open (animated)
  private exitTarget = 0;
  private readonly fireflies: { sprite: THREE.Sprite; base: THREE.Vector3; seed: number }[] = [];

  constructor(scene: THREE.Scene, room: RoomDef, shadowMapSize = 2048) {
    this.room = room;
    this.half = room.half;
    const rng = mulberry32(room.half * 7919 + room.pillars.length);
    scene.background = new THREE.Color(room.fog);
    scene.fog = room.outdoor ? new THREE.Fog(room.fog, 45, 120) : new THREE.Fog(room.fog, 30, 80);

    this.buildFloor(rng);
    this.buildWalls(rng);
    this.buildPillars();
    this.buildFeature(rng);
    this.buildRubble(rng);
    this.buildLights(shadowMapSize);

    const h = this.half;
    // Far enough in that the camera behind the elf can sit up over the south wall.
    this.entry.set(0, 0, h - 12);
    this.exit.set(0, 0, -h + 0.6);
    this.gates.push(new THREE.Vector3(-(h - 1.5), 0, 0), new THREE.Vector3(h - 1.5, 0, 0));
    if (room.hasExit) this.gates.push(new THREE.Vector3(0, 0, -(h - 1.5)));
    scene.add(this.group);
  }

  /** Is (x, z) in the open exit doorway? */
  inExit(x: number, z: number): boolean {
    return this.room.hasExit && this.exitTarget === 1 && z < -this.half + 2 && Math.abs(x) < GATE_HALF_WIDTH;
  }

  setExitOpen(open: boolean): void {
    this.exitTarget = open ? 1 : 0;
  }

  /** Torch flicker, glowing things, the exit door. */
  update(time: number, dt = 1 / 60): void {
    for (const f of this.flames) {
      const flicker =
        0.82 + Math.sin(time * 11 + f.seed) * 0.08 + Math.sin(time * 23.7 + f.seed * 3) * 0.06 + Math.sin(time * 5.3 + f.seed * 7) * 0.06;
      f.light.intensity = f.base * flicker;
      f.sprite.scale.setScalar(f.sprite.userData.size * (0.9 + flicker * 0.15));
    }
    for (const [i, m] of this.glowing.entries()) m.emissiveIntensity = (m.userData.base as number) * (0.85 + Math.sin(time * 1.7 + i) * 0.15);
    for (const f of this.fireflies) {
      const t = time * 0.6 + f.seed;
      f.sprite.position.set(f.base.x + Math.sin(t * 1.3) * 1.5, f.base.y + Math.sin(t * 2.1) * 0.5, f.base.z + Math.cos(t * 0.9) * 1.5);
      f.sprite.material.opacity = 0.35 + 0.65 * Math.max(0, Math.sin(t * 3 + f.seed * 5));
    }

    this.exitOpen += (this.exitTarget - this.exitOpen) * (1 - Math.exp(-3 * dt));
    if (this.exitBars) this.exitBars.position.y = this.exitOpen * (GATE_HEIGHT - 0.3);
    if (this.exitPortal && this.exitLight) {
      (this.exitPortal.material as THREE.MeshBasicMaterial).opacity = this.exitOpen * (0.75 + Math.sin(time * 4) * 0.1);
      this.exitLight.intensity = this.exitOpen * 26;
    }
  }

  /** Removes the room from the scene and frees its GPU resources. */
  dispose(scene: THREE.Scene): void {
    scene.remove(this.group);
    const seen = new Set<unknown>();
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry && !seen.has(mesh.geometry)) {
        seen.add(mesh.geometry);
        mesh.geometry.dispose();
      }
      const mats = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
      for (const m of mats) {
        if (seen.has(m)) continue;
        seen.add(m);
        m.dispose();
      }
      if ((o as THREE.Light).isLight) (o as THREE.DirectionalLight).shadow?.map?.dispose();
    });
  }

  private buildFloor(rng: () => number): void {
    const h = this.half;
    const n = (h * 2) / TILE;
    const { floor } = this.room;
    const tiles = new THREE.InstancedMesh(
      new THREE.BoxGeometry(TILE - 0.07, 0.3, TILE - 0.07),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, flatShading: true }),
      n * n,
    );
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    let i = 0;
    for (let ix = 0; ix < n; ix++) {
      for (let iz = 0; iz < n; iz++) {
        const x = -h + TILE / 2 + ix * TILE;
        const z = -h + TILE / 2 + iz * TILE;
        // Grass is lumpier than flagstones.
        const bump = this.room.outdoor ? 0.1 : 0.04;
        m.makeRotationY((rng() - 0.5) * 0.03).setPosition(x, -0.15 + (rng() - 0.5) * bump, z);
        tiles.setMatrixAt(i, m);
        tiles.setColorAt(i, c.setHSL(floor.h + (rng() - 0.5) * 0.05, floor.s + (rng() - 0.5) * 0.06, floor.l + (rng() - 0.5) * 0.07));
        i++;
      }
    }
    tiles.receiveShadow = true;
    // Dark grout showing between the tiles.
    const grout = new THREE.Mesh(
      new THREE.BoxGeometry(h * 2 + 4, 0.2, h * 2 + 4),
      new THREE.MeshStandardMaterial({ color: this.room.outdoor ? 0x22381a : 0x0e0c10, roughness: 1 }),
    );
    grout.position.y = -0.25;
    this.group.add(tiles, grout);
  }

  private buildWalls(rng: () => number): void {
    const h = this.half;
    const brickW = 2;
    const brickH = 1;
    const span = h + WALL_DEPTH;
    const rows = WALL_HEIGHT / brickH;
    const perRow = Math.ceil((span * 2) / brickW) + 1;
    const { wall } = this.room;
    const bricks = new THREE.InstancedMesh(
      new THREE.BoxGeometry(brickW - 0.06, brickH - 0.06, WALL_DEPTH),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }),
      4 * rows * perRow,
    );
    const m = new THREE.Matrix4();
    const rot = new THREE.Matrix4();
    const c = new THREE.Color();
    let count = 0;
    const voidMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const trimMat = new THREE.MeshStandardMaterial({ color: this.room.stone, roughness: 0.9, flatShading: true });
    const ironMat = this.room.outdoor
      ? new THREE.MeshStandardMaterial({ color: 0x5a3c22, roughness: 0.9, flatShading: true }) // wooden gate
      : new THREE.MeshStandardMaterial({ color: 0x26221f, metalness: 0.6, roughness: 0.5, flatShading: true });
    const hedge = this.room.outdoor;

    SIDES.forEach((side, k) => {
      rot.makeRotationY((k * Math.PI) / 2);
      const throneWall = side === 'north' && !this.room.hasExit;
      for (let row = 0; row < rows; row++) {
        const offset = row % 2 ? brickW / 2 : 0;
        for (let b = 0; b < perRow; b++) {
          const x = -span + offset + b * brickW;
          if (x - brickW / 2 > span) continue;
          // Leave an opening for the gate (the throne wall is solid).
          if (!throneWall && row < GATE_HEIGHT && Math.abs(x) - brickW / 2 < GATE_HALF_WIDTH) continue;
          if (hedge) {
            // Leafy, uneven blocks for a hedge.
            const s = 1 + rng() * 0.25;
            m.makeRotationFromEuler(new THREE.Euler((rng() - 0.5) * 0.3, (rng() - 0.5) * 0.3, (rng() - 0.5) * 0.3));
            m.scale(new THREE.Vector3(s, s, 1 + rng() * 0.3));
            m.setPosition(x, row * brickH + brickH / 2, -(h + WALL_DEPTH / 2 - (rng() - 0.5) * 0.3));
            m.premultiply(rot);
          } else {
            m.makeTranslation(x, row * brickH + brickH / 2, -(h + WALL_DEPTH / 2)).premultiply(rot);
          }
          bricks.setMatrixAt(count, m);
          bricks.setColorAt(count, c.setHSL(wall.h + (rng() - 0.5) * 0.08, wall.s + (rng() - 0.5) * 0.05, wall.l + (rng() - 0.5) * 0.08 - (row === 0 ? 0.03 : 0)));
          count++;
        }
      }
      if (throneWall) return;

      // Gate: dark void behind the opening, with a stone frame.
      const gate = new THREE.Group();
      const voidPlane = new THREE.Mesh(new THREE.PlaneGeometry(GATE_HALF_WIDTH * 2, GATE_HEIGHT), voidMat);
      voidPlane.position.set(0, GATE_HEIGHT / 2, -(h + WALL_DEPTH));
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(GATE_HALF_WIDTH * 2 + 1.6, 0.8, WALL_DEPTH + 0.3), trimMat);
      lintel.position.set(0, GATE_HEIGHT + 0.4, -(h + WALL_DEPTH / 2));
      const postGeo = new THREE.BoxGeometry(0.8, GATE_HEIGHT, WALL_DEPTH + 0.3);
      const postL = new THREE.Mesh(postGeo, trimMat);
      postL.position.set(-GATE_HALF_WIDTH - 0.4, GATE_HEIGHT / 2, -(h + WALL_DEPTH / 2));
      const postR = postL.clone();
      postR.position.x = GATE_HALF_WIDTH + 0.4;
      for (const o of [lintel, postL, postR]) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
      gate.add(voidPlane, lintel, postL, postR);

      // The entry (closed behind you) and the exit (opens when the room is clear) have portcullises.
      if (side === 'south' || side === 'north') {
        const bars = portcullis(ironMat);
        bars.position.z = -(h + 0.15);
        gate.add(bars);
        if (side === 'north') {
          this.exitBars = bars;
          // A glowing portal behind the door, revealed as it opens.
          const portal = new THREE.Mesh(
            new THREE.PlaneGeometry(GATE_HALF_WIDTH * 2, GATE_HEIGHT),
            new THREE.MeshBasicMaterial({ color: 0xfff1c0, map: glowTexture(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
          );
          portal.position.set(0, GATE_HEIGHT / 2, -(h + WALL_DEPTH - 0.05));
          this.exitPortal = portal;
          const light = new THREE.PointLight(0xffe0a0, 0, 16, 1.5);
          light.position.set(0, 2.2, -(h - 1));
          this.exitLight = light;
          gate.add(portal, light);
        }
      }
      gate.rotation.y = (k * Math.PI) / 2;
      this.group.add(gate);
    });
    bricks.count = count;
    bricks.castShadow = true;
    bricks.receiveShadow = true;
    this.group.add(bricks);
  }

  private buildPillars(): void {
    const stone = new THREE.MeshStandardMaterial({ color: this.room.stone, roughness: 0.9, flatShading: true });
    const shaftGeo = new THREE.CylinderGeometry(PILLAR_RADIUS - 0.2, PILLAR_RADIUS - 0.1, WALL_HEIGHT - 1.2, 8);
    const blockGeo = new THREE.BoxGeometry(PILLAR_RADIUS * 2.1, 0.6, PILLAR_RADIUS * 2.1);
    for (const [x, z] of this.room.pillars) {
      const pillar = new THREE.Group();
      const shaft = new THREE.Mesh(shaftGeo, stone);
      shaft.position.y = WALL_HEIGHT / 2;
      const base = new THREE.Mesh(blockGeo, stone);
      base.position.y = 0.3;
      const cap = new THREE.Mesh(blockGeo, stone);
      cap.position.y = WALL_HEIGHT - 0.3;
      for (const o of [shaft, base, cap]) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
      pillar.add(shaft, base, cap);
      pillar.position.set(x, 0, z);
      this.group.add(pillar);
      this.obstacles.push({ x, z, radius: PILLAR_RADIUS });
    }
  }

  private glow(color: number, emissive: number, intensity: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: intensity, flatShading: true, ...extra });
    m.userData.base = intensity;
    this.glowing.push(m);
    return m;
  }

  private buildFeature(rng: () => number): void {
    const room = this.room;
    switch (room.feature) {
      case 'woodland': {
        // Low-poly trees (trunk + stacked canopy), like the card art.
        const bark = new THREE.MeshStandardMaterial({ color: 0x7a4a26, flatShading: true, roughness: 0.9 });
        const leafColors = [0x4f8f3a, 0x5fa044, 0x3f7a32];
        for (const [x, z] of room.trees ?? []) {
          const tree = new THREE.Group();
          const height = 3 + rng() * 1.5;
          const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.55, height, 7).translate(0, height / 2, 0), bark);
          tree.add(trunk);
          const leaf = new THREE.MeshStandardMaterial({ color: leafColors[Math.floor(rng() * leafColors.length)], flatShading: true, roughness: 0.85 });
          for (let i = 0; i < 3; i++) {
            const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(1.9 - i * 0.4, 0), leaf);
            blob.position.set((rng() - 0.5) * 0.8, height + 0.6 + i * 1.1, (rng() - 0.5) * 0.8);
            blob.rotation.set(rng() * 3, rng() * 3, rng() * 3);
            tree.add(blob);
          }
          tree.traverse((o) => (o.castShadow = o.receiveShadow = true));
          tree.position.set(x, 0, z);
          tree.rotation.y = rng() * Math.PI * 2;
          this.group.add(tree);
          this.obstacles.push({ x, z, radius: 0.9 });
        }
        // Undergrowth: grass tufts, mushrooms and flowers (decoration only).
        const tufts = new THREE.InstancedMesh(
          new THREE.ConeGeometry(0.12, 0.5, 3).translate(0, 0.25, 0),
          new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true }),
          220,
        );
        const m = new THREE.Matrix4();
        const c = new THREE.Color();
        for (let i = 0; i < tufts.count; i++) {
          const x = (rng() * 2 - 1) * (this.half - 1);
          const z = (rng() * 2 - 1) * (this.half - 1);
          m.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromEuler(new THREE.Euler((rng() - 0.5) * 0.5, rng() * 3, (rng() - 0.5) * 0.5)), new THREE.Vector3(1, 0.6 + rng(), 1));
          tufts.setMatrixAt(i, m);
          tufts.setColorAt(i, c.setHSL(0.26 + rng() * 0.06, 0.5, 0.25 + rng() * 0.12));
        }
        this.group.add(tufts);
        const capMat = new THREE.MeshStandardMaterial({ color: 0xd8483a, flatShading: true });
        const stemMat = new THREE.MeshStandardMaterial({ color: 0xf2e6cc, flatShading: true });
        const petal = [0xffd34d, 0xffffff, 0xd98cff].map((col) => new THREE.MeshStandardMaterial({ color: col, flatShading: true }));
        for (let i = 0; i < 26; i++) {
          const x = (rng() * 2 - 1) * (this.half - 2);
          const z = (rng() * 2 - 1) * (this.half - 2);
          const bit = new THREE.Group();
          if (i % 2 === 0) {
            const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.3, 5).translate(0, 0.15, 0), stemMat);
            const cap = new THREE.Mesh(new THREE.SphereGeometry(0.22, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), capMat);
            cap.position.y = 0.28;
            bit.add(stem, cap);
          } else {
            const flower = new THREE.Mesh(new THREE.OctahedronGeometry(0.12, 0), petal[i % 3]);
            flower.position.y = 0.3;
            bit.add(flower);
          }
          bit.position.set(x, 0, z);
          this.group.add(bit);
        }
        // Fireflies drifting about.
        const glowMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xf4ff9a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
        for (let i = 0; i < 28; i++) {
          const sprite = new THREE.Sprite(glowMat.clone());
          sprite.scale.setScalar(0.35);
          const base = new THREE.Vector3((rng() * 2 - 1) * (this.half - 3), 0.8 + rng() * 2.5, (rng() * 2 - 1) * (this.half - 3));
          this.fireflies.push({ sprite, base, seed: rng() * 10 });
          this.group.add(sprite);
        }
        break;
      }
      case 'brazier': {
        const iron = new THREE.MeshStandardMaterial({ color: 0x2a2626, roughness: 0.6, metalness: 0.5, flatShading: true, side: THREE.DoubleSide });
        const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 0.7, 0.7, 10, 1, true), iron);
        bowl.position.y = 1.35;
        const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.5, 1.1, 8), iron);
        stand.position.y = 0.55;
        const coals = new THREE.Mesh(new THREE.CircleGeometry(1.1, 10).rotateX(-Math.PI / 2), this.glow(0x3a1206, 0xff4a10, 1.2));
        coals.position.y = 1.5;
        bowl.castShadow = stand.castShadow = true;
        this.group.add(bowl, stand, coals);
        this.obstacles.push({ x: 0, z: 0, radius: 1.3 });
        this.addFlame(0, 2.1, 0, 3.2, 30, 30, room.torchLight, room.torchFlame, 2);
        break;
      }
      case 'puddles': {
        // Shallow water: glossy dark puddles (purely decorative).
        const water = new THREE.MeshStandardMaterial({ color: 0x0c2433, roughness: 0.05, metalness: 0.4, transparent: true, opacity: 0.85 });
        for (let i = 0; i < 14; i++) {
          const puddle = new THREE.Mesh(new THREE.CircleGeometry(1, 18).rotateX(-Math.PI / 2), water);
          puddle.position.set((rng() * 2 - 1) * (this.half - 4), 0.02, (rng() * 2 - 1) * (this.half - 4));
          puddle.scale.set(1.2 + rng() * 2.5, 1, 0.8 + rng() * 1.6);
          puddle.rotation.y = rng() * Math.PI;
          puddle.receiveShadow = true;
          this.group.add(puddle);
        }
        break;
      }
      case 'lava': {
        // A glowing pit in the middle: blocks walking (arrows fly over it).
        const lava = new THREE.Mesh(new THREE.CircleGeometry(3.2, 24).rotateX(-Math.PI / 2), this.glow(0x4a1004, 0xff5010, 1.6));
        lava.position.y = 0.03;
        const rim = new THREE.Mesh(new THREE.TorusGeometry(3.35, 0.35, 5, 24).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2a1a16, flatShading: true }));
        rim.position.y = 0.1;
        rim.castShadow = rim.receiveShadow = true;
        this.group.add(lava, rim);
        this.obstacles.push({ x: 0, z: 0, radius: 3.6, low: true });
        this.addFlame(0, 1.2, 0, 4.5, 34, 30, 0xff5a20, 0xff6a20, 2);
        // Cracks of lava in the floor.
        for (let i = 0; i < 10; i++) {
          const crack = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 2 + rng() * 4).rotateX(-Math.PI / 2), this.glow(0x3a0a02, 0xff4a10, 1.2));
          crack.position.set((rng() * 2 - 1) * (this.half - 5), 0.02, (rng() * 2 - 1) * (this.half - 5));
          crack.rotation.y = rng() * Math.PI;
          this.group.add(crack);
        }
        break;
      }
      case 'crystals': {
        const colors = [0x8fe8ff, 0xc89bff, 0x9ffff0];
        for (const [x, z] of room.crystals ?? []) {
          const cluster = new THREE.Group();
          const color = colors[Math.floor(rng() * colors.length)];
          const mat = this.glow(color, color, 0.7, { roughness: 0.2, metalness: 0.1 });
          for (let i = 0; i < 4; i++) {
            const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.6, 0), mat);
            const a = (i / 4) * Math.PI * 2 + rng();
            shard.position.set(Math.cos(a) * 0.5, 1 + rng(), Math.sin(a) * 0.5);
            shard.scale.set(0.8, 2.2 + rng() * 1.5, 0.8);
            shard.rotation.set((rng() - 0.5) * 0.6, rng() * Math.PI, (rng() - 0.5) * 0.6);
            shard.castShadow = true;
            cluster.add(shard);
          }
          cluster.position.set(x, 0, z);
          this.group.add(cluster);
          this.obstacles.push({ x, z, radius: 1.4 });
        }
        // Two soft crystal lights to make the cave glow.
        for (const [x, z] of [[-10, 0], [10, 0]]) {
          const light = new THREE.PointLight(0xb08aff, 22, 26, 1.6);
          light.position.set(x, 3, z);
          this.group.add(light);
        }
        break;
      }
      case 'throne': {
        const h = this.half;
        const stone = new THREE.MeshStandardMaterial({ color: room.stone, roughness: 0.85, flatShading: true });
        const gold = new THREE.MeshStandardMaterial({ color: 0xd8a83a, metalness: 0.7, roughness: 0.35, flatShading: true });
        const velvet = new THREE.MeshStandardMaterial({ color: 0x7a1424, roughness: 0.9, flatShading: true });
        const throne = new THREE.Group();
        const steps = [new THREE.BoxGeometry(7, 0.4, 4), new THREE.BoxGeometry(5.5, 0.4, 3)];
        steps.forEach((g, i) => {
          const s = new THREE.Mesh(g, stone);
          s.position.set(0, 0.2 + i * 0.4, -i * 0.3);
          throne.add(s);
        });
        const seat = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 2), velvet);
        seat.position.set(0, 1.3, -0.4);
        const back = new THREE.Mesh(new THREE.BoxGeometry(2.6, 4.2, 0.5), gold);
        back.position.set(0, 3.2, -1.3);
        const backVelvet = new THREE.Mesh(new THREE.BoxGeometry(1.9, 3.2, 0.1), velvet);
        backVelvet.position.set(0, 3.1, -1.0);
        for (const sx of [-1, 1]) {
          const arm = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.8, 2), gold);
          arm.position.set(sx * 1.3, 1.8, -0.4);
          throne.add(arm);
        }
        const crown = new THREE.Mesh(new THREE.ConeGeometry(0.6, 0.9, 5), gold);
        crown.position.set(0, 5.75, -1.3);
        throne.add(seat, back, backVelvet, crown);
        throne.traverse((o) => (o.castShadow = o.receiveShadow = true));
        throne.position.set(0, 0, -h + 2.5);
        this.group.add(throne);
        this.obstacles.push({ x: 0, z: -h + 2.3, radius: 3 });
        // A long red carpet from the entry to the throne.
        const carpet = new THREE.Mesh(new THREE.PlaneGeometry(4, h * 2 - 6).rotateX(-Math.PI / 2), velvet);
        carpet.position.set(0, 0.03, 1);
        carpet.receiveShadow = true;
        const trim = new THREE.Mesh(new THREE.PlaneGeometry(4.6, h * 2 - 5.4).rotateX(-Math.PI / 2), gold);
        trim.position.set(0, 0.02, 1);
        this.group.add(trim, carpet);
        break;
      }
    }
  }

  private buildRubble(rng: () => number): void {
    const h = this.half;
    const rocks = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }),
      90,
    );
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const c = new THREE.Color();
    const pillars = this.room.pillars;
    for (let i = 0; i < rocks.count; i++) {
      // Hug the walls and pillar bases, where rubble would collect.
      let x: number;
      let z: number;
      if (i < 60 || pillars.length === 0) {
        const along = (rng() * 2 - 1) * h;
        const inset = h - 0.3 - rng() * 1.2;
        [x, z] = [[along, -inset], [along, inset], [-inset, along], [inset, along]][i % 4];
        if (Math.abs(along) < GATE_HALF_WIDTH + 1) x = z = 1e3; // keep gates clear
      } else {
        const p = pillars[i % pillars.length];
        const a = rng() * Math.PI * 2;
        const r = PILLAR_RADIUS + 0.3 + rng() * 0.6;
        x = p[0] + Math.cos(a) * r;
        z = p[1] + Math.sin(a) * r;
      }
      const s = 0.1 + rng() * rng() * 0.45;
      q.setFromEuler(e.set(rng() * 3, rng() * 3, rng() * 3));
      m.compose(new THREE.Vector3(x, s * 0.3, z), q, new THREE.Vector3(s, s * 0.7, s));
      rocks.setMatrixAt(i, m);
      const { wall } = this.room;
      rocks.setColorAt(i, c.setHSL(wall.h, wall.s * 0.6, 0.18 + rng() * 0.1));
    }
    rocks.castShadow = rocks.receiveShadow = true;
    this.group.add(rocks);
  }

  private addFlame(x: number, y: number, z: number, size: number, intensity: number, distance: number, light: number, flame: number, strength: number): void {
    const pl = new THREE.PointLight(light, intensity, distance, 1.6);
    pl.position.set(x, y + 0.3, z);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture(), color: flame, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
    );
    sprite.position.set(x, y, z);
    sprite.userData.size = size;
    sprite.scale.setScalar(size);
    this.group.add(pl, sprite);
    this.flames.push({ light: pl, sprite, base: intensity, seed: this.flames.length * 1.7 });
    this.fireSources.push({ position: sprite.position, strength });
  }

  private buildLights(shadowMapSize: number): void {
    const h = this.half;
    const room = this.room;
    // Light falling from high above (the only shadow caster), plus faint fill.
    const moon = new THREE.DirectionalLight(room.moon, room.moonIntensity);
    moon.position.set(12, 40, 18);
    moon.castShadow = true;
    moon.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    const sc = moon.shadow.camera;
    sc.left = sc.bottom = -h - 4;
    sc.right = sc.top = h + 4;
    sc.near = 1;
    sc.far = 100;
    moon.shadow.bias = -0.0005;
    moon.shadow.normalBias = 0.04;
    this.group.add(moon, new THREE.HemisphereLight(room.hemiSky, room.hemiGround, 0.9));

    if (room.outdoor) return; // daylight: no torches
    const bracketMat = new THREE.MeshStandardMaterial({ color: 0x2a2626, metalness: 0.5, roughness: 0.6 });
    const bracketGeo = new THREE.BoxGeometry(0.25, 0.7, 0.5);
    // Two torches per wall.
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      for (const along of [-h * 0.5, h * 0.5]) {
        const ox = Math.cos(a) * along;
        const oz = Math.sin(a) * along;
        const nx = Math.sin(a);
        const nz = -Math.cos(a);
        const wx = ox + nx * (h - 0.3);
        const wz = oz + nz * (h - 0.3);
        const bracket = new THREE.Mesh(bracketGeo, bracketMat);
        bracket.position.set(wx, 3.2, wz);
        bracket.rotation.y = -a;
        this.group.add(bracket);
        this.addFlame(wx - nx * 0.2, 3.75, wz - nz * 0.2, 1.3, 14, 22, room.torchLight, room.torchFlame, 1);
      }
    }
  }
}

/** Iron portcullis bars filling a gate opening. */
function portcullis(mat: THREE.Material): THREE.Group {
  const bars = new THREE.Group();
  const vGeo = new THREE.BoxGeometry(0.14, GATE_HEIGHT, 0.14);
  const hGeo = new THREE.BoxGeometry(GATE_HALF_WIDTH * 2, 0.14, 0.14);
  for (let i = 0; i <= 6; i++) {
    const v = new THREE.Mesh(vGeo, mat);
    v.position.set(-GATE_HALF_WIDTH + (i / 6) * GATE_HALF_WIDTH * 2, GATE_HEIGHT / 2, 0);
    bars.add(v);
  }
  for (const y of [0.9, 2.1, 3.3]) {
    const hbar = new THREE.Mesh(hGeo, mat);
    hbar.position.set(0, y, 0);
    bars.add(hbar);
  }
  bars.traverse((o) => (o.castShadow = true));
  return bars;
}
