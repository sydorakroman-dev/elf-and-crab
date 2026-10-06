import * as THREE from 'three';
import { Dungeon } from '../world/dungeon';
import { ROOMS } from '../world/rooms';
import { generateLevel } from '../world/levelgen';
import { Minimap } from '../ui/minimap';
import { TelegraphRings } from '../game/telegraph';
import { BeastVisual } from '../game/beastVisual';
import { ElementalVisual } from '../game/elementalVisual';
import type { Elf } from '../player/elf';
import type { FamiliarBody } from '../player/beasts';
import { BEAST_KIND_LIST, ELEMENTAL_KIND_LIST, type BeastKind, type ElementalKind, type MonsterKind } from '../game/enemies';
import { createMonsterVisual, type MonsterLook } from '../game/monsters';
import { Arrows } from '../game/arrows';
import { Globs, PROJECTILES, PROJECTILE_KINDS } from '../game/globs';
import { Pickups } from '../game/pickups';
import { Effects } from '../game/effects';
import { Sfx } from '../game/audio';
import { SpringPools } from '../game/zones';
import { HEALING } from '../game/balance';
import { POWER_UPS } from '../game/powerups';
import { FAMILIARS, FAMILIAR_KINDS, SPELLS, SPELL_IDS, pounceLanding, type FamiliarKind } from '../game/familiars';
import { POWER_CODES, SLIME_KIND_CODES, SnapshotBuffer, type GameEvent, type Snapshot } from '../net/snapshot';
import type { FamiliarLink, FamiliarStatus } from '../net/client';
import { FamiliarHud } from './hud';
import { DamageNumbers } from '../game/numbers';
import { AutoQuality } from '../ui/quality';
import { jadeRing } from '../game/Game';

const FOV = 45;
/** Third-person follow camera: always looking north, this far back (m) and this steep (radians). */
const FOLLOW_DISTANCE = 17;
const FOLLOW_PITCH = 0.95;
const FOLLOW_LAG = 6; // higher = tighter follow
/** Screen-edge arrows (elf, boss) sit this far in from the edge (fraction of half the screen). */
const EDGE = 0.86;
/** …and stay clear of the top bar and the spell buttons (screen space, −1…1, y up). */
const EDGE_TOP = 0.8;
const EDGE_BOTTOM = -0.55;
const STEER_SEND_INTERVAL = 0.1; // joystick updates at 10 Hz (resent while held)
const STICK_RADIUS = 60; // px of drag for full speed
const STICK_DEAD_ZONE = 0.15;
const EVENT_DELAY_MS = 100; // play events in step with the interpolation delay
const STUN_STAR = new THREE.Color(0xfff27a);
const CALM_PINK = new THREE.Color(0xffb8dc);
const SPRING_BLUE = new THREE.Color(0x8fe8f5);

/**
 * The familiar's tablet: a top-down view of the whole arena, drawn from the hero's snapshots.
 * Pick a creature, steer it with a virtual joystick (touch and drag anywhere), and tap the spell buttons to cast.
 * Runs no game logic itself — the hero's browser is the source of truth.
 */
