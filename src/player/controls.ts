import * as THREE from 'three';
import { clampToArena, pushOutOfCircles, type Circle } from '../game/combat';
import type { Elf } from './elf';
import { angleDelta } from './crab';

const WALK_SPEED = 7.5;
const DASH_SPEED = 24;
const DASH_TIME = 0.18;
const DASH_COOLDOWN = 0.8;
const RADIUS = 0.5;
const TURN_RATE = 14; // rad/s
const AIM_HOLD = 0.45; // seconds the elf keeps facing the shot direction

// Third-person camera: orbits the elf, kept well back by default.
const CAMERA_DISTANCE = 17;
const MIN_DISTANCE = 6;
const MAX_DISTANCE = 30;
const MIN_PITCH = 0.12;
const MAX_PITCH = 1.3;
const LOOK_HEIGHT = 1.3;
const MOUSE_SENSITIVITY = 0.0025;

const NO_KEYS = new Set<string>();

export interface Arena {
  half: number;
  wallHeight: number;
  obstacles: readonly Circle[];
}

const TOUCH_LOOK_SENSITIVITY = 0.006;

export type InputMode = 'mouse' | 'touch';

/**
 * The elf and its third-person camera. Two input modes:
 * - mouse: pointer lock; mouse orbits, WASD moves, Space dashes, hold left button to shoot.
 * - touch: driven by the on-screen controls through setMove / look / setTouchTrigger / queueDash.
 * Movement is relative to the camera; the elf stays inside the arena.
 */
export class Player {
  /** Feet position. */
  readonly position = new THREE.Vector3();
  /** Model yaw (front = local +Z). */
  facing = 0;
  readonly mode: InputMode;
  /** Fires when play starts or stops (pointer lock gained/lost, or touch play toggled). */
  onActiveChange?: (active: boolean) => void;
  onDash?: () => void;

