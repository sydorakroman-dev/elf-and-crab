import * as THREE from 'three';
import { attachAtPivot, loadParts } from './rig';
import { toonify } from './toon';
import { Spring, angleDelta, cadence, damp, legPose, splitBody } from './gait';
import { HEROES, type HeroClass, type WeaponLook } from '../game/heroes';

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
/** The hands, in their elbow's frame (where the placeholder weapons are held). */
const BOW_HAND = new THREE.Vector3(1.33, 2.96, 0.22).sub(BOW_ELBOW);
const DRAW_HAND = new THREE.Vector3(-0.84, 2.41, 0.08).sub(DRAW_ELBOW);
/** Parts recoloured for the other heroes (main colour / second colour), and the archer's kit hidden for them. */
const MAIN_PARTS = /^(vest|hips_vest|cloak|hood)/;
const SECOND_PARTS = /^(shirt|hips_shirt|armL_upper$|armR_upper$|armL_lower_sleeve)/;
const ARCHER_KIT = /bow|^quiver|^arrow_/;
const SHIELD_TURN = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -0.35, 0));

/** Parts too small or thin for an outline (it would swallow them). */
const NO_OUTLINE = /^head_(eye|iris|pupil|shine|lid|brow|mouth|nose|circlet)|bowstring|_nock|_wrap|fletch|^arrow_|gem|_ring|buckle|shirt_lapel|vest_edge|_strand|strap$/;

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

  private ghostly = false;

  /** Wind Walk: see-through, no outline. */
  setGhost(on: boolean): void {
    if (on === this.ghostly) return;
    this.ghostly = on;
    this.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      if (o.userData.outline) {
        o.visible = !on;
        return;
      }
      const m = o.material as THREE.Material;
      m.transparent = on;
      m.opacity = on ? 0.28 : 1;
      m.depthWrite = !on;
      m.needsUpdate = true;
    });
  }

  /** Release: the string snaps forward and the bow kicks; then it's redrawn (others: a swing, a cast, a throw). */
  shoot(): void {
    this.recoil = 1;
    this.draw = 0;
    this.swing = 1;
    this.swingSide = -this.swingSide;
  }

  /** The knight raises the shield (Shield Wall). */
  setGuard(on: boolean): void {
    this.guard = on;
  }

  private heroClass: HeroClass = 'elf';
  private weaponLook: WeaponLook = 'bow';
  private readonly weapons = new THREE.Group();
  private readonly offWeapons = new THREE.Group();
  private swing = 0;
  private swingSide = 1;
  private guard = false;
  private guardAmount = 0;
  private shield: THREE.Group | null = null;

  get hero(): HeroClass {
    return this.heroClass;
  }

  /**
   * Dresses the model as hero `h` (placeholder until each hero has its own model): its colours,
   * and its weapon in hand instead of the bow and quiver.
   */
  setHeroClass(h: HeroClass): void {
    if (h === this.heroClass && this.weapons.parent) return;
    this.heroClass = h;
    const def = HEROES[h];
    this.weaponLook = def.weapon;
    this.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || o.userData.outline || o.parent === this.weapons || o.parent === this.offWeapons) return;
      const name = o.name;
      const mat = o.material as THREE.MeshToonMaterial;
      if (!o.userData.ownMat) {
        o.material = mat.clone(); // its own, so recolouring one part leaves the others alone
        o.userData.ownMat = true;
        o.userData.baseColor = (o.material as THREE.MeshToonMaterial).color.getHex();
      }
      const m = o.material as THREE.MeshToonMaterial;
      const base = o.userData.baseColor as number;
      if (h !== 'elf' && MAIN_PARTS.test(name)) m.color.setHex(def.colors[0]);
      else if (h !== 'elf' && SECOND_PARTS.test(name)) m.color.setHex(def.colors[1]);
      else m.color.setHex(base);
      if (ARCHER_KIT.test(name)) o.visible = h === 'elf';
    });
    this.buildWeapons(def.weapon, def.colors[0]);
  }

  private buildWeapons(look: WeaponLook, main: number): void {
    for (const g of [this.weapons, this.offWeapons]) {
      g.parent?.remove(g);
      g.clear();
    }
    this.shield = null;
    if (look === 'bow') return;
    const toon = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.5, ...extra });
    const steel = toon(0xd8dde4, { metalness: 0.7, roughness: 0.3 });
    const wood = toon(0x7a4a26);
    const gold = toon(0xe0b040, { metalness: 0.7, roughness: 0.35 });
    const add = (g: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      m.name = 'weapon';
      g.add(m);
      return m;
    };
    /** A blade standing up from the hand: grip, guard, blade. */
    const blade = (g: THREE.Group, length: number, width: number) => {
      add(g, new THREE.CylinderGeometry(0.06, 0.06, 0.55, 6), wood, 0, 0, 0);
      add(g, new THREE.BoxGeometry(width * 3.5, 0.1, 0.14), gold, 0, 0.3, 0);
      add(g, new THREE.BoxGeometry(width, length, 0.05), steel, 0, 0.35 + length / 2, 0);
      add(g, new THREE.ConeGeometry(width * 0.7, 0.3, 4), steel, 0, 0.5 + length, 0);
      add(g, new THREE.SphereGeometry(0.09, 8, 6), gold, 0, -0.32, 0);
    };
    switch (look) {
      case 'swordShield': {
        blade(this.weapons, 2.4, 0.16);
        // A round shield on the other forearm, facing forward.
        // (Turned every frame to face the way the hero faces, whatever the arm is doing.)
        const shield = new THREE.Group();
        add(shield, new THREE.CylinderGeometry(0.85, 0.85, 0.12, 20), toon(main), 0, 0, 0, Math.PI / 2);
        add(shield, new THREE.TorusGeometry(0.85, 0.06, 6, 20), gold, 0, 0, 0);
        add(shield, new THREE.SphereGeometry(0.2, 10, 8), gold, 0, 0, 0.08);
        shield.position.set(-0.1, 0.1, 0.3);
        this.offWeapons.add(shield);
        this.shield = shield;
        break;
      }
      case 'staff': {
        add(this.weapons, new THREE.CylinderGeometry(0.07, 0.09, 4.4, 7), wood, 0, 0.8, 0);
        add(this.weapons, new THREE.TorusGeometry(0.28, 0.06, 6, 12), gold, 0, 3.05, 0);
        const orb = add(this.weapons, new THREE.SphereGeometry(0.26, 14, 10), new THREE.MeshStandardMaterial({ color: 0x9fd0ff, emissive: 0x4f8fff, emissiveIntensity: 1.4 }), 0, 3.05, 0);
        orb.name = 'weapon_orb';
        break;
      }
      case 'twinBlades':
        blade(this.weapons, 1.7, 0.2);
        blade(this.offWeapons, 1.7, 0.2);
        break;
      case 'spear':
        add(this.weapons, new THREE.CylinderGeometry(0.06, 0.06, 4.6, 6), wood, 0, 0.9, 0);
        add(this.weapons, new THREE.ConeGeometry(0.16, 0.7, 5), steel, 0, 3.55, 0);
        add(this.weapons, new THREE.TorusGeometry(0.1, 0.035, 5, 8).rotateX(Math.PI / 2), gold, 0, 3.15, 0);
        break;
    }
    this.weapons.position.copy(BOW_HAND);
    this.bowElbow.add(this.weapons);
    if (this.offWeapons.children.length) {
      this.offWeapons.position.copy(DRAW_HAND);
      this.drawElbow.add(this.offWeapons);
    }
    toonify(this.weapons, /^$/);
    toonify(this.offWeapons, /^$/);
  }

  /** Recoil from a hit: a jolt back, the head snapping, a stagger. */
  flinch(): void {
    this.flinchAmount = 1;
    this.stagger = 1;
  }

  /** End-of-run poses, played on top of everything: falling over, or bow raised in triumph. */
  setPose(pose: 'none' | 'dead' | 'victory'): void {
    if (pose === this.pose) return;
    this.pose = pose;
    this.poseT = 0;
    if (pose === 'none') {
      this.body.rotation.set(0, 0, 0);
      this.body.position.set(0, 0, 0);
    }
  }

  /** Advances the end pose while the game itself is stopped (game over / victory screen). */
  updatePose(dt: number): void {
    if (this.pose === 'none') return;
    this.poseT += dt;
    this.time += dt;
    const k = Math.min(1, this.poseT / 0.9);
    const ease = 1 - Math.pow(1 - k, 3);
    if (this.pose === 'dead') {
      // Knees buckle, then a fall onto the side.
      for (const leg of this.legs) {
        leg.hip.rotation.x = -0.9 * ease;
        leg.knee.rotation.x = 1.6 * ease;
      }
      // Topple sideways about the feet, settling on the ground (the body is ~2 m tall).
      const fall = 1.35 * Math.max(0, (k - 0.3) / 0.7) ** 2;
      this.body.rotation.set(-0.15 * ease, 0, fall);
      this.body.position.set(Math.sin(fall) * 0.55, -0.2 * ease + Math.sin(fall) * 0.12, 0);
      this.torso.rotation.set(0.3 * ease, 0, 0);
      this.head.rotation.set(0.4 * ease, 0, 0.3 * ease);
      this.drawShoulder.rotation.set(0.6 * ease, 0, -0.9 * ease);
      this.bowShoulder.rotation.set(0.5 * ease, 0, 0.9 * ease);
    } else {
      // Victory: bow raised high, a little bounce.
      const bounce = Math.abs(Math.sin(this.poseT * 4)) * 0.06;
      this.body.position.y = bounce;
      this.bowShoulder.rotation.set(-2.6 * ease, 0, -0.2 * ease);
      this.bowElbow.rotation.set(0, 0, 0.1);
      this.drawShoulder.rotation.set(-0.3, 0.3, -0.5 * ease);
      this.torso.rotation.set(-0.12 * ease, 0, 0);
      this.head.rotation.set(-0.25 * ease, Math.sin(this.poseT * 1.5) * 0.15, 0);
      for (const leg of this.legs) {
        leg.hip.rotation.x = 0;
        leg.knee.rotation.x = 0;
      }
    }
  }

  /** Arms for the heroes who don't use a bow: carried weapons, swings, casts, throws, the shield. */
  private heroArms(dt: number, s: number, move: number): void {
    this.swing = Math.max(0, this.swing - dt * 3.6);
    this.guardAmount = damp(this.guardAmount, this.guard ? 1 : 0, 12, dt);
    const p = 1 - this.swing; // swing progress 0 → 1
    const active = this.swing > 0;
    const sw = Math.sin(p * Math.PI);
    // Carried: weapon arm low and a little forward, swaying with the walk.
    const carry = -0.35 - s * 0.12 * move;
    let bx = carry;
    let by = 0;
    let bz = -0.25;
    let ex = -0.5;
    switch (this.weaponLook) {
      case 'swordShield':
      case 'twinBlades': {
        if (active && (this.weaponLook === 'swordShield' || this.swingSide > 0)) {
          // A sweeping cut: from high on the outside, across and down.
          bx = -2.2 + 2.6 * p;
          by = 0.8 - 1.9 * p;
          bz = -0.3;
          ex = -0.3;
        }
        break;
      }
      case 'staff':
        // Staff planted ahead; thrust forward with each bolt.
        bx = -0.5 - 0.9 * sw;
        ex = -0.2 - 0.3 * sw;
        break;
      case 'spear':
        if (active) {
          // Overhand throw.
          bx = -2.8 + 3.4 * p;
          by = 0.2;
          ex = -0.6 + 0.6 * p;
        }
        break;
    }
    this.bowShoulder.rotation.set(bx, by, bz);
    this.bowElbow.rotation.set(ex, 0, 0);
    // The other arm: the knight's shield, the barbarian's second blade, otherwise a free swing.
    if (this.weaponLook === 'swordShield') {
      const g = this.guardAmount;
      this.drawShoulder.rotation.set(-0.4 - 0.9 * g, 0.3 + 0.4 * g, -0.2);
      this.drawElbow.rotation.x = -1.1 - 0.3 * g;
      if (this.shield) {
        // Face forward (angled out a little), whatever the arm's doing.
        this.drawElbow.updateWorldMatrix(true, false);
        const parent = this.drawElbow.getWorldQuaternion(new THREE.Quaternion()).invert();
        const body = this.group.getWorldQuaternion(new THREE.Quaternion());
        this.shield.quaternion.copy(parent.multiply(body).multiply(SHIELD_TURN));
      }
    } else if (this.weaponLook === 'twinBlades') {
      if (active && this.swingSide < 0) this.drawShoulder.rotation.set(-2.2 + 2.6 * p, -0.8 + 1.9 * p, 0.3);
      else this.drawShoulder.rotation.set(-0.35 + s * 0.12 * move, 0, 0.25);
      this.drawElbow.rotation.x = -0.5;
    }
  }

  private pose: 'none' | 'dead' | 'victory' = 'none';
  private poseT = 0;
  /** A hit stagger: a step back and a twist, decaying. */
  private stagger = 0;

  update(dt: number, m: ElfMotion): void {
    if (dt <= 0) return;
    if (this.pose !== 'none') {
      this.group.rotation.y = m.facing;
      this.updatePose(dt);
      return;
    }
    this.time += dt;
    this.stagger = Math.max(0, this.stagger - dt * 3);

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
    if (this.weaponLook !== 'bow') this.heroArms(dt, s, move);

    // --- Hit stagger: the whole body rocks back and twists, then recovers ------------------------
    if (this.stagger > 0) {
      const st = Math.sin(this.stagger * Math.PI) * this.stagger;
      this.body.rotation.x = -0.28 * st;
      this.body.rotation.z = 0.12 * st;
      this.body.position.z = -0.25 * st;
    } else {
      this.body.rotation.x = this.body.rotation.z = 0;
      this.body.position.z = 0;
    }

    // --- Cloth and hair: springs driven by speed, acceleration, turning and bounce -----------------
    const bounce = Math.cos(this.phase * 2) * 0.05 * move;
    this.cloak.rotation.x = this.cloakPitch.update(0.08 + 0.26 * move + 0.45 * this.dash - this.accel * 0.01 + bounce * 0.6, dt);
    this.cloak.rotation.z = this.cloakRoll.update(THREE.MathUtils.clamp(this.turnRate * 0.06, -0.35, 0.35), dt);
    this.ponytail.rotation.x = this.tailPitch.update(0.05 + 0.35 * move + 0.5 * this.dash - bounce * 2, dt);
    this.ponytail.rotation.z = this.tailRoll.update(THREE.MathUtils.clamp(this.turnRate * 0.08, -0.4, 0.4) + s * 0.06 * move, dt);
  }
}
