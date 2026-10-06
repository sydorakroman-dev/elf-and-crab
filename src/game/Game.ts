import * as THREE from 'three';
import { Dungeon } from '../world/dungeon';
import { generateLevel, type Level } from '../world/levelgen';
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
import { DOUBLE_GAP, DOUBLE_SHOTS, Resources, WIND_WALK_SECONDS } from './abilities';
import { DIFFICULTIES, difficulty, scaledDamage } from './difficulty';
import { DamageNumbers } from './numbers';
import { AutoQuality } from '../ui/quality';
import { reachRoom, recordWin } from './progress';
import { SEAL_RIDDLES, makeRiddle, type Riddle } from './riddles';
import { ENEMY_KIND_LIST } from './enemyKinds';
import type { FamiliarCommand } from '../net/protocol';
import { pickAimTarget, walkMap } from './combat';
import { fireAmbience } from './ambience';
import { Hud } from '../ui/hud';
import { Minimap } from '../ui/minimap';
import { InventoryPanel } from '../ui/inventory';
import { Sfx } from './audio';
import { loadBest, recordRun } from './highscore';
import { ActivePowers, POWER_UPS, pickPowerUp, randomSpawnPoint, spreadDirections, type PowerUpType } from './powerups';
import { Pickups, type Collected } from './pickups';
import { ELF_SPELLS, FIRST_SPELL_SLOT, SPELL_POWER, Spellbook, spellCost, spellTitle, type SpellKey } from './spells';
import { chestLoot, rollLoot, tierOf, type Drop } from './loot';
import { Inventory, makeStock, type InvOp, type StockEntry } from './inventory';
import { POTIONS, RARITY_INFO, makeItem, makePotion, type BagEntry } from './items';
import { ENCHANT_CHAIN, ENCHANT_FIRE, ENCHANT_FROST, type ArrowHit } from './arrows';
import type { HeroLink } from '../net/client';
import { POWER_CODES, q, type GameEvent, type Snapshot } from '../net/snapshot';

