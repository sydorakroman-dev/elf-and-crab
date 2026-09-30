import * as THREE from 'three';
import { clampToArena, pushOutOfCircles, waveComposition, type Circle } from './combat';

const SMALL = { radius: 0.7, hp: 1, speed: 3.4, color: 0x62d46a, score: 10 };
const BIG = { radius: 1.25, hp: 4, speed: 2.5, color: 0xa35ee0, score: 40 };
const SPAWN_INTERVAL = 0.55;

const bodyGeo = new THREE.SphereGeometry(1, 12, 8).translate(0, 1, 0);
const eyeGeo = new THREE.SphereGeometry(0.2, 8, 6);
const pupilGeo = new THREE.SphereGeometry(0.11, 8, 6);
const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
const pupilMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.2 });

export class Slime {
  readonly group = new THREE.Group();
  readonly radius: number;
  readonly big: boolean;
  readonly score: number;
  readonly color: THREE.Color;
  hp: number;
  /** Set once hp hits 0; the slime shrinks away, then `removed` is set. */
  dying = false;
  removed = false;
  private readonly speed: number;
  private readonly body: THREE.Mesh;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly knock = new THREE.Vector2();
  private hopPhase = Math.random();
  private flash = 0;
  private deathTimer = 0;

  constructor(big: boolean, x: number, z: number, speedBonus: number) {
    const kind = big ? BIG : SMALL;
    this.big = big;
    this.radius = kind.radius;
    this.hp = kind.hp;
    this.score = kind.score;
    this.speed = kind.speed + speedBonus;
    this.color = new THREE.Color(kind.color);
    this.material = new THREE.MeshStandardMaterial({
      color: kind.color,
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
    const push = this.big ? 5 : 9;
    this.knock.set(dirX * push, dirZ * push);
    if (this.hp <= 0) this.dying = true;
    return this.dying;
  }

  update(dt: number, target: THREE.Vector3, others: Slime[], obstacles: readonly Circle[], half: number): void {
    this.flash = Math.max(0, this.flash - dt * 5);
    this.material.emissiveIntensity = this.flash * 1.5;

    if (this.dying) {
      this.deathTimer += dt;
      const s = Math.max(0, 1 - this.deathTimer / 0.18);
      this.group.scale.set(this.radius * (1 + (1 - s) * 0.6), this.radius * s, this.radius * (1 + (1 - s) * 0.6));
      if (s === 0) this.removed = true;
      return;
    }

    // Hop toward the target: fast while airborne, slow while squashed on the ground.
    this.hopPhase = (this.hopPhase + dt * (this.big ? 1.3 : 1.8)) % 1;
    const t = this.hopPhase;
    const airborne = t < 0.6;
    const air = airborne ? Math.sin((t / 0.6) * Math.PI) : 0;
    const squash = airborne ? 0 : Math.sin(((t - 0.6) / 0.4) * Math.PI);

    const p = this.group.position;
    let dx = target.x - p.x;
    let dz = target.z - p.z;
    const dist = Math.hypot(dx, dz) || 1;
    dx /= dist;
    dz /= dist;
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
  }
}

/** Spawns slimes wave by wave through the dungeon gates and updates them. */
export class Enemies {
  readonly group = new THREE.Group();
  readonly slimes: Slime[] = [];
  private queue: boolean[] = []; // true = big slime
  private spawnTimer = 0;
  private speedBonus = 0;
  private readonly gates: THREE.Vector3[];

  constructor(gates: THREE.Vector3[]) {
    this.gates = gates;
  }

  /** Slimes still to beat this wave (alive + not yet spawned). */
  get remaining(): number {
    return this.queue.length + this.slimes.filter((s) => s.alive).length;
  }

  startWave(wave: number): void {
    const { small, big } = waveComposition(wave);
    this.queue = [...Array(small).fill(false), ...Array(big).fill(true)].sort(() => Math.random() - 0.5);
    this.speedBonus = Math.min(1.5, (wave - 1) * 0.15);
    this.spawnTimer = 0.3;
  }

  clear(): void {
    for (const s of this.slimes) this.group.remove(s.group);
    this.slimes.length = 0;
    this.queue = [];
  }

  update(dt: number, target: THREE.Vector3, obstacles: readonly Circle[], half: number): void {
    this.spawnTimer -= dt;
    if (this.queue.length && this.spawnTimer <= 0) {
      this.spawnTimer = SPAWN_INTERVAL;
      const gate = this.gates[Math.floor(Math.random() * this.gates.length)];
      const jitter = (Math.random() - 0.5) * 2.5;
      const alongX = Math.abs(gate.z) > Math.abs(gate.x);
      const s = new Slime(this.queue.pop()!, gate.x + (alongX ? jitter : 0), gate.z + (alongX ? 0 : jitter), this.speedBonus);
      this.slimes.push(s);
      this.group.add(s.group);
    }
    for (const s of this.slimes) s.update(dt, target, this.slimes, obstacles, half);
    for (let i = this.slimes.length - 1; i >= 0; i--) {
      if (!this.slimes[i].removed) continue;
      this.group.remove(this.slimes[i].group);
      this.slimes.splice(i, 1);
    }
  }
}
