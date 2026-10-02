import * as THREE from 'three';
import { Dungeon, WALL_HEIGHT } from '../world/dungeon';
import { ROOMS, runLabel, type RunPhase } from '../world/rooms';
import { TelegraphRings } from './telegraph';
import { Player, type Arena, type InputMode } from '../player/controls';
import { TouchControls } from '../ui/touch';
import type { Elf } from '../player/elf';
import type { FamiliarBody } from '../player/beasts';
import { Enemies, type Enemy, type Strike } from './enemies';
import { Arrows } from './arrows';
import { Globs, PROJECTILES, PROJECTILE_KINDS, type GlobImpact } from './globs';
import { Effects } from './effects';
import { Companion } from './companion';
import { ELEMENTAL_ATTACKS, HEALING, HERO, MONSTER_SHOTS, POISON, VICTORY_SCORE_PER_HP } from './balance';
import { BUBBLE_HITS, TONGUE_BOSS_FLINCH, WARD, FAMILIARS, FAMILIAR_KINDS, HOWL_BOSS_FLINCH, HOWL_RAPID_SECONDS, JET, POUNCE_DAMAGE, inJet, SPELLS, SPELL_IDS, SPRING_SLOW, type FamiliarKind, type SpellId } from './familiars';
import { SpringPools, ZONE_FIRE, ZONE_POISON, ZONE_SPRING, type ZoneTuple } from './zones';
import { Monster } from './monsters';
import { Resources, WIND_WALK_SECONDS } from './abilities';
import { DIFFICULTIES, difficulty, scaledDamage } from './difficulty';
import { ENEMY_KIND_LIST } from './enemyKinds';
import type { FamiliarCommand } from '../net/protocol';
import { pickAimTarget } from './combat';
import { fireAmbience } from './ambience';
import { Hud } from '../ui/hud';
import { Sfx } from './audio';
import { loadBest, recordRun } from './highscore';
import { ActivePowers, POWER_UPS, pickPowerUp, randomSpawnPoint, spreadDirections, type PowerUpType } from './powerups';
import { Pickups } from './pickups';
import type { HeroLink } from '../net/client';
import { POWER_CODES, q, type GameEvent, type Snapshot } from '../net/snapshot';

const STEP = 1 / 60; // fixed simulation step
const MAX_FRAME = 0.1; // clamp long frames (tab switches) so physics doesn't explode
const MAX_HEALTH = HERO.maxHp;
const FIRE_INTERVAL = 0.36;
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
const SNAPSHOT_EVERY = 3; // steps → 20 Hz while playing
const IDLE_SNAPSHOT_EVERY = 12; // 5 Hz on menus / pause
const STUN_STAR = new THREE.Color(0xfff27a);
const CALM_PINK = new THREE.Color(0xffb8dc);
const SPRING_BLUE = new THREE.Color(0x8fe8f5);
const HOWL_BLUE = new THREE.Color(0x9fd0ff);
const WATER_BLUE = new THREE.Color(0x5cc4ff);
const TONGUE_PINK = new THREE.Color(0xff7aa8);
const JADE = 0x4fe39a;

/** Jade Ward's circle: a glowing jade ring and a faint disc, laid on the floor. */
export function jadeRing(radius: number): THREE.Group {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.RingGeometry(radius - 0.18, radius, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: JADE, transparent: true, opacity: 0.85, depthWrite: false }));
  const disc = new THREE.Mesh(new THREE.CircleGeometry(radius, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: JADE, transparent: true, opacity: 0.18, depthWrite: false }));
  ring.position.y = 0.08;
  disc.position.y = 0.06;
  g.add(disc, ring);
  g.visible = false;
  return g;
}
const HEAL_GREEN = 0x7dff8a;

