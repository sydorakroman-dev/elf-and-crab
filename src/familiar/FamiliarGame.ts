import * as THREE from 'three';
import { mulberry32 } from '../util/rng';
import { ARENA_HALF, Dungeon } from '../world/dungeon';
import type { Elf } from '../player/elf';
import type { Crab } from '../player/crab';
import { SlimeVisual, type SlimePose } from '../game/enemies';
import { Arrows } from '../game/arrows';
import { GLOB_COLOR, Globs } from '../game/globs';
import { Pickups } from '../game/pickups';
import { Effects } from '../game/effects';
import { Sfx } from '../game/audio';
import { BURST_RADIUS } from '../game/companion';
import { POWER_UPS } from '../game/powerups';
import { POWER_CODES, SLIME_KIND_CODES, SnapshotBuffer, type GameEvent, type Snapshot } from '../net/snapshot';
import type { FamiliarSession, FamiliarStatus } from '../net/client';
import { FamiliarHud } from './hud';
import { floorPoint, overviewDistance } from './input';

const FOV = 40;
const PITCH = 1.22; // radians down from horizontal: a high, slightly tilted overview
const CRAB_COLOR = 0x6fe8d6;
const MOVE_SEND_INTERVAL = 0.1; // throttle drag commands to 10 Hz
const EVENT_DELAY_MS = 100; // play events in step with the interpolation delay

/**
 * The familiar's tablet: a top-down view of the whole arena, drawn from the hero's snapshots.
 * Tap or drag on the floor to send the crab there; the ✨ button fires a Magic Burst.
 * Runs no game logic itself — the hero's browser is the source of truth.
 */
