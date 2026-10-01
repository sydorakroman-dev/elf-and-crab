import * as THREE from 'three';
import { clampToArena, pushOutOfCircles, rangeIntent, waveSpec, type Circle, type WaveSpec } from './combat';
import { glowTexture } from '../util/glow';

export type SlimeKind = 'small' | 'big' | 'spitter';

export const SLIME_KINDS: Record<SlimeKind, { radius: number; speed: number; color: number; score: number; hopRate: number; push: number }> = {
  small: { radius: 0.7, speed: 3.6, color: 0x62d46a, score: 10, hopRate: 1.8, push: 9 },
  big: { radius: 1.25, speed: 2.6, color: 0xa35ee0, score: 40, hopRate: 1.3, push: 5 },
  spitter: { radius: 0.85, speed: 3.2, color: 0x4fb3ff, score: 25, hopRate: 1.6, push: 7 },
};

// Spitter tuning.
const SPIT_RANGE_MIN = 9;
const SPIT_RANGE_MAX = 14;
const SPIT_INTERVAL = 3.0;
const SPIT_WINDUP = 0.7;

const bodyGeo = new THREE.SphereGeometry(1, 12, 8).translate(0, 1, 0);
const eyeGeo = new THREE.SphereGeometry(0.2, 8, 6);
const pupilGeo = new THREE.SphereGeometry(0.11, 8, 6);
const mouthGeo = new THREE.TorusGeometry(0.16, 0.05, 6, 10);
const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
const pupilMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.2 });
const STUN_TINT = new THREE.Color(0xd8ecff);
const CALM_TINT = new THREE.Color(0xf3c6ff); // soft lavender-pink: sleepy, not angry

/**
 * Everything needed to draw a slime at one moment. The simulation produces it every step; the
 * familiar's tablet receives it over the network and draws the same thing.
 */
export interface SlimePose {
  x: number;
  z: number;
  yaw: number;
  /** Body lift while hopping. */
  y: number;
  sx: number;
  sy: number;
  sz: number;
  /** Hit flash 0..1. */
  flash: number;
  /** 1 while stunned. */
  stun: number;
  /** Death shrink 0 (alive) → 1 (gone). */
  death: number;
  /** 1 while calmed (wandering off, harmless). */
  calm: number;
}

/** A slime's meshes, driven entirely by a SlimePose. Shared by the game and the familiar view. */
export class SlimeVisual {
  readonly group = new THREE.Group();
  private readonly body: THREE.Mesh;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly baseColor: THREE.Color;
  private readonly stars: THREE.Group;
  private readonly radius: number;

  constructor(kind: SlimeKind) {
    const k = SLIME_KINDS[kind];
    this.radius = k.radius;
    this.baseColor = new THREE.Color(k.color);
    this.material = new THREE.MeshStandardMaterial({ color: k.color, roughness: 0.35, flatShading: true, emissive: 0xff2020, emissiveIntensity: 0 });
    this.body = new THREE.Mesh(bodyGeo, this.material);
    this.body.castShadow = true;
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(side * 0.35, 1.25, 0.82);
      const pupil = new THREE.Mesh(pupilGeo, pupilMat);
      pupil.position.set(side * 0.35, 1.25, 0.98);
      this.body.add(eye, pupil);
    }
    if (kind === 'spitter') {
      // A little round "o" mouth, for spitting.
      const mouth = new THREE.Mesh(mouthGeo, pupilMat);
      mouth.position.set(0, 0.85, 0.97);
      this.body.add(mouth);
    }
    // Dizzy stars circling the head while stunned.
    this.stars = new THREE.Group();
    const starMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xfff27a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Sprite(starMat);
      s.scale.setScalar(0.45);
      const a = (i / 3) * Math.PI * 2;
      s.position.set(Math.cos(a) * 0.75, 0, Math.sin(a) * 0.75);
      this.stars.add(s);
    }
    this.stars.position.y = 2.3;
    this.stars.visible = false;
    this.group.add(this.body, this.stars);
    this.group.scale.setScalar(this.radius);
  }

  apply(p: SlimePose, time: number): void {
    this.group.position.set(p.x, 0, p.z);
    this.group.rotation.y = p.yaw;
    this.body.position.y = p.y;
    this.body.scale.set(p.sx, p.sy, p.sz);
    const s = 1 - p.death;
    this.group.scale.set(this.radius * (1 + p.death * 0.6), this.radius * s, this.radius * (1 + p.death * 0.6));
    this.material.emissiveIntensity = p.flash * 1.5;
    const stunned = p.stun > 0.5 && p.death === 0;
    this.material.color.copy(this.baseColor);
    const calm = !stunned && p.calm > 0.5 && p.death === 0;
    if (stunned) this.material.color.lerp(STUN_TINT, 0.55);
    else if (calm) this.material.color.lerp(CALM_TINT, 0.65);
    this.stars.visible = stunned;
    this.body.rotation.z = stunned ? Math.sin(time * 11) * 0.18 : calm ? Math.sin(time * 2.5) * 0.08 : 0;
    if (stunned) this.stars.rotation.y = time * 4;
  }
}