export class FamiliarGame {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV, innerWidth / innerHeight, 0.5, 400);
  private readonly timer = new THREE.Timer();
  private dungeon: Dungeon;
  private readonly telegraph = new TelegraphRings();
  private readonly elf: Elf;
  private readonly bodies: Record<FamiliarKind, FamiliarBody>;
  private readonly session: FamiliarLink;
  private readonly hud: FamiliarHud;
  private readonly buffer = new SnapshotBuffer(0.1);
  /** Every enemy on screen, keyed by id: slimes and beasts draw differently. */
  private readonly slimes = new Map<number, MonsterLook>();
  private readonly arrows = new Arrows();
  private readonly globs = new Globs();
  private readonly pickups = new Pickups();
  private readonly pools = new SpringPools();
  private readonly effects = new Effects();
  private readonly sfx = new Sfx();
  private readonly shieldBubble: THREE.Mesh;
  private readonly famRing: THREE.Mesh;
  private readonly numbers = new DamageNumbers();
  private quality: AutoQuality | null = null;
  /** The iguana's Jade Ward around the elf. */
  private readonly wardRing = jadeRing(SPELLS.ward.radius);
  private readonly rangeRing: THREE.Mesh;
  private readonly pounceMark: THREE.Mesh;
  private time = 0;
  /** Where the camera looks (eases after the familiar), and where it should be looking. */
  private readonly camFocus = new THREE.Vector3();
  private readonly camGoal = new THREE.Vector3();
  private camPlaced = false;
  /** Pillars, trees and crystals that fade out when they stand between the camera and the creature. */
  /** The south wall and gate: half see-through while the creature is near it. */
  /** Off-screen pointers to the elf and the boss. */
  private readonly pointers: Record<'elf' | 'boss', { el: HTMLElement; at: THREE.Vector3 | null }> = {
    elf: { el: null!, at: null },
    boss: { el: null!, at: null },
  };
  /** The virtual joystick: where the finger went down, and the stick (direction × 0..1). */
  private stick: { id: number; ox: number; oy: number; x: number; z: number } | null = null;
  private lastSteerSent = -1;
  private joy!: { base: HTMLElement; knob: HTMLElement };
  private shownKind: FamiliarKind | null = null;
  private status: FamiliarStatus = 'connecting';
  private onFrame?: () => void;
  private minimap!: Minimap;

  constructor(renderer: THREE.WebGLRenderer, root: HTMLElement, elf: Elf, bodies: Record<FamiliarKind, FamiliarBody>, session: FamiliarLink) {
    this.renderer = renderer;
    this.elf = elf;
    this.bodies = bodies;
    this.session = session;
    this.dungeon = new Dungeon(this.scene, ROOMS[0], generateLevel({ ...ROOMS[0], layout: 'practice' }, 1), 1024);
    for (const b of Object.values(bodies)) b.group.visible = false;
    this.minimap = new Minimap(root);

    const additive = (color: number, opacity: number) =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.shieldBubble = new THREE.Mesh(new THREE.IcosahedronGeometry(1.25, 2), additive(POWER_UPS.shield.color, 0.18));
    this.shieldBubble.visible = false;
    // A glowing ring under your creature so it's easy to find, and the reach of its area spell.
    this.famRing = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.3, 40).rotateX(-Math.PI / 2), additive(0xffffff, 0.7));
    this.rangeRing = new THREE.Mesh(new THREE.RingGeometry(0.975, 1, 72).rotateX(-Math.PI / 2), additive(0xffffff, 0.28));
    // Where a pounce would land (wolf only).
    this.pounceMark = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.85, 6).rotateX(-Math.PI / 2), additive(0xd9cbb0, 0.6));
    for (const m of [this.famRing, this.rangeRing, this.pounceMark]) m.position.y = 0.06;
    this.famRing.visible = this.rangeRing.visible = this.pounceMark.visible = false;

    this.scene.add(
      elf.group,
      ...Object.values(bodies).map((b) => b.group),
      this.pools.group,
      this.arrows.group,
      this.globs.group,
      this.pickups.group,
      this.effects.mesh,
      this.effects.rings,
      this.shieldBubble,
      this.famRing,
      this.wardRing,
      this.numbers.group,
      this.rangeRing,
      this.pounceMark,
      this.telegraph.group,
    );

    this.hud = new FamiliarHud(root, session.code);
    root.insertAdjacentHTML('beforeend', '<div class="edge-arrow elf" hidden><span>🧝</span></div><div class="edge-arrow boss" hidden><span>⚔️</span></div>');
    this.pointers.elf.el = root.querySelector<HTMLElement>('.edge-arrow.elf')!;
    this.pointers.boss.el = root.querySelector<HTMLElement>('.edge-arrow.boss')!;
    this.hud.onStart = () => this.sfx.unlock();
    this.hud.onChoose = (kind) => this.session.send({ type: 'choose', kind });
    this.hud.onSpell = (id) => this.session.send({ type: 'spell', id });
    this.hud.onParade = (kind) => this.session.send({ type: 'parade', kind });
    this.hud.onAnswer = (value) => this.session.send({ type: 'answer', value });
    this.hud.onRiddle = () => this.session.send({ type: 'riddle' });
    bodies.crab.onStep = (s) => this.sfx.scuttle(s);
    bodies.wolf.onStep = (s) => this.sfx.scuttle(s * 0.6);
    bodies.capybara.onStep = (s) => this.sfx.footstep(s * 0.4);
    bodies.goldfish.onStep = (s) => this.sfx.scuttle(s * 0.5);
    bodies.iguana.onStep = (s) => this.sfx.footstep(s * 0.35);

    session.onSnapshot = (s) => this.receive(s);
    session.onStatus = (s) => this.setStatus(s);

    this.bindTouch(renderer.domElement);
    addEventListener('resize', () => this.resize());
    this.resize();
    this.setStatus('connecting');
  }

  setFrameHook(fn: () => void): void {
    this.onFrame = fn;
  }

  start(): void {
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  private setStatus(s: FamiliarStatus): void {
    this.status = s;
    if (s === 'no-room' || s === 'room-full' || s === 'hero-left') this.hud.setBlocking(s, this.session.code);
    // After a (re)join, tell the hero which creature we are again.
    if (s === 'joined' && this.hud.chosen) this.session.send({ type: 'choose', kind: this.hud.chosen });
    this.refreshStatusPill(this.buffer.latest);
  }

  private refreshStatusPill(latest: Snapshot | null): void {
    const s = this.status;
    let text: string | null = null;
    if (s === 'connecting') text = 'Connecting to the server… (can take a minute to wake up)';
    else if (s === 'reconnecting') text = 'Reconnecting…';
    else if (s === 'unavailable') text = "Can't reach the server — retrying…";
    else if (s === 'hero-away') text = 'The elf lost connection — waiting for them…';
    else if (s === 'joined' || s === 'open') {
      if (!latest) text = 'Joined! Waiting for the elf…';
      else if (latest.state === 'ready') text = 'Waiting for the elf to enter the dungeon…';
      else if (latest.state === 'paused') text = 'The elf paused the game';
      else if (latest.state === 'over') text = `Game over — wave ${latest.wave}, ${latest.score} points. Waiting for the elf…`;
      else if (latest.state === 'won') text = `👑 Victory! ${latest.score} points. Waiting for the elf…`;
    }
    this.hud.setStatus(text);
  }

  private receive(s: Snapshot): void {
    // The hero walked into another room (or started over): build it.
    if (s.room !== ROOMS.indexOf(this.dungeon.room) || (s.lvl ?? 0) !== this.dungeon.level.seed) this.loadRoom(s.room, s.lvl ?? 0, !!s.practice);
    this.buffer.push(s, performance.now() / 1000);
    if (s.ev.length) {
      const events = s.ev;
      window.setTimeout(() => this.playEvents(events), EVENT_DELAY_MS);
    }
    this.hud.update(s);
    this.refreshStatusPill(s);
  }

  private playEvents(events: GameEvent[]): void {
    const famColor = new THREE.Color(this.shownKind ? FAMILIARS[this.shownKind].color : 0xffffff);
    for (const ev of events) {
      switch (ev.e) {
        case 'splat':
          this.effects.burst(ev.x, ev.big ? 1.25 : 0.7, ev.z, new THREE.Color(ev.c), ev.big ? 40 : 22, ev.big ? 8 : 6);
          this.sfx.splat(ev.big);
          break;
        case 'hit':
          this.effects.burst(ev.x, 0.8, ev.z, new THREE.Color(ev.c), 6, 4, 0.12);
          break;
        case 'glob':
          this.effects.burst(ev.x, 1, ev.z, new THREE.Color(PROJECTILES[PROJECTILE_KINDS[ev.k ?? 0] ?? 'acid'].color), 10, 4, 0.12);
          break;
        case 'spit':
          this.sfx.spit();
          break;
        case 'spell':
          this.playSpell(SPELL_IDS[ev.id], ev.x, ev.z, famColor, ev.h ?? 0, ev.d ?? 0);
          break;
        case 'bite':
          this.currentBody()?.pinch();
          this.sfx.hit();
          break;
        case 'land':
          this.effects.ring(ev.x, ev.z, 0xd9cbb0, 2.2);
          this.effects.burst(ev.x, 0.3, ev.z, new THREE.Color(0xb8a98f), 16, 4, 0.12);
          this.sfx.land();
          break;
        case 'heal':
          this.effects.burst(ev.x, 1.2, ev.z, new THREE.Color(0xff4d5e), 14, 4, 0.12);
          this.hud.popups.toast(`♨️ +${HEALING.spring} HP`, 0x8fe8f5);
          this.sfx.powerUp();
          break;
        case 'poof':
          this.effects.burst(ev.x, 0.6, ev.z, famColor, 30, 5, 0.14);
          this.effects.ring(ev.x, ev.z, famColor, 2.5);
          break;
        case 'pickup': {
          const def = POWER_UPS[POWER_CODES[ev.p] ?? 'multishot'];
          this.effects.burst(ev.x, ev.fam ? 0.8 : 1.1, ev.z, new THREE.Color(def.color), 18, 5, 0.12);
          if (ev.fam) break; // the elf's own event follows with the toast and sound
          this.hud.popups.toast(`${def.icon} ${def.label}!`, def.color);
          this.sfx.powerUp();
          break;
        }
        case 'hurt':
          this.hud.popups.flashHurt();
          this.sfx.hurt();
          break;
        case 'shield':
          this.effects.burst(ev.x, 1.2, ev.z, new THREE.Color(POWER_UPS.shield.color), 24, 6, 0.14);
          this.sfx.shieldBreak();
          break;
        case 'banner':
          this.hud.popups.banner(ev.text);
          break;
        case 'slam': {
          const red = new THREE.Color(0xc0303a);
          this.effects.ring(ev.x, ev.z, red, ev.r);
          this.effects.burst(ev.x, 0.4, ev.z, red, 40, 8, 0.18);
          this.sfx.land();
          break;
        }
        case 'riddle':
          this.hud.riddleResult(ev.ok === 1, ev.done === 1);
          if (ev.ok) this.sfx.powerUp();
          else this.sfx.hurt();
          break;
        case 'ring':
          this.effects.ring(ev.x, ev.z, ev.c, ev.r);
          this.effects.burst(ev.x, 1.5, ev.z, new THREE.Color(ev.c), 16, 4, 0.1);
          break;
        case 'num':
          this.numbers.show(ev.n, ev.x, ev.y, ev.z, ev.k === 2 ? 'hurt' : ev.k === 1 ? 'big' : 'hit');
          break;
        case 'door':
          this.sfx.door();
          this.hud.popups.toast('↑ The elf can head through the north door', 0xffe0a0);
          break;
        case 'twang':
          break; // the bow is the elf's sound; keep the tablet calmer
      }
    }
  }

  private playSpell(id: (typeof SPELL_IDS)[number] | undefined, x: number, z: number, color: THREE.Color, heading: number, reach: number): void {
    if (!id) return;
    const spell = SPELLS[id];
    this.currentBody()?.pinch();
    switch (id) {
      case 'burst':
        this.effects.ring(x, z, color, spell.radius);
        this.effects.burst(x, 0.8, z, color, 30, 7, 0.14);
        this.effects.burst(x, 1.5, z, STUN_STAR, 12, 5, 0.1);
        this.sfx.burst();
        break;
      case 'shell': {
        const h = this.buffer.latest?.hero;
        if (h) this.effects.burst(h.x, 1.2, h.z, new THREE.Color(POWER_UPS.shield.color), 24, 5, 0.12);
        this.hud.popups.toast('🐚 Shell Shield!', POWER_UPS.shield.color);
        this.sfx.powerUp();
        break;
      }
      case 'spring':
        this.effects.ring(x, z, SPRING_BLUE, spell.radius);
        this.effects.burst(x, 0.4, z, SPRING_BLUE, 20, 4, 0.1);
        this.sfx.spring();
        break;
      case 'calm':
        this.effects.ring(x, z, CALM_PINK, spell.radius);
        this.effects.burst(x, 1, z, CALM_PINK, 30, 5, 0.12);
        this.sfx.calm();
        break;
      case 'pounce':
        this.effects.burst(x, 0.3, z, new THREE.Color(0xb8a98f), 10, 3, 0.1);
        this.sfx.whoosh();
        break;
      case 'bubble':
        this.sfx.bubble();
        break;
      case 'tongue':
        for (let i = 1; i <= 8; i++) this.effects.burst(x + (Math.sin(heading) * reach * i) / 8, 0.7, z + (Math.cos(heading) * reach * i) / 8, new THREE.Color(0xff7aa8), 3, 1.5, 0.08);
        this.sfx.whoosh();
        break;
      case 'ward':
        this.sfx.spring();
        break;
      case 'jet':
        for (let i = 1; i <= 6; i++) this.effects.burst(x + Math.sin(heading) * i * 1.15, 0.7, z + Math.cos(heading) * i * 1.15, new THREE.Color(0x5cc4ff), 8, 3 + i * 0.3, 0.12);
        this.sfx.jet();
        break;
      case 'howl':
        this.effects.ring(x, z, 0x9fd0ff, spell.radius);
        this.effects.burst(x, 1.2, z, new THREE.Color(0x9fd0ff), 30, 6, 0.12);
        this.sfx.howl();
        break;
    }
  }

  /** Builds the hero's current level from its seed (the same generator gives the same level). */
  private loadRoom(index: number, seed: number, practice: boolean): void {
    const room = ROOMS[index];
    if (!room) return;
    this.dungeon.dispose(this.scene);
    this.dungeon = new Dungeon(this.scene, room, generateLevel(practice ? { ...room, layout: 'practice' } : room, seed), 1024);
    // Drop everything from the old level.
    for (const v of this.slimes.values()) this.scene.remove(v.group);
    this.slimes.clear();
    this.effects.clear();
    this.camPlaced = false; // snap to the new level's spot instead of gliding across
    this.minimap.setLevel(this.dungeon.level.map);
    this.resize();
  }

  private currentBody(): FamiliarBody | null {
    return this.shownKind ? this.bodies[this.shownKind] : null;
  }

  private frame(timestamp: number): void {
    this.timer.update(timestamp);
    const dt = Math.min(this.timer.getDelta(), 0.1);
    this.time += dt;
    this.dungeon.update(this.time, dt, this.camFocus);
    this.sfx.setAmbience(0.25, 0, dt);
    const s = this.buffer.sample(performance.now() / 1000);
    if (s) this.apply(s, dt);
    this.effects.update(dt);
    this.numbers.update(dt);
    (this.quality ??= new AutoQuality(this.renderer)).frame(dt);
    // The tablet plays the same music as the hero.
    const latest = this.buffer.latest;
    this.sfx.music.play(latest && latest.state !== 'ready' ? latest.room : -1, !!latest?.boss);
    this.sfx.music.update();
    this.updateStick();
    this.updateCamera(dt);
    this.dungeon.fadeBetween(this.camera.position, this.camFocus, dt);
    this.renderer.render(this.scene, this.camera);
    this.updatePointers();
    this.onFrame?.();
  }

  private apply(s: Snapshot, dt: number): void {
    const e = this.dungeon.level.exit;
    const bossHall = this.dungeon.level.halls.find((hh) => hh.kind === 'boss');
    this.minimap.setVisible(!s.practice && (s.state === 'playing' || s.state === 'paused'));
    this.minimap.update(dt, {
      hero: { x: s.hero.x, z: s.hero.z, facing: s.hero.f },
      familiar: s.fam,
      exit: e ? { ...e, open: s.phase === 'cleared' && !s.rid } : null,
      chests: this.dungeon.level.chests,
      boss: bossHall && s.phase === 'fight' ? bossHall : null,
    });
    // Elf: placed and animated from the hero's motion.
    const h = s.hero;
    // The camera follows our creature (or the elf, before a creature is picked).
    if (s.fam) this.camGoal.set(s.fam.x, 0, s.fam.z);
    else this.camGoal.set(h.x, 0, h.z);
    this.pointers.elf.at = (this.pointers.elf.at ?? new THREE.Vector3()).set(h.x, 1.4, h.z);
    const bossKind = s.boss ? ROOMS[s.room]?.boss : undefined;
    const bossT = bossKind ? s.slimes.find((t) => SLIME_KIND_CODES[t[1]] === bossKind) : undefined;
    this.pointers.boss.at = bossT ? (this.pointers.boss.at ?? new THREE.Vector3()).set(bossT[2], 2, bossT[3]) : null;
    this.elf.group.position.set(h.x, 0, h.z);
    this.elf.group.visible = h.v === 1;
    this.elf.setGhost(h.i === 1);
    this.wardRing.visible = h.w === 1;
    if (h.w === 1) {
      this.wardRing.position.set(h.x, 0, h.z);
      this.wardRing.rotation.y += dt * 0.6;
    }
    this.elf.update(dt, { speed: h.s, moveYaw: h.m, facing: h.f, aiming: h.a === 1, dashing: h.d === 1 });
    const shielded = s.powers.some(([code]) => POWER_CODES[code] === 'shield');
    this.shieldBubble.visible = shielded;
    if (shielded) this.shieldBubble.position.set(h.x, 1.05, h.z);

    this.applyFamiliar(s, dt);

    // Enemies, keyed by id.
    const seen = new Set<number>();
    for (const t of s.slimes) {
      const [id, code] = t;
      const kind = SLIME_KIND_CODES[code] ?? 'beetle';
      seen.add(id);
      let v = this.slimes.get(id);
      if (!v) {
        if ((BEAST_KIND_LIST as string[]).includes(kind)) v = new BeastVisual(kind as BeastKind);
        else if ((ELEMENTAL_KIND_LIST as string[]).includes(kind)) v = new ElementalVisual(kind as ElementalKind);
        else v = createMonsterVisual(kind as MonsterKind);
        this.slimes.set(id, v);
        this.scene.add(v.group);
      }
      v.apply({ x: t[2], z: t[3], yaw: t[4], y: t[5], speed: t[6], act: t[7], mode: t[8], flash: t[9], stun: t[10], death: t[11], calm: t[12] ?? 0 }, dt, this.time);
    }
    for (const [id, v] of this.slimes) {
      if (seen.has(id)) continue;
      this.scene.remove(v.group);
      this.slimes.delete(id);
    }

    this.arrows.sync(s.arrows);
    this.globs.sync(s.globs, this.time);
    this.pickups.sync(s.pickups, dt, this.time);
    this.pools.sync(s.zones, dt, this.time);
    this.telegraph.sync(s.tels ?? [], this.time);
    this.dungeon.setExitOpen(s.phase === 'cleared' || s.phase === 'transition');
  }

  /** Our creature, its glow ring, the reach of its area spell, and (wolf) where a pounce would land. */
  private applyFamiliar(s: Snapshot, dt: number): void {
    const f = s.fam;
    const kind = f ? FAMILIAR_KINDS[f.k] : null;
    if (kind !== this.shownKind) {
      if (this.shownKind) this.bodies[this.shownKind].group.visible = false;
      this.shownKind = kind ?? null;
      if (kind) {
        this.bodies[kind].group.visible = true;
        const color = FAMILIARS[kind].color;
        (this.famRing.material as THREE.MeshBasicMaterial).color.setHex(color);
        (this.rangeRing.material as THREE.MeshBasicMaterial).color.setHex(color);
      }
    }
    this.famRing.visible = !!f;
    if (!f || !kind) {
      this.rangeRing.visible = this.pounceMark.visible = false;
      return;
    }
    const body = this.bodies[kind];
    body.group.position.set(f.x, f.y, f.z);
    body.group.rotation.y = f.h;
    body.update(dt, f.s, f.y > 0.05);
    this.famRing.position.set(f.x, 0.06, f.z);
    this.famRing.scale.setScalar(1 + Math.sin(this.time * 4) * 0.08);

    // Show the biggest area spell that's ready.
    const ready = new Set(s.cds.filter(([, secs]) => secs <= 0.05).map(([code]) => SPELL_IDS[code]));
    const area = FAMILIARS[kind].spells.filter((id) => ready.has(id) && SPELLS[id].radius > 0).sort((a, b) => SPELLS[b].radius - SPELLS[a].radius)[0];
    this.rangeRing.visible = !!area;
    if (area) {
      this.rangeRing.position.set(f.x, 0.06, f.z);
      this.rangeRing.scale.setScalar(SPELLS[area].radius);
    }

    this.pounceMark.visible = ready.has('pounce') && f.y < 0.05;
    if (this.pounceMark.visible) {
      const land = pounceLanding({ x: f.x, z: f.z }, null, f.h);
      this.pounceMark.position.set(land.x, 0.06, land.z);
      this.pounceMark.rotation.y = this.time;
    }
  }

  /**
   * Virtual joystick: put a finger down anywhere on the floor and a stick appears under it; drag
   * to steer (direction and speed), let go to stop. The room view stays fixed with north up, so
   * screen right is world +x and screen down is world +z.
   */
  private bindTouch(canvas: HTMLCanvasElement): void {
    canvas.style.touchAction = 'none';
    canvas.insertAdjacentHTML('afterend', '<div class="joy" hidden><div class="joy-knob"></div></div>');
    const base = canvas.parentElement!.querySelector<HTMLElement>('.joy')!;
    this.joy = { base, knob: base.querySelector<HTMLElement>('.joy-knob')! };
    canvas.addEventListener('pointerdown', (e) => {
      if (this.hud.isBlocked || this.stick) return;
      canvas.setPointerCapture(e.pointerId);
      this.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, z: 0 };
      base.style.left = `${e.clientX}px`;
      base.style.top = `${e.clientY}px`;
      this.joy.knob.style.transform = 'translate(-50%, -50%)';
      base.hidden = false;
    });
    canvas.addEventListener('pointermove', (e) => {
      const st = this.stick;
      if (!st || e.pointerId !== st.id) return;
      let dx = e.clientX - st.ox;
      let dy = e.clientY - st.oy;
      const len = Math.hypot(dx, dy);
      if (len > STICK_RADIUS) {
        dx *= STICK_RADIUS / len;
        dy *= STICK_RADIUS / len;
      }
      this.joy.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      // Strength 0..1 past a small dead zone, along the drag direction.
      const mag = Math.min(1, len / STICK_RADIUS);
      const strength = mag < STICK_DEAD_ZONE ? 0 : (mag - STICK_DEAD_ZONE) / (1 - STICK_DEAD_ZONE);
      // Inside the dead zone (but clearly pushed): a tiny vector, which only turns the creature.
      const k = strength > 0 ? strength : len > 8 ? 0.01 : 0;
      st.x = len ? (dx / Math.hypot(dx, dy)) * k : 0;
      st.z = len ? (dy / Math.hypot(dx, dy)) * k : 0;
      if (this.time - this.lastSteerSent >= STEER_SEND_INTERVAL) this.sendSteer();
    });
    const end = (e: PointerEvent) => {
      if (!this.stick || e.pointerId !== this.stick.id) return;
      this.stick = null;
      base.hidden = true;
      this.session.send({ type: 'steer', dx: 0, dz: 0 });
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private sendSteer(): void {
    const st = this.stick!;
    this.lastSteerSent = this.time;
    this.session.send({ type: 'steer', dx: Math.round(st.x * 1000) / 1000, dz: Math.round(st.z * 1000) / 1000 });
  }

  /** While the stick is held, keep telling the hero (so it keeps running after a pounce, say). */
  private updateStick(): void {
    if (this.stick && this.time - this.lastSteerSent >= STEER_SEND_INTERVAL) this.sendSteer();
  }

  /** Third person, always facing north: eases after the creature from behind and above. */
  private updateCamera(dt: number): void {
    if (!this.camPlaced) {
      this.camFocus.copy(this.camGoal);
      this.camPlaced = true;
    } else {
      this.camFocus.lerp(this.camGoal, 1 - Math.exp(-FOLLOW_LAG * dt));
    }
    // A bit further back on a tall (portrait) screen, so the sides aren't cramped.
    const d = FOLLOW_DISTANCE * (this.camera.aspect < 1 ? 1.35 : 1);
    this.camera.position.set(this.camFocus.x, Math.sin(FOLLOW_PITCH) * d, this.camFocus.z + Math.cos(FOLLOW_PITCH) * d);
    this.camera.lookAt(this.camFocus.x, 0.5, this.camFocus.z - 1);
  }

  /** Arrows at the screen edge toward the elf and the boss when they're off screen. */
  private updatePointers(): void {
    const v = new THREE.Vector3();
    for (const p of Object.values(this.pointers)) {
      if (!p.at) {
        p.el.hidden = true;
        continue;
      }
      v.copy(p.at).project(this.camera);
      const behind = v.z > 1;
      const onScreen = !behind && Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.92;
      p.el.hidden = onScreen;
      if (onScreen) continue;
      let x = behind ? -v.x : v.x;
      let y = behind ? -v.y : v.y;
      // Push out along the direction to the edge of a box clear of the top bar and spell buttons.
      const k = Math.min(EDGE / Math.max(Math.abs(x), 1e-6), (y > 0 ? EDGE_TOP : -EDGE_BOTTOM) / Math.max(Math.abs(y), 1e-6));
      x *= k;
      y *= k;
      const angle = Math.atan2(-y, x); // screen space, y down
      p.el.style.left = `${((x + 1) / 2) * innerWidth}px`;
      p.el.style.top = `${((1 - y) / 2) * innerHeight}px`;
      p.el.style.setProperty('--a', `${angle}rad`);
    }
  }

  private resize(): void {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }

}
