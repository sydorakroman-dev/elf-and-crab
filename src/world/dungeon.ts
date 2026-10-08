import * as THREE from 'three';
import { setWalkMap, type Circle } from '../game/combat';
import { TILE, type WalkMap } from '../game/walkmap';
import { glowTexture } from '../util/glow';
import { mulberry32 } from '../util/rng';
import type { Level, Prop } from './levelgen';
import type { RoomDef } from './rooms';

export const GATE_HALF_WIDTH = 2.2;
const GATE_HEIGHT = 4;
const PILLAR_RADIUS = 1.3;
/** Walls are drawn (and faded) in square chunks of this many tiles. */
const CHUNK = 8;
/** Point lights shared out to the flames nearest the camera's focus. */
const LIGHT_POOL = 8;
/** The sun / moon's shadow covers this far around the focus (m). */
const SHADOW_REACH = 34;

interface Flame {
  sprite: THREE.Sprite;
  x: number;
  y: number;
  z: number;
  /** Light it gives when it has one of the pooled lights. */
  intensity: number;
  distance: number;
  color: number;
  seed: number;
  flicker: number;
}

/** A chunk of wall (and the woods / rock behind it), faded as one when it hides what you follow. */
interface WallChunk {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  mats: THREE.Material[];
  opacity: number;
}

interface Fadeable {
  obj: THREE.Object3D;
  mats: THREE.Material[];
  opacity: number;
}

/**
 * One level of the dungeon, drawn from its generated Level and its theme (RoomDef): tiled floor,
 * walls (brick, or hedges and woods outdoors) round the halls and corridors, the props (trees,
 * pillars, crystals, braziers, lava…), the exit door, torches and lights. The sun / moon's shadow
 * and a small pool of point lights follow the camera's focus, so a big level stays fast.
 * dispose() frees it all.
 */
interface ForestLists {
  trunks: THREE.Matrix4[];
  trunkColors: THREE.Color[];
  canopies: THREE.Matrix4[];
  canopyColors: THREE.Color[];
  pines: THREE.Matrix4[];
  pineColors: THREE.Color[];
  bushes: THREE.Matrix4[];
  bushColors: THREE.Color[];
  flowers: THREE.Matrix4[];
  flowerColors: THREE.Color[];
  rocks: THREE.Matrix4[];
  rockColors: THREE.Color[];
}

const fq = new THREE.Quaternion();
const fe = new THREE.Euler();
const fv = new THREE.Vector3();
const fs = new THREE.Vector3();
const hsl = (h: number, s: number, l: number) => new THREE.Color().setHSL(h, s, l);

/**
 * One tile of the Woodland's edge, `d` tiles from the clearing: trunks under tall canopies (oak,
 * pine, birch, some in autumn colours) with undergrowth — bushes (some flowering, some turning),
 * mossy boulders and fallen logs — thick at the edge, trees further in.
 */
function forestTile(rng: () => number, d: number, x: number, z: number, o: ForestLists): void {
  const at = (spread: number) => [x + (rng() - 0.5) * spread, z + (rng() - 0.5) * spread] as const;
  // Trees: now and then right at the edge, mostly further in.
  if (rng() < (d === 1 ? 0.35 : d === 2 ? 0.6 : 0.5)) {
    const [tx, tz] = at(1.4);
    const kind = rng();
    if (kind < 0.25) {
      // Pine: a dark trunk, stacked cones.
      const height = 5 + rng() * 3;
      o.trunks.push(new THREE.Matrix4().compose(fv.set(tx, 0, tz), fq.identity(), fs.set(0.7, height * 0.5, 0.7)));
      o.trunkColors.push(hsl(0.07, 0.35, 0.2 + rng() * 0.05));
      const tint = hsl(0.38 + (rng() - 0.5) * 0.06, 0.35, 0.17 + rng() * 0.06);
      for (let i = 0; i < 3; i++) {
        const w = 1.9 - i * 0.5;
        o.pines.push(new THREE.Matrix4().compose(fv.set(tx, height * (0.25 + i * 0.22), tz), fq.setFromEuler(fe.set(0, rng() * 3, 0)), fs.set(w, height * 0.38, w)));
        o.pineColors.push(tint.clone().offsetHSL(0, 0, i * 0.03));
      }
    } else {
      // Oak (brown bark) or birch (pale bark, lighter leaves); some turned gold, orange or red.
      const birch = kind > 0.8;
      const height = 3.2 + rng() * 2.6;
      o.trunks.push(new THREE.Matrix4().compose(fv.set(tx, 0, tz), fq.setFromEuler(fe.set((rng() - 0.5) * 0.12, 0, (rng() - 0.5) * 0.12)), fs.set(birch ? 0.6 : 1, height, birch ? 0.6 : 1)));
      o.trunkColors.push(birch ? hsl(0.1, 0.08, 0.8) : hsl(0.07, 0.4, 0.22 + rng() * 0.08));
      const season = rng();
      const leaf =
        season < 0.14 ? hsl(0.1 + rng() * 0.04, 0.7, 0.42) // gold
        : season < 0.24 ? hsl(0.05 + rng() * 0.03, 0.7, 0.4) // orange
        : season < 0.3 ? hsl(0.01 + rng() * 0.02, 0.6, 0.35) // red
        : birch ? hsl(0.2 + rng() * 0.04, 0.5, 0.4)
        : hsl(0.25 + (rng() - 0.5) * 0.08, 0.45, 0.24 + rng() * 0.1);
      for (let i = 0; i < 3; i++) {
        const k = (birch ? 1.4 : 1.9) - i * 0.4 + rng() * 0.3;
        o.canopies.push(new THREE.Matrix4().compose(fv.set(tx + (rng() - 0.5) * 1.2, height + 0.4 + i * 0.9, tz + (rng() - 0.5) * 1.2), fq.setFromEuler(fe.set(rng() * 3, rng() * 3, rng() * 3)), fs.set(k, k * 0.85, k)));
        o.canopyColors.push(leaf.clone().offsetHSL((rng() - 0.5) * 0.02, 0, (rng() - 0.5) * 0.06));
      }
    }
  }
  // Undergrowth: thick along the edge, thinning further in.
  const bushes = d === 1 ? 2 + Math.floor(rng() * 2) : d === 2 ? (rng() < 0.6 ? 1 : 0) : rng() < 0.25 ? 1 : 0;
  for (let b = 0; b < bushes; b++) {
    const [bx, bz] = at(1.8);
    const look = rng();
    const color =
      look < 0.16 ? hsl(0.07 + rng() * 0.05, 0.6, 0.38) // turning
      : look < 0.3 ? hsl(0.17 + rng() * 0.03, 0.5, 0.36) // yellow-green
      : look < 0.42 ? hsl(0.42, 0.3, 0.22) // blue-green
      : hsl(0.27 + (rng() - 0.5) * 0.06, 0.45, 0.22 + rng() * 0.1);
    const k = 0.75 + rng() * 0.6;
    const h = (0.65 + rng() * 0.45) * k;
    for (let i = 0; i < 2; i++) {
      const ox = bx + (rng() - 0.5) * 0.9;
      const oz = bz + (rng() - 0.5) * 0.9;
      const kk = k * (1 - i * 0.25);
      o.bushes.push(new THREE.Matrix4().compose(fv.set(ox, h * 0.7, oz), fq.setFromEuler(fe.set(rng() * 3, rng() * 3, rng() * 3)), fs.set(kk, h, kk)));
      o.bushColors.push(color.clone().offsetHSL(0, 0, (rng() - 0.5) * 0.06));
    }
    // Some flower: pink, white or yellow blossoms dotted over it.
    if (rng() < 0.22) {
      const petal = [hsl(0.93, 0.6, 0.75), hsl(0.15, 0.2, 0.92), hsl(0.13, 0.85, 0.6), hsl(0.75, 0.45, 0.7)][Math.floor(rng() * 4)];
      for (let f = 0; f < 6; f++) {
        const a = rng() * Math.PI * 2;
        const up = 0.3 + rng() * 0.6;
        o.flowers.push(new THREE.Matrix4().compose(fv.set(bx + Math.sin(a) * k * 0.85, h * (0.7 + up * 0.8), bz + Math.cos(a) * k * 0.85), fq.setFromEuler(fe.set(rng(), rng(), rng())), fs.set(1, 1, 1)));
        o.flowerColors.push(petal);
      }
    }
  }
  // Mossy boulders and the odd fallen log.
  if (rng() < (d <= 2 ? 0.14 : 0.06)) {
    const [rx, rz] = at(1.2);
    const k = 0.7 + rng() * 0.8;
    o.rocks.push(new THREE.Matrix4().compose(fv.set(rx, k * 0.35, rz), fq.setFromEuler(fe.set(rng() * 3, rng() * 3, rng() * 3)), fs.set(k * 1.2, k * 0.8, k)));
    o.rockColors.push(rng() < 0.5 ? hsl(0.1, 0.05, 0.42 + rng() * 0.1) : hsl(0.22, 0.3, 0.32));
  } else if (d <= 2 && rng() < 0.06) {
    const [lx, lz] = at(0.8);
    const len = 2.5 + rng() * 2;
    fq.setFromEuler(fe.set(0, rng() * Math.PI, Math.PI / 2));
    // The trunk geometry stands on its base: tipped over, it lies along the ground from (lx, lz).
    o.trunks.push(new THREE.Matrix4().compose(fv.set(lx, 0.4, lz), fq, fs.set(0.75, len, 0.75)));
    o.trunkColors.push(hsl(0.07, 0.35, 0.24));
  }
}

