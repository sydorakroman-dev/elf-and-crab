import * as THREE from 'three';
import { attachAtPivot, bounds, loadParts } from '../player/rig';
import { glowTexture } from '../util/glow';
import type { BeastPose } from './beastVisual';
import type { MonsterKind } from './enemies';

type Rig = 'biped' | 'crawler' | 'worm' | 'ghost' | 'blob';

/** Model files (public/models/<group>/) and how tall each stands in the world, in metres. */
export const MONSTER_MODELS: Record<Exclude<MonsterKind, 'inferno'>, { file: string; height: number; rig: Rig; hover?: boolean }> = {
  // Goblins (Crystal Cave)
  brawler: { file: 'goblins/scrap-brawler.glb', height: 1.45, rig: 'biped' },
  rotor: { file: 'goblins/rotor-scout.glb', height: 1.45, rig: 'biped', hover: true },
  riveter: { file: 'goblins/rivet-shooter.glb', height: 1.45, rig: 'biped' },
  lobber: { file: 'goblins/bomb-lobber.glb', height: 1.45, rig: 'biped' },
  tinkerer: { file: 'goblins/boiler-tinkerer.glb', height: 1.55, rig: 'biped' },
  scrapboss: { file: 'goblins/scrap-boss.glb', height: 3.4, rig: 'biped' },
  // Undead (Crypt)
  skeleton: { file: 'undead/skeleton-warrior.glb', height: 1.9, rig: 'biped' },
  skelarcher: { file: 'undead/skeleton-archer.glb', height: 1.9, rig: 'biped' },
  ghost: { file: 'undead/ghost.glb', height: 1.9, rig: 'ghost', hover: true },
  zombie: { file: 'undead/zombie-brute.glb', height: 2.3, rig: 'biped' },
  knight: { file: 'undead/undead-knight.glb', height: 2.2, rig: 'biped' },
  necromancer: { file: 'undead/necromancer.glb', height: 3.2, rig: 'biped' },
  // Orcs (Throne Room)
  orcscout: { file: 'orcs/scout.glb', height: 2.0, rig: 'biped' },
  orcwarrior: { file: 'orcs/warrior.glb', height: 2.2, rig: 'biped' },
  orcarcher: { file: 'orcs/archer.glb', height: 2.1, rig: 'biped' },
  shaman: { file: 'orcs/shaman.glb', height: 2.1, rig: 'biped' },
  shieldguard: { file: 'orcs/shield-guard.glb', height: 2.4, rig: 'biped' },
  chieftain: { file: 'orcs/chieftain.glb', height: 3.5, rig: 'biped' },
  // Underworld dwellers (Flooded Hall)
  spider: { file: 'underworld/cave-spider.glb', height: 1.3, rig: 'crawler' },
  ooze: { file: 'underworld/slime.glb', height: 1.5, rig: 'blob' },
  sporecrawler: { file: 'underworld/spore-crawler.glb', height: 1.3, rig: 'crawler' },
  mushroom: { file: 'underworld/mushroom-monster.glb', height: 2.1, rig: 'biped' },
  mold: { file: 'underworld/living-mold.glb', height: 2.3, rig: 'biped' },
  caveworm: { file: 'underworld/cave-worm.glb', height: 4.6, rig: 'worm' },
};
type ModelKind = keyof typeof MONSTER_MODELS;

const templates = new Map<ModelKind, { parts: Map<string, THREE.Mesh>; height: number }>();

/** Loads all monster models once; call before any monster is created. */
export async function loadMonsterTemplates(base: string): Promise<void> {
  const kinds = Object.keys(MONSTER_MODELS) as ModelKind[];
  const loaded = await Promise.all(kinds.map((k) => loadParts(`${base}models/${MONSTER_MODELS[k].file}`).catch(() => null)));
  kinds.forEach((k, i) => {
    const parts = loaded[i];
    if (!parts) return;
    let top = 0;
    for (const m of parts.values()) top = Math.max(top, bounds(m).max.y);
    templates.set(k, { parts, height: top || 1 });
  });
}

