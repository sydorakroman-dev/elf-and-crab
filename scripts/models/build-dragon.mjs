/**
 * Builds the Ash King — the final boss, a volcanic dragon — as a GLB, after its concept art: crimson
 * body with an orange belly, huge orange-membrane wings, black horns, spikes and claws, glowing
 * yellow eyes, a spiked tail with a spade tip. Bold low-poly shapes for the cartoon look.
 *
 * Metres, feet on y = 0, facing +Z (~5.5 m to the horns, wings up to ~7.5 m). Part names say which
 * joint carries them (src/game/dragonVisual.ts): leg_<x>_<z>* (x −1 left / 1 right, z −1 hind /
 * 1 front), wing_<side>*, neck_* and head_* (jaw_*: the lower jaw), tail_*; the rest is body.
 *
 *   node scripts/models/build-dragon.mjs   → public/models/ashking.glb
 */
import * as THREE from 'three';
import fs from 'node:fs';
import { Model, deform, limb, taperTube, toGLB, tube } from './kit.mjs';

const OUT = process.argv[2] ?? 'public/models/ashking.glb';
const RED = 0xd23a2c;
const RED_DARK = 0x9a2420;
const BELLY = 0xf7a540;
const BELLY_LINE = 0xd9822a;
const MEMBRANE = 0xffa841;
const BLACK = 0x2e2629;
const EYE = 0xffd23a;
const smooth = { smooth: true };
const flat = {}; // faceted: the bold low-poly look of the art

const m = new Model('ashking', 0);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ── Body: a big faceted barrel, the orange belly bulging out front and below ─────────────────────
const body = new THREE.IcosahedronGeometry(1, 2);
deform(body, (v) => {
  if (v.z > 0) v.y += v.z * 0.25; // chest rises toward the neck
});
m.add('body', body, RED, { ...flat, pos: [0, 2.7, -0.1], scale: [1.35, 1.25, 2.0] });
m.add('body_belly', new THREE.IcosahedronGeometry(1, 2), BELLY, { ...flat, pos: [0, 2.45, 0.45], scale: [1.08, 1.08, 1.55] });
for (let i = 0; i < 5; i++) {
  // Belly plates: curved lines across the front.
  const y = 1.75 + i * 0.32;
  const r = 1.0 - Math.abs(i - 2) * 0.06;
  const pts = [];
  for (let k = 0; k <= 8; k++) {
    const a = (k / 8 - 0.5) * 1.6;
    pts.push([Math.sin(a) * r, y + Math.cos(a) * 0.05, 0.45 + Math.cos(a) * 1.5 * (1 - (y - 2.45) ** 2 * 0.25) + 0.02]);
  }
  m.add(`body_plate_${i}`, tube(pts, 0.03, 16, 5), BELLY_LINE, smooth);
}
// Spikes down the spine, black.
for (let i = 0; i < 6; i++) {
  const z = 1.2 - i * 0.55;
  const y = 3.85 - Math.abs(z + 0.1) * 0.25;
  m.add(`body_spike_${i}`, new THREE.ConeGeometry(0.22 - i * 0.015, 0.6 - i * 0.03, 4), BLACK, { ...flat, pos: [0, y + 0.2, z], rot: [-0.35, Math.PI / 4, 0] });
}

// ── Legs: thick hind legs, front legs a little lighter; black claws ─────────────────────────────
for (const sx of [-1, 1])
  for (const sz of [-1, 1]) {
    const hind = sz < 0;
    const top = hind ? V(sx * 1.05, 2.1, -0.8) : V(sx * 0.95, 2.4, 1.1);
    const knee = hind ? V(sx * 1.25, 1.2, -0.5) : V(sx * 1.05, 1.3, 1.35);
    const ankle = hind ? V(sx * 1.25, 0.35, -0.75) : V(sx * 1.1, 0.35, 1.4);
    const foot = V(ankle.x, 0.2, ankle.z + 0.35);
    m.add(`leg_${sx}_${sz}`, new THREE.IcosahedronGeometry(1, 1), RED, { ...flat, pos: top.toArray(), scale: hind ? [0.62, 0.95, 0.8] : [0.45, 0.7, 0.5] });
    m.add(`leg_${sx}_${sz}_upper`, limb(top, knee, hind ? 0.48 : 0.36, hind ? 0.4 : 0.3), RED, flat);
    m.add(`leg_${sx}_${sz}_lower`, limb(knee, ankle, hind ? 0.38 : 0.3, hind ? 0.3 : 0.24), RED_DARK, flat);
    m.add(`leg_${sx}_${sz}_foot`, new THREE.IcosahedronGeometry(1, 1), RED, { ...flat, pos: foot.toArray(), scale: [0.45, 0.22, 0.6] });
    for (const c of [-1, 0, 1]) {
      m.add(`leg_${sx}_${sz}_claw${c + 1}`, new THREE.ConeGeometry(0.1, 0.38, 4), BLACK, {
        ...flat,
        pos: [foot.x + c * 0.24, 0.13, foot.z + 0.52],
        rot: [Math.PI / 2 + 0.25, 0, 0],
      });
    }
  }

