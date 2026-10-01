import * as THREE from 'three';
import { attachAtPivot, loadParts } from './rig';
import { toonify } from './toon';
import { Spring, angleDelta, cadence, damp, legPose, splitBody } from './gait';

const MODEL_SCALE = 0.42; // model is ~4.8 units tall → ~2 m
const ORIGIN = new THREE.Vector3();

// Joint positions in model space (Y up, front +Z, bow hand on +X).
const HIPS = new THREE.Vector3(0, 2.45, 0);
const TORSO = new THREE.Vector3(0, 2.6, 0);
const NECK = new THREE.Vector3(0, 3.95, 0);
const hipJoint = (side: number) => new THREE.Vector3(side * 0.29, 2.35, 0);
const kneeJoint = (side: number) => new THREE.Vector3(side * 0.42, 1.42, 0);
const DRAW_SHOULDER = new THREE.Vector3(-0.5, 3.5, 0);
const DRAW_ELBOW = new THREE.Vector3(-0.8, 3.0, 0.02);
const BOW_SHOULDER = new THREE.Vector3(0.5, 3.5, 0);
const BOW_ELBOW = new THREE.Vector3(0.85, 3.08, 0.04);

/** Parts too small or thin for an outline (it would swallow them). */
const NO_OUTLINE = /^head_(eye|iris|pupil|shine|lid|brow|blush|mouth|nose|circlet)|bowstring|_nock|fletch|^arrow_|gem|brooch|tunic_(trim|vneck)|strap$/;

/** Removes and returns every part whose name starts with one of the prefixes. */
function takePrefix(parts: Map<string, THREE.Mesh>, ...prefixes: string[]): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  for (const [name, mesh] of parts) {
    if (!prefixes.some((p) => name.startsWith(p))) continue;
    parts.delete(name);
    found.push(mesh);
  }
  return found;
}

export interface ElfMotion {
  /** Ground speed, m/s. */
  speed: number;
  /** World yaw of the direction of travel. */
  moveYaw: number;
  /** World yaw the upper body faces (model front = +Z). */
  facing: number;
  aiming: boolean;
  dashing: boolean;
}

interface Leg {
  side: number;
  hip: THREE.Group;
  knee: THREE.Group;
}

/**
 * The elf archer (public/models/elf.glb, built by scripts/models/build-elf.mjs), rigged in code
 * by part-name prefix (hips_, thigh_<side>, shin_<side>, armL_/armR_ upper/lower, cloak, head,
 * tail) with hips, knees, a torso that can
 * twist against the hips, a head, shoulders and elbows. Animation: a walk/run cycle with knee
 * lift, hip sway and counter-rotating shoulders; legs follow the direction of travel while the
 * torso faces the aim (strafing, backpedalling); leaning into speed, turns and dashes; spring
 * physics on the cloak and ponytail; idle breathing and glances; a bow draw and release; a flinch.
 */
export class Elf {
  readonly group = new THREE.Group();
  /** Called when a foot lands while walking; `strength` 0..1 follows speed. */
  onStep?: (strength: number) => void;

  private readonly body = new THREE.Group();
  private readonly hips: THREE.Group;
  private readonly torso: THREE.Group;
  private readonly head: THREE.Group;
  private readonly legs: Leg[] = [];
  private readonly drawShoulder: THREE.Group;
  private readonly drawElbow: THREE.Group;
  private readonly bowShoulder: THREE.Group;
  private readonly bowElbow: THREE.Group;
  private readonly cloak: THREE.Group;
  private readonly ponytail: THREE.Group;

  private time = 0;
  private phase = 0;
  private move = 0; // smoothed effort 0..1
  private hipYaw = 0;
  private direction = 1;
  private lastFacing: number | null = null;
  private turnRate = 0; // smoothed yaw velocity, rad/s
  private lastSpeed = 0;
  private accel = 0; // smoothed forward acceleration, m/s²
  private aim = 0;
  private draw = 0; // 0 string relaxed → 1 fully drawn
  private recoil = 0;
  private flinchAmount = 0;
  private dash = 0;
  private idleTime = 0;
  private glance = 0;
  private glanceTarget = 0;
  private readonly lean = new Spring(0, 90, 13);
  private readonly roll = new Spring(0, 80, 12);
  private readonly cloakPitch = new Spring(0.1, 45, 5);
  private readonly cloakRoll = new Spring(0, 40, 5);
  private readonly tailPitch = new Spring(0.05, 35, 4);
  private readonly tailRoll = new Spring(0, 30, 4);