export interface Spit {
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
}

let nextSlimeId = 1;

export class Slime {
  readonly id = nextSlimeId++;
  readonly visual: SlimeVisual;
  readonly kind: SlimeKind;
  readonly radius: number;
  readonly score: number;
  readonly color: THREE.Color;
  readonly pose: SlimePose;
  hp: number;
  /** Set once hp hits 0; the slime shrinks away, then `removed` is set. */
  dying = false;
  removed = false;
  private readonly speed: number;
  private readonly hopRate: number;
  private readonly push: number;
  private readonly knock = new THREE.Vector2();
  private hopPhase = Math.random();
  private flash = 0;
  private deathTimer = 0;
  private stunTimer = 0;
  private calmTimer = 0;
  private wanderAngle = Math.random() * Math.PI * 2;
  private time = 0;
  /** Speed multiplier for this step (set by area effects like the Soothing Spring; resets after each update). */
  slow = 1;
  private spitTimer = SPIT_INTERVAL * (0.5 + Math.random() * 0.5);
  private windup = 0; // > 0 while swelling up to spit
  private strafeSign = Math.random() < 0.5 ? -1 : 1;

  constructor(kind: SlimeKind, x: number, z: number, speedBonus: number, hp: number) {
    const k = SLIME_KINDS[kind];
    this.kind = kind;
    this.radius = k.radius;
    this.hp = hp;
    this.score = k.score;
    this.speed = k.speed + speedBonus;
    this.hopRate = k.hopRate;
    this.push = k.push;
    this.color = new THREE.Color(k.color);
    this.visual = new SlimeVisual(kind);
    this.pose = { x, z, yaw: 0, y: 0, sx: 1, sy: 1, sz: 1, flash: 0, stun: 0, death: 0, calm: 0 };
    this.visual.apply(this.pose, 0);
  }

  get group(): THREE.Group {
    return this.visual.group;
  }

  get x(): number {
    return this.pose.x;
  }

  get z(): number {
    return this.pose.z;
  }

  get alive(): boolean {
    return !this.dying;
  }

  get stunned(): boolean {
    return this.stunTimer > 0;
  }

  get calmed(): boolean {
    return this.calmTimer > 0;
  }

  /** Harmless right now (stunned or calmed): no contact damage. */
  get harmless(): boolean {
    return this.stunned || this.calmed;
  }

  /** Teleport (used by tests and spawning). */
  setPosition(x: number, z: number): void {
    this.pose.x = x;
    this.pose.z = z;
    this.visual.apply(this.pose, this.time);
  }

  /** Returns true if this hit killed it. */
  hurt(amount: number, dirX: number, dirZ: number): boolean {
    if (this.dying) return false;
    this.hp -= amount;
    this.flash = 1;
    this.knock.set(dirX * this.push, dirZ * this.push);
    if (this.hp <= 0) this.dying = true;
    return this.dying;
  }

  /** Freezes the slime in place (no moving, spitting or contact damage) for `seconds`. */
  stun(seconds: number): void {
    if (this.dying) return;
    this.stunTimer = Math.max(this.stunTimer, seconds);
    this.windup = 0; // an interrupted spit is lost
  }

  /** Makes the slime lose interest for `seconds`: it wanders away, won't spit or hurt anyone. */
  calm(seconds: number): void {
    if (this.dying) return;
    this.calmTimer = Math.max(this.calmTimer, seconds);
    this.windup = 0;
    this.wanderAngle = Math.random() * Math.PI * 2;
  }