// ── Neck and head (neck pivots at its base; the jaw opens) ────────────────────────────────────
m.add('neck', taperTube([[0, 3.3, 1.3], [0, 4.1, 1.85], [0, 4.85, 2.35], [0, 5.15, 2.6]], (t) => 0.62 - t * 0.22, { segments: 18, radial: 9 }), RED, flat);
m.add('neck_front', taperTube([[0, 3.2, 1.55], [0, 4.0, 2.1], [0, 4.7, 2.6]], (t) => 0.42 - t * 0.14, { segments: 14, radial: 8 }), BELLY, { ...flat, pos: [0, 0, 0.12] });
for (let i = 0; i < 4; i++) {
  const t = i / 4;
  m.add(`neck_spike_${i}`, new THREE.ConeGeometry(0.2 - i * 0.02, 0.55, 4), BLACK, { ...flat, pos: [0, 3.75 + t * 1.6, 1.45 + t * 1.1], rot: [-0.9, Math.PI / 4, 0] });
}
const skull = new THREE.IcosahedronGeometry(1, 1);
m.add('head', skull, RED, { ...flat, pos: [0, 5.35, 2.85], scale: [0.55, 0.48, 0.72] });
m.add('head_snout', new THREE.IcosahedronGeometry(1, 1), RED, { ...flat, pos: [0, 5.22, 3.55], scale: [0.42, 0.3, 0.62] });
m.add('head_nose_tip', new THREE.ConeGeometry(0.18, 0.35, 4), RED_DARK, { ...flat, pos: [0, 5.35, 4.1], rot: [Math.PI / 2 - 0.3, Math.PI / 4, 0] });
m.both((s) => {
  // Brow ridge, glowing eye, horns sweeping back, a fin of cheek spikes.
  m.add(`head_brow_${s}`, new THREE.BoxGeometry(0.42, 0.12, 0.3), RED_DARK, { ...flat, pos: [s * 0.28, 5.6, 3.15], rot: [0.2, s * 0.35, s * -0.35] });
  m.add(`head_eye_${s}`, new THREE.SphereGeometry(1, 10, 8), EYE, { pos: [s * 0.36, 5.47, 3.2], rot: [0, s * 0.5, s * -0.25], scale: [0.14, 0.07, 0.07], glow: 1.2 });
  m.add(`head_horn_${s}`, taperTube([[s * 0.3, 5.65, 2.65], [s * 0.55, 6.05, 2.1], [s * 0.62, 6.35, 1.5], [s * 0.5, 6.45, 1.05]], (t) => 0.2 * (1 - t) + 0.02, { segments: 14, radial: 6 }), BLACK, flat);
  m.add(`head_cheek_spike_${s}`, new THREE.ConeGeometry(0.1, 0.5, 4), BLACK, { ...flat, pos: [s * 0.55, 5.25, 2.6], rot: [-1.0, 0, s * 0.8] });
  m.add(`head_nostril_${s}`, new THREE.SphereGeometry(0.05, 6, 4), 0xff7a1a, { pos: [s * 0.13, 5.38, 4.05], glow: 1.5 });
});
// Upper teeth, and the lower jaw (hinged under the skull) with its own teeth and a fiery mouth.
for (let i = 0; i < 4; i++) for (const s of [-1, 1]) m.add(`head_tooth_${i}_${s}`, new THREE.ConeGeometry(0.05, 0.18, 4), 0xfff4e0, { ...flat, pos: [s * (0.3 - i * 0.04), 4.98, 3.2 + i * 0.22], rot: [Math.PI, 0, 0] });
m.add('jaw', new THREE.IcosahedronGeometry(1, 1), RED_DARK, { ...flat, pos: [0, 4.9, 3.4], scale: [0.36, 0.14, 0.62] });
m.add('jaw_mouth', new THREE.IcosahedronGeometry(1, 1), 0xff6a1a, { pos: [0, 5.0, 3.45], scale: [0.28, 0.08, 0.5], glow: 1.2 });
for (let i = 0; i < 3; i++) for (const s of [-1, 1]) m.add(`jaw_tooth_${i}_${s}`, new THREE.ConeGeometry(0.045, 0.16, 4), 0xfff4e0, { ...flat, pos: [s * (0.27 - i * 0.04), 5.05, 3.3 + i * 0.25] });