const STEP = 1 / 60; // fixed simulation step
const MAX_FRAME = 0.1; // clamp long frames (tab switches) so physics doesn't explode
const FIRE_INTERVAL = 0.36;
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
  /** This run's current level (regenerated, with a new seed, every time you enter one). */
  private level!: Level;
  /** The guardian's health bar has been announced. */
  private bossAnnounced = false;
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
  private readonly minimap: Minimap;
  private readonly bagPanel: InventoryPanel;
  /** The merchant's wares while the party is at the camp between levels. */
  private shop: StockEntry[] | null = null;
  /** What the familiar's tablet last got (inventory version, shop state). */
  private sentInv = -1;
  private sentShop = '';
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
  private health: number = HERO.maxHp;
  private score = 0;
  private wave = 0;
  private fireCooldown = 0;
  private invulnerable = 0;
  /** Seconds since the elf last took a hit (resting heals). */
  private sinceHurt = 0;
  /** Jade Ward: seconds left on the healing circle around the elf (and its mesh). */
  private ward = 0;
  private readonly wardRing: THREE.Group;
  /** Floating damage numbers, camera shake (metres, decays), and hit-stop (seconds the action freezes). */
  private readonly numbers = new DamageNumbers();
  private quality!: AutoQuality;
  private shake = 0;
  private hitStop = 0;
  private readonly shakeOffset = new THREE.Vector3();
  /** Rune Seal on the exit door (familiar's riddles), and how many are solved. */
  private riddle: Riddle | null = null;
  private sealSolved = 0;
  /** Wrong answers so far on this seal (the familiar's view uses it to say the riddle changed). */
  private sealMisses = 0;
  /** Double Shot: charged shots left. */
  private doubleShots = 0;
  /** Spells learned from books this run, and the party's gold. */
  private readonly spellbook = new Spellbook();
  /** Gear, the 16-slot bag and the gold purse (shared by the elf and the familiar). */
  private readonly inv = new Inventory();
  /** Stats from what the elf and the familiar wear (recomputed when the gear changes). */
  private heroGear = this.inv.heroStats();
  private famGear = this.inv.familiarStats();
  private gearVersion = -1;
  /** Arrow enchantments waiting: shots left, and the rank they were cast at. */
  private readonly enchants: Record<'fire' | 'frost' | 'chain', { shots: number; rank: number }> = {
    fire: { shots: 0, rank: 1 },
    frost: { shots: 0, rank: 1 },
    chain: { shots: 0, rank: 1 },
  };
  /** Healing Bloom (seconds left, health per second) and Bark Skin (seconds left, share of damage taken away). */
  private bloom = { left: 0, rate: 0 };
  private bark = { left: 0, reduce: 0 };
  /** Chests opened in this level (bit i: chest i). */
  private chestsOpened = 0;
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
    this.level = this.makeLevel(0);
    this.dungeon = new Dungeon(this.scene, ROOMS[0], this.level, this.shadowSize);
    this.arena = { wallHeight: this.dungeon.wallHeight, obstacles: this.dungeon.obstacles };
    this.enemies = new Enemies();
    this.companion = new Companion(familiars);
    this.shieldBubble = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.25, 2),
      new THREE.MeshBasicMaterial({ color: POWER_UPS.shield.color, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.shieldBubble.visible = false;
    this.wardRing = jadeRing(SPELLS.ward.radius);
    this.scene.add(this.wardRing, this.numbers.group);
    this.scene.add(...Object.values(familiars).map((b) => b.group));
    this.scene.add(elf.group, this.springPools.group, this.enemies.group, this.arrows.group, this.globs.group, this.pickups.group, this.shieldBubble, this.effects.mesh, this.effects.rings, this.telegraph.group);

    this.player = new Player(
      this.camera,
      this.headless ? document.createElement('canvas') : renderer.domElement, // headless: no mouse capture
      elf,
      this.arena,
      mode,
    );

    this.hud = new Hud(root, HERO.maxHp, mode, () => {
      this.sfx.unlock();
      if (this.state !== 'playing') this.newGame(this.hud.startRoom);
      this.banner(`${ROOMS[this.room].name}`);
      this.player.activate();
    }, () => this.beginFight());
    this.minimap = new Minimap(root);
    this.bagPanel = new InventoryPanel(root, 'hero');
    this.bagPanel.onAction = (req) => this.applyInv(req, false);
    this.bagPanel.onClose = () => this.closeBag();
    this.bagPanel.onContinue = () => this.leaveShop();
    this.hud.actionBar.onBag = () => this.toggleBag();
    this.minimap.setLevel(this.level.map);
    if (mode === 'touch') this.touch = new TouchControls(root, this.player);
    this.player.onActiveChange = (active) => {
      if (!active && this.bagPanel.isOpen) return; // the bag or the merchant took the mouse
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
      else if ((e.code === 'KeyI' || e.code === 'KeyB') && !e.repeat && !this.hud.actionBar.rebinding) this.toggleBag();
      else if ((e.code === 'KeyQ' || e.code === 'KeyE') && !e.repeat && this.state === 'playing') this.quickPotion(e.code === 'KeyQ' ? 'health' : 'mana');
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

  /** Starts a run in room `start` (0: the Woodland; later rooms once reached — "continue"). */
  private newGame(start = 0): void {
    const room = Math.max(0, Math.min(ROOMS.length - 1, start));
    this.loadRoom(room); // a freshly generated level every run
    this.resetWorld();
    this.state = 'playing';
    this.health = this.maxHealth;
    this.resources.reset();
    this.invisible = 0;
    this.doubleShots = 0;
    this.hud.actionBar.setCharges('doubleshot', 0);
    this.spellbook.clear();
    for (let i = 0; i < 6; i++) {
      this.hud.actionBar.setSlot(FIRST_SPELL_SLOT + i, null);
      this.hud.actionBar.setSlotCharges(FIRST_SPELL_SLOT + i, 0);
    }
    for (const e of Object.values(this.enchants)) e.shots = 0;
    this.bloom.left = this.bark.left = 0;
    this.inv.clear();
    this.refreshGear();
    this.ward = 0;
    this.riddle = null;
    this.elf.setGhost(false);
    this.elf.setPose('none');
    this.score = 0;
    this.wave = 0;
    // Open on the Woodland's intro card.
    this.phase = 'transition';
    this.doorT = DOOR_FADE;
    this.doorSwitched = true;
    this.cardSkip = false;
    this.hud.fade.set(true, room);
    this.invulnerable = 0;
    this.playTime = 0;
    this.dungeon.setExitOpen(false);
    this.hud.setHealth(this.health);
    this.hud.setScore(this.score);
  }

  /** A new level `index` with a fresh seed (the practice room: one plain hall). */
  private makeLevel(index: number): Level {
    const theme = this.practice ? { ...ROOMS[index], layout: 'practice' as const } : ROOMS[index];
    return generateLevel(theme, (Math.random() * 2 ** 32) >>> 0);
  }

  /** Swaps in level `index`: generates and builds it, points everything at its walls and obstacles, places its packs. */
  private loadRoom(index: number): void {
    this.dungeon.dispose(this.scene);
    this.room = index;
    this.level = this.makeLevel(index);
    this.dungeon = new Dungeon(this.scene, ROOMS[index], this.level, this.shadowSize);
    this.arena.wallHeight = this.dungeon.wallHeight;
    this.arena.obstacles = this.dungeon.obstacles;
    this.enemies.clear();
    this.enemies.spawnPacks(this.level.packs, this.dungeon.obstacles);
    this.bossAnnounced = false;
    this.chestsOpened = 0;
    this.minimap?.setLevel(this.level.map);
  }

  private frame(timestamp: number): void {
    this.timer.update(timestamp);
    const real = Math.min(this.timer.getDelta(), MAX_FRAME);
    if (this.hitStop > 0) this.hitStop = Math.max(0, this.hitStop - real); // the action freezes for a beat
    else this.accumulator += real;
    while (this.accumulator >= STEP) {
      this.update(STEP);
      this.accumulator -= STEP;
    }
    this.numbers.update(real);
    if (!this.headless) (this.quality ??= new AutoQuality(this.renderer)).frame(real);
    // Music: the room's theme while a run is on (the boss version while one is out), silent on the title.
    this.sfx.music.play(this.state === 'playing' || this.state === 'won' ? this.room : -1, !!this.enemies.boss && this.state === 'playing');
    this.sfx.music.update();
    if (!this.headless) {
      // Walls and trees between the camera and the elf fade out.
      this.dungeon.fadeBetween(this.camera.position, this.player.position, real);
      // Camera shake: a jitter that fades out (applied only for this render).
      this.shake = Math.max(0, this.shake - real * 2.2);
      this.shakeOffset.set((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
      this.camera.position.add(this.shakeOffset);
      this.renderer.render(this.scene, this.camera);
      this.camera.position.sub(this.shakeOffset);
    }
    this.onFrame?.();
  }

  private update(dt: number): void {
    this.time += dt;
    this.dungeon.update(this.time, dt, this.player.position);
    this.updateAmbience(dt);
    // The bag pauses a solo game; with a familiar along (or at the merchant) the game keeps going.
    const menu = this.bagPanel.isOpen && (this.phase === 'shop' || !!this.net?.familiarConnected);
    const running = this.state === 'playing' && (this.player.isActive || this.practice || menu);
    if (this.inv.version !== this.gearVersion) this.refreshGear();
    this.steps++;
    if (this.net?.familiarConnected && this.steps % (running ? SNAPSHOT_EVERY : IDLE_SNAPSHOT_EVERY) === 0) {
      this.net.sendSnapshot(this.snapshot(running));
    }
    this.hud.actionBar.setVisible(running && !this.headless);
    this.setBagButton(this.state === 'playing' && !this.headless && !this.practice);
    this.minimap.setVisible(running && !this.headless && !this.practice);
    if (running) this.updateMinimap(dt);
    if (!running) {
      // Paused / title / game over: keep the scene alive but frozen.
      this.player.update(0, false);
      this.elf.updatePose(dt); // the death fall / victory pose keeps playing
      return;
    }

    this.resources.tick(dt);
    this.updateWard(dt);
    this.invisible = Math.max(0, this.invisible - dt);
    this.elf.setGhost(this.invisible > 0);
    this.hud.actionBar.update(this.resources);
    this.player.update(dt, !this.bagPanel.isOpen);
    this.playTime += dt;
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.elf.group.visible = this.invulnerable === 0 || Math.floor(this.time * 16) % 2 === 0;

    this.shoot(dt);
    this.updateZones(dt);
    // Wind Walk: enemies lose track and head for the spot where the elf vanished.
    const seen = this.invisible > 0 ? this.vanishSpot : this.player.position;
    // Nothing stirs before the hero starts, or while walking between levels.
    const still = !this.practice && (this.phase === 'ready' || this.phase === 'transition' || this.phase === 'shop');
    const { spits, strikes } = still ? { spits: [], strikes: [] } : this.enemies.update(dt, seen, this.dungeon.obstacles);
    for (const spit of spits) {
      this.globs.fire(spit);
      this.sfx.spit();
      this.events.push({ e: 'spit' });
    }
    for (const strike of strikes) this.enemyStrike(strike);
    if (this.steps % 6 === 0) this.enemies.cull(this.player.position, 50);
    this.showHealPulses();
    this.syncBoss();
    this.updateGlobs(dt);

    for (const hit of this.arrows.update(dt, this.enemies.all, this.dungeon.obstacles)) {
      this.damage(hit.slime, hit.dirX, hit.dirZ, this.arrowDamage());
      if (hit.enchant) this.enchantHit(hit);
    }

    this.updateFamiliar(dt);
    this.rest(dt);
    this.updateBlessings(dt);

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
    if (this.phase === 'ready' && !this.practice) return; // nothing to shoot at until the hero starts
    if (!this.player.trigger || this.fireCooldown > 0) return;
    this.fireCooldown = (this.powers.has('rapid') ? FIRE_INTERVAL / 2 : FIRE_INTERVAL) / (1 + this.heroGear.attackSpeed);
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
    // Double Shot: each arrow gets a twin flying parallel beside it.
    const twin = this.doubleShots > 0;
    if (twin) {
      this.doubleShots--;
      this.hud.actionBar.setCharges('doubleshot', this.doubleShots);
    }
    const enchant = this.takeEnchant();
    for (const d of spreadDirections(dir.x, dir.z, count, MULTISHOT_SPREAD)) {
      if (!twin) {
        this.arrows.fire(p.x + d.x * 0.6, p.z + d.z * 0.6, d, pierce, enchant);
        continue;
      }
      const sx = d.z * (DOUBLE_GAP / 2); // sideways (perpendicular to the shot)
      const sz = -d.x * (DOUBLE_GAP / 2);
      for (const k of [-1, 1]) this.arrows.fire(p.x + d.x * 0.6 + sx * k, p.z + d.z * 0.6 + sz * k, d, pierce, enchant);
    }
    this.sfx.twang();
    this.events.push({ e: 'twang' });
  }

  /** The familiar's creature: walking, biting, and whatever spells went off this step. */
  private updateFamiliar(dt: number): void {
    const r = this.companion.update(dt, this.enemies.all, this.dungeon.obstacles);
    const c = this.companion.position;
    const push = (s: Enemy, amount: number) => {
      const dx = s.x - c.x;
      const dz = s.z - c.z;
      const d = Math.hypot(dx, dz) || 1;
      this.damage(s, dx / d, dz / d, amount * (1 + this.famGear.famPower));
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
          this.damage(s, dx, dz, JET.damage * (1 + this.famGear.famPower));
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
      if (!z.healed && this.health < this.maxHealth && Math.hypot(p.x - z.x, p.z - z.z) <= z.r) {
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
    if (!connected && this.riddle) {
      // Nobody left to solve it: the runes fade.
      this.riddle = null;
      if (this.phase === 'cleared' && !this.practice) this.openDoor();
    }
    if (!connected && this.companion.kind) {
      const kind = this.companion.kind;
      this.poof(kind);
      this.companion.disappear();
      this.hud.toast(`${FAMILIARS[kind].emoji} ${FAMILIARS[kind].name} left`, FAMILIARS[kind].color);
    }
    this.hud.setInviteStatus('open', connected, this.companion.kind);
  }

  private familiarCommand(cmd: FamiliarCommand): void {
    if (cmd.type === 'answer') {
      this.answerRiddle(cmd.value);
      return;
    }
    if (cmd.type === 'riddle') {
      // Practice room: try a seal any time (there's no door to open there).
      if (this.practice && !this.riddle) {
        this.riddle = makeRiddle();
        this.sealSolved = 0;
        this.sealMisses = 0;
      }
      return;
    }
    if (cmd.type === 'parade') {
      // Practice room only: one monster appears a little way off and behaves as it does in its room.
      const kind = ENEMY_KIND_LIST.find((k) => k === cmd.kind);
      if (!this.practice || !kind) return;
      const f = this.companion.present ? this.companion.position : this.player.position;
      const d = Math.hypot(f.x, f.z) || 1;
      const at = walkMap().nearestFloor(f.x - (f.x / d) * 9, f.z - (f.z / d) * 9); // toward the middle of the room
      const e = this.enemies.showcase(kind, at.x, at.z);
      this.effects.ring(e.x, e.z, e.color, Math.max(1.5, e.radius * 1.5));
      this.effects.burst(e.x, 1, e.z, e.color, 24, 5, 0.12);
      this.events.push({ e: 'poof', x: q(e.x), z: q(e.z) });
      return;
    }
    if (cmd.type === 'inv') {
      this.applyInv(cmd.req, true);
      return;
    }
    if (cmd.type !== 'choose') {
      this.companion.command(cmd);
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
      // Only the monsters near either player (a level is big).
      slimes: this.enemies.all.filter((s) => this.nearPlayers(s.x, s.z, 48)).map((s) => s.tuple()),
      arrows: this.arrows.snapshot(),
      globs: this.globs.snapshot(),
      pickups: this.pickups.snapshot(),
      zones: this.zoneTuples(),
      room: this.room,
      rw: 0,
      lvl: this.level.seed,
      phase: this.phase,
      card: this.phase === 'transition' && this.doorSwitched ? this.room : -1,
      ...(this.riddle ? { rid: { a: this.riddle.a, op: this.riddle.op, b: this.riddle.b, c: this.riddle.choices, n: this.sealSolved, t: SEAL_RIDDLES, m: this.sealMisses } } : {}),
      boss: this.bossState(),
      tels: this.telegraphTuples(),
      wave: this.wave,
      remaining: this.enemies.remaining,
      health: Math.max(0, this.health),
      maxHealth: this.maxHealth,
      score: this.score,
      gold: this.inv.gold,
      ...this.invForSnapshot(),
      ch: this.chestsOpened,
      powers: this.powers.list().map((pw) => [POWER_CODES.indexOf(pw.type), q(pw.remaining)]),
      cds: c.kind ? FAMILIARS[c.kind].spells.map((id) => [SPELL_IDS.indexOf(id), q(c.cooldowns.remaining(id))]) : [],
      ev: this.events,
    };
    this.events = [];
    return snap;
  }

  /** Out of a fight for a few seconds (nobody hunting nearby), the elf gets health back. */
  private rest(dt: number): void {
    this.sinceHurt += dt;
    if (this.sinceHurt < HEALING.restAfter || this.health >= this.maxHealth || this.health <= 0) return;
    const p = this.player.position;
    if (this.enemies.all.some((s) => s.alive && !this.enemies.isAsleep(s) && Math.hypot(s.x - p.x, s.z - p.z) < 24)) return;
    const before = Math.floor(this.health);
    this.health = Math.min(this.maxHealth, this.health + HEALING.rest * dt);
    if (Math.floor(this.health) !== before) this.hud.setHealth(this.health);
  }

  private updateMinimap(dt: number): void {
    const p = this.player.position;
    const c = this.companion;
    const e = this.level.exit;
    const bossHall = this.level.halls.find((h) => h.kind === 'boss');
    this.minimap.update(dt, {
      hero: { x: p.x, z: p.z, facing: this.player.motion.facing },
      familiar: c.present ? c.position : null,
      exit: e ? { ...e, open: this.dungeon.exitTarget === 1 } : null,
      chests: this.level.chests,
      boss: bossHall && this.enemies.guardianAlive ? bossHall : null,
    });
  }

  /** Is (x, z) within `range` m of the elf or the familiar? */
  private nearPlayers(x: number, z: number, range: number): boolean {
    const p = this.player.position;
    if (Math.hypot(x - p.x, z - p.z) < range) return true;
    const c = this.companion;
    return c.present && Math.hypot(x - c.position.x, z - c.position.z) < range;
  }

  /** Big banner on the hero's screen, mirrored on the familiar's. */
  private banner(text: string): void {
    this.hud.banner(text);
    this.events.push({ e: 'banner', text });
  }

  private damage(slime: Enemy, dirX: number, dirZ: number, amount = HERO.arrowDamage): void {
    if (this.phase === 'ready' && !this.practice) return; // monsters can't be hurt before the start
    const hpBefore = slime.hp;
    const killed = slime.hurt(amount, dirX, dirZ);
    const y = slime.radius;
    const big = slime.radius >= 1.2;
    const dealt = Math.max(0, hpBefore - Math.max(0, slime.hp));
    if (dealt > 0) {
      const heavy = amount >= 20;
      this.numbers.show(dealt, slime.x, y * 1.6 + 1, slime.z, heavy ? 'big' : 'hit');
      this.events.push({ e: 'num', x: q(slime.x), y: q(y * 1.6 + 1), z: q(slime.z), n: Math.round(dealt), k: heavy ? 1 : 0 });
    }
    if (killed && slime.bossName) {
      // A boss falls: freeze for a beat, and shake.
      this.hitStop = 0.28;
      this.shake = Math.max(this.shake, 0.9);
    }
    if (killed) {
      this.score += Math.round(slime.score * DIFFICULTIES[difficulty()].score);
      this.hud.setScore(this.score);
      this.effects.burst(slime.x, y, slime.z, slime.color, big ? 40 : 22, big ? 8 : 6);
      this.sfx.splat(big);
      this.events.push({ e: 'splat', x: q(slime.x), z: q(slime.z), c: slime.color.getHex(), big });
      this.dropLoot(slime.x, slime.z, rollLoot(tierOf(slime), this.room + 1, Math.random));
      const drop = (slime as Enemy & { def?: { drop: number } }).def?.drop ?? 0; // each kind carries its own chance
      if (Math.random() < drop && this.pickups.count < MAX_PICKUPS + 1) {
        this.pickups.spawn(pickPowerUp(Math.random, this.health, this.maxHealth), slime.x, slime.z);
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
    if (this.nextPickup <= 0 && (this.phase === 'fight' || this.practice)) {
      // The practice room drops them much more often, to try them out.
      this.nextPickup = this.practice ? 3 + Math.random() * 2 : PICKUP_INTERVAL_MIN + Math.random() * (PICKUP_INTERVAL_MAX - PICKUP_INTERVAL_MIN);
      if (this.pickups.count < MAX_PICKUPS + (this.practice ? 1 : 0)) {
        const at = randomSpawnPoint(Math.random, p, this.dungeon.obstacles, [p], 7);
        this.pickups.spawn(pickPowerUp(Math.random, this.health, this.maxHealth), at.x, at.z);
      }
    }

    // The elf and the familiar can both grab power-ups; either way they go to the elf.
    const collectors = this.companion.present && this.companion.height < 0.5 ? [p, this.companion.position] : [p];
    const bagFull = this.inv.full;
    for (const c of this.pickups.update(dt, this.time, collectors, (t) => !bagFull || !(t.startsWith('item_') || t.startsWith('potion_')))) this.collect(c);
    this.openChests(collectors);

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
      if (this.health < this.maxHealth) this.health = Math.min(this.maxHealth, this.health + HEALING.heartPickup);
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
    for (const hit of this.globs.update(dt, this.time, target, this.dungeon.obstacles)) {
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
    this.sinceHurt = 0;
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
    // Bark Skin takes the edge off.
    const taken = Math.max(1, Math.round(scaledDamage(amount) * (this.bark.left > 0 ? 1 - this.bark.reduce : 1) * (1 - this.heroGear.armor)));
    this.health -= taken;
    this.numbers.show(taken, p.x, 2.4, p.z, 'hurt');
    this.events.push({ e: 'num', x: q(p.x), y: 2.4, z: q(p.z), n: taken, k: 2 });
    // Heavy hits shake the camera and freeze the action for a beat.
    this.shake = Math.max(this.shake, Math.min(0.7, taken / 40));
    if (taken >= 20) this.hitStop = Math.max(this.hitStop, 0.07);
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
    this.health = Math.min(this.maxHealth, this.health + WARD.heal * dt);
    if (Math.ceil(this.health) !== before) this.hud.setHealth(this.health);
    const r = SPELLS.ward.radius;
    for (const s of this.enemies.all) if (Math.hypot(s.x - p.x, s.z - p.z) <= r + s.radius * 0.5) s.slow = Math.min(s.slow, WARD.slow);
  }

  /** Uses whatever's in action slot `slot` (keys 1-9 by default, or a tap on the bar). */
  private useSlot(slot: number): void {
    const running = this.state === 'playing' && this.player.isActive;
    const spell = this.spellbook.inSlot(slot);
    if (running && spell && this.phase !== 'ready') {
      this.castElfSpell(spell);
      return;
    }
    const id = this.hud.actionBar.ability(slot);
    if (!running || !id) return;
    if (id === 'dash') {
      this.player.queueDash(); // paid for when it happens (canDash)
      return;
    }
    if (id === 'doubleshot') {
      if (!this.resources.spend('doubleshot')) return;
      this.doubleShots = DOUBLE_SHOTS;
      this.hud.actionBar.setCharges('doubleshot', this.doubleShots);
      const p = this.player.position;
      this.effects.burst(p.x, 1.3, p.z, new THREE.Color(0xffd36b), 16, 4, 0.1);
      this.hud.toast(`🏹 Double Shot ×${DOUBLE_SHOTS}`, 0xffd36b);
      this.sfx.powerUp();
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

  // ── Gear, the bag and the merchant ────────────────────────────────────────────────────────

  /** Max health: the elf's own, plus gear. */
  private get maxHealth(): number {
    return HERO.maxHp + this.heroGear.maxHp;
  }

  /** An arrow's damage with gear: more damage, and sometimes a critical (double) shot. */
  private arrowDamage(): number {
    const base = HERO.arrowDamage * (1 + this.heroGear.damage);
    return Math.random() < this.heroGear.crit ? base * 2 : base;
  }

  /** Gear changed (or the gold): recompute stats and pass them on to everything that uses them. */
  private refreshGear(): void {
    this.gearVersion = this.inv.version;
    this.heroGear = this.inv.heroStats();
    this.famGear = this.inv.familiarStats();
    this.player.speedScale = 1 + this.heroGear.moveSpeed;
    this.resources.manaBonus = this.heroGear.manaRegen;
    this.resources.staminaBonus = this.heroGear.staminaRegen;
    this.companion.cooldownScale = 1 - this.famGear.famCooldown;
    this.companion.speedScale = 1 + this.famGear.famSpeed;
    this.hud.setMaxHealth(this.maxHealth);
    this.health = Math.min(this.health, this.maxHealth);
    this.hud.setHealth(this.health);
    this.hud.setGold(this.inv.gold);
    this.bagPanel?.update(this.inv.encode(), this.shop, this.gearSummary());
  }

  /** A line of what the elf's gear adds up to (for the bag). */
  private gearSummary(): string {
    const g = this.heroGear;
    const parts: string[] = [];
    if (g.damage) parts.push(`+${Math.round(g.damage * 100)}% damage`);
    if (g.attackSpeed) parts.push(`+${Math.round(g.attackSpeed * 100)}% attack speed`);
    if (g.crit) parts.push(`${Math.round(g.crit * 100)}% crits`);
    if (g.maxHp) parts.push(`+${g.maxHp} health`);
    if (g.armor) parts.push(`−${Math.round(g.armor * 100)}% damage taken`);
    if (g.moveSpeed) parts.push(`+${Math.round(g.moveSpeed * 100)}% speed`);
    return parts.length ? `Elf: ${parts.join(' · ')}` : '';
  }

  /** A bag request from the elf's panel or the familiar's tablet. */
  private applyInv(req: InvOp, fromFamiliar: boolean): void {
    if (this.state !== 'playing') return;
    if ((req.op === 'buy' || req.op === 'sell') && this.phase !== 'shop') return;
    const res = this.inv.apply(req, this.phase === 'shop' ? this.shop : null);
    if (!res) return;
    if (res.used?.kind === 'potion') this.drink(res.used.potion);
    if (res.bought) {
      const p = this.player.position;
      if (res.bought.kind === 'book') this.readBook(p.x, p.z);
      else this.hud.toast(`🛒 ${res.bought.kind === 'item' ? res.bought.name : POTIONS[res.bought.potion].name}`, 0xffd24a);
      this.sfx.coin();
    }
    if (req.op === 'sell') this.sfx.coin();
    if (req.op === 'equip') this.sfx.powerUp();
    if (fromFamiliar && req.op === 'equip' && this.companion.kind) this.hud.toast(`${FAMILIARS[this.companion.kind].emoji} The familiar changed gear`, 0xc79bff);
    this.refreshGear();
  }

  private drink(potion: 'health' | 'mana'): void {
    const p = this.player.position;
    const def = POTIONS[potion];
    if (potion === 'health') this.heal(def.amount);
    else this.resources.mana = Math.min(100, this.resources.mana + def.amount);
    this.effects.burst(p.x, 1.2, p.z, new THREE.Color(def.color), 20, 4, 0.12);
    this.events.push({ e: 'burst', x: q(p.x), z: q(p.z), c: def.color, n: 20 });
    this.hud.toast(`${def.icon} ${def.name}`, def.color);
    this.sfx.spring();
  }

  /** Q / E: drink the first health / mana potion in the bag. */
  private quickPotion(potion: 'health' | 'mana'): void {
    const i = this.inv.bag.findIndex((e) => e?.kind === 'potion' && e.potion === potion);
    if (i < 0) {
      this.hud.toast(`No ${POTIONS[potion].name.toLowerCase()}s`, 0x9a9a9a);
      return;
    }
    this.applyInv({ op: 'use', i }, false);
  }

  /** The bag button on the action bar (not in the practice room). */
  private setBagButton(show: boolean): void {
    const btn = document.querySelector<HTMLElement>('.action-bar [data-bag-open]');
    if (btn && btn.hidden === show) btn.hidden = !show;
  }

  /** Opens / closes the bag (the mouse is freed while it's open). */
  private toggleBag(): void {
    if (this.state !== 'playing' || this.phase === 'shop' || this.headless) return;
    if (this.bagPanel.isOpen) {
      this.closeBag();
      return;
    }
    this.bagPanel.update(this.inv.encode(), null, this.gearSummary());
    this.bagPanel.open();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private closeBag(): void {
    this.bagPanel.close();
    if (this.state === 'playing') this.player.activate(); // back to the game (the close is a click or a key: allowed to take the mouse)
  }

  /** Through the exit door: the merchant's camp first (then the next level). */
  private enterShop(): void {
    if (!ROOMS[this.room + 1]) {
      this.enterDoor();
      return;
    }
    this.phase = 'shop';
    this.shop = makeStock(this.room + 1, Math.random);
    this.bagPanel.update(this.inv.encode(), this.shop, this.gearSummary());
    this.bagPanel.open();
    if (document.pointerLockElement) document.exitPointerLock();
    this.banner('🛒 The merchant’s camp');
    this.sfx.door();
  }

  private leaveShop(): void {
    if (this.phase !== 'shop') return;
    this.shop = null;
    this.bagPanel.close();
    this.enterDoor();
    this.player.activate();
  }

  /** The inventory (when it changed, or now and then) and the shop, for the familiar's tablet. */
  private invForSnapshot(): Partial<Snapshot> {
    const out: Partial<Snapshot> = {};
    if (this.inv.version !== this.sentInv || this.steps % 120 === 0) {
      this.sentInv = this.inv.version;
      out.inv = this.inv.encode();
    }
    const shopKey = this.shop ? this.shop.map((e) => (e.sold ? 1 : 0)).join('') + this.shop.length : '';
    if (this.shop && (shopKey !== this.sentShop || this.steps % 60 === 0)) out.shop = this.shop;
    this.sentShop = shopKey;
    return out;
  }

  // ── Loot ─────────────────────────────────────────────────────────────────────────────────────

  /** Scatters drops round (x, z): coin piles and spell books. */
  private dropLoot(x: number, z: number, drops: Drop[]): void {
    for (const d of drops) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.6 + Math.random() * 1.2;
      const at = walkMap().nearestFloor(x + Math.cos(a) * r, z + Math.sin(a) * r);
      const spot = walkMap().clear(x + Math.cos(a) * r, z + Math.sin(a) * r, 0.4) ? { x: x + Math.cos(a) * r, z: z + Math.sin(a) * r } : at;
      if (d.kind === 'gold') this.pickups.spawn('gold', spot.x, spot.z, undefined, d.amount);
      else if (d.kind === 'book') this.pickups.spawn('book', spot.x, spot.z);
      else if (d.kind === 'item') this.pickups.spawn(`item_${d.rarity}`, spot.x, spot.z, undefined, 0, makeItem(Math.random, d.rarity, this.room + 1));
      else this.pickups.spawn(`potion_${d.potion}`, spot.x, spot.z, undefined, 0, makePotion(d.potion));
    }
  }

  /** Something picked up by the elf (by 0) or the familiar (by 1): it all goes to the party. */
  private collect(c: Collected): void {
    if (c.type === 'gold') {
      this.inv.addGold(c.amount);
      this.hud.setGold(this.inv.gold);
      this.numbers.show(c.amount, c.x, 1.6, c.z, 'gold');
      this.events.push({ e: 'loot', k: 0, x: q(c.x), z: q(c.z), n: c.amount });
      this.sfx.coin();
      return;
    }
    if (c.type === 'book') {
      this.readBook(c.x, c.z);
      return;
    }
    if (c.payload) {
      this.inv.add(c.payload);
      const e: BagEntry = c.payload;
      const name = e.kind === 'item' ? e.name : POTIONS[e.potion].name;
      const color = e.kind === 'item' ? parseInt(RARITY_INFO[e.rarity].color.slice(1), 16) : POTIONS[e.potion].color;
      this.hud.toast(`🎒 ${name}`, color);
      this.events.push({ e: 'loot', k: 2, x: q(c.x), z: q(c.z), n: 0, t: `🎒 ${name}` });
      this.sfx.powerUp();
      return;
    }
    if (c.type in POWER_UPS) this.applyPowerUp(c.type as PowerUpType, c.by === 1);
  }

  /** A spell book: a new spell in slots 4–9, or a rank up. */
  private readBook(x: number, z: number): void {
    const r = this.spellbook.read(Math.random);
    let text: string;
    if (r.kind === 'mastered') {
      // Every spell known at its best: the book's worth gold instead.
      this.inv.addGold(50);
      this.hud.setGold(this.inv.gold);
      text = '📖 You know it all — +50 🪙';
    } else {
      const key = r.key;
      const rank = this.spellbook.rank(key);
      const slot = this.spellbook.slots.indexOf(key) + FIRST_SPELL_SLOT;
      const def = ELF_SPELLS[key];
      this.hud.actionBar.setSlot(slot, { icon: def.icon, name: spellTitle(key, rank), description: def.describe(rank), kind: 'spell', cost: spellCost(key, rank), rank });
      this.hud.actionBar.flash(slot);
      const keyName = this.hud.actionBar.keys[slot]?.replace(/^Digit|^Key/, '') ?? String(slot + 1);
      text = r.kind === 'learned' ? `📖 Learned ${def.icon} ${def.name}! (key ${keyName})` : `📖 ${def.icon} ${spellTitle(key, rank)}!`;
    }
    this.hud.toast(text, 0xc79bff);
    this.banner(text);
    this.effects.burst(x, 1.2, z, new THREE.Color(0xc79bff), 30, 6, 0.14);
    this.events.push({ e: 'loot', k: 1, x: q(x), z: q(z), n: 0, t: text });
    this.sfx.book();
  }

  /** Chests open when the elf or the familiar steps up to them. */
  private openChests(collectors: readonly { x: number; z: number }[]): void {
    this.level.chests.forEach((c, i) => {
      if (this.chestsOpened & (1 << i)) return;
      if (!collectors.some((p) => Math.hypot(p.x - c.x, p.z - c.z) < 2.4)) return;
      this.chestsOpened |= 1 << i;
      this.dungeon.openChest(i);
      this.dropLoot(c.x, c.z + 1.6, chestLoot(this.room + 1, Math.random));
      this.effects.burst(c.x, 1.2, c.z, new THREE.Color(0xffd34d), 34, 6, 0.14);
      this.events.push({ e: 'chest', i });
      this.hud.toast('🧰 A treasure chest!', 0xffd34d);
      this.sfx.chest();
    });
  }

  // ── The elf's spells ────────────────────────────────────────────────────────────────────────

  /** Enchantment bits for this shot (and one shot used up of each). */
  private takeEnchant(): number {
    let bits = 0;
    const flags = { fire: ENCHANT_FIRE, frost: ENCHANT_FROST, chain: ENCHANT_CHAIN } as const;
    for (const key of ['fire', 'frost', 'chain'] as const) {
      const e = this.enchants[key];
      if (e.shots <= 0) continue;
      bits |= flags[key];
      e.shots--;
      this.hud.actionBar.setSlotCharges(this.spellbook.slots.indexOf(key) + FIRST_SPELL_SLOT, e.shots);
    }
    return bits;
  }

  /** An enchanted arrow struck: explode, chill, or arc lightning on. */
  private enchantHit(hit: ArrowHit): void {
    const t = hit.slime;
    if (hit.enchant & ENCHANT_FIRE) {
      const r = this.enchants.fire.rank - 1;
      const radius = SPELL_POWER.fire.radius[r];
      const near = this.enemies.all.filter((s) => s.alive && !s.hidden && Math.hypot(s.x - t.x, s.z - t.z) <= radius + s.radius);
      for (const s of near) this.damage(s, s.x - t.x || hit.dirX, s.z - t.z || hit.dirZ, SPELL_POWER.fire.damage[r]);
      this.spellFx(t.x, t.z, ELF_SPELLS.fire.color, radius, 26);
      this.sfx.burst();
    }
    if (hit.enchant & ENCHANT_FROST && t.alive) {
      const r = this.enchants.frost.rank - 1;
      t.soak(SPELL_POWER.frost.seconds[r], SPELL_POWER.frost.slow[r]);
      if (SPELL_POWER.frost.freeze[r] > 0) t.stun(SPELL_POWER.frost.freeze[r]);
      this.spellFx(t.x, t.z, ELF_SPELLS.frost.color, 0, 14);
    }
    if (hit.enchant & ENCHANT_CHAIN) {
      const r = this.enchants.chain.rank - 1;
      const struck = new Set([t]);
      let from = { x: t.x, z: t.z };
      for (let j = 0; j < SPELL_POWER.chain.jumps[r]; j++) {
        const next = this.enemies.all
          .filter((s) => s.alive && !s.hidden && !struck.has(s) && Math.hypot(s.x - from.x, s.z - from.z) <= SPELL_POWER.chain.reach)
          .sort((a, b) => Math.hypot(a.x - from.x, a.z - from.z) - Math.hypot(b.x - from.x, b.z - from.z))[0];
        if (!next) break;
        struck.add(next);
        // Sparks along the arc, then the zap.
        for (let k = 1; k <= 4; k++) this.effects.burst(from.x + ((next.x - from.x) * k) / 5, 1.3, from.z + ((next.z - from.z) * k) / 5, new THREE.Color(ELF_SPELLS.chain.color), 3, 1.5, 0.08);
        this.damage(next, next.x - from.x, next.z - from.z, Math.round(HERO.arrowDamage * SPELL_POWER.chain.share[r] * 10) / 10);
        this.spellFx(next.x, next.z, ELF_SPELLS.chain.color, 0, 10);
        from = { x: next.x, z: next.z };
      }
    }
  }

  /** A spell's flash: a ring (if `radius`) and sparks, on both screens. */
  private spellFx(x: number, z: number, color: number, radius: number, sparks: number): void {
    if (radius > 0) {
      this.effects.ring(x, z, color, radius);
      this.events.push({ e: 'ring', x: q(x), z: q(z), r: radius, c: color });
    }
    this.effects.burst(x, 1.1, z, new THREE.Color(color), sparks, 5, 0.12);
    this.events.push({ e: 'burst', x: q(x), z: q(z), c: color, n: sparks });
  }

  /** Where the elf is aiming (with the same gentle aim assist as shooting). */
  private aimAt(): THREE.Vector3 {
    const p = this.player.position;
    const dir = this.player.aimDirection(this.aim);
    const alive = this.enemies.all.filter((s) => s.alive && !s.hidden);
    const assist = this.mode === 'touch' ? TOUCH_AIM_ASSIST_ANGLE : AIM_ASSIST_ANGLE;
    const i = pickAimTarget(p, dir.x, dir.z, alive, assist, AIM_ASSIST_RANGE);
    if (i >= 0) dir.set(alive[i].x - p.x, 0, alive[i].z - p.z).normalize();
    return dir;
  }

  private castElfSpell(key: SpellKey): void {
    const rank = this.spellbook.rank(key);
    if (!rank) return;
    if (!this.resources.spendMana(spellCost(key, rank))) {
      this.hud.toast('✦ Not enough mana', 0x8fd0ff);
      return;
    }
    const r = rank - 1;
    const def = ELF_SPELLS[key];
    const p = this.player.position;
    const slot = this.spellbook.slots.indexOf(key) + FIRST_SPELL_SLOT;
    switch (key) {
      case 'fire':
      case 'frost':
      case 'chain': {
        const e = this.enchants[key];
        e.shots = SPELL_POWER[key].shots[r];
        e.rank = rank;
        this.hud.actionBar.setSlotCharges(slot, e.shots);
        this.spellFx(p.x, p.z, def.color, 1.6, 18);
        this.sfx.powerUp();
        break;
      }
      case 'volley': {
        const dir = this.aimAt();
        this.player.faceShot(dir);
        this.invisible = 0;
        for (const d of spreadDirections(dir.x, dir.z, SPELL_POWER.volley.arrows[r], SPELL_POWER.volley.spread)) {
          this.arrows.fire(p.x + d.x * 0.6, p.z + d.z * 0.6, d, true);
        }
        this.spellFx(p.x + dir.x * 1.5, p.z + dir.z * 1.5, def.color, 0, 24);
        this.sfx.twang();
        this.sfx.burst();
        break;
      }
      case 'roots': {
        const dir = this.aimAt();
        const P = SPELL_POWER.roots;
        // Where the roots burst up: ahead of the elf, short of any wall.
        const t = walkMap().raycast(p.x, p.z, p.x + dir.x * P.ahead, p.z + dir.z * P.ahead) ?? 1;
        const cx = p.x + dir.x * P.ahead * t;
        const cz = p.z + dir.z * P.ahead * t;
        this.enemies.stunAround(cx, cz, P.radius[r], P.seconds[r]);
        this.spellFx(cx, cz, def.color, P.radius[r], 36);
        this.sfx.calm();
        break;
      }
      case 'nova': {
        const P = SPELL_POWER.nova;
        for (const s of this.enemies.stunAround(p.x, p.z, P.radius[r], P.seconds[r])) this.damage(s, s.x - p.x, s.z - p.z, P.damage[r]);
        this.spellFx(p.x, p.z, def.color, P.radius[r], 40);
        this.sfx.burst();
        break;
      }
      case 'bloom':
        this.bloom = { left: SPELL_POWER.bloom.seconds, rate: SPELL_POWER.bloom.heal[r] / SPELL_POWER.bloom.seconds };
        this.spellFx(p.x, p.z, def.color, 2.2, 24);
        this.sfx.spring();
        break;
      case 'bark':
        this.bark = { left: SPELL_POWER.bark.seconds, reduce: SPELL_POWER.bark.reduce[r] };
        this.spellFx(p.x, p.z, def.color, 1.8, 24);
        this.sfx.land();
        break;
    }
    this.hud.toast(`${def.icon} ${spellTitle(key, rank)}`, def.color);
  }

  /** Healing Bloom heals over time; Bark Skin wears off. */
  private updateBlessings(dt: number): void {
    if (this.bloom.left > 0) {
      const before = Math.floor(this.health);
      this.bloom.left = Math.max(0, this.bloom.left - dt);
      this.health = Math.min(this.maxHealth, this.health + this.bloom.rate * dt);
      if (Math.floor(this.health) !== before) this.hud.setHealth(this.health);
      if (Math.floor(this.time * 3) !== Math.floor((this.time - dt) * 3)) {
        const p = this.player.position;
        this.effects.burst(p.x, 1, p.z, new THREE.Color(ELF_SPELLS.bloom.color), 6, 2, 0.1);
      }
    }
    if (this.bark.left > 0) this.bark.left = Math.max(0, this.bark.left - dt);
  }

  /** Opens the exit door. */
  private openDoor(): void {
    this.dungeon.setExitOpen(true);
    this.banner('The way is open!');
    this.hud.toast('↑ The exit door is open, north of the guardian’s hall', 0xffe0a0);
    this.sfx.door();
    this.events.push({ e: 'door' });
  }

  /** Runes seal the door: the familiar must solve SEAL_RIDDLES riddles. */
  private startSeal(): void {
    this.riddle = makeRiddle();
    this.sealSolved = 0;
    this.sealMisses = 0;
    this.dungeon.setExitOpen(false);
    this.banner('🔮 The door is sealed!');
    this.hud.toast('Your familiar must break the rune seal', 0xc79bff);
    this.sfx.calm();
  }

  /** The familiar's answer to the current riddle. */
  private answerRiddle(value: number): void {
    const r = this.riddle;
    if (!r) return;
    if (value !== r.answer) {
      // Wrong: the runes shift to a different riddle (progress so far is kept).
      this.riddle = makeRiddle(Math.random, r);
      this.sealMisses++;
      this.events.push({ e: 'riddle', ok: 0 });
      return;
    }
    this.sealSolved++;
    if (this.sealSolved < SEAL_RIDDLES) {
      this.riddle = makeRiddle();
      this.events.push({ e: 'riddle', ok: 1 });
      return;
    }
    // Seal broken: a reward, and the way on.
    this.riddle = null;
    this.events.push({ e: 'riddle', ok: 1, done: 1 });
    this.heal(20);
    const p = this.player.position;
    this.effects.burst(p.x, 1.2, p.z, new THREE.Color(0xc79bff), 30, 6, 0.12);
    this.hud.toast('🔮 Seal broken! +20 HP', 0xc79bff);
    this.sfx.powerUp();
    if (this.phase === 'cleared') this.openDoor();
  }

  /** The hero pressed Start (Enter / the button): the hunt begins. */
  private beginFight(): void {
    if (this.state !== 'playing' || this.phase !== 'ready') return;
    this.phase = 'fight';
    this.wave = this.room + 1;
    this.hud.setStartPrompt(false);
    this.banner('⚔️ Find the way north!');
    this.sfx.wave();
  }

  /** The level: hunt down its guardian; then the exit opens (or, in the lair, you win). */
  private updateWaves(dt: number): void {
    this.hud.setWave(this.riddle && !this.practice ? `🔮 Rune seal — your familiar is solving it (${this.sealSolved}/${SEAL_RIDDLES})` : runLabel(this.room, this.enemies.remaining, this.phase, this.enemies.boss?.bossName ?? null));
    this.hud.setStartPrompt(this.phase === 'ready');
    if (this.phase === 'ready') return; // nothing stirs until the hero starts
    if (this.phase === 'transition') {
      this.updateDoor(dt);
      return;
    }
    if (this.phase === 'cleared') {
      const p = this.player.position;
      if (this.dungeon.inExit(p.x, p.z)) this.enterShop();
      return;
    }
    if (this.phase === 'shop') return;
    if (this.practice) return;
    // The guardian wakes: its name across the screen and its health bar.
    const boss = this.enemies.boss;
    if (boss && !this.bossAnnounced) {
      this.bossAnnounced = true;
      this.effects.ring(boss.x, boss.z, boss.color.getHex(), 5);
      this.effects.burst(boss.x, 2, boss.z, boss.color, 50, 9, 0.2);
      this.banner(`⚔️ ${boss.bossName}!`);
      this.sfx.burst();
    }
    if (this.enemies.guardianAlive) return;
    // Guardian down: a breather, and the way on.
    this.heal(HEALING.waveClear);
    if (!ROOMS[this.room].hasExit) {
      this.victory();
      return;
    }
    this.phase = 'cleared';
    // With a familiar along, runes seal the door until it solves their riddles.
    if (this.companion.present && this.net?.familiarConnected) this.startSeal();
    else this.openDoor();
  }

  private heal(amount: number): void {
    this.health = Math.min(this.maxHealth, this.health + amount);
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
      this.hud.setProgress(reachRoom(this.room));
      this.wave = this.room + 1;
      this.arrows.clear();
      this.globs.clear();
      this.pickups.clear();
      this.zones = [];
      this.springPools.sync([], 0, 0);
      this.effects.clear();
      const e = this.dungeon.entry;
      this.player.spawn(e.x, e.z, 0);
      if (this.companion.kind) this.companion.appear(this.companion.kind, e.x + 2.5, e.z + 0.5);
      this.heal(this.maxHealth); // a fresh start in every level
      this.nextPickup = 8;
      this.cardSkip = false;
      this.hud.fade.set(true, this.room);
    }
    if (this.doorT >= DOOR_TOTAL || (this.cardSkip && this.doorT >= CARD_SKIP_AFTER)) {
      // A new run waits in the first room until the hero presses Start; later rooms go straight in.
      this.phase = this.wave === 0 ? 'ready' : 'fight';
      this.hud.fade.set(false);
      this.banner(`Level ${this.room + 1} · ${ROOMS[this.room].name}`);
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
      // Big slams shake the ground — more the closer the elf is.
      const d = Math.hypot(this.player.position.x - s.x, this.player.position.z - s.z);
      this.shake = Math.max(this.shake, Math.max(0, 0.6 - d * 0.03));
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
    this.elf.setPose('victory');
    this.score += Math.max(0, this.health) * VICTORY_SCORE_PER_HP; // a bonus for health left
    this.hud.setScore(this.score);
    const run = { score: this.score, wave: this.wave };
    const isBest = recordRun(run);
    this.hud.setProgress(recordWin(difficulty()));
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
      this.health = this.maxHealth;
      this.hud.setHealth(this.health);
      const p = this.player.position;
      this.effects.burst(p.x, 1.2, p.z, new THREE.Color(0xff4d5e), 20, 5, 0.12);
      this.events.push({ e: 'heal', x: q(p.x), z: q(p.z) });
      return;
    }
    this.state = 'over';
    this.elf.group.visible = true;
    this.elf.setPose('dead');
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