// Part roles, by name. Sides are -1 / 1 (written "leg_-1", "arm1", "mech_leg-1"…).
const LEG = /^(leg|foot|mushroom_leg)[_-]?(-1|1)$/;
const MECH_LEG = /^mech_(leg|foot)(-1|1)$/;
const ARM = /^(arm|hand|fist|oversized_fist|ghost_arm)[_-]?(-1|1)$/;
const MECH_ARM = /^mech_(arm|fist)(-1|1)$/;
const MANY_LEGS = /leg(-?1)(\d)$/; // spider / crawler legs: leg-10 … leg13
const HELD = /^(axe|sword|mace|hammer|bow|shield|round_shield|staff|wrench|mechanical_fist|knuckles|launcher|barrel_opening|crank|clockwork_bomb|clock_)/;
const HEAD = /^(head|jaw|eye|pupil|brow|mouth|ear|nose|tusk|leather_cap|goggle|hood|topknot|beard|nose_hole|tooth|spider_head|spider_eye|fang|mold_head|dark_face|mold_eye|ghost_head|dark_eye|crawler_head|worm_eye|big_mushroom|cap_spot)/;
const SPIN = /^propeller/;
const BOB = /^(floating_drop|spore$)/;

const CALM_TINT = new THREE.Color(0xf3c6ff);
const STUN_TINT = new THREE.Color(0xd8ecff);
const FLASH = new THREE.Color(0xff2020);
const ORIGIN = new THREE.Vector3();

const centre = (m: THREE.Mesh) => bounds(m).getCenter(new THREE.Vector3());

/**
 * One goblin / undead / orc / underworld monster, rigged in code from its part-named model:
 * legs swing from the hips, arms (and whatever they hold) from the shoulders, the head bobs;
 * spiders scuttle, worms sway, ghosts float, slimes wobble. Wind-ups raise the arms (or rear the
 * body up), attacks thrust forward. `y` below zero sinks it into the ground (the worm burrowing).
 */
export class MonsterVisual {
  readonly group = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly legs: { pivot: THREE.Group; side: number }[] = [];
  private readonly arms: { pivot: THREE.Group; side: number }[] = [];
  private readonly manyLegs: { pivot: THREE.Group; side: number; i: number }[] = [];
  private head: THREE.Group | null = null;
  private readonly spinners: THREE.Object3D[] = [];
  private readonly bobbers: { o: THREE.Object3D; y: number }[] = [];
  private readonly mats: { m: THREE.MeshStandardMaterial; color: THREE.Color; emissive: THREE.Color; intensity: number }[] = [];
  private readonly stars = new THREE.Group();
  private readonly rig: Rig;
  private readonly hover: boolean;
  private readonly scale: number;
  private phase = Math.random() * 10;