// ── Wings: arm bone, elbow claw, finger bones, and a scalloped orange membrane ───────────────────
m.both((s) => {
  const shoulder = V(s * 1.0, 3.7, 0.5);
  const elbow = V(s * 3.0, 6.3, 0.0);
  const tip = V(s * 5.6, 7.3, -0.7);
  const fingers = [V(s * 6.4, 4.4, -0.9), V(s * 5.2, 2.7, -1.1), V(s * 3.4, 2.4, -1.0)];
  const root = V(s * 1.1, 3.0, -0.9);
  m.add(`wing_${s}_arm`, limb(shoulder, elbow, 0.3, 0.2), RED, flat);
  m.add(`wing_${s}_forearm`, limb(elbow, tip, 0.2, 0.1), RED, flat);
  m.add(`wing_${s}_thumb`, new THREE.ConeGeometry(0.16, 0.7, 4), BLACK, { ...flat, pos: [elbow.x + s * 0.1, elbow.y + 0.45, elbow.z], rot: [0, 0, -s * 0.3] });
  m.add(`wing_${s}_tipclaw`, new THREE.ConeGeometry(0.13, 0.6, 4), BLACK, { ...flat, pos: [tip.x + s * 0.2, tip.y + 0.25, tip.z], rot: [0, 0, -s * 0.9] });
  fingers.forEach((f, i) => m.add(`wing_${s}_finger${i}`, limb(elbow, f, 0.12, 0.05), RED_DARK, flat));
  // Membrane: fan from the elbow over the outline tip → fingers → root → shoulder, each edge
  // sagging toward the elbow between bones.
  const outline = [tip, ...fingers, root, shoulder];
  const pos = [];
  const sag = (a, b, k) => a.clone().add(b).multiplyScalar(0.5).lerp(elbow, k);
  for (let i = 0; i < outline.length - 1; i++) {
    const a = outline[i];
    const b = outline[i + 1];
    const mid = sag(a, b, i < outline.length - 2 ? 0.22 : 0.05);
    for (const [p, q] of [[a, mid], [mid, b]]) pos.push(...elbow.toArray(), ...p.toArray(), ...q.toArray());
  }
  const membrane = new THREE.BufferGeometry();
  membrane.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  membrane.computeVertexNormals();
  m.add(`wing_${s}_membrane`, membrane, MEMBRANE, { double: true });
});

// ── Tail: a long spiked sweep ending in a spade ──────────────────────────────────────────────────
const tailPts = [[0, 2.6, -1.8], [0, 1.9, -3.1], [0.5, 1.2, -4.4], [1.4, 0.9, -5.4], [2.4, 1.2, -5.9], [3.0, 1.7, -5.8]];
m.add('tail', taperTube(tailPts, (t) => 0.62 * (1 - t) + 0.1, { segments: 40, radial: 9 }), RED, flat);
const tailCurve = new THREE.CatmullRomCurve3(tailPts.map((p) => V(...p)));
for (let i = 0; i < 6; i++) {
  const t = 0.1 + i * 0.14;
  const p = tailCurve.getPointAt(t);
  m.add(`tail_spike_${i}`, new THREE.ConeGeometry(0.16 - i * 0.015, 0.45 - i * 0.03, 4), BLACK, { ...flat, pos: [p.x, p.y + (0.62 * (1 - t) + 0.1) * 0.85, p.z], rot: [-0.3, Math.PI / 4, 0] });
}
m.add('tail_spade', new THREE.OctahedronGeometry(0.45, 0), RED_DARK, { ...flat, pos: [3.25, 1.95, -5.75], rot: [0.2, 0.9, 0.5], scale: [1.1, 0.75, 0.25] });

fs.writeFileSync(OUT, toGLB(m, 'Elf & Crab dragon builder'));
console.log(`${OUT}  ${m.parts.length} parts  ${Math.round(m.triangles)} triangles  ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