  /** Moves the slime; returns a spit when a spitter lets one fly this step. */
  update(dt: number, target: THREE.Vector3, others: Slime[], obstacles: readonly Circle[], half: number): Spit | null {
    this.time += dt;
    const spit = this.step(dt, target, others, obstacles, half);
    this.pose.flash = this.flash;
    this.pose.stun = this.stunTimer > 0 ? 1 : 0;
    this.pose.calm = this.calmTimer > 0 ? 1 : 0;
    this.visual.apply(this.pose, this.time);
    this.slow = 1;
    return spit;
  }

  private step(dt: number, target: THREE.Vector3, others: Slime[], obstacles: readonly Circle[], half: number): Spit | null {
    this.flash = Math.max(0, this.flash - dt * 5);
    const p = this.pose;

    if (this.dying) {
      this.deathTimer += dt;
      p.death = Math.min(1, this.deathTimer / 0.18);
      if (p.death === 1) this.removed = true;
      return null;
    }

    if (this.stunTimer > 0) {
      // Stunned: only knockback still slides it a little; squash settles to rest.
      this.stunTimer = Math.max(0, this.stunTimer - dt);
      p.x += this.knock.x * dt;
      p.z += this.knock.y * dt;
      this.knock.multiplyScalar(Math.exp(-8 * dt));
      pushOutOfCircles(p, this.radius, obstacles);
      clampToArena(p, half, this.radius);
      p.y = 0;
      p.sx = p.sz = 1.08;
      p.sy = 0.88;
      return null;
    }

    let tx = target.x - p.x;
    let tz = target.z - p.z;
    const dist = Math.hypot(tx, tz) || 1;
    tx /= dist;
    tz /= dist;
    const calm = this.calmTimer > 0;
    if (calm) this.calmTimer = Math.max(0, this.calmTimer - dt);

    // Spitters freeze and swell up, then spit at where the target is now.
    if (this.kind === 'spitter' && !calm) {
      if (this.windup > 0) {
        this.windup -= dt;
        const swell = 1 - this.windup / SPIT_WINDUP;
        p.y = 0;
        p.sx = p.sz = 1 + swell * 0.25;
        p.sy = 1 + swell * 0.35;
        p.yaw = Math.atan2(tx, tz);
        if (this.windup <= 0) {
          this.spitTimer = SPIT_INTERVAL * (0.8 + Math.random() * 0.4);
          return { x: p.x + tx * this.radius, z: p.z + tz * this.radius, dirX: tx, dirZ: tz };
        }
        return null;
      }
      this.spitTimer -= dt;
      if (this.spitTimer <= 0 && dist < SPIT_RANGE_MAX + 4) {
        this.windup = SPIT_WINDUP;
        return null;
      }
    }

    // Hop: fast while airborne, slow while squashed on the ground.
    this.hopPhase = (this.hopPhase + dt * this.hopRate) % 1;
    const t = this.hopPhase;
    const airborne = t < 0.6;
    const air = airborne ? Math.sin((t / 0.6) * Math.PI) : 0;
    const squash = airborne ? 0 : Math.sin(((t - 0.6) / 0.4) * Math.PI);

    // Melee slimes chase; spitters hold a distance band and circle inside it; calm ones meander off.
    let dx = tx;
    let dz = tz;
    if (calm) {
      this.wanderAngle += (Math.random() - 0.5) * dt * 3;
      dx = -tx * 0.6 + Math.sin(this.wanderAngle) * 0.8;
      dz = -tz * 0.6 + Math.cos(this.wanderAngle) * 0.8;
    } else if (this.kind === 'spitter') {
      const intent = rangeIntent(dist, SPIT_RANGE_MIN, SPIT_RANGE_MAX);
      if (intent === 0) {
        dx = -tz * this.strafeSign;
        dz = tx * this.strafeSign;
        if (Math.random() < dt * 0.3) this.strafeSign *= -1;
      } else {
        dx = tx * intent;
        dz = tz * intent;
      }
    }
    // Keep slimes from stacking up on each other.
    for (const o of others) {
      if (o === this || o.dying) continue;
      const ox = p.x - o.x;
      const oz = p.z - o.z;
      const d = Math.hypot(ox, oz);
      const min = this.radius + o.radius + 0.2;
      if (d > 0 && d < min) {
        dx += (ox / d) * (min - d) * 1.5;
        dz += (oz / d) * (min - d) * 1.5;
      }
    }
    const len = Math.hypot(dx, dz) || 1;
    const speed = this.speed * (airborne ? 1.25 : 0.25) * this.slow * (calm ? 0.45 : 1);
    p.x += ((dx / len) * speed + this.knock.x) * dt;
    p.z += ((dz / len) * speed + this.knock.y) * dt;
    this.knock.multiplyScalar(Math.exp(-8 * dt));
    pushOutOfCircles(p, this.radius, obstacles);
    clampToArena(p, half, this.radius);

    p.yaw = calm ? Math.atan2(dx, dz) : Math.atan2(target.x - p.x, target.z - p.z);
    p.y = air * 0.7;
    p.sx = p.sz = 1 + squash * 0.25 - air * 0.08;
    p.sy = 1 - squash * 0.3 + air * 0.12;
    return null;
  }
}