  static async load(url: string): Promise<Elf> {
    return new Elf(await loadParts(url));
  }

  private constructor(parts: Map<string, THREE.Mesh>) {
    this.body.scale.setScalar(MODEL_SCALE);
    this.group.add(this.body);

    // Lower body: hips carry the skirt and both legs (thigh → knee → shin and boot).
    this.hips = attachAtPivot(this.body, ORIGIN, HIPS, takePrefix(parts, 'hips_'));
    for (const side of [1, -1]) {
      const hip = attachAtPivot(this.hips, HIPS, hipJoint(side), takePrefix(parts, `thigh_${side}`));
      const knee = attachAtPivot(hip, hipJoint(side), kneeJoint(side), takePrefix(parts, `shin_${side}`));
      this.legs.push({ side, hip, knee });
    }

    // Upper body: torso → shoulders → elbows (the bow rides the bow hand), cloak, head → ponytail.
    this.torso = attachAtPivot(this.body, ORIGIN, TORSO, []);
    this.drawShoulder = attachAtPivot(this.torso, TORSO, DRAW_SHOULDER, takePrefix(parts, 'armL_upper'));
    this.drawElbow = attachAtPivot(this.drawShoulder, DRAW_SHOULDER, DRAW_ELBOW, takePrefix(parts, 'armL_lower'));
    this.bowShoulder = attachAtPivot(this.torso, TORSO, BOW_SHOULDER, takePrefix(parts, 'armR_upper'));
    this.bowElbow = attachAtPivot(this.bowShoulder, BOW_SHOULDER, BOW_ELBOW, takePrefix(parts, 'armR_lower'));
    this.cloak = attachAtPivot(this.torso, TORSO, new THREE.Vector3(0, 3.55, -0.35), takePrefix(parts, 'cloak'));
    this.head = attachAtPivot(this.torso, TORSO, NECK, takePrefix(parts, 'head'));
    const tailAt = new THREE.Vector3(0, 4.4, -0.2);
    this.ponytail = attachAtPivot(this.head, NECK, tailAt, takePrefix(parts, 'tail'));

    // Everything else (tunic, belt, quiver, arrows, neck…) rides on the torso.
    for (const mesh of parts.values()) {
      mesh.position.copy(TORSO).negate();
      this.torso.add(mesh);
    }

    // Cartoon look: toon shading, and outlines on everything but the small face details and trims.
    toonify(this.group, NO_OUTLINE);
  }

  /** Release: the string snaps forward and the bow kicks; then it's redrawn. */
  shoot(): void {
    this.recoil = 1;
    this.draw = 0;
  }

  /** Recoil from a hit. */
  flinch(): void {
    this.flinchAmount = 1;
  }

