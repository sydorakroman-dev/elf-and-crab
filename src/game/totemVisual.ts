import * as THREE from 'three';
import type { BeastPose } from './beastVisual';
import { toonify, MONSTER_NO_OUTLINE } from '../player/toon';
import { glowTexture } from '../util/glow';

/**
 * Q03's war horn totem (docs/quests.md §6): a rough log pole with a crossbar, a great curled horn and
 * a ragged red war banner, a skull on top. It doesn't move; hit, it flashes; broken, it topples.
 */
export class HornTotemVisual {
  readonly group = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly mats: THREE.MeshToonMaterial[] = [];

  constructor() {
    const mat = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true });
    const wood = mat(0x6a4a2a);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 4.2, 7).translate(0, 2.1, 0), wood);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.18, 0.18).translate(0, 3.3, 0), wood);
    // The horn: a curling, tapering bone horn hung off the crossbar.
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0.2, 3.0, 0.25), new THREE.Vector3(0.9, 2.7, 0.45), new THREE.Vector3(1.25, 2.1, 0.4), new THREE.Vector3(0.95, 1.7, 0.3)]);
    const hornGeo = new THREE.TubeGeometry(curve, 16, 0.16, 8);
    // Taper toward the tip, flare at the mouth.
    const pos = hornGeo.getAttribute('position');
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      const t = Math.floor(i / 9) / 16;
      v.fromBufferAttribute(pos, i);
      const c = curve.getPoint(Math.min(1, t));
      const k = 1.6 - t * 1.1;
      v.sub(c).multiplyScalar(k).add(c);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    hornGeo.computeVertexNormals();
    const horn = new THREE.Mesh(hornGeo, mat(0xe8dcc0));
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.05, 6, 12), mat(0x8a6a3a));
    band.position.set(0.55, 2.95, 0.35);
    band.rotation.y = Math.PI / 2;
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.5, 3, 3).translate(0, -0.75, 0), new THREE.MeshStandardMaterial({ color: 0xa02a20, roughness: 0.9, side: THREE.DoubleSide, flatShading: true }));
    banner.position.set(-0.55, 3.25, 0.12);
    const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 0), mat(0xe8e0cc));
    skull.position.y = 4.4;
    skull.scale.set(1, 0.9, 1.1);
    this.body.add(pole, bar, horn, band, banner, skull);
    this.body.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    toonify(this.body, MONSTER_NO_OUTLINE);
    this.body.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshToonMaterial | undefined;
      if ((o as THREE.Mesh).isMesh && m && !o.userData.outline && 'emissive' in m) this.mats.push(m);
    });
    this.group.add(this.body);
  }

  apply(p: BeastPose, _dt: number, _time: number): void {
    this.group.position.set(p.x, 0, p.z);
    // Hit: a red flash and a shudder. Broken: it topples and sinks.
    for (const m of this.mats) m.emissive.setRGB(p.flash * 0.6, p.flash * 0.1, 0);
    this.body.rotation.z = Math.sin(p.flash * 20) * 0.04 * p.flash + p.death * 1.4;
    this.body.position.y = -p.death * 0.6;
    this.group.visible = p.death < 1;
  }
}

/**
 * Q02's rune stone: a rough grey standing stone carved with a glowing blue rune. Hit, it flashes;
 * broken, it cracks apart and sinks in a flare of light.
 */
export class RuneStoneVisual {
  readonly group = new THREE.Group();
  private readonly halves: THREE.Mesh[] = [];
  private readonly rune: THREE.Mesh;
  private readonly runeMat: THREE.MeshBasicMaterial;
  private readonly glow: THREE.Sprite;

  constructor() {
    const stone = new THREE.MeshStandardMaterial({ color: 0x6a6872, roughness: 0.95, flatShading: true });
    // Two halves (they split apart when it breaks).
    for (const side of [-1, 1]) {
      const half = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.9, 0.38, 1, 3, 1).translate(side * 0.21, 0.95, 0), stone);
      half.castShadow = true;
      this.halves.push(half);
      this.group.add(half);
    }
    toonify(this.group, MONSTER_NO_OUTLINE); // the stone; the rune and its glow stay plain light
    this.runeMat = new THREE.MeshBasicMaterial({ color: 0x8fd8ff, transparent: true, opacity: 0.95 });
    const runeShape = new THREE.Shape();
    runeShape.moveTo(0, 0.42);
    runeShape.lineTo(0.18, 0.05);
    runeShape.lineTo(0.06, 0.05);
    runeShape.lineTo(0.2, -0.4);
    runeShape.lineTo(-0.04, -0.05);
    runeShape.lineTo(0.08, -0.05);
    runeShape.lineTo(-0.12, 0.42);
    runeShape.closePath();
    this.rune = new THREE.Mesh(new THREE.ShapeGeometry(runeShape), this.runeMat);
    this.rune.position.set(0, 1.15, 0.2);
    this.group.add(this.rune);
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x6fc8ff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.glow.scale.setScalar(2.2);
    this.glow.position.y = 1.15;
    this.group.add(this.glow);
  }

  apply(p: BeastPose, _dt: number, time: number): void {
    this.group.position.set(p.x, 0, p.z);
    const pulse = 0.75 + Math.sin(time * 3 + p.x) * 0.25;
    this.runeMat.opacity = (1 - p.death) * pulse;
    this.glow.material.opacity = Math.max(0, 0.6 * pulse * (1 - p.death) + p.flash * 0.6 + (p.death > 0 && p.death < 0.4 ? 1 - p.death * 2.5 : 0));
    // Broken: the halves fall apart and sink.
    this.halves.forEach((h, i) => {
      const side = i ? 1 : -1;
      h.rotation.z = side * p.death * 0.9;
      h.position.set(side * p.death * 0.5, -p.death * 0.9, 0);
    });
    this.group.visible = p.death < 1;
  }
}
