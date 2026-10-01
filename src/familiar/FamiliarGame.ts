import * as THREE from 'three';
import { Dungeon } from '../world/dungeon';
import { ROOMS } from '../world/rooms';
import { TelegraphRings } from '../game/telegraph';
import { BeastVisual } from '../game/beastVisual';
import { ElementalVisual } from '../game/elementalVisual';
import type { Elf } from '../player/elf';
import type { FamiliarBody } from '../player/beasts';
import { ELEMENTAL_KIND_LIST, SLIME_KIND_LIST, SlimeVisual, type BeastKind, type ElementalKind, type SlimeKind, type SlimePose } from '../game/enemies';
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
import type { FamiliarSession, FamiliarStatus } from '../net/client';
import { FamiliarHud } from './hud';
import { floorPoint, overviewDistance } from './input';

const FOV = 40;
const PITCH = 1.22; // radians down from horizontal: a high, slightly tilted overview
const MOVE_SEND_INTERVAL = 0.1; // throttle drag commands to 10 Hz
const EVENT_DELAY_MS = 100; // play events in step with the interpolation delay
const STUN_STAR = new THREE.Color(0xfff27a);
const CALM_PINK = new THREE.Color(0xffb8dc);
const SPRING_BLUE = new THREE.Color(0x8fe8f5);