/** Spawns slimes wave by wave through the dungeon gates and updates them. */
export class Enemies {
  readonly group = new THREE.Group();
  readonly slimes: Slime[] = [];
  private queue: SlimeKind[] = [];
  private spawnTimer = 0;
  private spec: WaveSpec = waveSpec(1);
  private readonly gates: THREE.Vector3[];

  constructor(gates: THREE.Vector3[]) {
    this.gates = gates;
  }

  /** Slimes still to beat this wave (alive + not yet spawned). */
  get remaining(): number {
    return this.queue.length + this.slimes.filter((s) => s.alive).length;
  }

  startWave(wave: number): void {
    this.spec = waveSpec(wave);
    const { small, big, spitters } = this.spec;
    this.queue = [
      ...Array<SlimeKind>(small).fill('small'),
      ...Array<SlimeKind>(big).fill('big'),
      ...Array<SlimeKind>(spitters).fill('spitter'),
    ].sort(() => Math.random() - 0.5);
    this.spawnTimer = 0.3;
  }

  clear(): void {
    for (const s of this.slimes) this.group.remove(s.group);
    this.slimes.length = 0;
    this.queue = [];
  }

  /** Stuns every living slime within `radius` of (x, z); returns the slimes hit. */
  stunAround(x: number, z: number, radius: number, seconds: number): Slime[] {
    const hit = this.slimes.filter((s) => s.alive && Math.hypot(s.x - x, s.z - z) <= radius + s.radius);
    for (const s of hit) s.stun(seconds);
    return hit;
  }

  /** Calms every living slime within `radius` of (x, z); returns the slimes affected. */
  calmAround(x: number, z: number, radius: number, seconds: number): Slime[] {
    const hit = this.slimes.filter((s) => s.alive && Math.hypot(s.x - x, s.z - z) <= radius + s.radius);
    for (const s of hit) s.calm(seconds);
    return hit;
  }

  /** Updates all slimes; returns the spits launched this step. */
  update(dt: number, target: THREE.Vector3, obstacles: readonly Circle[], half: number): Spit[] {
    this.spawnTimer -= dt;
    if (this.queue.length && this.spawnTimer <= 0) {
      // A pack pours out of one gate at a time.
      this.spawnTimer = this.spec.spawnInterval;
      const gate = this.gates[Math.floor(Math.random() * this.gates.length)];
      const alongX = Math.abs(gate.z) > Math.abs(gate.x);
      for (let n = 0; n < this.spec.packSize && this.queue.length; n++) {
        const jitter = (Math.random() - 0.5) * 3.5;
        const inward = n * 0.8; // stagger the pack so it doesn't spawn overlapping
        const x = gate.x + (alongX ? jitter : -Math.sign(gate.x) * inward);
        const z = gate.z + (alongX ? -Math.sign(gate.z) * inward : jitter);
        const kind = this.queue.pop()!;
        const hp = kind === 'big' ? this.spec.bigHp : kind === 'spitter' ? this.spec.spitterHp : this.spec.smallHp;
        const s = new Slime(kind, x, z, this.spec.speedBonus, hp);
        this.slimes.push(s);
        this.group.add(s.group);
      }
    }
    const spits: Spit[] = [];
    for (const s of this.slimes) {
      const spit = s.update(dt, target, this.slimes, obstacles, half);
      if (spit) spits.push(spit);
    }
    for (let i = this.slimes.length - 1; i >= 0; i--) {
      if (!this.slimes[i].removed) continue;
      this.group.remove(this.slimes[i].group);
      this.slimes.splice(i, 1);
    }
    return spits;
  }
}