type State = 'ready' | 'playing' | 'over' | 'won';
const DOOR_FADE = 0.5; // seconds of black before the next room appears (with its intro card)
const DOOR_TOTAL = 4; // the card stays up this long, unless skipped
const CARD_SKIP_AFTER = 1.1; // a click / tap / key skips the card after this long

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 300);
  private readonly timer = new THREE.Timer();
  private dungeon: Dungeon;
  private readonly arena: Arena;
  private readonly shadowSize: number;
  private readonly telegraph = new TelegraphRings();
  private room = 0;
  private waveInRoom = 0;
  private phase: RunPhase = 'fight';
  private doorT = 0;
  private doorSwitched = false;
  /** A click / tap / key since the room card came up. */
  private cardSkip = false;
  private playTime = 0;
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
  private readonly springPools = new SpringPools();
  /** Live Soothing Spring pools; `healed` = it already gave the elf their heart. */
  private zones: { id: number; kind: number; x: number; z: number; r: number; t: number; healed: boolean }[] = [];
  /** Burn damage owed from standing in fire (dealt in small ticks). */
  private burn = 0;
  private burnTick = 0;
  private nextZoneId = 1;
  private readonly effects = new Effects();
  private readonly hud: Hud;
  private readonly touch: TouchControls | null = null;
  private readonly mode: InputMode;
  private readonly sfx = new Sfx();
  private readonly aim = new THREE.Vector3();
  private readonly net: HeroLink | null;
  /** Simulate only (no drawing): the practice room's hidden hero game. */
  private readonly headless: boolean;
  /** The practice room: no monsters, power-ups keep coming, the elf just stands there. */
  private readonly practice: boolean;
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
  /** Jade Ward: seconds left on the healing circle around the elf (and its mesh). */
  private ward = 0;
  private readonly wardRing: THREE.Group;
  /** The elf's mana and stamina. */
  private readonly resources = new Resources();
  /** Wind Walk: seconds of invisibility left, and where the elf vanished (enemies head there). */
  private invisible = 0;
  private readonly vanishSpot = new THREE.Vector3();
  /** Hits the shield still absorbs (2 for a Bubble Shield, else 1). */
  private shieldHits = 0;
  private onFrame?: () => void;

  constructor(
    renderer: THREE.WebGLRenderer,
    root: HTMLElement,
    elf: Elf,
    familiars: Record<FamiliarKind, FamiliarBody>,
    mode: InputMode,
    net: HeroLink | null,
    options: { headless?: boolean; practice?: boolean } = {},
  ) {
    this.renderer = renderer;
    this.net = net;
    this.headless = !!options.headless;
    this.practice = !!options.practice;
    this.elf = elf;
    this.mode = mode;
    this.shadowSize = mode === 'touch' ? 1024 : 2048;
    this.dungeon = new Dungeon(this.scene, ROOMS[0], this.shadowSize);
    this.arena = { half: this.dungeon.half, wallHeight: WALL_HEIGHT, obstacles: this.dungeon.obstacles };
    this.enemies = new Enemies(this.dungeon.gates);
    this.companion = new Companion(familiars);
    this.shieldBubble = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.25, 2),
      new THREE.MeshBasicMaterial({ color: POWER_UPS.shield.color, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.shieldBubble.visible = false;
    this.wardRing = jadeRing(SPELLS.ward.radius);
    this.scene.add(this.wardRing);
    this.scene.add(...Object.values(familiars).map((b) => b.group));
    this.scene.add(elf.group, this.springPools.group, this.enemies.group, this.arrows.group, this.globs.group, this.pickups.group, this.shieldBubble, this.effects.mesh, this.effects.rings, this.telegraph.group);

    this.player = new Player(
      this.camera,
      this.headless ? document.createElement('canvas') : renderer.domElement, // headless: no mouse capture
      elf,
      this.arena,
      mode,
    );

    this.hud = new Hud(root, MAX_HEALTH, mode, () => {
      this.sfx.unlock();
      if (this.state !== 'playing') this.newGame();
      this.banner(`${ROOMS[this.room].name}`);
      this.player.activate();
    }, () => this.beginFight());
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
    this.player.canDash = () => this.resources.spend('dash'); // a dash costs stamina
    this.hud.actionBar.onUse = (slot) => this.useSlot(slot);
    elf.onStep = (strength) => this.sfx.footstep(strength);
    familiars.crab.onStep = (strength) => this.sfx.scuttle(strength);
    familiars.capybara.onStep = (strength) => this.sfx.footstep(strength * 0.4);
    familiars.goldfish.onStep = (strength) => this.sfx.scuttle(strength * 0.5);
    familiars.iguana.onStep = (strength) => this.sfx.footstep(strength * 0.35);
    familiars.wolf.onStep = (strength) => this.sfx.scuttle(strength * 0.6);
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyM') this.hud.setMuted(this.sfx.toggleMute());
      else if ((e.code === 'Enter' || e.code === 'NumpadEnter') && this.phase === 'ready') this.beginFight();
      else {
        this.cardSkip = true;
        const slot = this.hud.actionBar.rebinding || e.repeat ? -1 : this.hud.actionBar.slotFor(e.code);
        if (slot >= 0) this.useSlot(slot);
      }
    });
    addEventListener('pointerdown', () => (this.cardSkip = true));

    if (net) {
      // Multiplayer: show the invite, bring the familiar's creature in when they pick it, obey their taps.
      net.onRoom = (code) => this.hud.setInviteCode(code);
      net.onStatus = (status) => this.hud.setInviteStatus(status, net.familiarConnected, this.companion.kind);
      net.onFamiliar = (connected) => this.familiarChanged(connected);
      net.onCommand = (cmd) => this.familiarCommand(cmd);
    } else {
      this.hud.setInviteStatus('unavailable', false, null);
    }

    this.hud.setBest(loadBest());
    this.resetWorld();
    addEventListener('resize', () => this.resize());
    this.resize();
    if (this.practice) this.startPractice();
  }

  /** The practice room: straight into the Woodland, no intro card, no waves; the elf a bit hurt so heals show. */
  private startPractice(): void {
    this.newGame();
    this.doorT = DOOR_TOTAL;
    this.health = 60;
    this.nextPickup = 1;
  }

  /** Optional per-frame hook (used for the dev FPS panel). */
  setFrameHook(fn: () => void): void {
    this.onFrame = fn;
  }

  start(): void {
    if (this.headless) {
      const loop = (t: number) => {
        this.frame(t);
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
      return;
    }
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
    // Arrive at the south gate, looking north across the room.
    const e = this.dungeon.entry;
    this.player.spawn(e.x, e.z, 0);
    this.companion.reset(e.x + 2.5, e.z + 0.5);
    this.telegraph.sync([], 0);
    this.hud.bossBar.set(null);
    this.zones = [];
    this.burn = 0;
    this.springPools.sync([], 0, 0);
    this.events = [];
  }

  private newGame(): void {
    if (this.room !== 0 || this.dungeon.room !== ROOMS[0]) this.loadRoom(0);
    this.resetWorld();
    this.state = 'playing';
    this.health = MAX_HEALTH;
    this.resources.reset();
    this.invisible = 0;
    this.ward = 0;
    this.elf.setGhost(false);
    this.score = 0;
    this.wave = 0;
    this.waveInRoom = 0;
    this.waveBreak = 1.5;
    // Open on the Woodland's intro card.
    this.phase = 'transition';
    this.doorT = DOOR_FADE;
    this.doorSwitched = true;
    this.cardSkip = false;
    this.hud.fade.set(true, 0);
    this.invulnerable = 0;
    this.playTime = 0;
    this.dungeon.setExitOpen(false);
    this.hud.setHealth(this.health);
    this.hud.setScore(this.score);
  }

  /** Swaps in room `index`: builds it, and points everything at its size, obstacles and gates. */
  private loadRoom(index: number): void {
    this.dungeon.dispose(this.scene);
    this.room = index;
    this.dungeon = new Dungeon(this.scene, ROOMS[index], this.shadowSize);
    this.arena.half = this.dungeon.half;
    this.arena.obstacles = this.dungeon.obstacles;
    this.enemies.setGates(this.dungeon.gates);
  }

  private frame(timestamp: number): void {
    this.timer.update(timestamp);
    this.accumulator += Math.min(this.timer.getDelta(), MAX_FRAME);
    while (this.accumulator >= STEP) {
      this.update(STEP);
      this.accumulator -= STEP;
    }
    if (!this.headless) this.renderer.render(this.scene, this.camera);
    this.onFrame?.();
  }

  private update(dt: number): void {
    this.time += dt;
    this.dungeon.update(this.time, dt);
    this.updateAmbience(dt);
    const running = this.state === 'playing' && (this.player.isActive || this.practice);
    this.steps++;
    if (this.net?.familiarConnected && this.steps % (running ? SNAPSHOT_EVERY : IDLE_SNAPSHOT_EVERY) === 0) {
      this.net.sendSnapshot(this.snapshot(running));
    }
    this.hud.actionBar.setVisible(running && !this.headless);
    if (!running) {
      // Paused / title / game over: keep the scene alive but frozen.
      this.player.update(0, false);
      return;
    }

    this.resources.tick(dt);
    this.updateWard(dt);
    this.invisible = Math.max(0, this.invisible - dt);
    this.elf.setGhost(this.invisible > 0);
    this.hud.actionBar.update(this.resources);
    this.player.update(dt, true);
    this.playTime += dt;
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.elf.group.visible = this.invulnerable === 0 || Math.floor(this.time * 16) % 2 === 0;

    this.shoot(dt);
    this.updateZones(dt);
    const half = this.dungeon.half;
    // Wind Walk: enemies lose track and head for the spot where the elf vanished.
    const seen = this.invisible > 0 ? this.vanishSpot : this.player.position;
    const { spits, strikes } = this.enemies.update(dt, seen, this.dungeon.obstacles, half);
    for (const spit of spits) {
      this.globs.fire(spit);
      this.sfx.spit();
      this.events.push({ e: 'spit' });
    }
    for (const strike of strikes) this.enemyStrike(strike);
    this.showHealPulses();
    this.syncBoss();
    this.updateGlobs(dt);

    for (const hit of this.arrows.update(dt, this.enemies.all, this.dungeon.obstacles, half)) {
      this.damage(hit.slime, hit.dirX, hit.dirZ);
    }

    this.updateFamiliar(dt);

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
    this.invisible = 0; // shooting gives you away

    const p = this.player.position;
    const dir = this.player.aimDirection(this.aim);
    // Gentle aim assist: snap to an enemy near the crosshair line.
    const alive = this.enemies.all.filter((s) => s.alive && !s.hidden);
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

  /** The familiar's creature: walking, biting, and whatever spells went off this step. */
  private updateFamiliar(dt: number): void {
    const r = this.companion.update(dt, this.enemies.all, this.dungeon.obstacles, this.dungeon.half);
    const c = this.companion.position;
    const push = (s: Enemy, amount: number) => {
      const dx = s.x - c.x;
      const dz = s.z - c.z;
      const d = Math.hypot(dx, dz) || 1;
      this.damage(s, dx / d, dz / d, amount);
    };
    if (r.bitten) {
      push(r.bitten, r.biteDamage);
      this.events.push({ e: 'bite' });
    }
    for (const s of r.pounceHits) push(s, POUNCE_DAMAGE);
    if (r.landed) {
      this.effects.ring(c.x, c.z, 0xd9cbb0, 2.2);
      this.effects.burst(c.x, 0.3, c.z, new THREE.Color(0xb8a98f), 16, 4, 0.12);
      this.sfx.land();
      this.events.push({ e: 'land', x: q(c.x), z: q(c.z) });
    }
    for (const id of r.cast) this.castSpell(id);
  }

  /** Effects of a familiar spell (cooldown already started by the companion). */
  private castSpell(id: SpellId): void {
    const c = this.companion.position;
    const p = this.player.position;
    const spell = SPELLS[id];
    const color = new THREE.Color(this.companion.kind ? FAMILIARS[this.companion.kind].color : 0xffffff);
    switch (id) {
      case 'burst': {
        const hit = this.enemies.stunAround(c.x, c.z, spell.radius, spell.duration);
        this.effects.ring(c.x, c.z, color, spell.radius);
        this.effects.burst(c.x, 0.8, c.z, color, 30, 7, 0.14);
        for (const s of hit) this.effects.burst(s.x, s.radius * 1.6, s.z, STUN_STAR, 6, 3, 0.1);
        this.sfx.burst();
        break;
      }
      case 'shell':
        this.powers.add('shield');
        this.shieldHits = Math.max(this.shieldHits, 1);
        this.effects.burst(p.x, 1.2, p.z, new THREE.Color(POWER_UPS.shield.color), 24, 5, 0.12);
        this.effects.ring(p.x, p.z, POWER_UPS.shield.color, 1.8);
        this.hud.toast('🐚 Shell Shield!', POWER_UPS.shield.color);
        this.sfx.powerUp();
        break;
      case 'spring':
        this.zones.push({ id: this.nextZoneId++, kind: ZONE_SPRING, x: c.x, z: c.z, r: spell.radius, t: spell.duration, healed: false });
        this.effects.ring(c.x, c.z, SPRING_BLUE, spell.radius);
        this.effects.burst(c.x, 0.4, c.z, SPRING_BLUE, 20, 4, 0.1);
        this.sfx.spring();
        break;
      case 'calm': {
        const hit = this.enemies.calmAround(c.x, c.z, spell.radius, spell.duration);
        this.effects.ring(c.x, c.z, CALM_PINK, spell.radius);
        this.effects.burst(c.x, 1, c.z, CALM_PINK, 30, 5, 0.12);
        for (const s of hit) this.effects.burst(s.x, s.radius * 1.6, s.z, CALM_PINK, 5, 2, 0.1);
        this.sfx.calm();
        break;
      }
      case 'pounce':
        this.effects.burst(c.x, 0.3, c.z, new THREE.Color(0xb8a98f), 10, 3, 0.1);
        this.sfx.whoosh();
        break;
      case 'bubble':
        this.powers.add('shield');
        this.shieldHits = BUBBLE_HITS;
        this.effects.burst(p.x, 1.2, p.z, WATER_BLUE, 28, 5, 0.12);
        this.effects.ring(p.x, p.z, WATER_BLUE, 1.8);
        this.hud.toast(`🫧 Bubble Shield! (${BUBBLE_HITS} hits)`, 0x8fd4ff);
        this.sfx.bubble();
        break;
      case 'jet': {
        // A blast of water the way the goldfish faces: knocks foes back and drenches them (slowed).
        const h = this.companion.facing;
        const dx = Math.sin(h);
        const dz = Math.cos(h);
        for (const s of [...this.enemies.all]) {
          if (!s.alive || s.hidden || !inJet(c, h, s, s.radius)) continue;
          this.damage(s, dx, dz, JET.damage);
          s.shove(dx, dz, JET.shove);
          s.soak(spell.duration, JET.slow);
          this.effects.burst(s.x, s.radius, s.z, WATER_BLUE, 8, 4, 0.1);
        }
        for (let i = 1; i <= 6; i++) this.effects.burst(c.x + dx * i * 1.15, 0.7, c.z + dz * i * 1.15, WATER_BLUE, 8, 3 + i * 0.3, 0.12);
        this.sfx.jet();
        break;
      }
      case 'tongue': {
        // Yank the nearest enemy in reach over to the iguana, stunned; bosses only flinch.
        let prey: Enemy | null = null;
        let best: number = spell.radius;
        for (const s of this.enemies.all) {
          if (!s.alive || s.hidden) continue;
          const d = Math.hypot(s.x - c.x, s.z - c.z) - s.radius;
          if (d < best) {
            best = d;
            prey = s;
          }
        }
        const h = prey ? Math.atan2(prey.x - c.x, prey.z - c.z) : this.companion.facing;
        const reach = prey ? Math.hypot(prey.x - c.x, prey.z - c.z) : 3;
        for (let i = 1; i <= 8; i++) this.effects.burst(c.x + (Math.sin(h) * reach * i) / 8, 0.7, c.z + (Math.cos(h) * reach * i) / 8, TONGUE_PINK, 3, 1.5, 0.08);
        if (prey) {
          if (prey.bossName) prey.stun(TONGUE_BOSS_FLINCH);
          else {
            prey.shove(-Math.sin(h), -Math.cos(h), Math.max(0, reach - prey.radius - 1.2));
            prey.stun(spell.duration);
          }
          this.effects.burst(prey.x, prey.radius, prey.z, TONGUE_PINK, 10, 3, 0.1);
        }
        this.sfx.whoosh();
        this.events.push({ e: 'spell', id: SPELL_IDS.indexOf(id), x: q(c.x), z: q(c.z), h: q(h), d: q(reach) });
        return;
      }
      case 'ward':
        this.ward = spell.duration;
        this.effects.ring(p.x, p.z, JADE, spell.radius);
        this.effects.burst(p.x, 1, p.z, new THREE.Color(JADE), 24, 4, 0.1);
        this.hud.toast('💚 Jade Ward!', JADE);
        this.sfx.spring();
        break;
      case 'howl': {
        // Enemies around panic and run off (calmed: harmless, wandering away); bosses only flinch.
        const near = this.enemies.all.filter((s) => s.alive && !s.hidden && Math.hypot(s.x - c.x, s.z - c.z) <= spell.radius + s.radius);
        for (const s of near) {
          if (s.bossName) s.stun(HOWL_BOSS_FLINCH);
          else s.calm(spell.duration);
          this.effects.burst(s.x, s.radius * 1.6, s.z, HOWL_BLUE, 5, 2, 0.1);
        }
        this.effects.ring(c.x, c.z, HOWL_BLUE, spell.radius);
        this.effects.burst(c.x, 1.2, c.z, HOWL_BLUE, 30, 6, 0.12);
        // …and the elf, roused, shoots faster for a while.
        this.powers.add('rapid', HOWL_RAPID_SECONDS);
        const p = this.player.position;
        this.effects.burst(p.x, 1.1, p.z, new THREE.Color(POWER_UPS.rapid.color), 16, 4, 0.1);
        this.hud.toast(`🌕 War Howl! ${POWER_UPS.rapid.icon} ${POWER_UPS.rapid.label}`, POWER_UPS.rapid.color);
        this.sfx.howl();
        break;
      }
    }
    this.events.push({ e: 'spell', id: SPELL_IDS.indexOf(id), x: q(c.x), z: q(c.z), h: q(this.companion.facing) });
  }

  /** Soothing Spring pools slow enemies and heal the elf once; burning ground hurts while the elf stands in it. */
  private updateZones(dt: number): void {
    const p = this.player.position;
    let burning = 0; // damage per second from fire / poison underfoot
    for (const z of this.zones) {
      z.t -= dt;
      if (z.kind !== ZONE_SPRING) {
        if (Math.hypot(p.x - z.x, p.z - z.z) <= z.r + PLAYER_RADIUS * 0.5) burning = Math.max(burning, z.kind === ZONE_FIRE ? ELEMENTAL_ATTACKS.fire.burnDps : POISON.dps);
        continue;
      }
      for (const s of this.enemies.all) {
        if (Math.hypot(s.x - z.x, s.z - z.z) <= z.r + s.radius * 0.5) s.slow = Math.min(s.slow, SPRING_SLOW);
      }
      if (!z.healed && this.health < MAX_HEALTH && Math.hypot(p.x - z.x, p.z - z.z) <= z.r) {
        z.healed = true;
        this.heal(HEALING.spring);
        this.hud.toast(`♨️ +${HEALING.spring} HP`, 0x8fe8f5);
        this.effects.burst(p.x, 1.2, p.z, new THREE.Color(0xff4d5e), 14, 4, 0.12);
        this.sfx.powerUp();
        this.events.push({ e: 'heal', x: q(p.x), z: q(p.z) });
      }
    }
    this.zones = this.zones.filter((z) => z.t > 0);
    this.springPools.sync(this.zoneTuples(), dt, this.time);
    this.updateBurn(dt, this.player.dashing ? 0 : burning);
  }

  /** Standing in fire or poison: a few HP every half second (no knockback, no invulnerability). */
  private updateBurn(dt: number, dps: number): void {
    this.burnTick = Math.max(0, this.burnTick - dt);
    if (!dps) return;
    this.burn += dps * dt;
    if (this.burnTick > 0 || this.burn < 1) return;
    this.burnTick = 0.5;
    const amount = Math.floor(this.burn);
    this.burn -= amount;
    if (this.powers.has('shield')) return; // the shield keeps the flames off
    this.health -= scaledDamage(amount);
    this.hud.setHealth(Math.max(0, this.health));
    this.hud.flashHurt();
    const p = this.player.position;
    this.effects.burst(p.x, 0.6, p.z, new THREE.Color(PROJECTILES.fire.color), 6, 3, 0.1);
    this.events.push({ e: 'hurt' });
    if (this.health <= 0) this.gameOver();
  }

  private zoneTuples(): ZoneTuple[] {
    return this.zones.map((z) => [z.id, q(z.x), q(z.z), z.r, q(z.t), z.kind]);
  }

  /** A familiar connected or left. They pick a creature next (a 'choose' command); leaving poofs it away. */
  private familiarChanged(connected: boolean): void {
    if (!connected && this.companion.kind) {
      const kind = this.companion.kind;
      this.poof(kind);
      this.companion.disappear();
      this.hud.toast(`${FAMILIARS[kind].emoji} ${FAMILIARS[kind].name} left`, FAMILIARS[kind].color);
    }
    this.hud.setInviteStatus('open', connected, this.companion.kind);
  }

  private familiarCommand(cmd: FamiliarCommand): void {
    if (cmd.type === 'parade') {
      // Practice room only: one monster appears a little way off and behaves as it does in its room.
      const kind = ENEMY_KIND_LIST.find((k) => k === cmd.kind);
      if (!this.practice || !kind) return;
      const f = this.companion.present ? this.companion.position : this.player.position;
      const d = Math.hypot(f.x, f.z) || 1;
      const at = { x: f.x - (f.x / d) * 9, z: f.z - (f.z / d) * 9 }; // toward the middle of the room
      const e = this.enemies.showcase(kind, at.x, at.z);
      this.effects.ring(e.x, e.z, e.color, Math.max(1.5, e.radius * 1.5));
      this.effects.burst(e.x, 1, e.z, e.color, 24, 5, 0.12);
      this.events.push({ e: 'poof', x: q(e.x), z: q(e.z) });
      return;
    }
    if (cmd.type !== 'choose') {
      this.companion.command(cmd, this.dungeon.half);
      return;
    }
    // Creatures can be picked any time at first, but only swapped between runs / while paused.
    const running = this.state === 'playing' && this.player.isActive;
    if (this.companion.kind === cmd.kind || (this.companion.kind && running && !this.practice)) return;
    if (this.companion.kind) this.poof(this.companion.kind);
    const p = this.player.position;
    this.companion.appear(cmd.kind, p.x + 2, p.z + 2);
    this.poof(cmd.kind);
    const def = FAMILIARS[cmd.kind];
    this.hud.toast(`${def.emoji} ${def.name} joined!`, def.color);
    this.sfx.powerUp();
    this.hud.setInviteStatus('open', true, cmd.kind);
  }

  private poof(kind: FamiliarKind): void {
    const c = this.companion.position;
    const color = FAMILIARS[kind].color;
    this.effects.burst(c.x, 0.6, c.z, new THREE.Color(color), 30, 5, 0.14);
    this.effects.ring(c.x, c.z, color, 2.5);
    this.events.push({ e: 'poof', x: q(c.x), z: q(c.z) });
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
      ...(this.practice ? { practice: 1 } : {}),
      hero: { x: q(p.x), z: q(p.z), f: q(m.facing), s: q(m.speed), m: q(m.moveYaw), a: m.aiming ? 1 : 0, d: m.dashing ? 1 : 0, v: this.elf.group.visible ? 1 : 0, ...(this.invisible > 0 ? { i: 1 } : {}), ...(this.ward > 0 ? { w: 1 } : {}) },
      fam: c.kind
        ? { k: FAMILIAR_KINDS.indexOf(c.kind), x: q(c.position.x), z: q(c.position.z), h: q(c.facing), s: q(c.speed), y: q(c.height) }
        : null,
      slimes: this.enemies.all.map((s) => s.tuple()),
      arrows: this.arrows.snapshot(),
      globs: this.globs.snapshot(),
      pickups: this.pickups.snapshot(),
      zones: this.zoneTuples(),
      room: this.room,
      rw: this.waveInRoom,
      phase: this.phase,
      card: this.phase === 'transition' && this.doorSwitched ? this.room : -1,
      boss: this.bossState(),
      tels: this.telegraphTuples(),
      wave: this.wave,
      remaining: this.enemies.remaining,
      health: Math.max(0, this.health),
      maxHealth: MAX_HEALTH,
      score: this.score,
      powers: this.powers.list().map((pw) => [POWER_CODES.indexOf(pw.type), q(pw.remaining)]),
      cds: c.kind ? FAMILIARS[c.kind].spells.map((id) => [SPELL_IDS.indexOf(id), q(c.cooldowns.remaining(id))]) : [],
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

  private damage(slime: Enemy, dirX: number, dirZ: number, amount = HERO.arrowDamage): void {
    const killed = slime.hurt(amount, dirX, dirZ);
    const y = slime.radius;
    const big = slime.radius >= 1.2;
    if (killed) {
      this.score += Math.round(slime.score * DIFFICULTIES[difficulty()].score);
      this.hud.setScore(this.score);
      this.effects.burst(slime.x, y, slime.z, slime.color, big ? 40 : 22, big ? 8 : 6);
      this.sfx.splat(big);
      this.events.push({ e: 'splat', x: q(slime.x), z: q(slime.z), c: slime.color.getHex(), big });
      const drop = (slime as Enemy & { def?: { drop: number } }).def?.drop ?? 0; // each kind carries its own chance
      if (Math.random() < drop && this.pickups.count < MAX_PICKUPS + 1) {
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
    for (const s of this.enemies.all) {
      if (!s.alive || s.harmless) continue; // stunned, calmed or burrowed foes don't hurt
      const dx = p.x - s.x;
      const dz = p.z - s.z;
      const d = Math.hypot(dx, dz);
      if (d > s.radius + PLAYER_RADIUS) continue;

      this.hurtPlayer(s.touchDamage, dx / (d || 1), dz / (d || 1), s.touchKnock);
      s.onHitTarget();
      return;
    }
  }

  /** Random floor spawns, collecting, timers, the shield bubble and the HUD chips. */
  private updatePowerUps(dt: number): void {
    const p = this.player.position;
    this.powers.tick(dt);
    if (!this.powers.has('shield')) this.shieldHits = 0;

    this.nextPickup -= dt;
    if (this.nextPickup <= 0 && (this.wave > 0 || this.practice)) {
      // The practice room drops them much more often, to try them out.
      this.nextPickup = this.practice ? 3 + Math.random() * 2 : PICKUP_INTERVAL_MIN + Math.random() * (PICKUP_INTERVAL_MAX - PICKUP_INTERVAL_MIN);
      if (this.pickups.count < MAX_PICKUPS + (this.practice ? 1 : 0)) {
        const at = randomSpawnPoint(Math.random, this.dungeon.half, this.dungeon.obstacles, [p], 7);
        this.pickups.spawn(pickPowerUp(Math.random, this.health, MAX_HEALTH), at.x, at.z);
      }
    }

    // The elf and the familiar can both grab power-ups; either way they go to the elf.
    const collectors = this.companion.present && this.companion.height < 0.5 ? [p, this.companion.position] : [p];
    for (const { type, by } of this.pickups.update(dt, this.time, collectors)) this.applyPowerUp(type, by === 1);

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

  /** `byFamiliar`: the familiar grabbed it — a sparkle there too, and a toast saying so. */
  private applyPowerUp(type: PowerUpType, byFamiliar = false): void {
    const def = POWER_UPS[type];
    const p = this.player.position;
    if (byFamiliar) {
      const f = this.companion.position;
      this.effects.burst(f.x, 0.8, f.z, new THREE.Color(def.color), 14, 4, 0.1);
      this.events.push({ e: 'pickup', p: POWER_CODES.indexOf(type), x: q(f.x), z: q(f.z), fam: 1 });
    }
    if (type === 'heart') {
      if (this.health < MAX_HEALTH) this.health = Math.min(MAX_HEALTH, this.health + HEALING.heartPickup);
      else this.score += 25; // full health: a little score instead
      this.hud.setHealth(this.health);
      this.hud.setScore(this.score);
    } else {
      this.powers.add(type);
    }
    const who = byFamiliar && this.companion.kind ? `${FAMILIARS[this.companion.kind].emoji} ` : '';
    this.hud.toast(`${who}${def.icon} ${def.label}!`, def.color);
    this.effects.burst(p.x, 1.1, p.z, new THREE.Color(def.color), 18, 5, 0.12);
    this.sfx.powerUp();
    this.events.push({ e: 'pickup', p: POWER_CODES.indexOf(type), x: q(p.x), z: q(p.z) });
  }

  private updateGlobs(dt: number): void {
    const p = this.player.position;
    const canBeHit = this.invulnerable === 0 && !this.player.dashing;
    const target = canBeHit ? { x: p.x, z: p.z, radius: PLAYER_RADIUS } : null;
    for (const hit of this.globs.update(dt, this.time, target, this.dungeon.obstacles, this.dungeon.half)) {
      this.effects.burst(hit.x, 1, hit.z, new THREE.Color(PROJECTILES[hit.kind].color), 10, 4, 0.12);
      this.events.push({ e: 'glob', x: q(hit.x), z: q(hit.z), k: PROJECTILE_KINDS.indexOf(hit.kind) });
      if (hit.kind === 'fire') this.igniteGround(hit);
      if (!hit.hitPlayer) continue;
      const dx = p.x - hit.x;
      const dz = p.z - hit.z;
      const d = Math.hypot(dx, dz) || 1;
      this.projectileHit(hit, dx / d, dz / d);
    }
  }

  /** What each kind of bolt does when it hits the elf. */
  private projectileHit(hit: GlobImpact, dirX: number, dirZ: number): void {
    const shielded = this.powers.has('shield');
    switch (hit.kind) {
      case 'acid': {
        const a = MONSTER_SHOTS.acid;
        this.hurtPlayer(a.damage, dirX, dirZ);
        if (!shielded) this.player.slow(a.slowSeconds, a.slowFactor);
        break;
      }
      case 'rivet':
      case 'arrow':
      case 'soul':
      case 'magic':
        this.hurtPlayer(MONSTER_SHOTS[hit.kind], dirX, dirZ);
        break;
      case 'gust':
        this.hurtPlayer(ELEMENTAL_ATTACKS.gust.damage, dirX, dirZ, ELEMENTAL_ATTACKS.gust.knock);
        break;
      case 'water': {
        const w = ELEMENTAL_ATTACKS.water;
        this.hurtPlayer(w.damage, dirX, dirZ);
        if (!shielded) this.player.slow(w.slowSeconds, w.slowFactor);
        break;
      }
      case 'fire':
        this.hurtPlayer(ELEMENTAL_ATTACKS.fire.damage, dirX, dirZ);
        break;
    }
  }

  /** A fireball leaves a patch of burning ground where it bursts. */
  private igniteGround(hit: GlobImpact): void {
    const f = ELEMENTAL_ATTACKS.fire;
    this.addHazard(ZONE_FIRE, hit.x, hit.z, f.burnRadius);
  }

  /** Burning or poisonous ground that hurts while the elf stands in it. */
  private addHazard(kind: number, x: number, z: number, r: number): void {
    const t = kind === ZONE_FIRE ? ELEMENTAL_ATTACKS.fire.burnSeconds : POISON.seconds;
    this.zones.push({ id: this.nextZoneId++, kind, x, z, r, t, healed: true });
  }

  private hurtPlayer(amount: number, dirX: number, dirZ: number, knock = 16): void {
    const p = this.player.position;
    if (this.powers.has('shield')) {
      // The shield takes the hit instead (a Bubble Shield holds for a second one).
      this.shieldHits--;
      if (this.shieldHits <= 0) this.powers.end('shield');
      this.invulnerable = 0.8;
      this.player.knockback(dirX, dirZ, 10);
      this.effects.burst(p.x, 1.2, p.z, new THREE.Color(POWER_UPS.shield.color), 24, 6, 0.14);
      this.sfx.shieldBreak();
      this.events.push({ e: 'shield', x: q(p.x), z: q(p.z) });
      return;
    }
    this.health -= scaledDamage(amount);
    this.invulnerable = HERO.hurtInvulnerable;
    this.player.knockback(dirX, dirZ, knock);
    this.hud.setHealth(Math.max(0, this.health));
    this.hud.flashHurt();
    this.sfx.hurt();
    this.events.push({ e: 'hurt' });
    if (this.health <= 0) this.gameOver();
  }

  /** Jade Ward: heal the elf while it lasts, slow enemies inside the circle (which follows the elf). */
  private updateWard(dt: number): void {
    this.ward = Math.max(0, this.ward - dt);
    this.wardRing.visible = this.ward > 0;
    if (!this.ward) return;
    const p = this.player.position;
    this.wardRing.position.set(p.x, 0, p.z);
    this.wardRing.rotation.y += dt * 0.6;
    const before = Math.ceil(this.health);
    this.health = Math.min(MAX_HEALTH, this.health + WARD.heal * dt);
    if (Math.ceil(this.health) !== before) this.hud.setHealth(this.health);
    const r = SPELLS.ward.radius;
    for (const s of this.enemies.all) if (Math.hypot(s.x - p.x, s.z - p.z) <= r + s.radius * 0.5) s.slow = Math.min(s.slow, WARD.slow);
  }

  /** Uses whatever's in action slot `slot` (keys 1-9 by default, or a tap on the bar). */
  private useSlot(slot: number): void {
    const running = this.state === 'playing' && this.player.isActive;
    const id = this.hud.actionBar.ability(slot);
    if (!running || !id) return;
    if (id === 'dash') {
      this.player.queueDash(); // paid for when it happens (canDash)
      return;
    }
    if (id === 'windwalk') {
      if (this.invisible > 0 || !this.resources.spend('windwalk')) return;
      this.invisible = WIND_WALK_SECONDS;
      this.vanishSpot.copy(this.player.position);
      const p = this.player.position;
      this.effects.burst(p.x, 1.1, p.z, new THREE.Color(0xdff4ff), 26, 5, 0.12);
      this.effects.ring(p.x, p.z, 0xdff4ff, 2);
      this.sfx.whoosh();
      this.hud.toast('🌬️ Wind Walk', 0xdff4ff);
    }
  }

  /** The hero pressed Start (Enter / the button): the first wave comes. */
  private beginFight(): void {
    if (this.state !== 'playing' || this.phase !== 'ready') return;
    this.phase = 'fight';
    this.waveBreak = 0.8;
    this.hud.setStartPrompt(false);
    this.banner('⚔️ Here they come!');
    this.sfx.wave();
  }

  /** Waves within a room; when all three are done, the north door opens (or, in the last room, you win). */
  private updateWaves(dt: number): void {
    this.hud.setWave(runLabel(this.room, this.waveInRoom, this.enemies.remaining, this.phase, this.enemies.boss?.bossName ?? null));
    this.hud.setStartPrompt(this.phase === 'ready');
    if (this.phase === 'ready') return; // nothing comes until the hero starts
    if (this.phase === 'transition') {
      this.updateDoor(dt);
      return;
    }
    if (this.phase === 'cleared') {
      const p = this.player.position;
      if (this.dungeon.inExit(p.x, p.z)) this.enterDoor();
      return;
    }
    if (this.enemies.remaining > 0) return;
    if (this.waveBreak <= 0) {
      // Wave cleared: breather, and a heart back.
      this.waveBreak = WAVE_BREAK;
      if (this.waveInRoom > 0) {
        this.heal(HEALING.waveClear);
        if (this.waveInRoom >= ROOMS[this.room].waves.length) {
          if (!ROOMS[this.room].hasExit) {
            this.victory();
            return;
          }
          this.phase = 'cleared';
          this.dungeon.setExitOpen(true);
          this.banner('Room cleared!');
          this.hud.toast('↑ Head through the north door', 0xffe0a0);
          this.sfx.door();
          this.events.push({ e: 'door' });
          return;
        }
        this.banner(`Wave ${this.waveInRoom} cleared`);
      }
      return;
    }
    this.waveBreak -= dt;
    if (this.waveBreak <= 0) this.startNextWave();
  }

  private startNextWave(): void {
    this.waveInRoom++;
    this.wave++;
    const room = ROOMS[this.room];
    const w = room.waves[Math.min(this.waveInRoom, room.waves.length) - 1];
    const at = { x: 0, z: -this.dungeon.half + 8 };
    const boss = this.enemies.startRoomWave(w, at.x, at.z);
    if (boss) {
      const color = boss.color.getHex();
      this.effects.ring(at.x, at.z, color, 5);
      this.effects.burst(at.x, 2, at.z, boss.color, 50, 9, 0.2);
      this.banner(`⚔️ ${boss.bossName}!`);
      this.sfx.burst();
    } else {
      this.banner(`Wave ${this.waveInRoom}/${room.waves.length}`);
    }
    this.sfx.wave();
  }

  private heal(amount: number): void {
    this.health = Math.min(MAX_HEALTH, this.health + amount);
    this.hud.setHealth(this.health);
  }

  /** The elf stepped through the open north door: fade out, build the next room, fade in. */
  private enterDoor(): void {
    this.phase = 'transition';
    this.doorT = 0;
    this.doorSwitched = false;
    this.cardSkip = false;
    this.hud.fade.set(true);
    this.sfx.whoosh();
  }

  private updateDoor(dt: number): void {
    this.doorT += dt;
    if (!this.doorSwitched && this.doorT >= DOOR_FADE) {
      this.doorSwitched = true;
      this.loadRoom(this.room + 1);
      this.enemies.clear();
      this.arrows.clear();
      this.globs.clear();
      this.pickups.clear();
      this.zones = [];
      this.springPools.sync([], 0, 0);
      this.effects.clear();
      const e = this.dungeon.entry;
      this.player.spawn(e.x, e.z, 0);
      if (this.companion.kind) this.companion.appear(this.companion.kind, e.x + 2.5, e.z + 0.5);
      this.heal(MAX_HEALTH); // a fresh start in every room
      this.waveInRoom = 0;
      this.waveBreak = 2.2;
      this.nextPickup = 8;
      this.cardSkip = false;
      this.hud.fade.set(true, this.room);
    }
    if (this.doorT >= DOOR_TOTAL || (this.cardSkip && this.doorT >= CARD_SKIP_AFTER)) {
      // A new run waits in the first room until the hero presses Start; later rooms go straight in.
      this.phase = this.wave === 0 ? 'ready' : 'fight';
      this.hud.fade.set(false);
      this.banner(`Room ${this.room + 1} · ${ROOMS[this.room].name}`);
    }
  }

  /** Orc shamans patching up their friends: a green ring (and green sparkles on those healed). */
  private showHealPulses(): void {
    for (const s of this.enemies.all) {
      if (!(s instanceof Monster) || !s.healPulse) continue;
      const h = s.healPulse;
      this.effects.ring(h.x, h.z, HEAL_GREEN, h.r);
      this.effects.burst(h.x, 1.5, h.z, new THREE.Color(HEAL_GREEN), 16, 4, 0.1);
      this.events.push({ e: 'ring', x: q(h.x), z: q(h.z), r: h.r, c: HEAL_GREEN });
    }
  }

  /** An enemy's area attack lands (a slam, a pound, a lunge, a swipe): the elf is hit if inside (dashing dodges it). */
  private enemyStrike(s: Strike): void {
    const big = s.r >= 3;
    const red = new THREE.Color(0xc0303a);
    if (big) {
      this.effects.ring(s.x, s.z, red, s.r);
      this.effects.burst(s.x, 0.4, s.z, red, 40, 8, 0.18);
      this.sfx.land();
    } else {
      this.effects.burst(s.x, 0.6, s.z, new THREE.Color(0xffffff), 8, 3, 0.1);
    }
    this.events.push({ e: 'slam', x: q(s.x), z: q(s.z), r: s.r });
    if (s.zone) this.addHazard(s.zone === 'fire' ? ZONE_FIRE : ZONE_POISON, s.x, s.z, s.r * 0.85);
    const p = this.player.position;
    const d = Math.hypot(p.x - s.x, p.z - s.z);
    if (d <= s.r + PLAYER_RADIUS && this.invulnerable === 0 && !this.player.dashing) {
      const shielded = this.powers.has('shield');
      this.hurtPlayer(s.damage, (p.x - s.x) / (d || 1), (p.z - s.z) / (d || 1), s.knock);
      if (s.slow && !shielded) this.player.slow(s.slow.seconds, s.slow.factor);
    }
  }

  private bossState(): Snapshot['boss'] {
    const b = this.enemies.boss;
    return b ? { hp: Math.max(0, b.hp), max: b.maxHp, name: b.bossName! } : null;
  }

  private telegraphTuples(): Snapshot['tels'] {
    return this.enemies.telegraphs.map((t) => [q(t.x), q(t.z), t.r, q(t.p)]);
  }

  private syncBoss(): void {
    this.hud.bossBar.set(this.bossState());
    this.telegraph.sync(this.telegraphTuples(), this.time);
  }

  private victory(): void {
    this.state = 'won';
    this.elf.group.visible = true;
    this.score += Math.max(0, this.health) * VICTORY_SCORE_PER_HP; // a bonus for health left
    this.hud.setScore(this.score);
    const run = { score: this.score, wave: this.wave };
    const isBest = recordRun(run);
    this.hud.bossBar.set(null);
    this.hud.showVictory(this.score, this.playTime, isBest);
    this.hud.setBest(loadBest() ?? run);
    this.sfx.wave();
    this.events.push({ e: 'banner', text: '👑 Victory!' });
    this.player.deactivate();
  }

  private gameOver(): void {
    if (this.practice) {
      // The practice room: the elf can't die — back to full health.
      this.health = MAX_HEALTH;
      this.hud.setHealth(this.health);
      const p = this.player.position;
      this.effects.burst(p.x, 1.2, p.z, new THREE.Color(0xff4d5e), 20, 5, 0.12);
      this.events.push({ e: 'heal', x: q(p.x), z: q(p.z) });
      return;
    }
    this.state = 'over';
    this.elf.group.visible = true;
    const run = { score: this.score, wave: this.wave };
    const isBest = recordRun(run);
    this.hud.showGameOver(this.wave, this.score, isBest);
    this.hud.setBest(loadBest() ?? run);
    this.player.deactivate();
  }

  private resize(): void {
    if (this.headless) return; // the canvas belongs to the familiar's view
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }
}
