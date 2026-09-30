import * as THREE from 'three';
import { clampToArena, pushOutOfCircles, rangeIntent, waveSpec, type Circle, type WaveSpec } from './combat';

export type SlimeKind = 'small' | 'big' | 'spitter';

const KINDS: Record<SlimeKind, { radius: number; speed: number; color: number; score: number; hopRate: number; push: number }> = {
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

export interface Spit {
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
}

export class Slime {
  readonly group = new THREE.Group();
  readonly kind: SlimeKind;
  readonly radius: number;
  readonly score: number;
  readonly color: THREE.Color;
  hp: number;
  /** Set once hp hits 0; the slime shrinks away, then `removed` is set. */
  dying = false;
  removed = false;
  private readonly speed: number;
  private readonly hopRate: number;
  private readonly push: number;
  private readonly body: THREE.Mesh;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly knock = new THREE.Vector2();
  private hopPhase = Math.random();
  private flash = 0;
  private deathTimer = 0;
  private spitTimer = SPIT_INTERVAL * (0.5 + Math.random() * 0.5);
  private windup = 0; // > 0 while swelling up to spit
  private strafeSign = Math.random() < 0.5 ? -1 : 1;

  constructor(kind: SlimeKind, x: number, z: number, speedBonus: number, hp: number) {
    const k = KINDS[kind];
    this.kind = kind;
    this.radius = k.radius;
    this.hp = hp;
    this.score = k.score;
    this.speed = k.speed + speedBonus;
    this.hopRate = k.hopRate;
    this.push = k.push;
    this.color = new THREE.Color(k.color);
    this.material = new THREE.MeshStandardMaterial({
      color: k.color,
      roughness: 0.35,
      flatShading: true,
      emissive: 0xff2020,
      emissiveIntensity: 0,
    });
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
    this.group.add(this.body);
    this.group.scale.setScalar(this.radius);
    this.group.position.set(x, 0, z);
  }

  get x(): number {
    return this.group.position.x;
  }

  get z(): number {
    return this.group.position.z;
  }

  get alive(): boolean {
    return !this.dying;
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

  /** Moves the slime; returns a spit when a spitter lets one fly this step. */
  update(dt: number, target: THREE.Vector3, others: Slime[], obstacles: readonly Circle[], half: number): Spit | null {
    this.flash = Math.max(0, this.flash - dt * 5);
    this.material.emissiveIntensity = this.flash * 1.5;

    if (this.dying) {
      this.deathTimer += dt;
      const s = Math.max(0, 1 - this.deathTimer / 0.18);
      this.group.scale.set(this.radius * (1 + (1 - s) * 0.6), this.radius * s, this.radius * (1 + (1 - s) * 0.6));
      if (s === 0) this.removed = true;
      return null;
    }

    const p = this.group.position;
    let tx = target.x - p.x;
    let tz = target.z - p.z;
    const dist = Math.hypot(tx, tz) || 1;
    tx /= dist;
    tz /= dist;

    // Spitters freeze and swell up, then spit at where the target is now.
    let spit: Spit | null = null;
    if (this.kind === 'spitter') {
      if (this.windup > 0) {
        this.windup -= dt;
        const swell = 1 - this.windup / SPIT_WINDUP;
        this.body.position.y = 0;
        this.body.scale.set(1 + swell * 0.25, 1 + swell * 0.35, 1 + swell * 0.25);
        this.group.rotation.y = Math.atan2(tx, tz);
        if (this.windup <= 0) {
          spit = { x: p.x + tx * this.radius, z: p.z + tz * this.radius, dirX: tx, dirZ: tz };
          this.spitTimer = SPIT_INTERVAL * (0.8 + Math.random() * 0.4);
        }
        return spit;
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

    // Melee slimes chase; spitters hold a distance band and circle inside it.
    let dx = tx;
    let dz = tz;
    if (this.kind === 'spitter') {
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
    const speed = this.speed * (airborne ? 1.25 : 0.25);
    p.x += ((dx / len) * speed + this.knock.x) * dt;
    p.z += ((dz / len) * speed + this.knock.y) * dt;
    this.knock.multiplyScalar(Math.exp(-8 * dt));
    pushOutOfCircles(p, this.radius, obstacles);
    clampToArena(p, half, this.radius);

    this.group.rotation.y = Math.atan2(target.x - p.x, target.z - p.z);
    this.body.position.y = air * 0.7;
    this.body.scale.set(1 + squash * 0.25 - air * 0.08, 1 - squash * 0.3 + air * 0.12, 1 + squash * 0.25 - air * 0.08);
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
