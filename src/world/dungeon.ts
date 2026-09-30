import * as THREE from 'three';
import type { Circle } from '../game/combat';
import { glowTexture } from '../util/glow';

export const ARENA_HALF = 28; // playable floor is [-28, 28]²
export const WALL_HEIGHT = 7;
const TILE = 2;
const GATE_HALF_WIDTH = 2.2;
const GATE_HEIGHT = 4;
const PILLAR_RADIUS = 1.3;

interface Flame {
  light: THREE.PointLight;
  sprite: THREE.Sprite;
  base: number;
  seed: number;
}

/**
 * A square stone arena: tiled floor, brick walls with a gate in the middle of each side,
 * four pillars, wall torches and a central brazier. Everything static is instanced.
 */
export class Dungeon {
  readonly group = new THREE.Group();
  readonly obstacles: Circle[] = [];
  /** Just inside each gate — where enemies enter. */
  readonly gates: THREE.Vector3[] = [];
  private readonly flames: Flame[] = [];

  constructor(scene: THREE.Scene, rng: () => number) {
    scene.background = new THREE.Color(0x07060a);
    scene.fog = new THREE.Fog(0x07060a, 30, 80);

    this.buildFloor(rng);
    this.buildWalls(rng);
    this.buildPillars();
    this.buildRubble(rng);
    this.buildLights();

    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      this.gates.push(new THREE.Vector3(Math.sin(a) * (ARENA_HALF - 1.5), 0, -Math.cos(a) * (ARENA_HALF - 1.5)));
    }
    scene.add(this.group);
  }

  /** Torch flicker. */
  update(time: number): void {
    for (const f of this.flames) {
      const flicker =
        0.82 + Math.sin(time * 11 + f.seed) * 0.08 + Math.sin(time * 23.7 + f.seed * 3) * 0.06 + Math.sin(time * 5.3 + f.seed * 7) * 0.06;
      f.light.intensity = f.base * flicker;
      f.sprite.scale.setScalar(f.sprite.userData.size * (0.9 + flicker * 0.15));
    }
  }

  private buildFloor(rng: () => number): void {
    const n = (ARENA_HALF * 2) / TILE;
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
        const x = -ARENA_HALF + TILE / 2 + ix * TILE;
        const z = -ARENA_HALF + TILE / 2 + iz * TILE;
        m.makeRotationY((rng() - 0.5) * 0.03).setPosition(x, -0.15 + (rng() - 0.5) * 0.04, z);
        tiles.setMatrixAt(i, m);
        const l = 0.2 + rng() * 0.07;
        tiles.setColorAt(i, c.setHSL(0.07 + rng() * 0.05, 0.08 + rng() * 0.06, l));
        i++;
      }
    }
    tiles.receiveShadow = true;
    // Dark grout showing between the tiles.
    const grout = new THREE.Mesh(
      new THREE.BoxGeometry(ARENA_HALF * 2 + 4, 0.2, ARENA_HALF * 2 + 4),
      new THREE.MeshStandardMaterial({ color: 0x0e0c10, roughness: 1 }),
    );
    grout.position.y = -0.25;
    this.group.add(tiles, grout);
  }

  private buildWalls(rng: () => number): void {
    const brickW = 2;
    const brickH = 1;
    const depth = 1.4;
    const span = ARENA_HALF + depth;
    const rows = WALL_HEIGHT / brickH;
    const perRow = Math.ceil((span * 2) / brickW) + 1;
    const bricks = new THREE.InstancedMesh(
      new THREE.BoxGeometry(brickW - 0.06, brickH - 0.06, depth),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }),
      4 * rows * perRow,
    );
    const m = new THREE.Matrix4();
    const rot = new THREE.Matrix4();
    const c = new THREE.Color();
    let count = 0;
    const gateMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x5b5360, roughness: 0.9, flatShading: true });

    for (let k = 0; k < 4; k++) {
      rot.makeRotationY((k * Math.PI) / 2);
      for (let row = 0; row < rows; row++) {
        const offset = row % 2 ? brickW / 2 : 0;
        for (let b = 0; b < perRow; b++) {
          const x = -span + offset + b * brickW;
          if (x - brickW / 2 > span) continue;
          // Leave an opening for the gate.
          if (row < GATE_HEIGHT && Math.abs(x) - brickW / 2 < GATE_HALF_WIDTH) continue;
          m.makeTranslation(x, row * brickH + brickH / 2, -(ARENA_HALF + depth / 2)).premultiply(rot);
          bricks.setMatrixAt(count, m);
          const l = 0.16 + rng() * 0.08 + (row === 0 ? -0.03 : 0);
          bricks.setColorAt(count, c.setHSL(0.72 + rng() * 0.08, 0.06 + rng() * 0.05, l));
          count++;
        }
      }

      // Gate: black void behind the opening, with a stone frame.
      const gate = new THREE.Group();
      const voidPlane = new THREE.Mesh(new THREE.PlaneGeometry(GATE_HALF_WIDTH * 2, GATE_HEIGHT), gateMat);
      voidPlane.position.set(0, GATE_HEIGHT / 2, -(ARENA_HALF + depth));
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(GATE_HALF_WIDTH * 2 + 1.6, 0.8, depth + 0.3), trimMat);
      lintel.position.set(0, GATE_HEIGHT + 0.4, -(ARENA_HALF + depth / 2));
      const postGeo = new THREE.BoxGeometry(0.8, GATE_HEIGHT, depth + 0.3);
      const postL = new THREE.Mesh(postGeo, trimMat);
      postL.position.set(-GATE_HALF_WIDTH - 0.4, GATE_HEIGHT / 2, -(ARENA_HALF + depth / 2));
      const postR = postL.clone();
      postR.position.x = GATE_HALF_WIDTH + 0.4;
      for (const o of [lintel, postL, postR]) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
      gate.add(voidPlane, lintel, postL, postR);
      gate.rotation.y = (k * Math.PI) / 2;
      this.group.add(gate);
    }
    bricks.count = count;
    bricks.castShadow = true;
    bricks.receiveShadow = true;
    this.group.add(bricks);
  }

  private buildPillars(): void {
    const stone = new THREE.MeshStandardMaterial({ color: 0x4f4856, roughness: 0.9, flatShading: true });
    const shaftGeo = new THREE.CylinderGeometry(PILLAR_RADIUS - 0.2, PILLAR_RADIUS - 0.1, WALL_HEIGHT - 1.2, 8);
    const blockGeo = new THREE.BoxGeometry(PILLAR_RADIUS * 2.1, 0.6, PILLAR_RADIUS * 2.1);
    for (const [x, z] of [[-11, -11], [11, -11], [-11, 11], [11, 11]]) {
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

    // Central brazier.
    const brazier = new THREE.Group();
    const iron = new THREE.MeshStandardMaterial({ color: 0x2a2626, roughness: 0.6, metalness: 0.5, flatShading: true });
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 0.7, 0.7, 10, 1, true), iron);
    bowl.material.side = THREE.DoubleSide;
    bowl.position.y = 1.35;
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.5, 1.1, 8), iron);
    stand.position.y = 0.55;
    const coals = new THREE.Mesh(
      new THREE.CircleGeometry(1.1, 10).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x3a1206, emissive: 0xff4a10, emissiveIntensity: 1.2 }),
    );
    coals.position.y = 1.5;
    for (const o of [bowl, stand]) o.castShadow = true;
    brazier.add(bowl, stand, coals);
    this.group.add(brazier);
    this.obstacles.push({ x: 0, z: 0, radius: 1.3 });
  }

  private buildRubble(rng: () => number): void {
    const rocks = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }),
      90,
    );
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const c = new THREE.Color();
    for (let i = 0; i < rocks.count; i++) {
      // Hug the walls and pillar bases, where rubble would collect.
      let x: number;
      let z: number;
      if (i < 60) {
        const along = (rng() * 2 - 1) * ARENA_HALF;
        const inset = ARENA_HALF - 0.3 - rng() * 1.2;
        [x, z] = [[along, -inset], [along, inset], [-inset, along], [inset, along]][i % 4];
        if (Math.abs(along) < GATE_HALF_WIDTH + 1) x = z = 1e3; // keep gates clear
      } else {
        const p = [[-11, -11], [11, -11], [-11, 11], [11, 11]][i % 4];
        const a = rng() * Math.PI * 2;
        const r = PILLAR_RADIUS + 0.3 + rng() * 0.6;
        x = p[0] + Math.cos(a) * r;
        z = p[1] + Math.sin(a) * r;
      }
      const s = 0.1 + rng() * rng() * 0.45;
      q.setFromEuler(e.set(rng() * 3, rng() * 3, rng() * 3));
      m.compose(new THREE.Vector3(x, s * 0.3, z), q, new THREE.Vector3(s, s * 0.7, s));
      rocks.setMatrixAt(i, m);
      const l = 0.18 + rng() * 0.1;
      rocks.setColorAt(i, c.setHSL(0.75, 0.05, l));
    }
    rocks.castShadow = rocks.receiveShadow = true;
    this.group.add(rocks);
  }

  private buildLights(): void {
    // Cool light falling from high above (the only shadow caster), plus faint fill.
    const moon = new THREE.DirectionalLight(0x9fb0ff, 0.9);
    moon.position.set(12, 40, 18);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    const sc = moon.shadow.camera;
    sc.left = sc.bottom = -ARENA_HALF - 4;
    sc.right = sc.top = ARENA_HALF + 4;
    sc.near = 1;
    sc.far = 100;
    moon.shadow.bias = -0.0005;
    moon.shadow.normalBias = 0.04;
    this.group.add(moon, new THREE.HemisphereLight(0x5a5a80, 0x1a1010, 0.9));

    const flameMat = new THREE.SpriteMaterial({
      map: glowTexture(),
      color: 0xff9a40,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    const bracketMat = new THREE.MeshStandardMaterial({ color: 0x2a2626, metalness: 0.5, roughness: 0.6 });
    const bracketGeo = new THREE.BoxGeometry(0.25, 0.7, 0.5);

    const addFlame = (x: number, y: number, z: number, size: number, intensity: number, distance: number) => {
      const light = new THREE.PointLight(0xff8a3d, intensity, distance, 1.6);
      light.position.set(x, y + 0.3, z);
      const sprite = new THREE.Sprite(flameMat);
      sprite.position.set(x, y, z);
      sprite.userData.size = size;
      sprite.scale.setScalar(size);
      this.group.add(light, sprite);
      this.flames.push({ light, sprite, base: intensity, seed: this.flames.length * 1.7 });
    };

    // Two torches per wall.
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      for (const along of [-14, 14]) {
        const ox = Math.cos(a) * along;
        const oz = Math.sin(a) * along;
        const nx = Math.sin(a);
        const nz = -Math.cos(a);
        const wx = ox + nx * (ARENA_HALF - 0.3);
        const wz = oz + nz * (ARENA_HALF - 0.3);
        const bracket = new THREE.Mesh(bracketGeo, bracketMat);
        bracket.position.set(wx, 3.2, wz);
        bracket.rotation.y = -a;
        this.group.add(bracket);
        addFlame(wx - nx * 0.2, 3.75, wz - nz * 0.2, 1.3, 14, 22);
      }
    }
    addFlame(0, 2.1, 0, 3.2, 30, 30);
  }
}
