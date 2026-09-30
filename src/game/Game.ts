import * as THREE from 'three';
import { mulberry32 } from '../util/rng';
import { ARENA_HALF, Dungeon, WALL_HEIGHT } from '../world/dungeon';
import { Player } from '../player/controls';
import type { Elf } from '../player/elf';
import type { Crab } from '../player/crab';
import { Enemies, type Slime } from './enemies';
import { Arrows } from './arrows';
import { Effects } from './effects';
import { Companion } from './companion';
import { pickAimTarget } from './combat';
import { fireAmbience } from './ambience';
import { Hud } from '../ui/hud';
import { Sfx } from './audio';

const STEP = 1 / 60; // fixed simulation step
const MAX_FRAME = 0.1; // clamp long frames (tab switches) so physics doesn't explode
const MAX_HEALTH = 5;
const FIRE_INTERVAL = 0.36;
const HURT_INVULNERABLE = 1.1;
const WAVE_BREAK = 2.5;
const AIM_ASSIST_ANGLE = 0.3; // radians
const AIM_ASSIST_RANGE = 32;
const PLAYER_RADIUS = 0.5;

type State = 'ready' | 'playing' | 'over';

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 300);
  private readonly timer = new THREE.Timer();
  private readonly dungeon: Dungeon;
  private readonly player: Player;
  private readonly elf: Elf;
  private readonly companion: Companion;
  private readonly enemies: Enemies;
  private readonly arrows = new Arrows();
  private readonly effects = new Effects();
  private readonly hud: Hud;
  private readonly sfx = new Sfx();
  private readonly aim = new THREE.Vector3();
  private readonly cameraRight = new THREE.Vector3();
  private accumulator = 0;
  private time = 0;
  private state: State = 'ready';
  private health = MAX_HEALTH;
  private score = 0;
  private wave = 0;
  private waveBreak = 0;
  private fireCooldown = 0;
  private invulnerable = 0;
  private onFrame?: () => void;

  constructor(renderer: THREE.WebGLRenderer, root: HTMLElement, elf: Elf, crab: Crab) {
    this.renderer = renderer;
    this.elf = elf;
    this.dungeon = new Dungeon(this.scene, mulberry32(1337));
    this.enemies = new Enemies(this.dungeon.gates);
    this.companion = new Companion(crab);
    this.scene.add(elf.group, crab.group, this.enemies.group, this.arrows.group, this.effects.mesh);

    this.player = new Player(this.camera, renderer.domElement, elf, {
      half: ARENA_HALF,
      wallHeight: WALL_HEIGHT,
      obstacles: this.dungeon.obstacles,
    });

    this.hud = new Hud(root, MAX_HEALTH, () => {
      this.sfx.unlock();
      if (this.state !== 'playing') this.newGame();
      this.player.lock();
    });
    this.player.onLockChange = (locked) => this.hud.setPaused(!locked, this.state === 'playing');
    this.player.onDash = () => this.sfx.whoosh();
    elf.onStep = (strength) => this.sfx.footstep(strength);
    crab.onStep = (strength) => this.sfx.scuttle(strength);
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyM') this.hud.setMuted(this.sfx.toggleMute());
    });

    this.resetWorld();
    addEventListener('resize', () => this.resize());
    this.resize();
  }

  /** Optional per-frame hook (used for the dev FPS panel). */
  setFrameHook(fn: () => void): void {
    this.onFrame = fn;
  }

  start(): void {
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  private resetWorld(): void {
    this.enemies.clear();
    this.arrows.clear();
    this.effects.clear();
    // Start just south of the brazier, looking north across the arena.
    this.player.spawn(0, 8, 0);
    this.companion.reset(2.5, 10);
  }

  private newGame(): void {
    this.resetWorld();
    this.state = 'playing';
    this.health = MAX_HEALTH;
    this.score = 0;
    this.wave = 0;
    this.waveBreak = 1;
    this.invulnerable = 0;
    this.hud.setHealth(this.health);
    this.hud.setScore(this.score);
    this.hud.setWave(0, 0);
  }

  private frame(timestamp: number): void {
    this.timer.update(timestamp);
    this.accumulator += Math.min(this.timer.getDelta(), MAX_FRAME);
    while (this.accumulator >= STEP) {
      this.update(STEP);
      this.accumulator -= STEP;
    }
    this.renderer.render(this.scene, this.camera);
    this.onFrame?.();
  }

  private update(dt: number): void {
    this.time += dt;
    this.dungeon.update(this.time);
    this.updateAmbience(dt);
    const running = this.state === 'playing' && this.player.isLocked;
    if (!running) {
      // Paused / title / game over: keep the scene alive but frozen.
      this.player.update(0, false);
      return;
    }

    this.player.update(dt, true);
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.elf.group.visible = this.invulnerable === 0 || Math.floor(this.time * 16) % 2 === 0;

    this.shoot(dt);
    this.enemies.update(dt, this.player.position, this.dungeon.obstacles, ARENA_HALF);

    for (const hit of this.arrows.update(dt, this.enemies.slimes, this.dungeon.obstacles, ARENA_HALF)) {
      this.damage(hit.slime, hit.dirX, hit.dirZ);
    }

    const pinched = this.companion.update(
      dt,
      this.player.position,
      this.player.facing,
      this.enemies.slimes,
      this.dungeon.obstacles,
      ARENA_HALF,
      true,
    );
    if (pinched) {
      const dx = pinched.x - this.companion.position.x;
      const dz = pinched.z - this.companion.position.z;
      const d = Math.hypot(dx, dz) || 1;
      this.damage(pinched, dx / d, dz / d);
    }

    this.checkContacts();
    this.effects.update(dt);
    this.updateWaves(dt);
  }

  /** Fire crackle follows the elf: louder near torches, panned by where they are on screen. */
  private updateAmbience(dt: number): void {
    this.cameraRight.setFromMatrixColumn(this.camera.matrixWorld, 0);
    const { level, pan } = fireAmbience(this.player.position, this.cameraRight.x, this.cameraRight.z, this.dungeon.fireSources);
    this.sfx.setAmbience(level, pan, dt);
  }

  private shoot(dt: number): void {
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    if (!this.player.trigger || this.fireCooldown > 0) return;
    this.fireCooldown = FIRE_INTERVAL;

    const p = this.player.position;
    const dir = this.player.aimDirection(this.aim);
    // Gentle aim assist: snap to a slime near the crosshair line.
    const alive = this.enemies.slimes.filter((s) => s.alive);
    const i = pickAimTarget(p, dir.x, dir.z, alive, AIM_ASSIST_ANGLE, AIM_ASSIST_RANGE);
    if (i >= 0) dir.set(alive[i].x - p.x, 0, alive[i].z - p.z).normalize();

    this.player.faceShot(dir);
    this.arrows.fire(p.x + dir.x * 0.6, p.z + dir.z * 0.6, dir);
    this.sfx.twang();
  }

  private damage(slime: Slime, dirX: number, dirZ: number): void {
    const killed = slime.hurt(1, dirX, dirZ);
    const y = slime.radius;
    if (killed) {
      this.score += slime.score;
      this.hud.setScore(this.score);
      this.effects.burst(slime.x, y, slime.z, slime.color, slime.big ? 40 : 22, slime.big ? 8 : 6);
      this.sfx.splat(slime.big);
    } else {
      this.effects.burst(slime.x, y, slime.z, slime.color, 6, 4, 0.12);
      this.sfx.hit();
    }
  }

  private checkContacts(): void {
    if (this.invulnerable > 0 || this.player.dashing) return;
    const p = this.player.position;
    for (const s of this.enemies.slimes) {
      if (!s.alive) continue;
      const dx = p.x - s.x;
      const dz = p.z - s.z;
      const d = Math.hypot(dx, dz);
      if (d > s.radius + PLAYER_RADIUS) continue;

      this.health -= s.big ? 2 : 1;
      this.invulnerable = HURT_INVULNERABLE;
      this.player.knockback(dx / (d || 1), dz / (d || 1), 16);
      this.hud.setHealth(Math.max(0, this.health));
      this.hud.flashHurt();
      this.sfx.hurt();
      if (this.health <= 0) this.gameOver();
      return;
    }
  }

  private updateWaves(dt: number): void {
    this.hud.setWave(this.wave, this.enemies.remaining);
    if (this.enemies.remaining > 0) return;
    if (this.waveBreak <= 0) {
      // Wave cleared: breather, and a heart back.
      this.waveBreak = WAVE_BREAK;
      if (this.wave > 0) {
        this.health = Math.min(MAX_HEALTH, this.health + 1);
        this.hud.setHealth(this.health);
        this.hud.banner(`Wave ${this.wave} cleared`);
      }
      return;
    }
    this.waveBreak -= dt;
    if (this.waveBreak <= 0) {
      this.wave++;
      this.enemies.startWave(this.wave);
      this.hud.banner(`Wave ${this.wave}`);
      this.sfx.wave();
    }
  }

  private gameOver(): void {
    this.state = 'over';
    this.elf.group.visible = true;
    this.hud.showGameOver(this.wave, this.score);
    document.exitPointerLock();
  }

  private resize(): void {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }
}