export class Dungeon {
  readonly group = new THREE.Group();
  readonly room: RoomDef;
  readonly level: Level;
  readonly map: WalkMap;
  readonly wallHeight: number;
  readonly obstacles: Circle[] = [];
  /** Tall things (pillars, trees, crystal clusters) a camera may need to see through. */
  readonly occluders: THREE.Object3D[] = [];
  /** Where the elf arrives (looking north). */
  readonly entry = new THREE.Vector3();
  /** Centre of the exit doorway on the floor (null in the final lair). */
  readonly exit: THREE.Vector3 | null;
  /** Fire positions and loudness, for positional ambience. */
  readonly fireSources: { position: THREE.Vector3; strength: number }[] = [];
  /** 0 closed → 1 open (the door animates toward it). */
  exitTarget = 0;
  private readonly flames: Flame[] = [];
  private readonly lights: THREE.PointLight[] = [];
  private lightTimer = 0;
  private readonly moon: THREE.DirectionalLight;
  private readonly glowing: THREE.MeshStandardMaterial[] = [];
  private readonly chunks: WallChunk[] = [];
  private fadeables: Fadeable[] = [];
  private exitBars: THREE.Group | null = null;
  private exitPortal: THREE.Mesh | null = null;
  private exitLight: THREE.PointLight | null = null;
  /** The light column showing where to go (over the guardian's hall, then the exit door). */
  private beacon: THREE.Group | null = null;
  private exitOpen = 0;
  /** Chest lids (in the level's chest order): how open (0 → 1), and where they're heading. */
  /** Sarcophagus lids by the prop's index (they slide off when the dead inside wake). */
  private readonly sarcophagi = new Map<number, THREE.Object3D>();
  private readonly chestLids: { lid: THREE.Object3D; open: number; target: number; glow: THREE.Sprite }[] = [];
  private readonly fireflies: { sprite: THREE.Sprite; base: THREE.Vector3; seed: number }[] = [];
  private readonly embers: { sprite: THREE.Sprite; x: number; z: number; speed: number; seed: number }[] = [];
  private waterSheet: THREE.Mesh | null = null;
  private readonly ripples: { mesh: THREE.Mesh; age: number; life: number }[] = [];
  private readonly glints: { sprite: THREE.Sprite; seed: number }[] = [];
  private readonly bobbers: { obj: THREE.Object3D; base: number; seed: number; amp: number }[] = [];
  private readonly focus = new THREE.Vector3();
  /** Things only drawn near the focus (fog hides them further off anyway): [object, range m]. */
  private readonly nearOnly: [THREE.Object3D, number][] = [];
  private cullTimer = 0;
  /** Floor tiles next to a wall: [floor col, floor row, wall dc, wall dr]. */
  private readonly edges: [number, number, number, number][] = [];

  constructor(scene: THREE.Scene, room: RoomDef, level: Level, shadowMapSize = 2048) {
    this.room = room;
    this.level = level;
    this.map = level.map;
    this.wallHeight = room.wallHeight;
    setWalkMap(level.map); // every walkability check (movement, arrows, bolts, camera) follows this level
    const rng = mulberry32(level.seed ^ 0x5eed);
    scene.background = new THREE.Color(room.fog);
    scene.fog = room.outdoor ? new THREE.Fog(room.fog, 45, 110) : new THREE.Fog(room.fog, 28, 78);
    this.entry.set(level.start.x, 0, level.start.z);
    this.exit = level.exit ? new THREE.Vector3(level.exit.x, 0, level.exit.z + 0.6) : null;
    this.findEdges();

    this.buildFloor(rng);
    this.buildWalls(rng);
    this.buildExit();
    this.buildChests();
    this.buildBeacon();
    level.props.forEach((p, i) => this.buildProp(p, rng, i));
    this.buildFeature(rng);
    this.buildRubble(rng);
    this.moon = this.buildLights(shadowMapSize, rng);
    this.fadeables = this.occluders.map((obj) => ({ obj, mats: ownMaterials(obj), opacity: 1 }));
    this.focus.copy(this.entry);
    this.update(0, 0, this.entry);
    this.freezeStatic();
    scene.add(this.group);
  }

  /**
   * Thousands of walls, props and bits of dressing never move: work out their positions once and
   * let the renderer skip them every frame (only the things that animate stay live).
   */
  private freezeStatic(): void {
    const live = new Set<THREE.Object3D>();
    const top = (o: THREE.Object3D | null) => {
      while (o && o.parent && o.parent !== this.group) o = o.parent;
      if (o && o.parent === this.group) live.add(o);
    };
    for (const f of this.flames) top(f.sprite);
    for (const f of this.fireflies) top(f.sprite);
    for (const e of this.embers) top(e.sprite);
    for (const b of this.bobbers) top(b.obj);
    for (const r of this.ripples) top(r.mesh);
    for (const g of this.glints) top(g.sprite);
    for (const c of this.chestLids) top(c.lid);
    for (const l of this.lights) top(l);
    top(this.waterSheet);
    top(this.exitBars);
    top(this.exitPortal);
    top(this.beacon);
    top(this.moon);
    top(this.moon.target);
    this.group.updateMatrixWorld(true);
    for (const child of this.group.children) {
      if (live.has(child)) continue;
      child.traverse((o) => {
        o.matrixAutoUpdate = false;
        o.matrixWorldAutoUpdate = false;
      });
    }
  }

  /** Is (x, z) in the open exit doorway? */
  inExit(x: number, z: number): boolean {
    const e = this.level.exit;
    return !!e && this.exitTarget === 1 && Math.abs(x - e.x) < GATE_HALF_WIDTH && z < e.z + 1.6;
  }

  setExitOpen(open: boolean): void {
    this.exitTarget = open ? 1 : 0;
  }