  constructor(kind: ModelKind) {
    const def = MONSTER_MODELS[kind];
    this.rig = def.rig;
    this.hover = !!def.hover;
    const template = templates.get(kind);
    this.scale = def.height / (template?.height ?? 1);
    this.group.add(this.body);
    this.body.scale.setScalar(this.scale);
    if (template) this.build(template.parts);
    else {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1, 0.5).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0x777777 }));
      this.body.add(box);
      this.track(box);
    }
    const starMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xfff27a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Sprite(starMat);
      s.scale.setScalar(0.35);
      const a = (i / 3) * Math.PI * 2;
      s.position.set(Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5);
      this.stars.add(s);
    }
    this.stars.position.y = def.height + 0.3;
    this.stars.visible = false;
    this.group.add(this.stars);
  }

  private track(mesh: THREE.Mesh): void {
    const m = (mesh.material as THREE.MeshStandardMaterial).clone();
    mesh.material = m;
    this.mats.push({ m, color: m.color.clone(), emissive: m.emissive.clone(), intensity: m.emissiveIntensity });
  }

  private build(template: Map<string, THREE.Mesh>): void {
    const parts = new Map<string, THREE.Mesh>();
    for (const [name, mesh] of template) {
      const clone = mesh.clone();
      clone.castShadow = true;
      this.track(clone);
      parts.set(name, clone);
    }
    const take = (test: (n: string) => boolean) =>
      [...parts.keys()].filter(test).map((n) => {
        const m = parts.get(n)!;
        parts.delete(n);
        return m;
      });
    // A goblin riding a mech: the mech's limbs move, the rider stays put.
    const mech = parts.has('mech_leg-1');
    const legRe = mech ? MECH_LEG : LEG;
    const armRe = mech ? MECH_ARM : ARM;

    if (this.rig === 'crawler') {
      for (const m of take((n) => MANY_LEGS.test(n))) {
        const [, side, i] = MANY_LEGS.exec(m.name)!;
        const b = bounds(m);
        const s = Number(side);
        // Pivot at the leg's inner, upper end (where it joins the body).
        const at = new THREE.Vector3(s > 0 ? b.min.x : b.max.x, b.max.y, (b.min.z + b.max.z) / 2);
        this.manyLegs.push({ pivot: attachAtPivot(this.body, ORIGIN, at, [m]), side: s, i: Number(i) });
      }
    }

    const heldBySide = new Map<number, THREE.Mesh[]>([[-1, []], [1, []]]);
    const held = take((n) => HELD.test(n));
    const handCentre = (side: number) => {
      const hand = [...parts.values()].find((m) => armRe.exec(m.name)?.[2] === String(side) && /hand|fist/.test(m.name));
      return hand ? centre(hand) : new THREE.Vector3(side * 0.5, 0.5, 0);
    };
    for (const m of held) {
      const c = centre(m);
      const side = c.distanceTo(handCentre(-1)) < c.distanceTo(handCentre(1)) ? -1 : 1;
      heldBySide.get(side)!.push(m);
    }

    for (const side of [-1, 1]) {
      const legParts = take((n) => legRe.exec(n)?.[2] === String(side));
      const main = legParts.find((m) => /leg/.test(m.name)) ?? legParts[0];
      if (main) {
        const b = bounds(main);
        this.legs.push({ pivot: attachAtPivot(this.body, ORIGIN, new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2), legParts), side });
      }
      const armParts = [...take((n) => armRe.exec(n)?.[2] === String(side)), ...heldBySide.get(side)!];
      const anchor = armParts.find((m) => /arm/.test(m.name)) ?? armParts[0];
      if (anchor) {
        const b = bounds(anchor);
        const at = new THREE.Vector3(side > 0 ? b.min.x : b.max.x, b.max.y - (b.max.y - b.min.y) * 0.1, (b.min.z + b.max.z) / 2);
        this.arms.push({ pivot: attachAtPivot(this.body, ORIGIN, at, armParts), side });
      }
    }

    // The head (and everything on it). On the mech, the rider's head stays with the rider.
    const headParts = take((n) => HEAD.test(n));
    if (headParts.length) {
      const anchor = headParts.find((m) => /^(head|spider_head|mold_head|ghost_head|crawler_head)$/.test(m.name)) ?? headParts[0];
      const b = bounds(anchor);
      this.head = attachAtPivot(this.body, ORIGIN, new THREE.Vector3((b.min.x + b.max.x) / 2, b.min.y, (b.min.z + b.max.z) / 2), headParts);
    }
    for (const m of parts.values()) {
      this.body.add(m);
      if (SPIN.test(m.name)) {
        // Spin about its own centre.
        const c = centre(m);
        const pivot = attachAtPivot(this.body, ORIGIN, c, [m]);
        this.spinners.push(pivot);
      } else if (BOB.test(m.name)) this.bobbers.push({ o: m, y: 0 });
    }
  }

  apply(p: BeastPose, dt: number, time: number): void {
    const g = this.group;
    const hover = this.hover ? 0.3 + Math.sin(time * 2.4 + this.phase) * 0.12 : 0;
    g.position.set(p.x, p.y + hover, p.z);
    g.rotation.y = p.yaw;
    const life = 1 - p.death;
    g.scale.setScalar(Math.max(0.001, life));
    g.rotation.z = p.death * 0.9;

    const move = Math.min(1, p.speed / 4);
    const stunned = p.stun > 0.5 && p.death === 0;
    const calm = !stunned && p.calm > 0.5 && p.death === 0;
    if (!stunned) this.phase += dt * (2 + Math.min(p.speed, 8) * 2.2);
    const s = Math.sin(this.phase);

    for (const leg of this.legs) leg.pivot.rotation.x = s * leg.side * 0.55 * move;
    for (const leg of this.manyLegs) {
      // Alternate legs sweep back and forth, and lift.
      const k = Math.sin(this.phase * 1.6 + leg.i * 1.3 + (leg.side > 0 ? Math.PI : 0));
      leg.pivot.rotation.y = k * 0.35 * Math.max(move, 0.15);
      leg.pivot.rotation.z = leg.side * Math.max(0, k) * 0.2 * move;
    }
    for (const arm of this.arms) {
      let x = -s * arm.side * 0.4 * move;
      if (p.mode === 1) x = -1.7 * p.act; // raised: winding up / casting
      else if (p.mode === 2) x = -1.3; // thrown forward
      arm.pivot.rotation.x = x;
      arm.pivot.rotation.z = this.rig === 'ghost' ? Math.sin(time * 3 + arm.side) * 0.2 * arm.side : 0;
    }
    if (this.head) this.head.rotation.x = Math.sin(time * 1.7 + this.phase) * 0.05 + (p.mode === 2 ? 0.15 : 0);

    // Whole-body moves.
    const b = this.body;
    b.rotation.set(0, 0, 0);
    b.scale.setScalar(this.scale);
    b.position.y = 0;
    if (this.rig === 'biped') b.position.y = Math.abs(s) * 0.05 * move;
    if (this.rig === 'crawler') {
      b.position.y = Math.abs(Math.sin(this.phase * 1.6)) * 0.04 * move;
      if (p.mode === 1) b.rotation.x = -0.35 * p.act; // rear up
      else if (p.mode === 2) b.rotation.x = 0.15;
    } else if (this.rig === 'worm') {
      b.rotation.z = Math.sin(time * 1.8 + this.phase) * 0.08;
      b.rotation.x = p.mode === 1 ? -0.25 * p.act : p.mode === 2 ? 0.3 : Math.sin(time * 1.3) * 0.05;
    } else if (this.rig === 'blob') {
      const squash = p.mode === 1 ? 0.18 * p.act : Math.abs(s) * 0.08 * Math.max(move, 0.3);
      b.scale.set(this.scale * (1 + squash * 0.6), this.scale * (1 - squash), this.scale * (1 + squash * 0.6));
    } else if (this.rig === 'ghost') {
      b.rotation.x = 0.12 * move + (p.mode === 2 ? 0.25 : 0);
    } else if (p.mode === 1 && !this.arms.length) b.rotation.x = -0.25 * p.act;
    if (stunned || p.mode === 3) b.rotation.z = Math.sin(time * 9) * 0.1;

    for (const sp of this.spinners) sp.rotation.y += dt * 25;
    for (const [i, o] of this.bobbers.entries()) o.o.position.y = Math.sin(time * 2.5 + i) * 0.05;

    for (const { m, color, emissive, intensity } of this.mats) {
      m.color.copy(color);
      if (stunned) m.color.lerp(STUN_TINT, 0.5);
      else if (calm) m.color.lerp(CALM_TINT, 0.55);
      if (p.flash > 0) {
        m.emissive.copy(emissive).lerp(FLASH, p.flash);
        m.emissiveIntensity = Math.max(intensity, p.flash * 1.4);
      } else {
        m.emissive.copy(emissive);
        m.emissiveIntensity = intensity;
      }
    }
    this.stars.visible = stunned;
    if (stunned) this.stars.rotation.y = time * 4;
  }
}