  private readonly camera: THREE.PerspectiveCamera;
  private readonly dom: HTMLElement;
  private readonly elf: Elf;
  private readonly arena: Arena;
  private readonly keys = new Set<string>();
  private readonly velocity = new THREE.Vector3();
  private readonly knock = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private active = false;
  private mouseDown = false;
  private touchTrigger = false;
  private readonly moveInput = { x: 0, y: 0 }; // touch joystick: x right, y forward, length ≤ 1
  private yaw = 0;
  private pitch = 0.55;
  private distance = CAMERA_DISTANCE;
  private cameraDistance = CAMERA_DISTANCE;
  private aimTimer = 0;
  private aimFacing = 0;
  private dashTimer = 0;
  private dashQueued = false; // set on key-down so even a very quick tap dashes
  private dashCooldown = 0;
  private readonly dashDir = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera, dom: HTMLElement, elf: Elf, arena: Arena, mode: InputMode) {
    this.mode = mode;
    this.camera = camera;
    this.dom = dom;
    this.elf = elf;
    this.arena = arena;

    document.addEventListener('pointerlockchange', () => {
      if (this.mode === 'mouse') this.setActive(document.pointerLockElement === dom);
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.active || this.mode !== 'mouse') return;
      this.yaw -= e.movementX * MOUSE_SENSITIVITY;
      this.pitch = clamp(this.pitch + e.movementY * MOUSE_SENSITIVITY, MIN_PITCH, MAX_PITCH);
    });
    document.addEventListener('mousedown', (e) => {
      if (this.active && this.mode === 'mouse' && e.button === 0) this.mouseDown = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
    });
    dom.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.distance = clamp(this.distance * Math.exp(e.deltaY * 0.001), MIN_DISTANCE, MAX_DISTANCE);
      },
      { passive: false },
    );
    addEventListener('keydown', (e) => {
      if (!this.active) return;
      this.keys.add(e.code);
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) this.dashQueued = true;
      }
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  /** True while the player is in control (not paused / on a menu). */
  get isActive(): boolean {
    return this.active;
  }

  /** True while the shoot button is held. */
  get trigger(): boolean {
    return this.active && (this.mouseDown || this.touchTrigger);
  }

  /** Invulnerable during a dash. */
  get dashing(): boolean {
    return this.dashTimer > 0;
  }

  /** Start playing: grabs the mouse (mouse mode) or just enables the touch controls. */
  activate(): void {
    if (this.mode === 'touch') this.setActive(true);
    // Some browsers return a promise that rejects if called too soon after Esc; that's harmless.
    else Promise.resolve(this.dom.requestPointerLock()).catch(() => {});
  }

  /** Stop playing (pause / game over). */
  deactivate(): void {
    if (this.mode === 'touch') this.setActive(false);
    else if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Touch joystick: x right, y forward; clamped to length 1 (analog speed). */
  setMove(x: number, y: number): void {
    const len = Math.hypot(x, y);
    const k = len > 1 ? 1 / len : 1;
    this.moveInput.x = x * k;
    this.moveInput.y = y * k;
  }

  /** Touch camera drag, in screen pixels. */
  look(dxPixels: number, dyPixels: number): void {
    if (!this.active) return;
    this.yaw -= dxPixels * TOUCH_LOOK_SENSITIVITY;
    this.pitch = clamp(this.pitch + dyPixels * TOUCH_LOOK_SENSITIVITY, MIN_PITCH, MAX_PITCH);
  }

  setTouchTrigger(down: boolean): void {
    this.touchTrigger = down;
  }

  queueDash(): void {
    if (this.active) this.dashQueued = true;
  }

  private setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    if (!active) {
      this.keys.clear();
      this.mouseDown = this.touchTrigger = false;
      this.moveInput.x = this.moveInput.y = 0;
    }
    this.onActiveChange?.(active);
  }

  /** Horizontal direction the camera looks. */
  aimDirection(out: THREE.Vector3): THREE.Vector3 {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  /** Turn to face a shot for a moment, and play the bow animation. */
  faceShot(dir: THREE.Vector3): void {
    this.aimFacing = Math.atan2(dir.x, dir.z);
    this.aimTimer = AIM_HOLD;
    this.elf.shoot();
  }

  knockback(dirX: number, dirZ: number, strength: number): void {
    this.knock.set(dirX * strength, 0, dirZ * strength);
    this.elf.flinch();
  }

  spawn(x: number, z: number, yaw: number): void {
    this.position.set(x, 0, z);
    this.velocity.set(0, 0, 0);
    this.knock.set(0, 0, 0);
    this.yaw = yaw;
    this.facing = yaw + Math.PI;
    this.aimTimer = this.dashTimer = this.dashCooldown = 0;
    this.cameraDistance = this.distance;
    this.update(0, false);
  }

  update(dt: number, controlling: boolean): void {
    const k = controlling ? this.keys : NO_KEYS;
    this.aimTimer = Math.max(0, this.aimTimer - dt);
    this.dashTimer = Math.max(0, this.dashTimer - dt);
    this.dashCooldown = Math.max(0, this.dashCooldown - dt);

    // Input relative to the camera's yaw.
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    let fwd = +(k.has('KeyW') || k.has('ArrowUp')) - +(k.has('KeyS') || k.has('ArrowDown'));
    let strafe = +(k.has('KeyD') || k.has('ArrowRight')) - +(k.has('KeyA') || k.has('ArrowLeft'));
    let magnitude = 1;
    if (!fwd && !strafe && controlling) {
      // Analog touch joystick.
      fwd = this.moveInput.y;
      strafe = this.moveInput.x;
      magnitude = Math.hypot(fwd, strafe);
    }
    const wx = -sin * fwd + cos * strafe;
    const wz = -cos * fwd - sin * strafe;
    const wlen = Math.hypot(wx, wz);

    const wantsDash = controlling && this.dashQueued;
    this.dashQueued = false;
    if (wantsDash && this.dashCooldown === 0) {
      this.dashTimer = DASH_TIME;
      this.dashCooldown = DASH_COOLDOWN;
      // Dash where you're steering, or straight ahead if you aren't.
      if (wlen > 0) this.dashDir.set(wx / wlen, 0, wz / wlen);
      else this.dashDir.set(Math.sin(this.facing), 0, Math.cos(this.facing));
      this.onDash?.();
    }

    if (this.dashTimer > 0) {
      this.velocity.copy(this.dashDir).multiplyScalar(DASH_SPEED);
    } else {
      const speed = wlen > 0 ? (WALK_SPEED * magnitude) / wlen : 0;
      const blend = 1 - Math.exp(-14 * dt);
      this.velocity.x += (wx * speed - this.velocity.x) * blend;
      this.velocity.z += (wz * speed - this.velocity.z) * blend;
    }

    const pos = this.position;
    pos.x += (this.velocity.x + this.knock.x) * dt;
    pos.z += (this.velocity.z + this.knock.z) * dt;
    this.knock.multiplyScalar(Math.exp(-9 * dt));
    pushOutOfCircles(pos, RADIUS, this.arena.obstacles);
    clampToArena(pos, this.arena.half, RADIUS);

    // Face the last shot briefly, otherwise the direction of travel.
    const groundSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    const aiming = this.aimTimer > 0;
    let want = this.facing;
    if (aiming) want = this.aimFacing;
    else if (groundSpeed > 0.5) want = Math.atan2(this.velocity.x, this.velocity.z);
    const step = TURN_RATE * (aiming ? 2 : 1) * dt;
    this.facing += clamp(angleDelta(this.facing, want), -step, step);

    const g = this.elf.group;
    g.position.copy(pos);
    g.rotation.y = this.facing;
    this.elf.update(dt, {
      speed: Math.min(groundSpeed, WALK_SPEED),
      moveYaw: groundSpeed > 0.3 ? Math.atan2(this.velocity.x, this.velocity.z) : this.facing,
      facing: this.facing,
      aiming,
      dashing: this.dashTimer > 0,
    });

    this.updateCamera(dt);
  }

  private updateCamera(dt: number): void {
    this.target.copy(this.position).y += LOOK_HEIGHT;
    const cp = Math.cos(this.pitch);
    const dx = Math.sin(this.yaw) * cp;
    const dy = Math.sin(this.pitch);
    const dz = Math.cos(this.yaw) * cp;

    // Don't let the walls block the view: pull in if the camera would end up behind a wall
    // (outside the arena and below the wall top). Ease back out afterwards.
    const { half, wallHeight } = this.arena;
    let allowed = this.distance;
    const steps = 20;
    for (let i = 1; i <= steps; i++) {
      const d = (this.distance * i) / steps;
      const x = this.target.x + dx * d;
      const y = this.target.y + dy * d;
      const z = this.target.z + dz * d;
      const outside = Math.abs(x) > half - 0.5 || Math.abs(z) > half - 0.5;
      if (outside && y < wallHeight + 0.5) {
        allowed = Math.max(2.5, (this.distance * (i - 1)) / steps);
        break;
      }
    }
    this.cameraDistance =
      allowed < this.cameraDistance || dt === 0
        ? allowed
        : this.cameraDistance + (allowed - this.cameraDistance) * (1 - Math.exp(-3 * dt));

    const d = this.cameraDistance;
    this.camera.position.set(this.target.x + dx * d, this.target.y + dy * d, this.target.z + dz * d);
    this.camera.lookAt(this.target);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