export class FamiliarGame {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV, innerWidth / innerHeight, 0.5, 400);
  private readonly timer = new THREE.Timer();
  private readonly dungeon: Dungeon;
  private readonly elf: Elf;
  private readonly crab: Crab;
  private readonly session: FamiliarSession;
  private readonly hud: FamiliarHud;
  private readonly buffer = new SnapshotBuffer(0.1);
  private readonly slimes = new Map<number, SlimeVisual>();
  private readonly arrows = new Arrows();
  private readonly globs = new Globs();
  private readonly pickups = new Pickups();
  private readonly effects = new Effects();
  private readonly sfx = new Sfx();
  private readonly shieldBubble: THREE.Mesh;
  private readonly crabRing: THREE.Mesh;
  private readonly burstRange: THREE.Mesh;
  private readonly marker: THREE.Mesh;
  private readonly raycaster = new THREE.Raycaster();
  private markerAge = 99;
  private time = 0;
  private lastMoveSent = -1;
  private dragging = false;
  private status: FamiliarStatus = 'connecting';
  private onFrame?: () => void;

  constructor(renderer: THREE.WebGLRenderer, root: HTMLElement, elf: Elf, crab: Crab, session: FamiliarSession) {
    this.renderer = renderer;
    this.elf = elf;
    this.crab = crab;
    this.session = session;
    this.dungeon = new Dungeon(this.scene, mulberry32(1337), 1024);
    crab.group.visible = false;

    const additive = (color: number, opacity: number) =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.shieldBubble = new THREE.Mesh(new THREE.IcosahedronGeometry(1.25, 2), additive(POWER_UPS.shield.color, 0.18));
    this.shieldBubble.visible = false;
    // A glowing ring under your crab so it's easy to find, and the Burst's reach around it.
    this.crabRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.25, 40).rotateX(-Math.PI / 2), additive(CRAB_COLOR, 0.7));
    this.burstRange = new THREE.Mesh(new THREE.RingGeometry(BURST_RADIUS - 0.12, BURST_RADIUS, 64).rotateX(-Math.PI / 2), additive(CRAB_COLOR, 0.25));
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.75, 32).rotateX(-Math.PI / 2), additive(0xffffff, 0));
    this.crabRing.position.y = this.burstRange.position.y = this.marker.position.y = 0.06;
    this.crabRing.visible = this.burstRange.visible = false;

    this.scene.add(
      elf.group,
      crab.group,
      this.arrows.group,
      this.globs.group,
      this.pickups.group,
      this.effects.mesh,
      this.effects.rings,
      this.shieldBubble,
      this.crabRing,
      this.burstRange,
      this.marker,
    );

    this.hud = new FamiliarHud(root, session.code);
    this.hud.onStart = () => this.sfx.unlock();
    this.hud.onBurst = () => {
      if (this.hud.isBlocked) return;
      this.session.send({ type: 'burst' });
    };
    crab.onStep = (s) => this.sfx.scuttle(s);

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
    if (s === 'no-room' || s === 'room-full' || s === 'hero-left') {
      this.hud.setBlocking(s, this.session.code);
    }
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
    }
    this.hud.setStatus(text);
  }

  private receive(s: Snapshot): void {
    this.buffer.push(s, performance.now() / 1000);
    if (s.ev.length) {
      const events = s.ev;
      window.setTimeout(() => this.playEvents(events), EVENT_DELAY_MS);
    }
    this.hud.update(s);
    this.refreshStatusPill(s);
  }

  private playEvents(events: GameEvent[]): void {
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
          this.effects.burst(ev.x, 1, ev.z, GLOB_COLOR, 10, 4, 0.12);
          break;
        case 'spit':
          this.sfx.spit();
          break;
        case 'burst':
          this.effects.ring(ev.x, ev.z, CRAB_COLOR, BURST_RADIUS);
          this.effects.burst(ev.x, 0.8, ev.z, new THREE.Color(CRAB_COLOR), 30, 7, 0.14);
          this.crab.pinch();
          this.sfx.burst();
          break;
        case 'pinch':
          this.crab.pinch();
          this.sfx.hit();
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
        case 'twang':
          break; // the bow is the elf's sound; keep the tablet calmer
      }
    }
  }

  private frame(timestamp: number): void {
    this.timer.update(timestamp);
    const dt = Math.min(this.timer.getDelta(), 0.1);
    this.time += dt;
    this.dungeon.update(this.time);
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

    // Our crab.
    const c = s.crab;
    this.crab.group.visible = this.crabRing.visible = c !== null;
    this.burstRange.visible = c !== null && s.burstCd <= 0.05;
    if (c) {
      this.crab.group.position.set(c.x, 0, c.z);
      this.crab.group.rotation.y = c.h;
      this.crab.update(dt, c.s, false);
      this.crabRing.position.set(c.x, 0.06, c.z);
      this.crabRing.scale.setScalar(1 + Math.sin(this.time * 4) * 0.08);
      this.burstRange.position.set(c.x, 0.06, c.z);
    }

    // Slimes, keyed by id.
    const seen = new Set<number>();
    for (const t of s.slimes) {
      const [id, kind] = t;
      seen.add(id);
      let v = this.slimes.get(id);
      if (!v) {
        v = new SlimeVisual(SLIME_KIND_CODES[kind] ?? 'small');
        this.slimes.set(id, v);
        this.scene.add(v.group);
      }
      const pose: SlimePose = { x: t[2], z: t[3], yaw: t[4], y: t[5], sx: t[6], sy: t[7], sz: t[8], flash: t[9], stun: t[10], death: t[11] };
      v.apply(pose, this.time);
    }
    for (const [id, v] of this.slimes) {
      if (seen.has(id)) continue;
      this.scene.remove(v.group);
      this.slimes.delete(id);
    }

    this.arrows.sync(s.arrows);
    this.globs.sync(s.globs, this.time);
    this.pickups.sync(s.pickups, dt, this.time);
  }

  private bindTouch(canvas: HTMLCanvasElement): void {
    canvas.style.touchAction = 'none';
    const pointer = new THREE.Vector2();
    const send = (e: PointerEvent, force: boolean) => {
      if (this.hud.isBlocked) return;
      pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
      this.raycaster.setFromCamera(pointer, this.camera);
      const { origin, direction } = this.raycaster.ray;
      const p = floorPoint(origin, direction, ARENA_HALF, 1);
      if (!p) return;
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
    const d = overviewDistance(ARENA_HALF, FOV, PITCH, aspect);
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
