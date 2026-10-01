import * as THREE from 'three';
import { mulberry32 } from '../util/rng';
import { ARENA_HALF, Dungeon, WALL_HEIGHT } from '../world/dungeon';
import { Player, type InputMode } from '../player/controls';
import { TouchControls } from '../ui/touch';
import type { Elf } from '../player/elf';
import type { Crab } from '../player/crab';
import { Enemies, type Slime } from './enemies';
import { Arrows } from './arrows';
import { GLOB_COLOR, Globs } from './globs';
import { Effects } from './effects';
import { BURST_RADIUS, BURST_STUN, Companion } from './companion';
import { pickAimTarget, waveSpec } from './combat';
import { fireAmbience } from './ambience';
import { Hud } from '../ui/hud';
import { Sfx } from './audio';
import { loadBest, recordRun } from './highscore';
import { ActivePowers, POWER_UPS, pickPowerUp, randomSpawnPoint, spreadDirections, type PowerUpType } from './powerups';
import { Pickups } from './pickups';
import type { HeroSession } from '../net/client';
import { POWER_CODES, SLIME_KIND_CODES, q, type GameEvent, type Snapshot } from '../net/snapshot';

const STEP = 1 / 60; // fixed simulation step
const MAX_FRAME = 0.1; // clamp long frames (tab switches) so physics doesn't explode
const MAX_HEALTH = 5;
const FIRE_INTERVAL = 0.36;
const HURT_INVULNERABLE = 1.1;
const WAVE_BREAK = 2.5;
const AIM_ASSIST_ANGLE = 0.3; // radians
const TOUCH_AIM_ASSIST_ANGLE = 0.65; // aiming with a thumb is much harder
const AIM_ASSIST_RANGE = 32;
const PLAYER_RADIUS = 0.5;
const MULTISHOT_ARROWS = 3;
const MULTISHOT_SPREAD = 0.2; // radians between arrows
const PICKUP_INTERVAL_MIN = 10; // seconds between random floor spawns
const PICKUP_INTERVAL_MAX = 18;
const MAX_PICKUPS = 2;
/** Chance a killed slime drops a power-up. */
const DROP_CHANCE: Record<Slime['kind'], number> = { small: 0.04, spitter: 0.1, big: 0.25 };
const SNAPSHOT_EVERY = 3; // steps → 20 Hz while playing
const IDLE_SNAPSHOT_EVERY = 12; // 5 Hz on menus / pause
const CRAB_COLOR = new THREE.Color(0x6fe8d6); // the crab's magic orbs

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
  private readonly globs = new Globs();
  private readonly pickups = new Pickups();
  private readonly powers = new ActivePowers();
  private readonly shieldBubble: THREE.Mesh;
  private nextPickup = 0;
  private readonly effects = new Effects();
  private readonly hud: Hud;
  private readonly touch: TouchControls | null = null;
  private readonly mode: InputMode;
  private readonly sfx = new Sfx();
  private readonly aim = new THREE.Vector3();
  private readonly net: HeroSession | null;
  private events: GameEvent[] = [];
  private steps = 0;
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

  constructor(renderer: THREE.WebGLRenderer, root: HTMLElement, elf: Elf, crab: Crab, mode: InputMode, net: HeroSession | null) {
    this.renderer = renderer;
    this.net = net;
    this.elf = elf;
    this.mode = mode;
    this.dungeon = new Dungeon(this.scene, mulberry32(1337), mode === 'touch' ? 1024 : 2048);
    this.enemies = new Enemies(this.dungeon.gates);
    this.companion = new Companion(crab);
    this.shieldBubble = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.25, 2),
      new THREE.MeshBasicMaterial({ color: POWER_UPS.shield.color, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.shieldBubble.visible = false;
    this.scene.add(elf.group, crab.group, this.enemies.group, this.arrows.group, this.globs.group, this.pickups.group, this.shieldBubble, this.effects.mesh, this.effects.rings);

    this.player = new Player(
      this.camera,
      renderer.domElement,
      elf,
      { half: ARENA_HALF, wallHeight: WALL_HEIGHT, obstacles: this.dungeon.obstacles },
      mode,
    );

    this.hud = new Hud(root, MAX_HEALTH, mode, () => {
      this.sfx.unlock();
      if (this.state !== 'playing') this.newGame();
      this.player.activate();
    });
    if (mode === 'touch') this.touch = new TouchControls(root, this.player);
    this.player.onActiveChange = (active) => {
      this.hud.setPaused(!active, this.state === 'playing');
      this.touch?.setVisible(active);
    };
    // Phones: pause when the app goes to the background (mouse mode loses pointer lock anyway).
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.player.deactivate();
    });
    this.player.onDash = () => this.sfx.whoosh();
    elf.onStep = (strength) => this.sfx.footstep(strength);
    crab.onStep = (strength) => this.sfx.scuttle(strength);
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyM') this.hud.setMuted(this.sfx.toggleMute());
    });

    if (net) {
      // Multiplayer: show the invite, bring the crab in when a familiar joins, obey their taps.
      net.onRoom = (code) => this.hud.setInviteCode(code);
      net.onStatus = (status) => this.hud.setInviteStatus(status, net.familiarConnected);
      net.onFamiliar = (connected) => this.familiarChanged(connected);
      net.onCommand = (cmd) => this.companion.command(cmd, ARENA_HALF);
    } else {
      this.hud.setInviteStatus('unavailable', false);
    }

    this.hud.setBest(loadBest());
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
    this.globs.clear();
    this.pickups.clear();
    this.powers.clear();
    this.nextPickup = 8;
    this.shieldBubble.visible = false;
    this.effects.clear();
    // Start just south of the brazier, looking north across the arena.
    this.player.spawn(0, 8, 0);
    this.companion.reset(2.5, 10);
    this.events = [];
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
    const running = this.state === 'playing' && this.player.isActive;
    this.steps++;
    if (this.net?.familiarConnected && this.steps % (running ? SNAPSHOT_EVERY : IDLE_SNAPSHOT_EVERY) === 0) {
      this.net.sendSnapshot(this.snapshot(running));
    }
    if (!running) {
      // Paused / title / game over: keep the scene alive but frozen.
      this.player.update(0, false);
      return;
    }

    this.player.update(dt, true);
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.elf.group.visible = this.invulnerable === 0 || Math.floor(this.time * 16) % 2 === 0;

    this.shoot(dt);
    for (const spit of this.enemies.update(dt, this.player.position, this.dungeon.obstacles, ARENA_HALF)) {
      this.globs.fire(spit);
      this.sfx.spit();
      this.events.push({ e: 'spit' });
    }
    this.updateGlobs(dt);

    for (const hit of this.arrows.update(dt, this.enemies.slimes, this.dungeon.obstacles, ARENA_HALF)) {
      this.damage(hit.slime, hit.dirX, hit.dirZ);
    }

    const crab = this.companion.update(dt, this.enemies.slimes, this.dungeon.obstacles, ARENA_HALF);
    if (crab.pinched) {
      const c = this.companion.position;
      const dx = crab.pinched.x - c.x;
      const dz = crab.pinched.z - c.z;
      const d = Math.hypot(dx, dz) || 1;
      this.damage(crab.pinched, dx / d, dz / d);
      this.events.push({ e: 'pinch' });
    }
    if (crab.burst) this.magicBurst();

    this.checkContacts();
    this.updatePowerUps(dt);
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
    this.fireCooldown = this.powers.has('rapid') ? FIRE_INTERVAL / 2 : FIRE_INTERVAL;

    const p = this.player.position;
    const dir = this.player.aimDirection(this.aim);
    // Gentle aim assist: snap to a slime near the crosshair line.
    const alive = this.enemies.slimes.filter((s) => s.alive);
    const assist = this.mode === 'touch' ? TOUCH_AIM_ASSIST_ANGLE : AIM_ASSIST_ANGLE;
    const i = pickAimTarget(p, dir.x, dir.z, alive, assist, AIM_ASSIST_RANGE);
    if (i >= 0) dir.set(alive[i].x - p.x, 0, alive[i].z - p.z).normalize();

    this.player.faceShot(dir);
    const count = this.powers.has('multishot') ? MULTISHOT_ARROWS : 1;
    const pierce = this.powers.has('pierce');
    for (const d of spreadDirections(dir.x, dir.z, count, MULTISHOT_SPREAD)) {
      this.arrows.fire(p.x + d.x * 0.6, p.z + d.z * 0.6, d, pierce);
    }
    this.sfx.twang();
    this.events.push({ e: 'twang' });
  }

  /** The familiar's Magic Burst: stun every slime around the crab. */
  private magicBurst(): void {
    const c = this.companion.position;
    const hit = this.enemies.stunAround(c.x, c.z, BURST_RADIUS, BURST_STUN);
    this.effects.ring(c.x, c.z, CRAB_COLOR, BURST_RADIUS);
    this.effects.burst(c.x, 0.8, c.z, CRAB_COLOR, 30, 7, 0.14);
    for (const s of hit) this.effects.burst(s.x, s.radius * 1.6, s.z, new THREE.Color(0xfff27a), 6, 3, 0.1);
    this.sfx.burst();
    this.events.push({ e: 'burst', x: q(c.x), z: q(c.z) });
  }

  /** A familiar connected or left: the crab poofs in beside the elf, or poofs away. */
  private familiarChanged(connected: boolean): void {
    const p = this.player.position;
    const c = this.companion.position;
    if (connected) {
      this.companion.appear(p.x + 2, p.z + 2);
      this.effects.burst(c.x, 0.6, c.z, CRAB_COLOR, 30, 5, 0.14);
      this.effects.ring(c.x, c.z, CRAB_COLOR, 2.5);
      this.hud.toast('🦀 Familiar joined!', 0x6fe8d6);
      this.sfx.powerUp();
    } else if (this.companion.present) {
      this.effects.burst(c.x, 0.6, c.z, CRAB_COLOR, 30, 5, 0.14);
      this.companion.disappear();
      this.hud.toast('🦀 Familiar left', 0x6fe8d6);
    }
    this.hud.setInviteStatus('open', connected);
  }

  /** Everything the familiar's tablet needs to draw this moment. */
  private snapshot(running: boolean): Snapshot {
    const m = this.player.motion;
    const p = this.player.position;
    const c = this.companion;
    const state = this.state === 'playing' ? (running ? 'playing' : 'paused') : this.state;
    const snap: Snapshot = {
      t: q(this.time),
      state,
      hero: { x: q(p.x), z: q(p.z), f: q(m.facing), s: q(m.speed), m: q(m.moveYaw), a: m.aiming ? 1 : 0, d: m.dashing ? 1 : 0, v: this.elf.group.visible ? 1 : 0 },
      crab: c.present ? { x: q(c.position.x), z: q(c.position.z), h: q(c.facing), s: q(c.speed) } : null,
      slimes: this.enemies.slimes.map((s) => {
        const o = s.pose;
        return [s.id, SLIME_KIND_CODES.indexOf(s.kind), q(o.x), q(o.z), q(o.yaw), q(o.y), q(o.sx), q(o.sy), q(o.sz), q(o.flash), o.stun, q(o.death)];
      }),
      arrows: this.arrows.snapshot(),
      globs: this.globs.snapshot(),
      pickups: this.pickups.snapshot(),
      wave: this.wave,
      remaining: this.enemies.remaining,
      health: Math.max(0, this.health),
      maxHealth: MAX_HEALTH,
      score: this.score,
      powers: this.powers.list().map((pw) => [POWER_CODES.indexOf(pw.type), q(pw.remaining)]),
      burstCd: q(c.burstCooldown),
      ev: this.events,
    };
    this.events = [];
    return snap;
  }

  /** Big banner on the hero's screen, mirrored on the familiar's. */
  private banner(text: string): void {
    this.hud.banner(text);
    this.events.push({ e: 'banner', text });
  }

  private damage(slime: Slime, dirX: number, dirZ: number): void {
    const killed = slime.hurt(1, dirX, dirZ);
    const y = slime.radius;
    const big = slime.kind === 'big';
    if (killed) {
      this.score += slime.score;
      this.hud.setScore(this.score);
      this.effects.burst(slime.x, y, slime.z, slime.color, big ? 40 : 22, big ? 8 : 6);
      this.sfx.splat(big);
      this.events.push({ e: 'splat', x: q(slime.x), z: q(slime.z), c: slime.color.getHex(), big });
      if (Math.random() < DROP_CHANCE[slime.kind] && this.pickups.count < MAX_PICKUPS + 1) {
        this.pickups.spawn(pickPowerUp(Math.random, this.health, MAX_HEALTH), slime.x, slime.z);
      }
    } else {
      this.effects.burst(slime.x, y, slime.z, slime.color, 6, 4, 0.12);
      this.sfx.hit();
      this.events.push({ e: 'hit', x: q(slime.x), z: q(slime.z), c: slime.color.getHex() });
    }
  }

  private checkContacts(): void {
    if (this.invulnerable > 0 || this.player.dashing) return;
    const p = this.player.position;
    for (const s of this.enemies.slimes) {
      if (!s.alive || s.stunned) continue; // stunned slimes are harmless
      const dx = p.x - s.x;
      const dz = p.z - s.z;
      const d = Math.hypot(dx, dz);
      if (d > s.radius + PLAYER_RADIUS) continue;

      this.hurtPlayer(s.kind === 'big' ? 2 : 1, dx / (d || 1), dz / (d || 1));
      return;
    }
  }

  /** Random floor spawns, collecting, timers, the shield bubble and the HUD chips. */
  private updatePowerUps(dt: number): void {
    const p = this.player.position;
    this.powers.tick(dt);

    this.nextPickup -= dt;
    if (this.nextPickup <= 0 && this.wave > 0) {
      this.nextPickup = PICKUP_INTERVAL_MIN + Math.random() * (PICKUP_INTERVAL_MAX - PICKUP_INTERVAL_MIN);
      if (this.pickups.count < MAX_PICKUPS) {
        const at = randomSpawnPoint(Math.random, ARENA_HALF, this.dungeon.obstacles, [p], 7);
        this.pickups.spawn(pickPowerUp(Math.random, this.health, MAX_HEALTH), at.x, at.z);
      }
    }

    for (const type of this.pickups.update(dt, this.time, p)) this.applyPowerUp(type);

    const shielded = this.powers.has('shield');
    this.shieldBubble.visible = shielded;
    if (shielded) {
      this.shieldBubble.position.set(p.x, 1.05, p.z);
      const pulse = 1 + Math.sin(this.time * 5) * 0.04;
      this.shieldBubble.scale.set(pulse, pulse * 1.05, pulse);
      // Flicker as it runs out.
      const left = this.powers.remaining('shield');
      (this.shieldBubble.material as THREE.MeshBasicMaterial).opacity = left < 3 && Math.sin(this.time * 20) < 0 ? 0.06 : 0.18;
    }
    this.hud.setPowers(this.powers.list());
  }

  private applyPowerUp(type: PowerUpType): void {
    const def = POWER_UPS[type];
    const p = this.player.position;
    if (type === 'heart') {
      if (this.health < MAX_HEALTH) this.health++;
      else this.score += 25; // full health: a little score instead
      this.hud.setHealth(this.health);
      this.hud.setScore(this.score);
    } else {
      this.powers.add(type);
    }
    this.hud.toast(`${def.icon} ${def.label}!`, def.color);
    this.effects.burst(p.x, 1.1, p.z, new THREE.Color(def.color), 18, 5, 0.12);
    this.sfx.powerUp();
    this.events.push({ e: 'pickup', p: POWER_CODES.indexOf(type), x: q(p.x), z: q(p.z) });
  }

  private updateGlobs(dt: number): void {
    const p = this.player.position;
    const canBeHit = this.invulnerable === 0 && !this.player.dashing;
    const target = canBeHit ? { x: p.x, z: p.z, radius: PLAYER_RADIUS } : null;
    for (const hit of this.globs.update(dt, this.time, target, this.dungeon.obstacles, ARENA_HALF)) {
      this.effects.burst(hit.x, 1, hit.z, GLOB_COLOR, 10, 4, 0.12);
      this.events.push({ e: 'glob', x: q(hit.x), z: q(hit.z) });
      if (!hit.hitPlayer) continue;
      const dx = p.x - hit.x;
      const dz = p.z - hit.z;
      const d = Math.hypot(dx, dz) || 1;
      this.hurtPlayer(1, dx / d, dz / d);
    }
  }

  private hurtPlayer(amount: number, dirX: number, dirZ: number): void {
    const p = this.player.position;
    if (this.powers.has('shield')) {
      // The shield takes the hit instead.
      this.powers.end('shield');
      this.invulnerable = 0.8;
      this.player.knockback(dirX, dirZ, 10);
      this.effects.burst(p.x, 1.2, p.z, new THREE.Color(POWER_UPS.shield.color), 24, 6, 0.14);
      this.sfx.shieldBreak();
      this.events.push({ e: 'shield', x: q(p.x), z: q(p.z) });
      return;
    }
    this.health -= amount;
    this.invulnerable = HURT_INVULNERABLE;
    this.player.knockback(dirX, dirZ, 16);
    this.hud.setHealth(Math.max(0, this.health));
    this.hud.flashHurt();
    this.sfx.hurt();
    this.events.push({ e: 'hurt' });
    if (this.health <= 0) this.gameOver();
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
        this.banner(`Wave ${this.wave} cleared`);
      }
      return;
    }
    this.waveBreak -= dt;
    if (this.waveBreak <= 0) {
      this.wave++;
      this.enemies.startWave(this.wave);
      const newSpitters = waveSpec(this.wave).spitters > 0 && waveSpec(this.wave - 1).spitters === 0;
      this.banner(newSpitters ? `Wave ${this.wave} · Spitters!` : `Wave ${this.wave}`);
      this.sfx.wave();
    }
  }

  private gameOver(): void {
    this.state = 'over';
    this.elf.group.visible = true;
    const run = { score: this.score, wave: this.wave };
    const isBest = recordRun(run);
    this.hud.showGameOver(this.wave, this.score, isBest);
    this.hud.setBest(loadBest() ?? run);
    this.player.deactivate();
  }

  private resize(): void {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }
}
