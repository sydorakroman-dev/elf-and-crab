import * as THREE from 'three';
import { insideArena, setArenaShape, type ArenaShape, type Circle } from '../game/combat';
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

/** Wall segments per floor plan (a "circle" is a 24-sided wall, which reads as round). */
const WALL_SIDES: Record<ArenaShape, number> = { square: 4, octagon: 8, circle: 24 };

/** Distance from the centre to the wall's inner face in direction `angle` (0 = north). */
function wallDistance(shape: ArenaShape, half: number, angle: number): number {
  if (shape === 'circle') return half;
  const step = (Math.PI * 2) / WALL_SIDES[shape];
  let d = ((angle % step) + step) % step;
  d = Math.min(d, step - d);
  return half / Math.cos(d);
}

/** Torch spots around the wall (angles; 0 = north), clear of the gates and corners. */
function torchAngles(shape: ArenaShape): number[] {
  const out: number[] = [];
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    if (shape === 'square') out.push(a - 0.4636, a + 0.4636); // halfway along each wall
    else if (shape === 'octagon') out.push(a + Math.PI / 4 - 0.17, a + Math.PI / 4 + 0.17); // the diagonal walls
    else out.push(a + Math.PI / 8, a + (3 * Math.PI) / 8);
  }
  return out;
}

interface Flame {
  light: THREE.PointLight;
  sprite: THREE.Sprite;
  base: number;
  seed: number;
}

/**
 * One room of the dungeon, built from a RoomDef: tiled floor, brick walls with a gate on each side,
 * pillars, a centrepiece (brazier, puddles, lava pit, crystals or a throne), torches and lights.
 * Enemies come in through the west, east and north gates; the elf enters by the south gate and
 * leaves by the north door once it opens. Static geometry is instanced; dispose() frees it all.
 */
export class Dungeon {
  readonly group = new THREE.Group();
  readonly room: RoomDef;
  readonly half: number;
  readonly obstacles: Circle[] = [];
  /** Tall things (pillars, trees, crystal clusters) a close camera may need to see through. */
  readonly occluders: THREE.Object3D[] = [];
  /** The walls (and gate) on the south side, between a south-facing camera and the room. */
  readonly southWall: THREE.Object3D[] = [];
  /** Just inside each enemy gate — where enemies enter. */
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
  /** Embers rising through the dragon's lair. */
  private readonly embers: { sprite: THREE.Sprite; x: number; z: number; speed: number; seed: number }[] = [];
  /** The Flooded Hall: its water sheet, ripples, and things bobbing on the water. */
  private waterSheet: THREE.Mesh | null = null;
  private readonly ripples: { mesh: THREE.Mesh; age: number; life: number }[] = [];
  private readonly glints: { sprite: THREE.Sprite; seed: number }[] = [];
  private readonly bobbers: { obj: THREE.Object3D; base: number; seed: number; amp: number }[] = [];