  /** The guardian is beaten: the light column moves to the open exit door. */
  beaconToExit(): void {
    const e = this.level.exit;
    if (!this.beacon || !e) return;
    this.beacon.position.set(e.x, 0, e.z + 2);
    for (const c of this.beacon.children) ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).color.setHex(0xfff1c0);
  }

  /** The lid of sarcophagus prop `i` slides off. */
  openSarcophagus(i: number): void {
    const lid = this.sarcophagi.get(i);
    if (!lid || lid.userData.open) return;
    lid.userData.open = true;
    lid.position.set(0.9, 0.5, 0.4);
    lid.rotation.set(0.2, 0.3, -0.5);
    lid.updateMatrix();
    lid.parent?.updateMatrixWorld(true);
  }

  /** Swings chest `i`'s lid open. */
  openChest(i: number): void {
    const c = this.chestLids[i];
    if (c) c.target = 1;
  }

  /** Torch flicker, the lights and shadow following `focus`, glowing things, water, the exit door. */
  update(time: number, dt: number, focus: THREE.Vector3): void {
    this.focus.copy(focus);
    for (const f of this.flames) {
      f.flicker = 0.82 + Math.sin(time * 11 + f.seed) * 0.08 + Math.sin(time * 23.7 + f.seed * 3) * 0.06 + Math.sin(time * 5.3 + f.seed * 7) * 0.06;
      f.sprite.scale.setScalar(f.sprite.userData.size * (0.9 + f.flicker * 0.15));
    }
    // Hand the point lights to the flames nearest the focus (re-sorted a few times a second).
    this.lightTimer -= dt;
    if (this.lightTimer <= 0 || dt === 0) {
      this.lightTimer = 0.25;
      const near = this.flames
        .map((f) => ({ f, d: (f.x - focus.x) ** 2 + (f.z - focus.z) ** 2 }))
        .filter((n) => n.d < 45 * 45)
        .sort((a, b) => a.d - b.d)
        .slice(0, LIGHT_POOL);
      this.lights.forEach((l, i) => {
        const n = near[i];
        l.userData.flame = n?.f ?? null;
        if (!n) {
          l.intensity = 0;
          return;
        }
        l.position.set(n.f.x, n.f.y + 0.3, n.f.z);
        l.color.setHex(n.f.color);
        l.distance = n.f.distance;
      });
    }
    for (const l of this.lights) {
      const f = l.userData.flame as Flame | null;
      if (f) l.intensity = f.intensity * f.flicker;
    }
    this.cullTimer -= dt;
    if (this.cullTimer <= 0 || dt === 0) {
      this.cullTimer = 0.2;
      for (const [obj, range] of this.nearOnly) {
        const c = (obj.userData.centre as { x: number; z: number } | undefined) ?? obj.position;
        obj.visible = Math.abs(c.x - focus.x) < range && Math.abs(c.z - focus.z) < range;
      }
    }
    // The shadow-casting sun / moon keeps the focus in the middle of its shadow.
    this.moon.position.set(focus.x + 12, 40, focus.z + 18);
    this.moon.target.position.set(focus.x, 0, focus.z);

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
        // Ripples pop up around wherever we're looking.
        r.age = 0;
        const p = this.map.randomFloor(Math.random, 1, focus, 0, 26);
        r.mesh.position.x = p.x;
        r.mesh.position.z = p.z;
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

    if (this.beacon) {
      const pulse = 0.85 + Math.sin(time * 2.2) * 0.15;
      this.beacon.children.forEach((c, i) => ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = (i === 0 ? 0.22 : 0.9) * pulse);
      this.beacon.rotation.y = time * 0.3;
    }
    for (const c of this.chestLids) {
      c.open += (c.target - c.open) * (1 - Math.exp(-6 * dt));
      c.lid.rotation.x = -c.open * 1.9;
      c.glow.material.opacity = c.target ? Math.max(0, 0.9 - c.open * 0.9) : 0.35 + Math.sin(time * 3) * 0.15;
    }
    this.exitOpen += (this.exitTarget - this.exitOpen) * (1 - Math.exp(-3 * dt));
    if (this.exitBars) this.exitBars.position.y = this.exitOpen * (GATE_HEIGHT - 0.3);
    if (this.exitPortal && this.exitLight) {
      (this.exitPortal.material as THREE.MeshBasicMaterial).opacity = this.exitOpen * (0.75 + Math.sin(time * 4) * 0.1);
      this.exitLight.intensity = this.exitOpen * 26;
    }
  }

  /**
   * Fades walls and tall props standing between the camera and `focus` (what it follows), so the
   * hero / creature never vanishes behind them.
   */
  fadeBetween(camera: THREE.Vector3, focus: THREE.Vector3, dt: number): void {
    const fy = focus.y + 1;
    // Only the part of the sight line below the wall tops can be blocked.
    const rise = camera.y - fy;
    // (In the Woodland the edge is tall trees: all the way up to the camera.)
    const top = this.room.outdoor ? 99 : this.wallHeight + 0.5;
    const tTop = rise > 0.01 ? Math.min(1, (top - fy) / rise) : 1;
    const ex = focus.x + (camera.x - focus.x) * tTop;
    const ez = focus.z + (camera.z - focus.z) * tTop;
    // Trees also fill the foreground under the camera: fade them along the whole way to it, wider.
    const pad = this.room.outdoor ? 3 : 1;
    for (const c of this.chunks) {
      const hit = segmentHitsBox(focus.x, focus.z, ex, ez, c.minX - pad, c.maxX + pad, c.minZ - pad, c.maxZ + pad);
      fade(c, hit ? 0.28 : 1, dt);
    }
    const lx = camera.x - focus.x;
    const lz = camera.z - focus.z;
    const len2 = lx * lx + lz * lz || 1;
    for (const item of this.fadeables) {
      const p = item.obj.position;
      const t = ((p.x - focus.x) * lx + (p.z - focus.z) * lz) / len2;
      const cx = focus.x + lx * Math.max(0, Math.min(1, t));
      const cz = focus.z + lz * Math.max(0, Math.min(1, t));
      const near = Math.hypot(p.x - cx, p.z - cz) < 3 && t > -0.05 && t < 0.6;
      fade(item, near || Math.hypot(p.x - focus.x, p.z - focus.z) < 2.5 ? 0.22 : 1, dt);
    }
  }

  /** Removes the level from the scene and frees its GPU resources. */
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

  // ── Building ──────────────────────────────────────────────────────────────────────────────────

  private findEdges(): void {
    const m = this.map;
    for (let r = 0; r < m.rows; r++)
      for (let c = 0; c < m.cols; c++) {
        if (!m.isFloor(c, r)) continue;
        for (const [dc, dr] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) if (!m.isFloor(c + dc, r + dr)) this.edges.push([c, r, dc, dr]);
      }
  }

  /** How many tiles from wall tile (c, r) to the nearest floor (1 = right next to it), up to 3. */
  private depth(c: number, r: number): number {
    for (let d = 1; d <= 3; d++)
      for (let dr = -d; dr <= d; dr++)
        for (let dc = -d; dc <= d; dc++) if (Math.max(Math.abs(dr), Math.abs(dc)) === d && this.map.isFloor(c + dc, r + dr)) return d;
    return 99;
  }

  private buildFloor(rng: () => number): void {
    const m = this.map;
    const { floor } = this.room;
    let count = 0;
    for (const t of m.tiles) if (t) count++;
    const tiles = new THREE.InstancedMesh(
      new THREE.BoxGeometry(TILE - 0.07, 0.3, TILE - 0.07),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, flatShading: true }),
      count,
    );
    const mat = new THREE.Matrix4();
    const c = new THREE.Color();
    let i = 0;
    const bump = this.room.outdoor ? 0.1 : 0.04; // grass is lumpier than flagstones
    for (let r = 0; r < m.rows; r++)
      for (let col = 0; col < m.cols; col++) {
        if (!m.isFloor(col, r)) continue;
        const p = m.centre(col, r);
        mat.makeRotationY((rng() - 0.5) * 0.03).setPosition(p.x, -0.15 + (rng() - 0.5) * bump, p.z);
        tiles.setMatrixAt(i, mat);
        tiles.setColorAt(i, c.setHSL(floor.h + (rng() - 0.5) * 0.05, floor.s + (rng() - 0.5) * 0.06, floor.l + (rng() - 0.5) * 0.07));
        i++;
      }
    tiles.receiveShadow = true;
    tiles.computeBoundingSphere();
    // Dark ground under everything (the grout between tiles, and beyond the walls).
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(m.cols * TILE + 80, m.rows * TILE + 80).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: this.room.outdoor ? 0x22381a : 0x0e0c10, roughness: 1 }),
    );
    ground.position.set(m.originX + (m.cols * TILE) / 2, -0.3, m.originZ + (m.rows * TILE) / 2);
    this.group.add(tiles, ground);
  }

  /**
   * The walls: stacked blocks on every wall tile touching the floor, rock caps (or, outdoors, a
   * wood of trees) a couple of tiles deeper, all in chunks that can fade out separately.
   */
  private buildWalls(rng: () => number): void {
    const m = this.map;
    const { wall } = this.room;
    const outdoor = !!this.room.outdoor;
    // How the walls are made: the forest's edge, rough cave rock, pale cut stone, a palisade, or brick.
    const style = outdoor ? 'forest' : this.room.feature === 'crystals' ? 'rock' : this.room.feature === 'throne' ? 'palisade' : 'brick';
    const crisp = this.room.feature === 'brazier'; // the crypt: even, pale cut stone
    const H = this.wallHeight;
    const rows = Math.ceil(H);
    const rockGeo = new THREE.IcosahedronGeometry(1, 0);
    const stakeGeo = new THREE.CylinderGeometry(0.3, 0.34, 1, 6).translate(0, 0.5, 0);
    const tipGeo = new THREE.ConeGeometry(0.32, 0.9, 6).translate(0, 0.45, 0);
    const blockGeo = new THREE.BoxGeometry(TILE - 0.06, 1 - 0.06, TILE - 0.06);
    const capGeo = new THREE.BoxGeometry(TILE, 0.5, TILE);
    const trunkGeo = new THREE.CylinderGeometry(0.35, 0.55, 1, 6).translate(0, 0.5, 0);
    const canopyGeo = new THREE.IcosahedronGeometry(1, 0);
    const pineGeo = new THREE.ConeGeometry(1, 1, 7).translate(0, 0.5, 0);
    const bushGeo = new THREE.DodecahedronGeometry(1, 0);
    const flowerGeo = new THREE.OctahedronGeometry(0.13, 0);
    const mat4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    const c = new THREE.Color();
    for (let cr = 0; cr < m.rows; cr += CHUNK)
      for (let cc = 0; cc < m.cols; cc += CHUNK) {
        const blocks: THREE.Matrix4[] = [];
        const blockColors: THREE.Color[] = [];
        const caps: THREE.Matrix4[] = [];
        const trunks: THREE.Matrix4[] = [];
        const trunkColors: THREE.Color[] = [];
        const canopies: THREE.Matrix4[] = [];
        const canopyColors: THREE.Color[] = [];
        const pines: THREE.Matrix4[] = [];
        const pineColors: THREE.Color[] = [];
        const bushes: THREE.Matrix4[] = [];
        const bushColors: THREE.Color[] = [];
        const flowers: THREE.Matrix4[] = [];
        const flowerColors: THREE.Color[] = [];
        const rocks: THREE.Matrix4[] = [];
        const rockColors: THREE.Color[] = [];
        const forest = { trunks, trunkColors, canopies, canopyColors, pines, pineColors, bushes, bushColors, flowers, flowerColors, rocks, rockColors };
        const stakes: THREE.Matrix4[] = [];
        const tips: THREE.Matrix4[] = [];
        for (let r = cr; r < Math.min(cr + CHUNK, m.rows); r++)
          for (let col = cc; col < Math.min(cc + CHUNK, m.cols); col++) {
            if (m.isFloor(col, r)) continue;
            const d = this.depth(col, r);
            const p = m.centre(col, r);
            if (style === 'forest') {
              if (d <= 4) forestTile(rng, d, p.x, p.z, forest);
              continue;
            }
            if (style === 'rock' && d <= 3) {
              // Cave rock: big, rough boulders of every height (no bricks, no straight tops).
              if (d === 1 || rng() < 0.55) {
                const k = 1.15 + rng() * 0.45;
                const h = H * (d === 1 ? 0.55 + rng() * 0.45 : 0.35 + rng() * 0.6);
                q.setFromEuler(e.set(rng() * 3, rng() * 3, rng() * 3));
                rocks.push(new THREE.Matrix4().compose(v.set(p.x + (rng() - 0.5) * 0.6, h * 0.55, p.z + (rng() - 0.5) * 0.6), q, s.set(k, h * 0.65, k)));
                rockColors.push(new THREE.Color().setHSL(wall.h + (rng() - 0.5) * 0.06, wall.s + (rng() - 0.5) * 0.06, wall.l + (rng() - 0.5) * 0.08));
              }
              continue;
            }
            if (style === 'palisade') {
              // Sharpened log stakes along the edge; beyond, the trodden ground of the camp.
              if (d === 1)
                for (const off of [-0.5, 0.5]) {
                  const h = H + (rng() - 0.5) * 1.2;
                  const jx = p.x + off * (rng() < 0.5 ? 1 : -1) * 0.9;
                  const jz = p.z + (rng() - 0.5) * 0.9;
                  q.setFromEuler(e.set((rng() - 0.5) * 0.08, rng() * 3, (rng() - 0.5) * 0.08));
                  stakes.push(new THREE.Matrix4().compose(v.set(jx, 0, jz), q, s.set(1, h, 1)));
                  tips.push(new THREE.Matrix4().compose(v.set(jx, h, jz), q, s.set(1, 1, 1)));
                }
              continue;
            }
            if (d === 1) {
              for (let row = 0; row < rows; row++) {
                const h = Math.min(1, H - row);
                mat4.compose(v.set(p.x, row + h / 2, p.z), q.identity(), s.set(1, h, 1));
                blocks.push(mat4.clone());
                const vary = crisp ? 0.3 : 1; // cut stone is even
                blockColors.push(new THREE.Color().setHSL(wall.h + (rng() - 0.5) * 0.08 * vary, wall.s + (rng() - 0.5) * 0.05 * vary, wall.l + (rng() - 0.5) * 0.08 * vary - (row === 0 ? 0.03 : 0) + (crisp && row === rows - 1 ? 0.05 : 0)));
              }
            } else if (d <= 3) {
              const jitter = (rng() - 0.5) * 0.4;
              caps.push(new THREE.Matrix4().compose(v.set(p.x, H - 0.25 + jitter, p.z), q.identity(), s.set(1, 1, 1)));
            }
          }
        if (!blocks.length && !caps.length && !trunks.length && !rocks.length && !stakes.length && !bushes.length && !pines.length) continue;
        const chunk = new THREE.Group();
        const mats: THREE.Material[] = [];
        const add = (geo: THREE.BufferGeometry, list: THREE.Matrix4[], material: THREE.MeshStandardMaterial, colors?: THREE.Color[]) => {
          if (!list.length) return;
          const mesh = new THREE.InstancedMesh(geo, material, list.length);
          list.forEach((mm, i) => {
            mesh.setMatrixAt(i, mm);
            if (colors) mesh.setColorAt(i, colors[i]);
          });
          mesh.castShadow = mesh.receiveShadow = true;
          mesh.computeBoundingSphere();
          chunk.add(mesh);
          mats.push(material);
        };
        add(blockGeo, blocks, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }), blockColors);
        add(capGeo, caps, new THREE.MeshStandardMaterial({ color: c.setHSL(wall.h, wall.s * 0.7, wall.l * 0.6).getHex(), roughness: 1, flatShading: true }));
        add(trunkGeo, trunks, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), trunkColors);
        add(canopyGeo, canopies, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true }), canopyColors);
        add(pineGeo, pines, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true }), pineColors);
        add(bushGeo, bushes, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), bushColors);
        add(flowerGeo, flowers, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, flatShading: true }), flowerColors);
        add(rockGeo, rocks, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }), rockColors);
        add(stakeGeo, stakes, new THREE.MeshStandardMaterial({ color: c.setHSL(wall.h, wall.s, wall.l).getHex(), roughness: 0.9, flatShading: true }));
        add(tipGeo, tips, new THREE.MeshStandardMaterial({ color: c.setHSL(wall.h, wall.s * 0.8, wall.l * 1.3).getHex(), roughness: 0.9, flatShading: true }));
        this.group.add(chunk);
        const x0 = m.originX + cc * TILE;
        // Only chunks near the camera are drawn (a level is 400 m long; fog hides the rest).
        chunk.userData.centre = { x: x0 + (CHUNK * TILE) / 2, z: m.originZ + cr * TILE + (CHUNK * TILE) / 2 };
        this.nearOnly.push([chunk, 75]);
        const z0 = m.originZ + cr * TILE;
        this.chunks.push({ minX: x0, maxX: x0 + CHUNK * TILE, minZ: z0, maxZ: z0 + CHUNK * TILE, mats, opacity: 1 });
      }
  }

  /** The exit door: a stone frame and portcullis set in the north wall, a glowing portal behind. */
  private buildExit(): void {
    const e = this.level.exit;
    if (!e) return;
    const trimMat = new THREE.MeshStandardMaterial({ color: this.room.stone, roughness: 0.9, flatShading: true });
    const ironMat = this.room.outdoor
      ? new THREE.MeshStandardMaterial({ color: 0x5a3c22, roughness: 0.9, flatShading: true }) // wooden gate
      : new THREE.MeshStandardMaterial({ color: 0x26221f, metalness: 0.6, roughness: 0.5, flatShading: true });
    const gate = new THREE.Group();
    gate.position.set(e.x, 0, e.z);
    const voidPlane = new THREE.Mesh(new THREE.PlaneGeometry(GATE_HALF_WIDTH * 2, GATE_HEIGHT), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    voidPlane.position.set(0, GATE_HEIGHT / 2, 0.04);
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(GATE_HALF_WIDTH * 2 + 1.6, 0.8, 0.9), trimMat);
    lintel.position.set(0, GATE_HEIGHT + 0.4, 0.4);
    const postGeo = new THREE.BoxGeometry(0.8, GATE_HEIGHT, 0.9);
    const postL = new THREE.Mesh(postGeo, trimMat);
    postL.position.set(-GATE_HALF_WIDTH - 0.4, GATE_HEIGHT / 2, 0.4);
    const postR = postL.clone();
    postR.position.x = GATE_HALF_WIDTH + 0.4;
    for (const o of [lintel, postL, postR]) o.castShadow = o.receiveShadow = true;
    const bars = portcullis(ironMat);
    bars.position.z = 0.35;
    this.exitBars = bars;
    const portal = new THREE.Mesh(
      new THREE.PlaneGeometry(GATE_HALF_WIDTH * 2, GATE_HEIGHT),
      new THREE.MeshBasicMaterial({ color: 0xfff1c0, map: glowTexture(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    portal.position.set(0, GATE_HEIGHT / 2, 0.08);
    this.exitPortal = portal;
    const light = new THREE.PointLight(0xffe0a0, 0, 16, 1.5);
    light.position.set(0, 2.2, 2);
    this.exitLight = light;
    gate.add(voidPlane, lintel, postL, postR, bars, portal, light);
    this.group.add(gate);
  }

  /**
   * A tall column of light over the guardian's hall, seen through the fog from anywhere, so "north"
   * always has a goal in it.
   */
  private buildBeacon(): void {
    const boss = this.level.halls.find((h) => h.kind === 'boss');
    if (!boss || this.level.halls.length < 3) return;
    const color = this.room.outdoor ? 0xffd27a : this.room.torchFlame;
    const g = new THREE.Group();
    const column = new THREE.Mesh(
      new THREE.CylinderGeometry(1.6, 3.2, 70, 16, 1, true).translate(0, 35, 0),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
    );
    const top = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    top.position.y = 40;
    top.scale.setScalar(16);
    g.add(column, top);
    g.position.set(boss.x, 0, boss.z);
    this.beacon = g;
    this.group.add(g);
  }

  /**
   * A landmark: unique, tall and lit, in the level's look (a giant oak, a geode, an obelisk, a war
   * banner, a lamp tower, a forge stack), with a glow on top seen from afar.
   */
  private buildLandmark(obj: THREE.Group, rng: () => number): void {
    const room = this.room;
    const mat = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, ...extra });
    let glowColor = 0xffe0a0;
    let top = 14;
    switch (room.feature) {
      case 'woodland': {
        // A giant oak in autumn colours, standing out from the green woods.
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2.2, 11, 9).translate(0, 5.5, 0), mat(0x6a3e1e));
        obj.add(trunk);
        const leaves = [0xe0702a, 0xd9a03a, 0xc04a2a].map((c) => mat(c));
        for (let i = 0; i < 6; i++) {
          const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), leaves[i % 3]);
          blob.scale.setScalar(3.4 + rng() * 1.6);
          const a = (i / 6) * Math.PI * 2;
          blob.position.set(Math.cos(a) * 2.6, 12 + (i % 2) * 2.2, Math.sin(a) * 2.6);
          blob.rotation.set(rng() * 3, rng() * 3, rng() * 3);
          obj.add(blob);
        }
        glowColor = 0xffc36b;
        top = 17;
        break;
      }
      case 'crystals': {
        // A huge geode: tall magenta shards round a glowing heart.
        const shard = this.glow(0xff5fd8, 0xff3fc8, 0.9, { roughness: 0.2 });
        for (let i = 0; i < 7; i++) {
          const m = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), shard);
          const a = (i / 7) * Math.PI * 2;
          m.position.set(Math.cos(a) * 1.4, 3 + rng() * 2, Math.sin(a) * 1.4);
          m.scale.set(1.2, 5 + rng() * 4, 1.2);
          m.rotation.set((rng() - 0.5) * 0.5, rng() * 3, (rng() - 0.5) * 0.5);
          obj.add(m);
        }
        this.flame(obj.position.x, 4, obj.position.z, 0, 40, 30, 0xff6ae0, 0xff6ae0, 0);
        glowColor = 0xff7ae8;
        top = 12;
        break;
      }
      case 'brazier': {
        // A rune obelisk with a ghostly green flame.
        const stone = mat(0x3a3640);
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.7, 13, 4).translate(0, 6.5, 0), stone);
        shaft.rotation.y = Math.PI / 4;
        const base = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1, 4.2), stone);
        base.position.y = 0.5;
        const rune = this.glow(0x0a2a14, 0x5dff8a, 1.4);
        for (let i = 0; i < 4; i++) {
          const strip = new THREE.Mesh(new THREE.BoxGeometry(0.25, 8, 0.25), rune);
          const a = (i / 4) * Math.PI * 2;
          strip.position.set(Math.cos(a) * 1.15, 6, Math.sin(a) * 1.15);
          obj.add(strip);
        }
        obj.add(shaft, base);
        this.flame(obj.position.x, 13.5, obj.position.z, 3.5, 30, 30, 0x6dff9a, 0x8dffb0, 0);
        glowColor = 0x6dff9a;
        top = 15;
        break;
      }
      case 'throne': {
        // A towering war banner of the orc horde.
        const wood = mat(0x4a3020);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 15, 8).translate(0, 7.5, 0), wood);
        const bar = new THREE.Mesh(new THREE.BoxGeometry(5, 0.35, 0.35), wood);
        bar.position.y = 13.5;
        const cloth = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 8, 1, 4), mat(0x9a1a24, { side: THREE.DoubleSide }));
        cloth.position.set(0, 9.4, 0.1);
        const skull = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 6), mat(0xe8dcc0));
        skull.position.set(0, 11, 0.4);
        const finial = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.4, 5), mat(0xd8a83a, { metalness: 0.7, roughness: 0.3 }));
        finial.position.y = 15.6;
        obj.add(pole, bar, cloth, skull, finial);
        this.flame(obj.position.x + 2, 1.5, obj.position.z + 2, 2.4, 24, 24, room.torchLight, room.torchFlame, 0);
        glowColor = 0xff6a4a;
        top = 16.5;
        break;
      }
      case 'puddles': {
        // An old lamp tower rising out of the water.
        const stone = mat(0x5a6070);
        const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.2, 12, 10).translate(0, 6, 0), stone);
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 8), this.glow(0x2a8aa8, 0x7fe8ff, 1.6));
        lamp.position.y = 13;
        const roof = new THREE.Mesh(new THREE.ConeGeometry(1.8, 1.6, 10), mat(0x3a3f4a));
        roof.position.y = 14.6;
        obj.add(tower, lamp, roof);
        this.flame(obj.position.x, 13, obj.position.z, 0, 34, 34, 0x7fe8ff, 0x7fe8ff, 0);
        glowColor = 0x8fefff;
        top = 15.5;
        break;
      }
      case 'lava': {
        // A great forge stack, glowing at the top, embers rising.
        const stone = mat(0x2a2224);
        const stack = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.8, 15, 8).translate(0, 7.5, 0), stone);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.35, 6, 16).rotateX(Math.PI / 2), this.glow(0x4a1004, 0xff6a1a, 1.8));
        rim.position.y = 15;
        const band = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.5, 0.6, 8, 1, true), this.glow(0x4a1004, 0xff5010, 1.2, { side: THREE.DoubleSide }));
        band.position.y = 5;
        obj.add(stack, rim, band);
        this.flame(obj.position.x, 15.5, obj.position.z, 4, 30, 34, 0xff6a20, 0xff8a30, 0);
        glowColor = 0xff7a30;
        top = 17;
        break;
      }
    }
    // A glow on top, seen through the fog from far away.
    const crown = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: glowColor, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, opacity: 0.85 }));
    crown.position.y = top;
    crown.scale.setScalar(7);
    obj.add(crown);
  }

  /** Treasure chests in the side rooms: wood, gold bands, a lid that swings open. */
  private buildChests(): void {
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a5530, roughness: 0.8, flatShading: true });
    const band = new THREE.MeshStandardMaterial({ color: 0xe0b040, metalness: 0.7, roughness: 0.35, flatShading: true });
    for (const c of this.level.chests) {
      const chest = new THREE.Group();
      chest.position.set(c.x, 0, c.z);
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 1.0), wood);
      body.position.y = 0.45;
      const lid = new THREE.Group();
      lid.position.set(0, 0.9, -0.5); // hinged at the back
      const lidTop = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.6, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), wood);
      lidTop.position.z = 0.5;
      lid.add(lidTop);
      for (const x of [-0.55, 0.55]) {
        const strap = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.95, 1.04), band);
        strap.position.set(x, 0.45, 0);
        chest.add(strap);
        const lidStrap = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.14, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), band);
        lidStrap.position.set(x, 0, 0.5);
        lid.add(lidStrap);
      }
      const lock = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.3, 0.1), band);
      lock.position.set(0, 0.8, 0.52);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffd34d, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.4 }));
      glow.position.y = 1.2;
      glow.scale.setScalar(3.2);
      chest.add(body, lid, lock, glow);
      chest.traverse((o) => (o.castShadow = o.receiveShadow = true));
      this.group.add(chest);
      this.obstacles.push({ x: c.x, z: c.z, radius: 0.9 });
      this.chestLids.push({ lid, open: 0, target: 0, glow });
    }
  }

  private glow(color: number, emissive: number, intensity: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: intensity, flatShading: true, ...extra });
    m.userData.base = intensity;
    this.glowing.push(m);
    return m;
  }

  private shared = new Map<string, THREE.BufferGeometry | THREE.Material>();
  /** One geometry / material per key, shared by every prop that uses it. */
  private once<T extends THREE.BufferGeometry | THREE.Material>(key: string, make: () => T): T {
    let v = this.shared.get(key);
    if (!v) this.shared.set(key, (v = make()));
    return v as T;
  }

  private buildProp(p: Prop, rng: () => number, index = -1): void {
    const room = this.room;
    const obj = new THREE.Group();
    obj.position.set(p.x, 0, p.z);
    let blocks: Circle | null = { x: p.x, z: p.z, radius: p.r };
    let tall = true;
    switch (p.kind) {
      case 'tree': {
        // Low-poly tree: trunk and a stacked canopy, like the card art.
        const bark = this.once('bark', () => new THREE.MeshStandardMaterial({ color: 0x7a4a26, flatShading: true, roughness: 0.9 }));
        const leaves = [0x4f8f3a, 0x5fa044, 0x3f7a32].map((col) => this.once(`leaf${col}`, () => new THREE.MeshStandardMaterial({ color: col, flatShading: true, roughness: 0.85 })));
        const height = 3 + rng() * 1.5;
        const trunk = new THREE.Mesh(this.once('trunk', () => new THREE.CylinderGeometry(0.35, 0.55, 1, 7).translate(0, 0.5, 0)), bark);
        trunk.scale.y = height;
        obj.add(trunk);
        const leaf = leaves[Math.floor(rng() * leaves.length)];
        for (let i = 0; i < 3; i++) {
          const blob = new THREE.Mesh(this.once('blob', () => new THREE.IcosahedronGeometry(1, 0)), leaf);
          blob.scale.setScalar(1.9 - i * 0.4);
          blob.position.set((rng() - 0.5) * 0.8, height + 0.6 + i * 1.1, (rng() - 0.5) * 0.8);
          blob.rotation.set(rng() * 3, rng() * 3, rng() * 3);
          obj.add(blob);
        }
        obj.rotation.y = rng() * Math.PI * 2;
        break;
      }
      case 'pillar': {
        const stone = this.once('stone', () => new THREE.MeshStandardMaterial({ color: room.stone, roughness: 0.9, flatShading: true }));
        const H = this.wallHeight;
        const shaft = new THREE.Mesh(this.once('shaft', () => new THREE.CylinderGeometry(PILLAR_RADIUS - 0.2, PILLAR_RADIUS - 0.1, H - 1.2, 8)), stone);
        shaft.position.y = H / 2;
        const blockGeo = this.once('pblock', () => new THREE.BoxGeometry(PILLAR_RADIUS * 2.1, 0.6, PILLAR_RADIUS * 2.1));
        const base = new THREE.Mesh(blockGeo, stone);
        base.position.y = 0.3;
        const cap = new THREE.Mesh(blockGeo, stone);
        cap.position.y = H - 0.3;
        obj.add(shaft, base, cap);
        break;
      }
      case 'crystal': {
        const colors = [0x8fe8ff, 0xc89bff, 0x9ffff0];
        const color = colors[Math.floor(rng() * colors.length)];
        const mat = this.once(`crystal${color}`, () => this.glow(color, color, 0.7, { roughness: 0.2, metalness: 0.1 }));
        for (let i = 0; i < 4; i++) {
          const shard = new THREE.Mesh(this.once('shard', () => new THREE.OctahedronGeometry(0.6, 0)), mat);
          const a = (i / 4) * Math.PI * 2 + rng();
          shard.position.set(Math.cos(a) * 0.5, 1 + rng(), Math.sin(a) * 0.5);
          shard.scale.set(0.8, 2.2 + rng() * 1.5, 0.8);
          shard.rotation.set((rng() - 0.5) * 0.6, rng() * Math.PI, (rng() - 0.5) * 0.6);
          obj.add(shard);
        }
        // Crystals glow: a soft light (one of the pooled ones when close).
        this.flame(p.x, 2.5, p.z, 0, 14, 20, 0xb08aff, color, 0);
        break;
      }
      case 'brazier': {
        tall = false;
        const iron = this.once('iron', () => new THREE.MeshStandardMaterial({ color: 0x2a2626, roughness: 0.6, metalness: 0.5, flatShading: true, side: THREE.DoubleSide }));
        const bowl = new THREE.Mesh(this.once('bowl', () => new THREE.CylinderGeometry(1.2, 0.7, 0.7, 10, 1, true)), iron);
        bowl.position.y = 1.35;
        const stand = new THREE.Mesh(this.once('stand', () => new THREE.CylinderGeometry(0.25, 0.5, 1.1, 8)), iron);
        stand.position.y = 0.55;
        const coals = new THREE.Mesh(this.once('coals', () => new THREE.CircleGeometry(1.1, 10).rotateX(-Math.PI / 2)), this.once('coalsMat', () => this.glow(0x3a1206, 0xff4a10, 1.2)));
        coals.position.y = 1.5;
        obj.add(bowl, stand, coals);
        this.flame(p.x, 2.1, p.z, 3.2, 30, 30, room.torchLight, room.torchFlame, 2);
        break;
      }
      case 'lavapit':
      case 'pool': {
        // A glowing pool of lava: blocks walking (arrows fly over it).
        tall = false;
        const big = p.kind === 'lavapit';
        const R = big ? 3.2 : 2.9;
        const lava = new THREE.Mesh(this.once(`lava${R}`, () => new THREE.CircleGeometry(R, 24).rotateX(-Math.PI / 2)), this.once('lavaMat', () => this.glow(0x4a1004, 0xff5010, 1.6)));
        lava.position.y = 0.03;
        const rim = new THREE.Mesh(
          this.once(`rim${R}`, () => new THREE.TorusGeometry(R + 0.15, 0.35, 5, 24).rotateX(Math.PI / 2)),
          this.once('rimMat', () => new THREE.MeshStandardMaterial({ color: 0x2a1a16, flatShading: true })),
        );
        rim.position.y = 0.1;
        obj.add(lava, rim);
        blocks = { x: p.x, z: p.z, radius: p.r, low: true };
        this.flame(p.x, 1.1, p.z, big ? 4.5 : 3.5, big ? 34 : 22, big ? 30 : 22, 0xff5a20, 0xff6a20, big ? 2 : 1.5);
        break;
      }
      case 'spire': {
        // Obsidian spires: tall jagged black shards veined with lava.
        const obsidian = this.once('obsidian', () => new THREE.MeshStandardMaterial({ color: 0x1f1719, roughness: 0.35, metalness: 0.2, flatShading: true }));
        const vein = this.once('vein', () => this.glow(0x3a0a02, 0xff5a10, 1.4));
        for (let i = 0; i < 3; i++) {
          const height = 9 + rng() * 6 - i * 3;
          const shard = new THREE.Mesh(new THREE.ConeGeometry(1.4 - i * 0.35, height, 5).translate(0, height / 2, 0), obsidian);
          shard.position.set((rng() - 0.5) * 1.2 * i, 0, (rng() - 0.5) * 1.2 * i);
          shard.rotation.set((rng() - 0.5) * 0.15, rng() * Math.PI, (rng() - 0.5) * 0.15);
          const crack = new THREE.Mesh(new THREE.BoxGeometry(0.12, height * 0.7, 0.12).translate(0, height * 0.35, 0), vein);
          crack.position.copy(shard.position).add(new THREE.Vector3(0.7 - i * 0.2, 0.3, 0.55));
          crack.rotation.copy(shard.rotation);
          obj.add(shard, crack);
        }
        break;
      }
      case 'landmark':
        this.buildLandmark(obj, rng);
        break;
      case 'stalagmite': {
        const rock = this.once('stalagRock', () => new THREE.MeshStandardMaterial({ color: room.stone, roughness: 1, flatShading: true }));
        for (let i = 0; i < 3; i++) {
          const h = 2.2 + rng() * 3 - i * 0.8;
          const cone = new THREE.Mesh(this.once('stalag', () => new THREE.ConeGeometry(0.7, 1, 6).translate(0, 0.5, 0)), rock);
          cone.scale.set(1 - i * 0.25, h, 1 - i * 0.25);
          cone.position.set((rng() - 0.5) * 0.9 * i, 0, (rng() - 0.5) * 0.9 * i);
          obj.add(cone);
        }
        tall = false;
        break;
      }
      case 'chasm': {
        // A dark drop in the cave floor: walk round it, shoot across.
        const pit = new THREE.Mesh(this.once('chasmGeo', () => new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2)), this.once('chasmMat', () => new THREE.MeshBasicMaterial({ color: 0x020104 })));
        pit.scale.set(p.r + 0.4, 1, p.r * 0.8);
        pit.position.y = 0.04;
        const rim = new THREE.Mesh(this.once('chasmRim', () => new THREE.TorusGeometry(1, 0.12, 4, 24).rotateX(Math.PI / 2)), this.once('chasmRimMat', () => this.glow(0x1a0a2a, 0x8a5aff, 0.6)));
        rim.scale.set(p.r + 0.45, 1, p.r * 0.8 + 0.05);
        rim.position.y = 0.06;
        obj.add(pit, rim);
        obj.rotation.y = rng() * Math.PI;
        blocks = { x: p.x, z: p.z, radius: p.r, low: true };
        tall = false;
        break;
      }
      case 'sarcophagus': {
        const stone = this.once('sarcStone', () => new THREE.MeshStandardMaterial({ color: 0xb8ad98, roughness: 0.85, flatShading: true }));
        const body = new THREE.Mesh(this.once('sarcBody', () => new THREE.BoxGeometry(1.2, 0.9, 2.4).translate(0, 0.45, 0)), stone);
        const lid = new THREE.Mesh(this.once('sarcLid', () => new THREE.BoxGeometry(1.35, 0.25, 2.55)), this.once('sarcLidMat', () => new THREE.MeshStandardMaterial({ color: 0xcfc4ae, roughness: 0.8, flatShading: true })));
        lid.position.y = 1.02;
        const effigy = new THREE.Mesh(this.once('sarcEffigy', () => new THREE.CapsuleGeometry(0.28, 1.3, 3, 6).rotateX(Math.PI / 2)), stone);
        effigy.position.y = 0.25;
        lid.add(effigy);
        obj.add(body, lid);
        obj.rotation.y = p.angle ?? 0;
        if (index >= 0) this.sarcophagi.set(index, lid);
        tall = false;
        break;
      }
      case 'candles': {
        blocks = null;
        tall = false;
        const wax = this.once('wax', () => new THREE.MeshStandardMaterial({ color: 0xf2e6c8, roughness: 0.7 }));
        for (let i = 0; i < 4; i++) {
          const h = 0.3 + rng() * 0.5;
          const c = new THREE.Mesh(this.once('candle', () => new THREE.CylinderGeometry(0.07, 0.08, 1, 6).translate(0, 0.5, 0)), wax);
          c.scale.y = h;
          c.position.set((rng() - 0.5) * 0.7, 0, (rng() - 0.5) * 0.7);
          obj.add(c);
        }
        this.flame(p.x, 0.9, p.z, 0.9, 8, 10, room.torchLight, room.torchFlame, 0);
        break;
      }
      case 'tent': {
        const hide = this.once(`tent${Math.floor(rng() * 3)}`, () => new THREE.MeshStandardMaterial({ color: [0x8a6a4a, 0x7a3a2a, 0x6a5a3a][Math.floor(rng() * 3)], roughness: 0.95, flatShading: true }));
        const cone = new THREE.Mesh(this.once('tentGeo', () => new THREE.ConeGeometry(2.5, 3.4, 6).translate(0, 1.7, 0)), hide);
        const pole = new THREE.Mesh(this.once('tentPole', () => new THREE.CylinderGeometry(0.08, 0.08, 1.2, 5).translate(0, 3.6, 0)), this.once('wood', () => new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.9 })));
        obj.add(cone, pole);
        obj.rotation.y = rng() * Math.PI;
        tall = false;
        break;
      }
      case 'campfire': {
        tall = false;
        const wood = this.once('wood', () => new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.9 }));
        for (let i = 0; i < 4; i++) {
          const log = new THREE.Mesh(this.once('log', () => new THREE.CylinderGeometry(0.15, 0.15, 1.6, 6).rotateZ(Math.PI / 2)), wood);
          log.rotation.y = (i / 4) * Math.PI;
          log.position.y = 0.15;
          obj.add(log);
        }
        const stones = this.once('fireStones', () => new THREE.TorusGeometry(0.95, 0.22, 4, 9).rotateX(Math.PI / 2));
        obj.add(new THREE.Mesh(stones, this.once('stoneMat', () => new THREE.MeshStandardMaterial({ color: 0x555050, flatShading: true }))));
        this.flame(p.x, 0.9, p.z, 2.6, 26, 22, 0xff9a40, 0xffa040, 1);
        break;
      }
      case 'rack': {
        tall = false;
        const wood = this.once('wood', () => new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.9 }));
        const iron = this.once('iron2', () => new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.6, roughness: 0.4, flatShading: true }));
        const bar = new THREE.Mesh(this.once('rackBar', () => new THREE.BoxGeometry(2, 0.15, 0.15)), wood);
        bar.position.y = 1.4;
        obj.add(bar);
        for (const x of [-0.9, 0.9]) {
          const post = new THREE.Mesh(this.once('rackPost', () => new THREE.BoxGeometry(0.15, 1.6, 0.15).translate(0, 0.8, 0)), wood);
          post.position.x = x;
          obj.add(post);
        }
        for (let i = 0; i < 4; i++) {
          const spear = new THREE.Mesh(this.once('spear', () => new THREE.CylinderGeometry(0.04, 0.04, 2.4, 4).translate(0, 1.2, 0)), iron);
          spear.position.set(-0.6 + i * 0.4, 0, 0.12);
          spear.rotation.x = -0.15;
          obj.add(spear);
        }
        obj.rotation.y = rng() * Math.PI;
        break;
      }
      case 'throne': {
        const stone = this.once('stone', () => new THREE.MeshStandardMaterial({ color: room.stone, roughness: 0.85, flatShading: true }));
        const gold = this.once('gold', () => new THREE.MeshStandardMaterial({ color: 0xd8a83a, metalness: 0.7, roughness: 0.35, flatShading: true }));
        const velvet = this.once('velvet', () => new THREE.MeshStandardMaterial({ color: 0x7a1424, roughness: 0.9, flatShading: true }));
        [new THREE.BoxGeometry(7, 0.4, 4), new THREE.BoxGeometry(5.5, 0.4, 3)].forEach((g, i) => {
          const st = new THREE.Mesh(g, stone);
          st.position.set(0, 0.2 + i * 0.4, -i * 0.3);
          obj.add(st);
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
          obj.add(arm);
        }
        const crown = new THREE.Mesh(new THREE.ConeGeometry(0.6, 0.9, 5), gold);
        crown.position.set(0, 5.75, -1.3);
        obj.add(seat, back, backVelvet, crown);
        obj.rotation.y = p.angle ?? 0;
        // A long red carpet running out in front of the throne.
        const dir = new THREE.Vector3(Math.sin(obj.rotation.y), 0, Math.cos(obj.rotation.y));
        const carpet = new THREE.Mesh(new THREE.PlaneGeometry(4, 22).rotateX(-Math.PI / 2), velvet);
        const trim = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 22.6).rotateX(-Math.PI / 2), gold);
        for (const [mesh, y] of [[carpet, 0.03], [trim, 0.02]] as const) {
          mesh.position.set(p.x + dir.x * 13, y, p.z + dir.z * 13);
          mesh.rotation.y = obj.rotation.y;
          mesh.receiveShadow = true;
          this.group.add(mesh);
        }
        tall = false;
        break;
      }
    }
    obj.traverse((o) => (o.castShadow = o.receiveShadow = true));
    this.group.add(obj);
    if (p.kind !== 'landmark') this.nearOnly.push([obj, 58]); // landmarks are seen from afar
    if (tall) this.occluders.push(obj);
    if (blocks) this.obstacles.push(blocks);
  }

  /** Scattered floor dressing and the level's special touches (water, lava, fireflies…). */
  private buildFeature(rng: () => number): void {
    const room = this.room;
    const m = this.map;
    const spot = (margin: number) => m.randomFloor(rng, margin);
    switch (room.feature) {
      case 'woodland': {
        // Undergrowth: grass tufts, mushrooms and flowers (decoration only).
        const tufts = new THREE.InstancedMesh(new THREE.ConeGeometry(0.12, 0.5, 3).translate(0, 0.25, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true }), 2500);
        const mat = new THREE.Matrix4();
        const c = new THREE.Color();
        for (let i = 0; i < tufts.count; i++) {
          const p = spot(0.6);
          mat.compose(new THREE.Vector3(p.x, 0, p.z), new THREE.Quaternion().setFromEuler(new THREE.Euler((rng() - 0.5) * 0.5, rng() * 3, (rng() - 0.5) * 0.5)), new THREE.Vector3(1, 0.6 + rng(), 1));
          tufts.setMatrixAt(i, mat);
          tufts.setColorAt(i, c.setHSL(0.26 + rng() * 0.06, 0.5, 0.25 + rng() * 0.12));
        }
        tufts.computeBoundingSphere();
        this.group.add(tufts);
        const capMat = new THREE.MeshStandardMaterial({ color: 0xd8483a, flatShading: true });
        const stemMat = new THREE.MeshStandardMaterial({ color: 0xf2e6cc, flatShading: true });
        const petal = [0xffd34d, 0xffffff, 0xd98cff].map((col) => new THREE.MeshStandardMaterial({ color: col, flatShading: true }));
        const stemGeo = new THREE.CylinderGeometry(0.06, 0.08, 0.3, 5).translate(0, 0.15, 0);
        const capGeo = new THREE.SphereGeometry(0.22, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2);
        const flowerGeo = new THREE.OctahedronGeometry(0.12, 0);
        for (let i = 0; i < 260; i++) {
          const p = spot(1.5);
          const bit = new THREE.Group();
          if (i % 2 === 0) {
            const cap = new THREE.Mesh(capGeo, capMat);
            cap.position.y = 0.28;
            bit.add(new THREE.Mesh(stemGeo, stemMat), cap);
          } else {
            const flower = new THREE.Mesh(flowerGeo, petal[i % 3]);
            flower.position.y = 0.3;
            bit.add(flower);
          }
          bit.position.set(p.x, 0, p.z);
          this.decor(bit);
        }
        // Fireflies drifting about.
        const glowMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xf4ff9a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
        for (let i = 0; i < 160; i++) {
          const sprite = new THREE.Sprite(glowMat.clone());
          sprite.scale.setScalar(0.35);
          const p = spot(2);
          this.fireflies.push({ sprite, base: new THREE.Vector3(p.x, 0.8 + rng() * 2.5, p.z), seed: rng() * 10 });
          this.decor(sprite);
        }
        break;
      }
      case 'puddles': {
        // Flooded: a sheet of water over the whole floor (everyone wades ankle-deep), deeper dark
        // pools, ripples, waterfalls pouring down the walls into foaming water, and floating debris.
        const sizeX = m.cols * TILE;
        const sizeZ = m.rows * TILE;
        const sheetMat = new THREE.MeshStandardMaterial({ color: 0x2a9cc4, emissive: 0x0b4a66, emissiveIntensity: 0.55, roughness: 0.04, metalness: 0.25, transparent: true, opacity: 0.8, depthWrite: false });
        const sheet = new THREE.Mesh(new THREE.PlaneGeometry(sizeX, sizeZ).rotateX(-Math.PI / 2), sheetMat);
        sheet.position.set(m.originX + sizeX / 2, 0.22, m.originZ + sizeZ / 2);
        sheet.receiveShadow = true;
        sheet.renderOrder = 1;
        this.group.add(sheet);
        this.waterSheet = sheet;
        const deep = new THREE.MeshStandardMaterial({ color: 0x0b2836, roughness: 0.1, metalness: 0.3 });
        const poolGeo = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);
        for (let i = 0; i < 24; i++) {
          const pool = new THREE.Mesh(poolGeo, deep);
          const p = spot(4);
          pool.position.set(p.x, 0.03, p.z);
          pool.scale.set(2 + rng() * 3.5, 1, 1.5 + rng() * 2.5);
          pool.rotation.y = rng() * Math.PI;
          this.decor(pool);
        }
        const rippleGeo = new THREE.RingGeometry(0.85, 1, 32).rotateX(-Math.PI / 2);
        for (let i = 0; i < 26; i++) {
          const ring = new THREE.Mesh(rippleGeo, new THREE.MeshBasicMaterial({ color: 0xcff4ff, transparent: true, opacity: 0, depthWrite: false }));
          ring.position.y = 0.24;
          ring.renderOrder = 2;
          this.group.add(ring);
          this.ripples.push({ mesh: ring, age: rng() * 2.5, life: 1.8 + rng() * 1.2 });
        }
        const glintMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xdff8ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
        for (let i = 0; i < 50; i++) {
          const glint = new THREE.Sprite(glintMat.clone());
          const p = spot(1);
          glint.position.set(p.x, 0.3, p.z);
          glint.scale.set(0.9, 0.25, 1);
          this.decor(glint);
          this.glints.push({ sprite: glint, seed: rng() * 10 });
        }
        // Waterfalls down north walls (facing the camera), foaming where they land.
        const fallMat = new THREE.MeshStandardMaterial({ color: 0x9fdcf5, emissive: 0x2a6f8f, emissiveIntensity: 0.5, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false });
        const foamMat = new THREE.MeshBasicMaterial({ color: 0xf2fbff, transparent: true, opacity: 0.8, depthWrite: false });
        for (const [x, z] of this.wallSpots(rng, 0, -1, 12, 18)) {
          const fallGroup = new THREE.Group();
          fallGroup.position.set(x, 0, z);
          for (let k = 0; k < 3; k++) {
            const strip = new THREE.Mesh(new THREE.PlaneGeometry(1.3 - k * 0.3, this.wallHeight), fallMat);
            strip.position.set((k - 1) * 1.0, this.wallHeight / 2, 0.4 + k * 0.06);
            fallGroup.add(strip);
          }
          for (let k = 0; k < 4; k++) {
            const foam = new THREE.Mesh(new THREE.SphereGeometry(0.35 + rng() * 0.3, 8, 6), foamMat);
            foam.position.set((rng() - 0.5) * 2.4, 0.2, 0.9 + rng() * 1.2);
            foam.scale.y = 0.45;
            fallGroup.add(foam);
            this.bobbers.push({ obj: foam, base: 0.2, seed: rng() * 10, amp: 0.06 });
          }
          this.decor(fallGroup);
        }
        // Floating debris: barrels, planks and crates, bobbing.
        const wood = new THREE.MeshStandardMaterial({ color: 0x7a5232, roughness: 0.85, flatShading: true });
        const band = new THREE.MeshStandardMaterial({ color: 0x3a3532, metalness: 0.5, roughness: 0.5, flatShading: true });
        for (let i = 0; i < 18; i++) {
          const p = spot(3);
          const bit = new THREE.Group();
          if (i % 3 === 0) {
            const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.1, 10), wood);
            barrel.rotation.z = Math.PI / 2;
            const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.04, 4, 14), band);
            hoop.rotation.y = Math.PI / 2;
            bit.add(barrel, hoop);
          } else if (i % 3 === 1) bit.add(new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 0.4), wood));
          else bit.add(new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.8), wood));
          bit.position.set(p.x, 0.26, p.z);
          bit.rotation.y = rng() * Math.PI;
          bit.traverse((o) => (o.castShadow = true));
          this.decor(bit);
          this.bobbers.push({ obj: bit, base: 0.26, seed: rng() * 10, amp: 0.05 });
        }
        break;
      }
      case 'lava': {
        const crackGeo = new THREE.PlaneGeometry(0.18, 1).rotateX(-Math.PI / 2);
        const crackMat = this.glow(0x3a0a02, 0xff4a10, 1.2);
        for (let i = 0; i < 60; i++) {
          const crack = new THREE.Mesh(crackGeo, crackMat);
          const p = spot(3);
          crack.position.set(p.x, 0.02, p.z);
          crack.scale.z = 2 + rng() * 4;
          crack.rotation.y = rng() * Math.PI;
          this.decor(crack);
        }
        break;
      }
      case 'dragonlair': {
        const lair = this.level.halls.find((h) => h.kind === 'boss')!;
        // Lavafalls pouring down the lair's walls into glowing basins.
        const fall = this.glow(0x7a1a04, 0xff4a0a, 1.15, { side: THREE.DoubleSide });
        for (const a of [Math.PI * 0.2, -Math.PI * 0.2, Math.PI * 0.45, -Math.PI * 0.45, Math.PI * 0.8, -Math.PI * 0.8]) {
          const nx = -Math.sin(a);
          const nz = -Math.cos(a);
          const d = lair.r - 0.6;
          for (let k = 0; k < 3; k++) {
            const strip = new THREE.Mesh(new THREE.PlaneGeometry(1.1 - k * 0.25, this.wallHeight + 2), fall);
            strip.position.set(lair.x + nx * (d - k * 0.05) + Math.cos(a) * (k - 1) * 0.9, (this.wallHeight + 2) / 2, lair.z + nz * (d - k * 0.05) - Math.sin(a) * (k - 1) * 0.9);
            strip.rotation.y = a;
            this.group.add(strip);
          }
          const basin = new THREE.Mesh(new THREE.CircleGeometry(2.2, 18).rotateX(-Math.PI / 2), this.glow(0x4a1004, 0xff5010, 1.5));
          basin.position.set(lair.x + nx * (d - 1.6), 0.03, lair.z + nz * (d - 1.6));
          this.group.add(basin);
          this.flame(lair.x + nx * (d - 1.5), 2.5, lair.z + nz * (d - 1.5), 3, 20, 24, 0xff5a20, 0xff7a30, 1);
        }
        // A great rune circle in the middle of the floor.
        const rune = this.glow(0x2a0a04, 0xff7a2a, 1.1);
        for (const r of [7, 8.2]) {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.12, 4, 64).rotateX(Math.PI / 2), rune);
          ring.position.set(lair.x, 0.04, lair.z);
          this.group.add(ring);
        }
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const mark = new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0), rune);
          mark.scale.set(1, 0.08, 1.8);
          mark.position.set(lair.x + Math.sin(a) * 7.6, 0.05, lair.z + Math.cos(a) * 7.6);
          mark.rotation.y = a;
          this.group.add(mark);
        }
        const crackGeo = new THREE.PlaneGeometry(0.22, 1).rotateX(-Math.PI / 2);
        const crackMat = this.glow(0x3a0a02, 0xff4a10, 1.2);
        for (let i = 0; i < 50; i++) {
          const crack = new THREE.Mesh(crackGeo, crackMat);
          const p = spot(3);
          crack.position.set(p.x, 0.02, p.z);
          crack.scale.z = 2.5 + rng() * 5;
          crack.rotation.y = rng() * Math.PI;
          this.decor(crack);
        }
        const emberMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffa040, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
        for (let i = 0; i < 90; i++) {
          const sprite = new THREE.Sprite(emberMat.clone());
          sprite.scale.setScalar(0.25 + rng() * 0.3);
          const a = rng() * Math.PI * 2;
          const d = Math.sqrt(rng()) * (lair.r - 2);
          this.embers.push({ sprite, x: lair.x + Math.cos(a) * d, z: lair.z + Math.sin(a) * d, speed: 0.6 + rng() * 1.2, seed: rng() * 10 });
          this.group.add(sprite);
        }
        this.flame(lair.x, 3, lair.z, 4, 26, 40, 0xff6a30, 0xff7a30, 2);
        break;
      }
    }
  }

  /**
   * Spots along walls facing (dx, dz) from the floor (e.g. 0, −1: the wall to the north of a
   * floor tile), at least `spacing` m apart, up to `max`. Returns the wall face's centre.
   */
  private wallSpots(rng: () => number, dx: number, dz: number, max: number, spacing: number): [number, number][] {
    const out: [number, number][] = [];
    const list = this.edges.filter(([, , dc, dr]) => dc === dx && dr === dz);
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    for (const [c, r] of list) {
      if (out.length >= max) break;
      const p = this.map.centre(c, r);
      const x = p.x + (dx * TILE) / 2;
      const z = p.z + (dz * TILE) / 2;
      if (this.level.exit && Math.hypot(x - this.level.exit.x, z - this.level.exit.z) < 5) continue;
      if (out.some(([ox, oz]) => Math.hypot(ox - x, oz - z) < spacing)) continue;
      out.push([x, z]);
    }
    return out;
  }

  private buildRubble(rng: () => number): void {
    const rocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }), 1200);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const c = new THREE.Color();
    const { wall } = this.room;
    for (let i = 0; i < rocks.count; i++) {
      // Hug the walls, where rubble would collect.
      const [col, r, dc, dr] = this.edges[Math.floor(rng() * this.edges.length)];
      const p = this.map.centre(col, r);
      const along = (rng() - 0.5) * TILE;
      const x = p.x + dc * (0.6 - rng() * 0.6) + (dr ? along : 0);
      const z = p.z + dr * (0.6 - rng() * 0.6) + (dc ? along : 0);
      const s = 0.1 + rng() * rng() * 0.45;
      q.setFromEuler(e.set(rng() * 3, rng() * 3, rng() * 3));
      m4.compose(new THREE.Vector3(x, s * 0.3, z), q, new THREE.Vector3(s, s * 0.7, s));
      rocks.setMatrixAt(i, m4);
      rocks.setColorAt(i, c.setHSL(wall.h, wall.s * 0.6, 0.18 + rng() * 0.1));
    }
    rocks.castShadow = rocks.receiveShadow = true;
    rocks.computeBoundingSphere();
    this.group.add(rocks);
  }

  /** Small floor dressing: drawn only near the focus. */
  private decor(obj: THREE.Object3D): void {
    this.group.add(obj);
    this.nearOnly.push([obj, 40]);
  }

  /** A flame sprite (size 0: none) that gets one of the pooled lights when it's near the focus. */
  private flame(x: number, y: number, z: number, size: number, intensity: number, distance: number, light: number, flame: number, strength: number): void {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: flame, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    sprite.position.set(x, y, z);
    sprite.userData.size = size;
    sprite.scale.setScalar(size);
    sprite.visible = size > 0;
    this.group.add(sprite);
    if (size > 0) this.nearOnly.push([sprite, 60]);
    this.flames.push({ sprite, x, y, z, intensity, distance, color: light, seed: this.flames.length * 1.7, flicker: 1 });
    if (strength > 0) this.fireSources.push({ position: sprite.position, strength });
  }

  private buildLights(shadowMapSize: number, rng: () => number): THREE.DirectionalLight {
    const room = this.room;
    // Light falling from high above (the only shadow caster; it follows the focus), plus fill.
    const moon = new THREE.DirectionalLight(room.moon, room.moonIntensity);
    moon.castShadow = true;
    moon.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    const sc = moon.shadow.camera;
    sc.left = sc.bottom = -SHADOW_REACH;
    sc.right = sc.top = SHADOW_REACH;
    sc.near = 1;
    sc.far = 100;
    moon.shadow.bias = -0.0005;
    moon.shadow.normalBias = 0.04;
    this.group.add(moon, moon.target, new THREE.HemisphereLight(room.hemiSky, room.hemiGround, room.outdoor ? 0.9 : 1.5));
    for (let i = 0; i < LIGHT_POOL; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 20, 1.6);
      l.userData.flame = null;
      this.lights.push(l);
      this.group.add(l);
    }

    if (room.outdoor || room.feature === 'crystals') return moon; // daylight / the cave: its crystals are the light
    const bracketMat = new THREE.MeshStandardMaterial({ color: 0x2a2626, metalness: 0.5, roughness: 0.6 });
    const bracketGeo = new THREE.BoxGeometry(0.25, 0.7, 0.5);
    // Torches along the walls, every dozen metres or so, on walls of every side.
    const spots: [number, number, number, number][] = [];
    for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) for (const [x, z] of this.wallSpots(rng, dx, dz, 40, 13)) spots.push([x, z, dx, dz]);
    for (const [x, z, dx, dz] of spots) {
      if (spots.some(([ox, oz]) => ox !== x && oz !== z && Math.hypot(ox - x, oz - z) < 6)) {
        if (rng() < 0.5) continue; // thin out torches crowding a corner
      }
      const bracket = new THREE.Mesh(bracketGeo, bracketMat);
      bracket.position.set(x - dx * 0.15, Math.min(3.2, this.wallHeight - 1.6), z - dz * 0.15);
      bracket.rotation.y = Math.atan2(dx, dz);
      this.group.add(bracket);
      this.flame(x - dx * 0.4, bracket.position.y + 0.55, z - dz * 0.4, 1.3, 20, 24, room.torchLight, room.torchFlame, 0); // wall torches are silent (there are dozens); braziers and lava crackle
    }
    return moon;
  }
}

