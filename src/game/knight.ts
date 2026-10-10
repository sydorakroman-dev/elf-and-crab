import * as THREE from 'three';
import { toonify, MONSTER_NO_OUTLINE } from '../player/toon';
import { glowTexture } from '../util/glow';
import type { KnightPlan, KnightState } from './quests';

const RUNE_BLUE = 0x8fd8ff;

/**
 * Q02's tomb (docs/quests.md §5): Sir Aldric's stone sarcophagus by the obelisk, its lid carved with
 * runes that glow blue while he's bound (dimmer with each broken stone). Freed, his spirit rises
 * from it and fades; plundered, the lid lies pushed aside and dark. A ring under the next rune stone
 * shows a solo hero which to break, and a gold ring fills while the blade is being taken.
 */
export class KnightSite {
  readonly group = new THREE.Group();
  private readonly lid: THREE.Group;
  private readonly runeMat: THREE.MeshBasicMaterial;
  private readonly glow: THREE.Sprite;
  private readonly spirit: THREE.Group;
  private readonly spiritMats: THREE.Material[] = [];
  private readonly next: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private ringAt = -1;
  private readonly plan: KnightPlan;
  private shown: KnightState = 'sleeping';
  private since = 0;

  constructor(plan: KnightPlan) {
    this.plan = plan;
    const tomb = new THREE.Group();
    tomb.position.set(plan.tomb.x, 0, plan.tomb.z);
    tomb.rotation.y = plan.angle;
    const stone = new THREE.MeshStandardMaterial({ color: 0x8a8690, roughness: 0.9, flatShading: true });
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.9, 2.5).translate(0, 0.45, 0), stone);
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.18, 2.8).translate(0, 0.09, 0), stone);
    this.lid = new THREE.Group();
    this.lid.position.y = 0.9;
    const lidSlab = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.22, 2.65).translate(0, 0.11, 0), stone);
    // A carved knight's effigy on the lid: a sword down the middle and a shield at the head.
    const effigy = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 1.7).translate(0, 0.25, 0.1), stone);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.1).translate(0, 0.25, -0.65), stone);
    const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.06, 6).translate(0, 0.25, -1.0), stone);
    this.lid.add(lidSlab, effigy, guard, shield);
    tomb.add(plinth, base, this.lid);
    tomb.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true;
    });
    toonify(tomb, MONSTER_NO_OUTLINE);
    // Glowing runes round the lid's edge (plain light, added after the cartoon look).
    this.runeMat = new THREE.MeshBasicMaterial({ color: RUNE_BLUE, transparent: true, opacity: 0.9 });
    for (const [x, z, w, d] of [[0.68, 0, 0.04, 2.4], [-0.68, 0, 0.04, 2.4], [0, 1.28, 1.2, 0.04], [0, -1.28, 1.2, 0.04]] as const) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, d), this.runeMat);
      strip.position.set(x, 0.23, z);
      this.lid.add(strip);
    }
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x6fc8ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.glow.scale.set(3.5, 2.5, 1);
    this.glow.position.y = 1.3;
    tomb.add(this.glow);
    // His spirit: a pale blue glow in a knight's shape, rising when freed.
    this.spirit = new THREE.Group();
    const ghost = (geo: THREE.BufferGeometry, y: number) => {
      const m = new THREE.MeshBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      this.spiritMats.push(m);
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.y = y;
      this.spirit.add(mesh);
    };
    ghost(new THREE.CylinderGeometry(0.32, 0.5, 1.3, 10), 0.8);
    ghost(new THREE.SphereGeometry(0.26, 12, 10), 1.7);
    ghost(new THREE.BoxGeometry(0.08, 1.2, 0.08), 1.0);
    tomb.add(this.spirit);
    this.group.add(tomb);
    // The next rune stone to break (solo), and the blade-taking ring.
    this.next = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.0, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: RUNE_BLUE, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.next.position.y = 0.05;
    this.group.add(this.next);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.75, 32, 1, 0, 0.001).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.9, depthWrite: false }));
    this.ring.position.set(plan.tomb.x, 0.05, plan.tomb.z);
    this.ring.visible = false;
    this.group.add(this.ring);
  }

  /**
   * `runes`: stones broken so far; `nextStone`: the one a solo hero must break next (−1: none shown);
   * `plunder`: how far the blade is taken (0..1).
   */
  update(state: KnightState, runes: number, nextStone: number, plunder: number, dt: number, time: number): void {
    if (state !== this.shown) {
      this.shown = state;
      this.since = 0;
    }
    this.since += dt;
    const bound = state === 'sleeping' || state === 'bound' || state === 'freeing';
    const pulse = 0.75 + Math.sin(time * 2.5) * 0.25;
    const strength = bound ? (3 - runes) / 3 : 0;
    this.runeMat.opacity = 0.25 + 0.7 * strength * pulse;
    this.runeMat.color.setHex(bound ? RUNE_BLUE : 0x4a5a66);
    this.glow.material.opacity = 0.5 * strength * pulse;
    // Plundered: the lid pushed half off and tipped.
    const off = state === 'plundered' ? Math.min(1, this.since * 1.5) : 0;
    this.lid.position.set(off * 0.7, 0.9 - off * 0.15, off * 0.3);
    this.lid.rotation.set(0, off * 0.35, -off * 0.18);
    // Freed: the spirit rises, bows, and fades.
    const t = state === 'freed' ? this.since : 99;
    const fade = t < 4 ? Math.min(1, t * 1.5) * Math.max(0, 1 - (t - 2.5) / 1.5) : 0;
    for (const m of this.spiritMats) (m as THREE.MeshBasicMaterial).opacity = 0.55 * fade;
    this.spirit.position.y = 0.9 + Math.min(1.2, t * 0.6);
    this.spirit.rotation.x = t > 1.6 && t < 2.6 ? Math.sin((t - 1.6) * Math.PI) * 0.4 : 0; // the bow
    this.spirit.visible = fade > 0;
    // The next stone to break (shown playing solo).
    const at = nextStone >= 0 ? this.plan.stones[nextStone] : null;
    (this.next.material as THREE.MeshBasicMaterial).opacity = at ? 0.7 * pulse : 0;
    if (at) this.next.position.set(at.x, 0.05, at.z);
    // Taking the blade: a gold ring fills round the tomb.
    this.ring.visible = plunder > 0.01;
    if (this.ring.visible && Math.abs(plunder - this.ringAt) > 0.01) {
      this.ringAt = plunder;
      this.ring.geometry.dispose();
      this.ring.geometry = new THREE.RingGeometry(1.7, 1.95, 40, 1, Math.PI / 2, plunder * Math.PI * 2).rotateX(-Math.PI / 2);
    }
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}