  update(dt: number, m: ElfMotion): void {
    if (dt <= 0) return;
    this.time += dt;

    // --- Smoothed drivers ------------------------------------------------------------------
    this.move = damp(this.move, Math.min(1, m.speed / 7), 8, dt);
    const move = this.move;
    const yawVel = this.lastFacing === null ? 0 : angleDelta(this.lastFacing, m.facing) / dt;
    this.lastFacing = m.facing;
    this.turnRate = damp(this.turnRate, yawVel, 10, dt);
    this.accel = damp(this.accel, (m.speed - this.lastSpeed) / dt, 6, dt);
    this.lastSpeed = m.speed;
    this.aim = damp(this.aim, m.aiming ? 1 : 0, 16, dt);
    this.draw = damp(this.draw, m.aiming ? 1 : 0, 9, dt);
    this.recoil = Math.max(0, this.recoil - dt * 5);
    this.flinchAmount = Math.max(0, this.flinchAmount - dt * 4);
    this.dash = damp(this.dash, m.dashing ? 1 : 0, 20, dt);

    // Legs follow the travel direction; the torso keeps facing the aim.
    const split = m.speed > 0.3 ? splitBody(m.facing, m.moveYaw) : { hipYaw: 0, direction: this.direction as 1 | -1 };
    this.hipYaw = damp(this.hipYaw, split.hipYaw, 10, dt);
    this.direction = split.direction;
    this.group.rotation.y = m.facing;

    // --- Walk / run cycle ------------------------------------------------------------------
    const before = Math.floor(this.phase / Math.PI);
    this.phase += dt * cadence(m.speed) * this.direction * (move > 0.02 ? 1 : 0.5);
    if (move > 0.15 && Math.floor(this.phase / Math.PI) !== before) this.onStep?.(move);

    for (const leg of this.legs) {
      const pose = legPose(this.phase + (leg.side > 0 ? 0 : Math.PI), move);
      // Dash: stretch into a long stride with the back leg trailing.
      leg.hip.rotation.x = pose.hip + this.dash * (leg.side > 0 ? -0.55 : 0.45);
      leg.knee.rotation.x = pose.knee + this.dash * (leg.side > 0 ? 0.2 : 0.7);
      // Legs splay a touch outward when running, like a real stride.
      leg.hip.rotation.z = leg.side * 0.03 * move;
    }

    const s = Math.sin(this.phase);
    // Body is lowest when the legs are furthest apart, highest as they pass; crouches when running.
    this.body.position.y = ((1 - Math.abs(s)) * 0.07 - 0.04) * move + Math.sin(this.time * 1.6) * 0.006 * (1 - move) - this.dash * 0.08;
    // Hips twist with the leg swing and roll over the planted leg.
    this.hips.rotation.set(0, this.hipYaw + s * 0.14 * move, s * 0.05 * move);

    // --- Torso: counter-rotation, lean into speed / acceleration / turns, breathing, flinch ------
    const breathe = Math.sin(this.time * 1.7) * 0.018 * (1 - move);
    const leanTarget = 0.1 * move + THREE.MathUtils.clamp(this.accel * 0.02, -0.12, 0.15) + 0.35 * this.dash - 0.4 * this.flinchAmount + breathe;
    const rollTarget = THREE.MathUtils.clamp(-this.turnRate * 0.035, -0.22, 0.22) * (0.3 + move);
    this.torso.rotation.set(this.lean.update(leanTarget, dt), -s * 0.12 * move * (1 - this.aim) + 0.18 * this.aim, this.roll.update(rollTarget, dt));

    // --- Head: stay level, glance around when idle, look where you aim ---------------------------
    if (move < 0.05 && this.aim < 0.1) {
      this.idleTime += dt;
      if (this.idleTime > 2.5 && Math.random() < dt * 0.5) this.glanceTarget = (Math.random() * 2 - 1) * 0.6;
    } else {
      this.idleTime = 0;
      this.glanceTarget = 0;
    }
    this.glance = damp(this.glance, this.glanceTarget, 3, dt);
    this.head.rotation.set(
      -this.torso.rotation.x * 0.6 + 0.15 * this.flinchAmount,
      -this.torso.rotation.y * 0.8 + this.glance,
      -this.torso.rotation.z * 0.5,
    );

    // --- Arms -------------------------------------------------------------------------------
    // Free (draw) arm swings opposite the left leg; elbow bends more when running.
    const armSwing = -s * (0.25 + 0.55 * move);
    const relaxed = 1 - this.aim;
    this.drawShoulder.rotation.set(
      (armSwing - 0.05) * relaxed + (-1.35 - 0.1 * this.draw) * this.aim - 0.5 * this.dash * relaxed,
      0.55 * this.aim,
      (-0.12 - 0.08 * move) * relaxed,
    );
    this.drawElbow.rotation.x = -(0.2 + 0.9 * move + 0.25 * Math.max(0, -armSwing)) * relaxed - (0.3 + 1.1 * this.draw) * this.aim;

    // Bow arm hangs lower and sways a little while moving; the elbow cancels most of the swing so
    // the bow stays roughly upright, as if carried. Swings forward to present the bow when aiming.
    const bowSwing = s * (0.06 + 0.12 * move) * relaxed;
    this.bowShoulder.rotation.set(bowSwing + 0.12 * this.recoil, (-Math.PI / 2) * this.aim, -0.45 * relaxed + 0.1 * this.recoil * this.aim);
    this.bowElbow.rotation.set(-bowSwing * 0.85 - 0.05 * relaxed, 0, 0.35 * relaxed);

    // --- Cloth and hair: springs driven by speed, acceleration, turning and bounce -----------------
    const bounce = Math.cos(this.phase * 2) * 0.05 * move;
    this.cloak.rotation.x = this.cloakPitch.update(0.08 + 0.26 * move + 0.45 * this.dash - this.accel * 0.01 + bounce * 0.6, dt);
    this.cloak.rotation.z = this.cloakRoll.update(THREE.MathUtils.clamp(this.turnRate * 0.06, -0.35, 0.35), dt);
    this.ponytail.rotation.x = this.tailPitch.update(0.05 + 0.35 * move + 0.5 * this.dash - bounce * 2, dt);
    this.ponytail.rotation.z = this.tailRoll.update(THREE.MathUtils.clamp(this.turnRate * 0.08, -0.4, 0.4) + s * 0.06 * move, dt);
  }
}