/** The materials an object owns, made fadeable (cloned so other objects don't fade with it). */
function ownMaterials(obj: THREE.Object3D): THREE.Material[] {
  const mats: THREE.Material[] = [];
  const clones = new Map<THREE.Material, THREE.Material>();
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const own = list.map((m) => {
      let c = clones.get(m);
      if (!c) {
        c = m.clone();
        clones.set(m, c);
        mats.push(c);
      }
      return c;
    });
    mesh.material = Array.isArray(mesh.material) ? own : own[0];
  });
  return mats;
}

/** Eases a fadeable's opacity toward `target`; it only turns transparent while faded. */
function fade(item: { mats: THREE.Material[]; opacity: number }, target: number, dt: number): void {
  if (Math.abs(item.opacity - target) < 0.005) return;
  const was = item.opacity < 0.995;
  item.opacity += (target - item.opacity) * (1 - Math.exp(-10 * dt));
  if (Math.abs(item.opacity - target) < 0.01) item.opacity = target;
  const now = item.opacity < 0.995;
  for (const m of item.mats) {
    m.opacity = item.opacity;
    if (was !== now) {
      m.transparent = now;
      m.depthWrite = !now;
      m.needsUpdate = true;
    }
  }
}

/** Does the 2D segment (ax, az)→(bx, bz) cross the box? (Slab test.) */
function segmentHitsBox(ax: number, az: number, bx: number, bz: number, minX: number, maxX: number, minZ: number, maxZ: number): boolean {
  let t0 = 0;
  let t1 = 1;
  for (const [a, d, lo, hi] of [[ax, bx - ax, minX, maxX], [az, bz - az, minZ, maxZ]]) {
    if (Math.abs(d) < 1e-9) {
      if (a < lo || a > hi) return false;
      continue;
    }
    let u = (lo - a) / d;
    let w = (hi - a) / d;
    if (u > w) [u, w] = [w, u];
    t0 = Math.max(t0, u);
    t1 = Math.min(t1, w);
    if (t0 > t1) return false;
  }
  return true;
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