/**
 * The familiar's tablet: a top-down view of the whole arena, drawn from the hero's snapshots.
 * Pick a creature, tap or drag on the floor to move it, and tap the spell buttons to cast.
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
  private readonly session: FamiliarSession;
  private readonly hud: FamiliarHud;
  private readonly buffer = new SnapshotBuffer(0.1);
  /** Every enemy on screen, keyed by id: slimes and beasts draw differently. */
  private readonly slimes = new Map<number, SlimeVisual | BeastVisual | ElementalVisual>();
  private readonly arrows = new Arrows();
  private readonly globs = new Globs();
  private readonly pickups = new Pickups();
  private readonly pools = new SpringPools();
  private readonly effects = new Effects();
  private readonly sfx = new Sfx();
  private readonly shieldBubble: THREE.Mesh;
  private readonly famRing: THREE.Mesh;
  private readonly rangeRing: THREE.Mesh;
  private readonly marker: THREE.Mesh;
  private readonly pounceMark: THREE.Mesh;
  private readonly raycaster = new THREE.Raycaster();
  private markerAge = 99;
  private time = 0;
  private lastMoveSent = -1;
  private dragging = false;
  private lastTap: { x: number; z: number } | null = null;
  private shownKind: FamiliarKind | null = null;
  private status: FamiliarStatus = 'connecting';
  private onFrame?: () => void;

  constructor(renderer: THREE.WebGLRenderer, root: HTMLElement, elf: Elf, bodies: Record<FamiliarKind, FamiliarBody>, session: FamiliarSession) {
    this.renderer = renderer;
    this.elf = elf;
    this.bodies = bodies;
    this.session = session;
    this.dungeon = new Dungeon(this.scene, ROOMS[0], 1024);
    for (const b of Object.values(bodies)) b.group.visible = false;

    const additive = (color: number, opacity: number) =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.shieldBubble = new THREE.Mesh(new THREE.IcosahedronGeometry(1.25, 2), additive(POWER_UPS.shield.color, 0.18));
    this.shieldBubble.visible = false;
    // A glowing ring under your creature so it's easy to find, and the reach of its area spell.
    this.famRing = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.3, 40).rotateX(-Math.PI / 2), additive(0xffffff, 0.7));
    this.rangeRing = new THREE.Mesh(new THREE.RingGeometry(0.975, 1, 72).rotateX(-Math.PI / 2), additive(0xffffff, 0.28));
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.75, 32).rotateX(-Math.PI / 2), additive(0xffffff, 0));
    // Where a pounce would land (wolf only).
    this.pounceMark = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.85, 6).rotateX(-Math.PI / 2), additive(0xd9cbb0, 0.6));
    for (const m of [this.famRing, this.rangeRing, this.marker, this.pounceMark]) m.position.y = 0.06;
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
      this.rangeRing,
      this.marker,
      this.pounceMark,
      this.telegraph.group,
    );

    this.hud = new FamiliarHud(root, session.code);
    this.hud.onStart = () => this.sfx.unlock();
    this.hud.onChoose = (kind) => this.session.send({ type: 'choose', kind });
    this.hud.onSpell = (id) => this.session.send({ type: 'spell', id });
    bodies.crab.onStep = (s) => this.sfx.scuttle(s);
    bodies.wolf.onStep = (s) => this.sfx.scuttle(s * 0.6);
    bodies.capybara.onStep = (s) => this.sfx.footstep(s * 0.4);

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
    if (s.room !== ROOMS.indexOf(this.dungeon.room)) this.loadRoom(s.room);
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
          this.effects.burst(ev.x, 1, ev.z, new THREE.Color(PROJECTILES[PROJECTILE_KINDS[ev.k ?? 0] ?? 'glob'].color), 10, 4, 0.12);
          break;
        case 'spit':
          this.sfx.spit();
          break;
        case 'spell':
          this.playSpell(SPELL_IDS[ev.id], ev.x, ev.z, famColor);
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
          this.effects.burst(ev.x, 1.1, ev.z, new THREE.Color(def.color), 18, 5, 0.12);
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
        case 'door':
          this.sfx.door();
          this.hud.popups.toast('↑ The elf can head through the north door', 0xffe0a0);
          break;
        case 'twang':
          break; // the bow is the elf's sound; keep the tablet calmer
      }
    }
  }

  private playSpell(id: (typeof SPELL_IDS)[number] | undefined, x: number, z: number, color: THREE.Color): void {
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
    }
  }

  private loadRoom(index: number): void {
    const room = ROOMS[index];
    if (!room) return;
    this.dungeon.dispose(this.scene);
    this.dungeon = new Dungeon(this.scene, room, 1024);
    // Drop everything from the old room.
    for (const v of this.slimes.values()) this.scene.remove(v.group);
    this.slimes.clear();
    this.effects.clear();
    this.resize();
  }

  private currentBody(): FamiliarBody | null {
    return this.shownKind ? this.bodies[this.shownKind] : null;
  }

  private frame(timestamp: number): void {
    this.timer.update(timestamp);
    const dt = Math.min(this.timer.getDelta(), 0.1);
    this.time += dt;
    this.dungeon.update(this.time, dt);
    this.sfx.setAmbience(0.25, 0, dt);
    const s = this.buffer.sample(performance.now() / 1000);
    if (s) this.apply(s, dt);
    this.effects.update(dt);
    this.updateMarker(dt);
    this.renderer.render(this.scene, this.camera);
    this.onFrame?.();
  }

  private apply(s: Snapshot, dt: number): void {
    // Elf: placed and animated from the hero's motion.
    const h = s.hero;
    this.elf.group.position.set(h.x, 0, h.z);
    this.elf.group.visible = h.v === 1;
    this.elf.update(dt, { speed: h.s, moveYaw: h.m, facing: h.f, aiming: h.a === 1, dashing: h.d === 1 });
    const shielded = s.powers.some(([code]) => POWER_CODES[code] === 'shield');
    this.shieldBubble.visible = shielded;
    if (shielded) this.shieldBubble.position.set(h.x, 1.05, h.z);

    this.applyFamiliar(s, dt);

    // Enemies, keyed by id.
    const seen = new Set<number>();
    for (const t of s.slimes) {
      const [id, code] = t;
      const kind = SLIME_KIND_CODES[code] ?? 'small';
      seen.add(id);
      let v = this.slimes.get(id);
      if (!v) {
        if ((SLIME_KIND_LIST as string[]).includes(kind)) v = new SlimeVisual(kind as SlimeKind);
        else if ((ELEMENTAL_KIND_LIST as string[]).includes(kind)) v = new ElementalVisual(kind as ElementalKind);
        else v = new BeastVisual(kind as BeastKind);
        this.slimes.set(id, v);
        this.scene.add(v.group);
      }
      if (v instanceof SlimeVisual) {
        const pose: SlimePose = { x: t[2], z: t[3], yaw: t[4], y: t[5], sx: t[6], sy: t[7], sz: t[8], flash: t[9], stun: t[10], death: t[11], calm: t[12] ?? 0 };
        v.apply(pose, this.time);
      } else {
        v.apply({ x: t[2], z: t[3], yaw: t[4], y: t[5], speed: t[6], act: t[7], mode: t[8], flash: t[9], stun: t[10], death: t[11], calm: t[12] ?? 0 }, dt, this.time);
      }
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
    this.dungeon.setExitOpen(s.phase !== 'fight');
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
      const land = pounceLanding({ x: f.x, z: f.z }, this.lastTap, f.h);
      this.pounceMark.position.set(land.x, 0.06, land.z);
      this.pounceMark.rotation.y = this.time;
    }
  }

  private bindTouch(canvas: HTMLCanvasElement): void {
    canvas.style.touchAction = 'none';
    const pointer = new THREE.Vector2();
    const send = (e: PointerEvent, force: boolean) => {
      if (this.hud.isBlocked) return;
      pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
      this.raycaster.setFromCamera(pointer, this.camera);
      const { origin, direction } = this.raycaster.ray;
      const p = floorPoint(origin, direction, this.dungeon.half, 1);
      if (!p) return;
      this.lastTap = p;
      this.marker.position.set(p.x, 0.06, p.z);
      this.markerAge = 0;
      if (!force && this.time - this.lastMoveSent < MOVE_SEND_INTERVAL) return;
      this.lastMoveSent = this.time;
      this.session.send({ type: 'move', x: Math.round(p.x * 100) / 100, z: Math.round(p.z * 100) / 100 });
    };
    canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      canvas.setPointerCapture(e.pointerId);
      send(e, true);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.dragging) send(e, false);
    });
    const end = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      send(e, true); // make sure the final spot is sent
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', () => (this.dragging = false));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private updateMarker(dt: number): void {
    this.markerAge += dt;
    const k = Math.min(1, this.markerAge / 0.6);
    (this.marker.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.9;
    this.marker.scale.setScalar(1 + k * 0.8);
  }

  private resize(): void {
    const aspect = innerWidth / innerHeight;
    this.camera.aspect = aspect;
    const d = overviewDistance(this.dungeon.half, FOV, PITCH, aspect);
    // Look at the arena centre from the south, high up.
    this.camera.position.set(0, Math.sin(PITCH) * d, Math.cos(PITCH) * d + 1);
    this.camera.lookAt(0, 0, 1);
    this.camera.updateProjectionMatrix();
    // The hero's fog is tuned for a close camera; push it back for the overview.
    const fog = this.scene.fog as THREE.Fog;
    fog.near = d * 0.9;
    fog.far = d * 1.8;
    this.renderer.setSize(innerWidth, innerHeight);
  }
}