  constructor(scene: THREE.Scene, room: RoomDef, shadowMapSize = 2048) {
    this.room = room;
    this.half = room.half;
    setArenaShape(room.shape); // every arena check (movement, arrows, bolts, camera) follows this room's shape
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
    if (!room.solidWest) this.gates.push(new THREE.Vector3(-(h - 1.5), 0, 0));
    this.gates.push(new THREE.Vector3(h - 1.5, 0, 0));
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

    if (this.waterSheet) this.waterSheet.position.y = 0.22 + Math.sin(time * 0.8) * 0.015;
    for (const g of this.glints) g.sprite.material.opacity = Math.max(0, Math.sin(time * 1.3 + g.seed * 3)) ** 3 * 0.8;
    for (const b of this.bobbers) {
      b.obj.position.y = b.base + Math.sin(time * 1.6 + b.seed) * b.amp;
      b.obj.rotation.x = Math.sin(time * 1.1 + b.seed) * 0.08;
    }
    for (const r of this.ripples) {
      r.age += dt;
      if (r.age >= r.life) {
        r.age = 0;
        const lim = this.half - 3;
        for (let i = 0; i < 10; i++) {
          const x = (Math.random() * 2 - 1) * lim;
          const z = (Math.random() * 2 - 1) * lim;
          if (insideArena(x, z, this.half, 3, this.room.shape)) {
            r.mesh.position.x = x;
            r.mesh.position.z = z;
            break;
          }
        }
      }
      const k = r.age / r.life;
      r.mesh.scale.setScalar(0.3 + k * 2.2);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - k) * Math.min(1, k * 6);
    }
    for (const e of this.embers) {
      const y = (time * e.speed + e.seed * 7) % 16;
      e.sprite.position.set(e.x + Math.sin(time * 0.8 + e.seed) * 0.8, y, e.z + Math.cos(time * 0.6 + e.seed) * 0.8);
      e.sprite.material.opacity = Math.min(1, y / 2) * Math.max(0, 1 - y / 16);
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
        if (!insideArena(x, z, h, -TILE, this.room.shape)) continue; // round / eight-sided rooms
        // Grass is lumpier than flagstones.
        const bump = this.room.outdoor ? 0.1 : 0.04;
        m.makeRotationY((rng() - 0.5) * 0.03).setPosition(x, -0.15 + (rng() - 0.5) * bump, z);
        tiles.setMatrixAt(i, m);
        tiles.setColorAt(i, c.setHSL(floor.h + (rng() - 0.5) * 0.05, floor.s + (rng() - 0.5) * 0.06, floor.l + (rng() - 0.5) * 0.07));
        i++;
      }
    }
    tiles.count = i;
    tiles.receiveShadow = true;
    // Dark grout showing between the tiles, in the room's own shape.
    const sides = WALL_SIDES[this.room.shape];
    const groutR = (h + 3) / Math.cos(Math.PI / sides);
    const grout = new THREE.Mesh(
      new THREE.CylinderGeometry(groutR, groutR, 0.2, sides),
      new THREE.MeshStandardMaterial({ color: this.room.outdoor ? 0x22381a : 0x0e0c10, roughness: 1 }),
    );
    grout.rotation.y = Math.PI / sides;
    grout.position.y = -0.25;
    this.group.add(tiles, grout);
  }

  private buildWalls(rng: () => number): void {
    const h = this.half;
    const brickW = 2;
    const brickH = 1;
    const sides = WALL_SIDES[this.room.shape];
    // Half the length of each wall segment's outer face (a little extra closes the corners).
    const span = (h + WALL_DEPTH) * Math.tan(Math.PI / sides) + (sides > 4 ? 0.5 : 0);
    const rows = WALL_HEIGHT / brickH;
    const perRow = Math.ceil((span * 2) / brickW) + 1;
    const { wall } = this.room;
    // Two brick meshes: the walls on the south (camera) side get their own, so a view from the
    // south can make them see-through when they'd hide something.
    const brickGeo = new THREE.BoxGeometry(brickW - 0.06, brickH - 0.06, WALL_DEPTH);
    const brickMesh = () => {
      const mesh = new THREE.InstancedMesh(brickGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }), sides * rows * perRow);
      mesh.count = 0; // filled below
      return mesh;
    };
    const northBricks = brickMesh();
    const southBricks = brickMesh();
    const m = new THREE.Matrix4();
    const rot = new THREE.Matrix4();
    const c = new THREE.Color();
    const voidMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const trimMat = new THREE.MeshStandardMaterial({ color: this.room.stone, roughness: 0.9, flatShading: true });
    const ironMat = this.room.outdoor
      ? new THREE.MeshStandardMaterial({ color: 0x5a3c22, roughness: 0.9, flatShading: true }) // wooden gate
      : new THREE.MeshStandardMaterial({ color: 0x26221f, metalness: 0.6, roughness: 0.5, flatShading: true });
    const hedge = this.room.outdoor;

    for (let k = 0; k < sides; k++) {
      const angle = (k * Math.PI * 2) / sides;
      const south = Math.cos(angle) < -0.01; // this segment's wall faces the room from the south
      const bricks = south ? southBricks : northBricks;
      rot.makeRotationY(angle);
      // Gates are on the four walls facing north, west, south and east.
      const gateIndex = (k * 4) % sides === 0 ? (k * 4) / sides : -1;
      const side = gateIndex >= 0 ? SIDES[gateIndex] : null;
      const throneWall = !side || (side === 'north' && !this.room.hasExit) || (side === 'west' && !!this.room.solidWest);
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
          bricks.setMatrixAt(bricks.count, m);
          bricks.setColorAt(bricks.count, c.setHSL(wall.h + (rng() - 0.5) * 0.08, wall.s + (rng() - 0.5) * 0.05, wall.l + (rng() - 0.5) * 0.08 - (row === 0 ? 0.03 : 0)));
          bricks.count++;
        }
      }
      if (throneWall) continue;

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
      gate.rotation.y = angle;
      this.group.add(gate);
      if (south) this.southWall.push(gate);
    }
    for (const bricks of [northBricks, southBricks]) {
      bricks.castShadow = true;
      bricks.receiveShadow = true;
      this.group.add(bricks);
    }
    this.southWall.push(southBricks);
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
      this.occluders.push(pillar);
      this.obstacles.push({ x, z, radius: PILLAR_RADIUS });
    }
  }

  private glow(color: number, emissive: number, intensity: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: intensity, flatShading: true, ...extra });
    m.userData.base = intensity;
    this.glowing.push(m);
    return m;
  }

  /** A random floor spot at least `margin` inside the walls (whatever the room's shape). */
  private spot(rng: () => number, margin: number): [number, number] {
    const lim = this.half - margin;
    let x = 0;
    let z = 0;
    for (let i = 0; i < 30; i++) {
      x = (rng() * 2 - 1) * lim;
      z = (rng() * 2 - 1) * lim;
      if (insideArena(x, z, this.half, margin, this.room.shape)) break;
    }
    return [x, z];
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
          this.occluders.push(tree);
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
          const [x, z] = this.spot(rng, 1);
          m.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromEuler(new THREE.Euler((rng() - 0.5) * 0.5, rng() * 3, (rng() - 0.5) * 0.5)), new THREE.Vector3(1, 0.6 + rng(), 1));
          tufts.setMatrixAt(i, m);
          tufts.setColorAt(i, c.setHSL(0.26 + rng() * 0.06, 0.5, 0.25 + rng() * 0.12));
        }
        this.group.add(tufts);
        const capMat = new THREE.MeshStandardMaterial({ color: 0xd8483a, flatShading: true });
        const stemMat = new THREE.MeshStandardMaterial({ color: 0xf2e6cc, flatShading: true });
        const petal = [0xffd34d, 0xffffff, 0xd98cff].map((col) => new THREE.MeshStandardMaterial({ color: col, flatShading: true }));
        for (let i = 0; i < 26; i++) {
          const [x, z] = this.spot(rng, 2);
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
          const [fx, fz] = this.spot(rng, 3);
          const base = new THREE.Vector3(fx, 0.8 + rng() * 2.5, fz);
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
        // Flooded: a sheet of water over the whole floor (everyone wades ankle-deep), deeper dark
        // pools, ripples, waterfalls pouring down the walls into foaming basins, and floating debris.
        const h = this.half;
        const sides = WALL_SIDES[room.shape];
        const r = h / Math.cos(Math.PI / sides);
        const sheetMat = new THREE.MeshStandardMaterial({ color: 0x2a9cc4, emissive: 0x0b4a66, emissiveIntensity: 0.55, roughness: 0.04, metalness: 0.25, transparent: true, opacity: 0.8, depthWrite: false });
        const sheet = new THREE.Mesh(new THREE.CircleGeometry(r, sides).rotateX(-Math.PI / 2).rotateY(Math.PI / sides), sheetMat);
        sheet.position.y = 0.22;
        sheet.receiveShadow = true;
        sheet.renderOrder = 1;
        this.group.add(sheet);
        this.waterSheet = sheet;
        // Deeper water: darker patches under the sheet.
        const deep = new THREE.MeshStandardMaterial({ color: 0x0b2836, roughness: 0.1, metalness: 0.3 });
        for (let i = 0; i < 12; i++) {
          const pool = new THREE.Mesh(new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2), deep);
          const [px, pz] = this.spot(rng, 4);
          pool.position.set(px, 0.03, pz);
          pool.scale.set(2 + rng() * 3.5, 1, 1.5 + rng() * 2.5);
          pool.rotation.y = rng() * Math.PI;
          this.group.add(pool);
        }
        // Ripples spreading over the surface (animated in update()).
        const rippleGeo = new THREE.RingGeometry(0.85, 1, 32).rotateX(-Math.PI / 2);
        for (let i = 0; i < 26; i++) {
          const ring = new THREE.Mesh(rippleGeo, new THREE.MeshBasicMaterial({ color: 0xcff4ff, transparent: true, opacity: 0, depthWrite: false }));
          ring.position.y = 0.24;
          ring.renderOrder = 2;
          this.group.add(ring);
          this.ripples.push({ mesh: ring, age: rng() * 2.5, life: 1.8 + rng() * 1.2 });
        }
        // Light glinting on the surface.
        const glintMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xdff8ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
        for (let i = 0; i < 40; i++) {
          const glint = new THREE.Sprite(glintMat.clone());
          const [gx, gz] = this.spot(rng, 2);
          glint.position.set(gx, 0.3, gz);
          glint.scale.set(0.9, 0.25, 1);
          this.group.add(glint);
          this.glints.push({ sprite: glint, seed: rng() * 10 });
        }
        // Waterfalls on the diagonal walls, foaming where they land.
        const fallMat = new THREE.MeshStandardMaterial({ color: 0x9fdcf5, emissive: 0x2a6f8f, emissiveIntensity: 0.5, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false });
        const foamMat = new THREE.MeshBasicMaterial({ color: 0xf2fbff, transparent: true, opacity: 0.8, depthWrite: false });
        for (const a of [Math.PI / 4, -Math.PI / 4, (3 * Math.PI) / 4, (-3 * Math.PI) / 4]) {
          const nx = -Math.sin(a);
          const nz = -Math.cos(a);
          const d = wallDistance(room.shape, h, a) - 0.4;
          for (let k = 0; k < 3; k++) {
            const strip = new THREE.Mesh(new THREE.PlaneGeometry(1.3 - k * 0.3, WALL_HEIGHT), fallMat);
            strip.position.set(nx * (d - k * 0.06) + Math.cos(a) * (k - 1) * 1.0, WALL_HEIGHT / 2, nz * (d - k * 0.06) - Math.sin(a) * (k - 1) * 1.0);
            strip.rotation.y = a;
            this.group.add(strip);
          }
          for (let k = 0; k < 6; k++) {
            const foam = new THREE.Mesh(new THREE.SphereGeometry(0.35 + rng() * 0.3, 8, 6), foamMat);
            foam.position.set(nx * (d - 0.9) + (rng() - 0.5) * 2.4, 0.2, nz * (d - 0.9) + (rng() - 0.5) * 2.4);
            foam.scale.y = 0.45;
            this.group.add(foam);
            this.bobbers.push({ obj: foam, base: 0.2, seed: rng() * 10, amp: 0.06 });
          }
        }
        // Floating debris: barrels, planks and crates, bobbing.
        const wood = new THREE.MeshStandardMaterial({ color: 0x7a5232, roughness: 0.85, flatShading: true });
        const band = new THREE.MeshStandardMaterial({ color: 0x3a3532, metalness: 0.5, roughness: 0.5, flatShading: true });
        for (let i = 0; i < 9; i++) {
          const [x, z] = this.spot(rng, 5);
          const bit = new THREE.Group();
          if (i % 3 === 0) {
            const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.1, 10), wood);
            barrel.rotation.z = Math.PI / 2;
            const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.04, 4, 14), band);
            hoop.rotation.y = Math.PI / 2;
            bit.add(barrel, hoop);
          } else if (i % 3 === 1) {
            bit.add(new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 0.4), wood));
          } else {
            bit.add(new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.8), wood));
          }
          bit.position.set(x, 0.26, z);
          bit.rotation.y = rng() * Math.PI;
          bit.traverse((o) => (o.castShadow = true));
          this.group.add(bit);
          this.bobbers.push({ obj: bit, base: 0.26, seed: rng() * 10, amp: 0.05 });
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
          const [cx, cz] = this.spot(rng, 5);
          crack.position.set(cx, 0.02, cz);
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
          this.occluders.push(cluster);
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
      case 'dragonlair': {
        const h = this.half;
        // Obsidian spires: tall jagged black shards veined with lava; they block like pillars.
        const obsidian = new THREE.MeshStandardMaterial({ color: 0x1f1719, roughness: 0.35, metalness: 0.2, flatShading: true });
        const vein = this.glow(0x3a0a02, 0xff5a10, 1.4);
        for (const [x, z] of room.spires ?? []) {
          const spire = new THREE.Group();
          for (let i = 0; i < 3; i++) {
            const height = 9 + rng() * 6 - i * 3;
            const shard = new THREE.Mesh(new THREE.ConeGeometry(1.4 - i * 0.35, height, 5).translate(0, height / 2, 0), obsidian);
            shard.position.set((rng() - 0.5) * 1.2 * i, 0, (rng() - 0.5) * 1.2 * i);
            shard.rotation.set((rng() - 0.5) * 0.15, rng() * Math.PI, (rng() - 0.5) * 0.15);
            shard.castShadow = shard.receiveShadow = true;
            const crack = new THREE.Mesh(new THREE.BoxGeometry(0.12, height * 0.7, 0.12).translate(0, height * 0.35, 0), vein);
            crack.position.copy(shard.position).add(new THREE.Vector3(0.7 - i * 0.2, 0.3, 0.55));
            crack.rotation.copy(shard.rotation);
            spire.add(shard, crack);
          }
          spire.position.set(x, 0, z);
          this.group.add(spire);
          this.occluders.push(spire);
          this.obstacles.push({ x, z, radius: 1.6 });
        }
        // Lava pools with dark rims; walking is blocked, arrows fly over.
        for (const [x, z] of room.pools ?? []) {
          const lava = new THREE.Mesh(new THREE.CircleGeometry(2.9, 24).rotateX(-Math.PI / 2), this.glow(0x4a1004, 0xff5010, 1.7));
          lava.position.set(x, 0.03, z);
          const rim = new THREE.Mesh(new THREE.TorusGeometry(3.05, 0.4, 5, 24).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x241414, flatShading: true }));
          rim.position.set(x, 0.12, z);
          rim.castShadow = rim.receiveShadow = true;
          this.group.add(lava, rim);
          this.obstacles.push({ x, z, radius: 3.3, low: true });
          this.addFlame(x, 1, z, 3.5, 22, 22, 0xff5a20, 0xff6a20, 1.5);
        }
        // Lavafalls pouring down the walls into glowing basins.
        const fall = this.glow(0x7a1a04, 0xff4a0a, 1.15, { side: THREE.DoubleSide });
        for (const a of [Math.PI * 0.2, -Math.PI * 0.2, Math.PI * 0.45, -Math.PI * 0.45, Math.PI * 0.8, -Math.PI * 0.8]) {
          const nx = -Math.sin(a);
          const nz = -Math.cos(a);
          const d = h - 0.4;
          for (let k = 0; k < 3; k++) {
            const strip = new THREE.Mesh(new THREE.PlaneGeometry(1.1 - k * 0.25, WALL_HEIGHT + 2), fall);
            strip.position.set(nx * (d - k * 0.05) + Math.cos(a) * (k - 1) * 0.9, (WALL_HEIGHT + 2) / 2, nz * (d - k * 0.05) - Math.sin(a) * (k - 1) * 0.9);
            strip.rotation.y = a;
            this.group.add(strip);
          }
          const basin = new THREE.Mesh(new THREE.CircleGeometry(2.2, 18).rotateX(-Math.PI / 2), this.glow(0x4a1004, 0xff5010, 1.5));
          basin.position.set(nx * (d - 1.6), 0.03, nz * (d - 1.6));
          this.group.add(basin);
          this.addFlame(nx * (d - 1.5), 2.5, nz * (d - 1.5), 3, 20, 24, 0xff5a20, 0xff7a30, 1);
        }
        // A great rune circle in the middle of the floor.
        const rune = this.glow(0x2a0a04, 0xff7a2a, 1.1);
        for (const r of [7, 8.2]) {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.12, 4, 64).rotateX(Math.PI / 2), rune);
          ring.position.y = 0.04;
          this.group.add(ring);
        }
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const mark = new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0), rune);
          mark.scale.set(1, 0.08, 1.8);
          mark.position.set(Math.sin(a) * 7.6, 0.05, Math.cos(a) * 7.6);
          mark.rotation.y = a;
          this.group.add(mark);
        }
        // Cracks of lava across the floor, and embers rising everywhere.
        for (let i = 0; i < 22; i++) {
          const crack = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 2.5 + rng() * 5).rotateX(-Math.PI / 2), this.glow(0x3a0a02, 0xff4a10, 1.2));
          const [cx, cz] = this.spot(rng, 4);
          crack.position.set(cx, 0.02, cz);
          crack.rotation.y = rng() * Math.PI;
          this.group.add(crack);
        }
        const emberMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffa040, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
        for (let i = 0; i < 70; i++) {
          const sprite = new THREE.Sprite(emberMat.clone());
          sprite.scale.setScalar(0.25 + rng() * 0.3);
          const [ex, ez] = this.spot(rng, 2);
          this.embers.push({ sprite, x: ex, z: ez, speed: 0.6 + rng() * 1.2, seed: rng() * 10 });
          this.group.add(sprite);
        }
        this.addFlame(0, 3, 0, 4, 26, 40, 0xff6a30, 0xff7a30, 2);
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
        if (room.hasExit) {
          // Against the west wall, facing into the room (the north wall has the exit door).
          throne.position.set(-h + 2.5, 0, 0);
          throne.rotation.y = Math.PI / 2;
          this.obstacles.push({ x: -h + 2.3, z: 0, radius: 3 });
        } else {
          throne.position.set(0, 0, -h + 2.5);
          this.obstacles.push({ x: 0, z: -h + 2.3, radius: 3 });
        }
        this.group.add(throne);
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
        const a = rng() * Math.PI * 2;
        const d = wallDistance(this.room.shape, h, a) - 0.3 - rng() * 1.2;
        x = -Math.sin(a) * d;
        z = -Math.cos(a) * d;
        // Keep the gates clear.
        if (Math.abs(x) < GATE_HALF_WIDTH + 1 || Math.abs(z) < GATE_HALF_WIDTH + 1) x = z = 1e3;
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
    // Indoors gets a stronger fill so the dungeon reads clearly.
    this.group.add(moon, new THREE.HemisphereLight(room.hemiSky, room.hemiGround, room.outdoor ? 0.9 : 1.5));

    if (room.outdoor) return; // daylight: no torches
    const bracketMat = new THREE.MeshStandardMaterial({ color: 0x2a2626, metalness: 0.5, roughness: 0.6 });
    const bracketGeo = new THREE.BoxGeometry(0.25, 0.7, 0.5);
    // Eight torches round the walls, clear of the gates.
    for (const a of torchAngles(room.shape)) {
      const nx = -Math.sin(a);
      const nz = -Math.cos(a);
      const d = wallDistance(room.shape, h, a) - 0.3;
      const bracket = new THREE.Mesh(bracketGeo, bracketMat);
      bracket.position.set(nx * d, 3.2, nz * d);
      bracket.rotation.y = a;
      this.group.add(bracket);
      this.addFlame(nx * (d - 0.2), 3.75, nz * (d - 0.2), 1.3, 20, 26, room.torchLight, room.torchFlame, 1);
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
