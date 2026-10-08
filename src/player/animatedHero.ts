import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { toonify } from './toon';
import { damp } from './gait';
import type { ElfMotion } from './elf';

/** How tall a hero stands (m), whatever size the delivered model is. */
const HEIGHT = 2.05;
/** The attack clip is squeezed into about this long (s), to keep up with the game's swings. */
const ATTACK_TIME = 0.75;
/** Ground speeds (m/s) the walk and run clips look right at. */
const WALK_SPEED = 2.6;
const RUN_SPEED = 7;

/**
 * A hero delivered as an animated model (docs/hero-model-spec.md, prepared by
 * scripts/models/prepare-hero.mjs): rigid parts on bones, with clips Idle / Walk / Run / Attack and
 * optionally Skill / Jump / Hit / Death / Victory. Locomotion blends by speed (played backwards when
 * backing off); the attack and the skill play over it; a hit, death and victory are played from
 * clips where the model has them, otherwise done by moving the whole body.
 */
export class AnimatedHero {
  /** Wrapper: the hit flinch / fall / lean are applied here, the model's own clips inside. */
  readonly group = new THREE.Group();
  onStep?: (strength: number) => void;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private readonly weights = { Idle: 1, Walk: 0, Run: 0 };
  private flinchT = 0;
  private lean = 0;
  private pose: 'none' | 'dead' | 'victory' = 'none';
  private poseT = 0;
  private stepPhase = 0;
  private ghost = false;

  static async load(url: string): Promise<AnimatedHero | null> {
    try {
      const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
      return new AnimatedHero(gltf.scene, gltf.animations);
    } catch {
      return null; // no such model: the hero keeps its built one
    }
  }

  private constructor(model: THREE.Object3D, clips: THREE.AnimationClip[]) {
    // Stand it HEIGHT tall, feet on the ground.
    const box = new THREE.Box3().setFromObject(model);
    const k = HEIGHT / Math.max(0.01, box.max.y - box.min.y);
    model.scale.multiplyScalar(k);
    model.position.y -= box.min.y * k;
    model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    toonify(model, /^$/);
    this.group.add(model);
    this.mixer = new THREE.AnimationMixer(model);
    for (const clip of clips) this.actions.set(clip.name, this.mixer.clipAction(clip));
    for (const name of ['Idle', 'Walk', 'Run'] as const) {
      const a = this.actions.get(name);
      if (!a) continue;
      a.play();
      a.setEffectiveWeight(this.weights[name]);
    }
  }

  private one(name: string, duration?: number, fade = 0.08): boolean {
    const a = this.actions.get(name);
    if (!a) return false;
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = false;
    a.timeScale = duration ? a.getClip().duration / duration : 1;
    a.setEffectiveWeight(1);
    a.fadeIn(fade).play();
    return true;
  }

  /** The basic attack (also what the game calls a "shot"). */
  attack(): void {
    this.one('Attack', ATTACK_TIME, 0.04);
  }

  /** A skill's flourish (a roar, a jump…), if the model has that clip. */
  special(name: string): void {
    if (!this.one(name, undefined, 0.15) && name === 'Skill') this.one('Attack', ATTACK_TIME);
  }

  flinch(): void {
    if (!this.one('Hit', 0.35, 0.04)) this.flinchT = 1;
  }

  setPose(pose: 'none' | 'dead' | 'victory'): void {
    if (pose === this.pose) return;
    this.pose = pose;
    this.poseT = 0;
    this.group.rotation.set(0, 0, 0);
    this.group.position.set(0, 0, 0);
    if (pose === 'dead') {
      this.mixer.stopAllAction();
      if (this.one('Death')) this.actions.get('Death')!.clampWhenFinished = true;
    } else if (pose === 'victory') {
      this.mixer.stopAllAction();
      const a = this.actions.get('Victory') ?? this.actions.get('Skill') ?? this.actions.get('Idle');
      a?.reset().setLoop(THREE.LoopRepeat, Infinity).setEffectiveWeight(1).play();
    } else {
      this.mixer.stopAllAction();
      for (const name of ['Idle', 'Walk', 'Run'] as const) this.actions.get(name)?.reset().play();
    }
  }

  /** The end pose keeps playing while the game is stopped. */
  updatePose(dt: number): void {
    if (this.pose === 'none') return;
    this.poseT += dt;
    this.mixer.update(dt);
    if (this.pose === 'dead' && !this.actions.has('Death')) {
      // No death clip: buckle, then keel over sideways.
      const k = Math.min(1, this.poseT / 0.9);
      const fall = 1.45 * Math.max(0, (k - 0.25) / 0.75) ** 2;
      this.group.rotation.set(-0.15 * k, 0, fall);
      this.group.position.set(Math.sin(fall) * 0.6, -0.15 * k, 0);
    }
  }

  setGhost(on: boolean): void {
    if (on === this.ghost) return;
    this.ghost = on;
    this.group.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh) return;
      if (o.userData.outline) {
        o.visible = !on;
        return;
      }
      const m = (o as THREE.Mesh).material as THREE.Material;
      m.transparent = on;
      m.opacity = on ? 0.28 : 1;
      m.depthWrite = !on;
      m.needsUpdate = true;
    });
  }

  update(dt: number, m: ElfMotion): void {
    if (dt <= 0) return;
    if (this.pose !== 'none') {
      this.updatePose(dt);
      return;
    }
    // Locomotion: idle → walk → run by speed; played backwards when backing away.
    const speed = m.speed;
    const run = THREE.MathUtils.clamp((speed - 3.5) / 3, 0, 1);
    const move = THREE.MathUtils.clamp(speed / 1.6, 0, 1);
    const target = { Idle: 1 - move, Walk: move * (1 - run), Run: move * run };
    const back = speed > 0.5 && Math.cos(m.moveYaw - m.facing) < -0.3 ? -1 : 1;
    // While attacking, the attack has the body (the legs keep a little of their stride).
    const attack = this.actions.get('Attack');
    const busy = attack?.isRunning() ? 0.2 : 1;
    for (const name of ['Idle', 'Walk', 'Run'] as const) {
      this.weights[name] = damp(this.weights[name], target[name], 10, dt);
      const a = this.actions.get(name);
      if (!a) continue;
      a.setEffectiveWeight(this.weights[name] * busy + 1e-4);
      if (name === 'Walk') a.timeScale = back * THREE.MathUtils.clamp(speed / WALK_SPEED, 0.6, 1.8);
      if (name === 'Run') a.timeScale = back * THREE.MathUtils.clamp(speed / RUN_SPEED, 0.7, 1.5);
    }
    this.mixer.update(dt);

    // Footsteps: twice per walk / run cycle.
    const lead = this.weights.Run > this.weights.Walk ? this.actions.get('Run') : this.actions.get('Walk');
    if (lead && move > 0.15) {
      const phase = Math.floor((lead.time / lead.getClip().duration) * 2);
      if (phase !== this.stepPhase) this.onStep?.(move);
      this.stepPhase = phase;
    }

    // Whole-body touches: a flinch when hit (no Hit clip), a lean into a dash.
    this.flinchT = Math.max(0, this.flinchT - dt * 4);
    this.lean = damp(this.lean, m.dashing ? 1 : 0, 18, dt);
    const f = Math.sin(this.flinchT * Math.PI) * this.flinchT;
    this.group.rotation.set(-0.3 * f + 0.3 * this.lean, 0, 0.1 * f);
    this.group.position.set(0, 0, -0.2 * f);
  }
}
