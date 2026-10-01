/**
 * Builds the elf archer (the hero) as a GLB: rounded, smooth-shaded body parts, a proper face
 * (green eyes under heavy brows, a square jaw, a straight mouth, long elf ears), layered hair with
 * bangs, side locks and a ponytail, a flowing cloak, and a recurve bow and quiver.
 *
 * Model space matches the joints in src/player/elf.ts (Y up, front +Z, about 4.8 units tall,
 * bow hand on +X). Part names say which joint carries them:
 *   hips_*  · thigh_<side> · shin_<side>*  · armL_upper* / armL_lower* (draw arm, −X)
 *   armR_upper* / armR_lower* (bow arm, +X, bow included) · cloak* · head* · tail* (ponytail)
 *   anything else rides on the torso.
 *
 *   node scripts/models/build-elf.mjs   → public/models/elf.glb
 */
import * as THREE from 'three';
import fs from 'node:fs';
import { Model, deform, lathe, limb, taperTube, toGLB, tube } from './kit.mjs';

const OUT = process.argv[2] ?? 'public/models/elf.glb';

// Bright, storybook colours (the renderer's lighting and tone mapping darken them a fair bit).
const C = {
  skin: 0xf9d3b2,
  hair: 0xffd25e,
  hairShade: 0xf0b545,
  brow: 0xc8913a,
  iris: 0x3fb46e,
  eyeWhite: 0xffffff,
  dark: 0x2a1c16,
  lip: 0xa85c4c,
  tunic: 0x4fae74,
  tunicTrim: 0xffd36b,
  cream: 0xfff1d4,
  cloak: 0x3f8a5a,
  pants: 0x7d8a52,
  leather: 0xa86a3a,
  leatherLight: 0xc88a52,
  sole: 0x5c3d26,
  wood: 0xb57a40,
  gold: 0xffcf5c,
  gem: 0x4dffa0,
  feather: 0xfffaf0,
  featherRed: 0xe5584a,
};
const smooth = { smooth: true };

const m = new Model('elf', 4.82);

// ── Legs (hip joints at (±0.29, 2.35), knees at (±0.42, 1.42)) ───────────────────────────────
m.both((s) => {
  m.add(`thigh_${s}`, limb([s * 0.28, 2.42, 0], [s * 0.42, 1.38, 0.01], 0.2, 0.145, { bulge: 0.02 }), C.pants, smooth);
  m.add(`shin_${s}`, limb([s * 0.42, 1.45, 0.01], [s * 0.47, 0.5, 0], 0.14, 0.11, { bulge: 0.02 }), C.pants, smooth);
  // Boot: shaft, folded cuff, rounded foot and sole.
  m.add(`shin_${s}_boot`, limb([s * 0.47, 0.32, 0], [s * 0.445, 1.12, 0.01], 0.165, 0.18), C.leather, smooth);
  m.add(`shin_${s}_cuff`, lathe([[0.19, 1.04], [0.225, 1.08], [0.235, 1.2], [0.2, 1.25], [0.17, 1.22]], 18), C.leatherLight, {
    ...smooth,
    pos: [s * 0.445, 0, 0.01],
  });
  m.add(`shin_${s}_foot`, new THREE.SphereGeometry(1, 18, 12), C.leather, { ...smooth, pos: [s * 0.48, 0.2, 0.13], scale: [0.17, 0.15, 0.33] });
  m.add(`shin_${s}_sole`, new THREE.BoxGeometry(0.33, 0.07, 0.66), C.sole, { pos: [s * 0.48, 0.085, 0.13] });
  m.add(`shin_${s}_strap`, new THREE.TorusGeometry(0.175, 0.025, 6, 18), C.sole, { pos: [s * 0.46, 0.62, 0], rot: [Math.PI / 2, 0, 0] });
});

// ── Hips: the tunic's skirt and hem (they twist with the hips) ──────────────────────────────────
const skirt = lathe([[0.4, 2.8], [0.45, 2.6], [0.53, 2.3], [0.62, 2.02]], 26);
deform(skirt, (v) => {
  v.z *= 0.74;
  // Gentle folds.
  const a = Math.atan2(v.x, v.z);
  v.y += (2.8 - v.y) * 0.04 * Math.sin(a * 6);
});
m.add('hips_skirt', skirt, C.tunic, smooth);
m.add('hips_hem', lathe([[0.62, 2.1], [0.635, 2.04], [0.63, 1.98], [0.6, 1.98]], 26), C.tunicTrim, { ...smooth, scale: [1, 1, 0.74] });

// ── Torso ───────────────────────────────────────────────────────────────────────────────────
const torso = lathe([[0.0, 2.6], [0.4, 2.62], [0.42, 2.85], [0.49, 3.2], [0.52, 3.45], [0.44, 3.64], [0.22, 3.74], [0.0, 3.76]], 26);
m.add('tunic_torso', torso, C.tunic, { ...smooth, scale: [1, 1, 0.62] });
// Cream undershirt in a V at the neck, with gold trim.
const vShape = new THREE.Shape();
vShape.moveTo(-0.24, 0);
vShape.lineTo(0.24, 0);
vShape.lineTo(0, -0.42);
vShape.closePath();
const vneck = new THREE.ShapeGeometry(vShape);
deform(vneck, (v) => (v.z = 0.012 - v.x * v.x * 0.6));
m.add('tunic_vneck', vneck, C.cream, { pos: [0, 3.68, 0.3], double: true });
m.both((s) => m.add(`tunic_trim_${s}`, tube([[s * 0.25, 3.69, 0.29], [s * 0.12, 3.47, 0.33], [0, 3.26, 0.33]], 0.022, 10, 6), C.tunicTrim, smooth));
m.add('tunic_collar', new THREE.TorusGeometry(0.21, 0.05, 8, 22), C.cream, { ...smooth, pos: [0, 3.71, 0.0], rot: [Math.PI / 2, 0, 0], scale: [1, 0.85, 1] });
m.add('neck', limb([0, 3.62, 0], [0, 4.02, 0.02], 0.155, 0.14), C.skin, smooth);
// Belt and buckle.
m.add('belt', new THREE.CylinderGeometry(0.44, 0.44, 0.15, 28, 1, true), C.leather, { ...smooth, pos: [0, 2.74, 0], scale: [1, 1, 0.66] });
m.add('belt_buckle', new THREE.BoxGeometry(0.2, 0.17, 0.05), C.gold, { pos: [0, 2.74, 0.3], metal: 0.6, roughness: 0.35 });
m.add('belt_pouch', new THREE.BoxGeometry(0.2, 0.22, 0.12), C.leatherLight, { pos: [0.33, 2.6, 0.2], rot: [0, 0.5, 0] });
// Cloak brooch.
m.add('brooch', new THREE.CylinderGeometry(0.075, 0.075, 0.03, 14), C.gold, { pos: [-0.3, 3.6, 0.27], rot: [Math.PI / 2 - 0.2, 0, 0], metal: 0.6, roughness: 0.35 });
m.add('brooch_gem', new THREE.OctahedronGeometry(0.045), C.gem, { pos: [-0.3, 3.6, 0.3], glow: 0.35 });
// Quiver strap across the chest.
m.add('strap', tube([[-0.5, 3.78, -0.36], [-0.42, 3.74, 0.05], [-0.18, 3.48, 0.33], [0.16, 3.08, 0.34], [0.4, 2.86, 0.22], [0.44, 2.84, -0.1], [0.05, 2.92, -0.4], [-0.3, 3.0, -0.52]], 0.032, 40, 6), C.leather, smooth);

// ── Draw arm (−X): shoulder (−0.5, 3.5), elbow (−0.8, 3.0) ──────────────────────────────────────
m.add('armL_upper', limb([-0.5, 3.52, 0], [-0.8, 3.0, 0.02], 0.17, 0.13, { bulge: 0.03 }), C.cream, smooth);
m.add('armL_upper_pauldron', new THREE.SphereGeometry(0.22, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), C.leatherLight, {
  ...smooth,
  pos: [-0.52, 3.5, 0],
  rot: [0, 0, 0.55],
  scale: [1, 0.8, 1],
});
m.add('armL_lower', limb([-0.8, 3.02, 0.02], [-0.83, 2.53, 0.06], 0.13, 0.105), C.leather, smooth);
m.add('armL_lower_cuff', new THREE.TorusGeometry(0.13, 0.03, 6, 16), C.leatherLight, { pos: [-0.8, 2.96, 0.02], rot: [Math.PI / 2, 0, 0] });
m.add('armL_lower_hand', new THREE.SphereGeometry(1, 14, 10), C.skin, { ...smooth, pos: [-0.84, 2.41, 0.08], scale: [0.105, 0.13, 0.11] });
m.add('armL_lower_thumb', limb([-0.78, 2.47, 0.13], [-0.76, 2.39, 0.17], 0.035, 0.03), C.skin, smooth);

// ── Bow arm (+X): shoulder (0.5, 3.5), elbow (0.85, 3.08), hand round the grip ───────────────────
m.add('armR_upper', limb([0.5, 3.52, 0], [0.85, 3.08, 0.04], 0.17, 0.13, { bulge: 0.03 }), C.cream, smooth);
m.add('armR_lower', limb([0.85, 3.08, 0.04], [1.2, 2.98, 0.17], 0.13, 0.105), C.leather, smooth);
m.add('armR_lower_cuff', new THREE.TorusGeometry(0.13, 0.03, 6, 16), C.leatherLight, { pos: [0.9, 3.07, 0.06], rot: [0, Math.PI / 2 - 0.35, 0] });
m.add('armR_lower_hand', new THREE.SphereGeometry(1, 14, 10), C.skin, { ...smooth, pos: [1.33, 2.96, 0.22], scale: [0.12, 0.12, 0.11] });
// Recurve bow in the X–Y plane: belly bends away (+X), tips flick back, string on the archer's side.
const BZ = 0.22;
const bowPts = [[1.2, 0.98], [1.32, 1.12], [1.5, 1.6], [1.56, 2.2], [1.45, 2.75], [1.43, 2.95], [1.45, 3.15], [1.56, 3.7], [1.5, 4.3], [1.32, 4.78], [1.2, 4.92]].map(([x, y]) => [x, y, BZ]);
m.add('armR_lower_bow', taperTube(bowPts, (t) => 0.022 + 0.05 * Math.pow(Math.sin(t * Math.PI), 1.5), { segments: 60, radial: 8 }), C.wood, smooth);
m.add('armR_lower_bow_grip', new THREE.CylinderGeometry(0.07, 0.07, 0.42, 10), C.tunic, { pos: [1.435, 2.95, BZ] });
m.add('armR_lower_bowstring', tube([[1.2, 0.98, BZ], [1.2, 4.92, BZ]], 0.011, 2, 4), C.cream);
for (const y of [0.98, 4.92]) m.add(`armR_lower_bow_nock${y > 2 ? 1 : 0}`, new THREE.SphereGeometry(0.035, 8, 6), C.gold, { pos: [1.2, y, BZ], metal: 0.5 });

// ── Quiver on the back (over the cloak), arrows fletched red and white ──────────────────────────
const qAxis = new THREE.Vector3(-0.48, 1.05, -0.06).normalize();
const qBase = new THREE.Vector3(-0.2, 2.85, -0.6);
const qq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), qAxis);
const qEuler = new THREE.Euler().setFromQuaternion(qq);
const along = (d) => qBase.clone().addScaledVector(qAxis, d);
const qGeo = lathe([[0.0, 0], [0.13, 0.0], [0.15, 0.08], [0.15, 1.1], [0.17, 1.12], [0.17, 1.2]], 16);
m.add('quiver', qGeo, C.leather, { ...smooth, pos: qBase.toArray(), rot: [qEuler.x, qEuler.y, qEuler.z] });
m.add('quiver_band', new THREE.TorusGeometry(0.155, 0.022, 6, 16), C.gold, { pos: along(0.55).toArray(), rot: [qEuler.x + Math.PI / 2, qEuler.y, qEuler.z], metal: 0.5 });
for (let i = 0; i < 5; i++) {
  const off = new THREE.Vector3(Math.cos(i * 1.3) * 0.07, 0, Math.sin(i * 1.3) * 0.07);
  const a = along(0.6 + (i % 2) * 0.05).add(off);
  const b = along(1.62 + (i % 3) * 0.04).add(off);
  m.add(`arrow_${i}`, tube([a.toArray(), b.toArray()], 0.016, 2, 5), C.wood);
  for (let f = 0; f < 3; f++) {
    const ang = (f / 3) * Math.PI * 2 + i;
    const fin = new THREE.BoxGeometry(0.008, 0.2, 0.07);
    fin.translate(0, 0, 0.04);
    fin.applyQuaternion(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang));
    fin.applyQuaternion(qq);
    const p = b.clone().addScaledVector(qAxis, -0.12);
    m.add(`arrow_${i}_fletch${f}`, fin, f === 0 ? C.featherRed : C.feather, { pos: p.toArray() });
  }
}

// ── Cloak: a draped sheet behind the shoulders, with folds and a rolled hood at the neck ──────────
const cloakGeo = lathe([[0.4, 3.7], [0.54, 3.55], [0.62, 3.1], [0.7, 2.4], [0.8, 1.6], [0.86, 1.05]], 30, Math.PI - 1.35, 2.7);
deform(cloakGeo, (v) => {
  const a = Math.atan2(v.x, v.z);
  const fold = Math.sin(a * 7) * 0.05 * ((3.7 - v.y) / 2.65);
  const r = Math.hypot(v.x, v.z) + fold;
  v.x = Math.sin(a) * r;
  v.z = Math.cos(a) * r * 0.78 - 0.04;
  v.y += Math.sin(a * 5 + 1) * 0.06 * Math.max(0, (2 - v.y) / 1);
});
m.add('cloak', cloakGeo, C.cloak, { ...smooth, double: true });
m.add('cloak_hood', new THREE.TorusGeometry(0.33, 0.1, 8, 20, Math.PI * 1.1), C.cloak, {
  ...smooth,
  double: true,
  pos: [0, 3.66, -0.05],
  rot: [Math.PI / 2, 0, Math.PI * 0.95],
  scale: [1, 0.85, 1],
});

// ── Head (neck pivot at y 3.95) ───────────────────────────────────────────────────────────────
const H = new THREE.Vector3(0, 4.33, 0.03); // head centre
const head = new THREE.SphereGeometry(0.33, 28, 20);
deform(head, (v) => {
  // A strong, square jaw: only slightly narrower toward a flat, forward chin.
  if (v.y < 0) {
    const k = -v.y / 0.33;
    v.x *= 1 - 0.13 * k;
    v.z *= 1 - 0.06 * k;
    v.z += 0.05 * k * k;
    v.y = Math.max(v.y, -0.3); // flat underside of the chin
  }
  // Defined cheekbones.
  if (v.y > -0.05 && v.y < 0.1) v.x *= 1.03;
  v.z *= 0.96;
});
m.add('head', head, C.skin, { ...smooth, pos: H.toArray() });
// Eyes: narrower and smaller than a cartoon heroine's, under heavy, straight brows.
m.both((s) => {
  const ex = s * 0.135;
  const ey = 4.35;
  const ez = 0.3;
  const turn = [0, s * 0.42, 0];
  m.add(`head_eye_${s}`, new THREE.SphereGeometry(1, 16, 12), C.eyeWhite, { ...smooth, pos: [ex, ey, ez], rot: turn, scale: [0.07, 0.055, 0.032] });
  m.add(`head_iris_${s}`, new THREE.SphereGeometry(1, 14, 10), C.iris, { ...smooth, pos: [ex - s * 0.01, ey - 0.003, ez + 0.021], rot: turn, scale: [0.04, 0.045, 0.02] });
  m.add(`head_pupil_${s}`, new THREE.SphereGeometry(1, 12, 8), C.dark, { ...smooth, pos: [ex - s * 0.012, ey - 0.004, ez + 0.033], rot: turn, scale: [0.021, 0.026, 0.012] });
  m.add(`head_shine_${s}`, new THREE.SphereGeometry(0.009, 8, 6), 0xffffff, { pos: [ex + s * 0.004, ey + 0.016, ez + 0.044], glow: 0.5 });
  m.add(`head_lid_${s}`, tube([[ex - s * 0.07, ey + 0.025, ez + 0.0], [ex, ey + 0.05, ez + 0.022], [ex + s * 0.075, ey + 0.03, ez - 0.01]], 0.011, 12, 5), C.dark, smooth);
  // Brows: thick, low and nearly level, dipping toward the nose for a determined look.
  m.add(`head_brow_${s}`, taperTube([[ex - s * 0.085, ey + 0.085, ez + 0.035], [ex + s * 0.0, ey + 0.105, ez + 0.03], [ex + s * 0.095, ey + 0.11, ez + 0.0]], (t) => 0.028 - t * 0.008, { segments: 10, radial: 6 }), C.brow, smooth);
  // Long elf ears, pointing out and up.
  m.add(
    `head_ear_${s}`,
    taperTube([[s * 0.29, 4.3, 0.02], [s * 0.42, 4.38, -0.02], [s * 0.6, 4.56, -0.1]], (t) => 0.075 * Math.pow(1 - t, 0.9) + 0.004, { segments: 12, radial: 8 }),
    C.skin,
    { ...smooth, scale: [1, 1, 0.6] },
  );
});
m.add('head_nose', limb([0, 4.34, 0.31], [0, 4.235, 0.375], 0.036, 0.028), C.skin, smooth);
m.add('head_mouth', tube([[-0.055, 4.155, 0.31], [0, 4.15, 0.325], [0.055, 4.155, 0.31]], 0.01, 10, 5), C.lip, smooth);

// Hair: a cap tilted back (forehead clear, nape covered), bangs, side locks, and a circlet.
m.add('head_hair_cap', new THREE.SphereGeometry(0.36, 28, 18, 0, Math.PI * 2, 0, 1.62), C.hair, {
  ...smooth,
  pos: [H.x, H.y + 0.01, H.z - 0.02],
  rot: [-0.55, 0, 0],
  scale: [1.03, 1, 1.02],
});
for (let i = -2; i <= 2; i++) {
  // Swept to the elf's right, off the brow.
  const x = i * 0.09;
  m.add(
    `head_bang_${i + 2}`,
    taperTube([[x * 0.6 - 0.04, 4.67, 0.1], [x + 0.06, 4.64, 0.28], [x + 0.17, 4.56, 0.33]], (t) => 0.07 * (1 - t) + 0.012, { segments: 12, radial: 8 }),
    i % 2 ? C.hairShade : C.hair,
    smooth,
  );
}
m.both((s) => {
  m.add(`head_lock_${s}`, taperTube([[s * 0.3, 4.58, 0.12], [s * 0.38, 4.32, 0.16], [s * 0.37, 4.05, 0.14]], (t) => 0.075 * (1 - t * 0.7), { segments: 14, radial: 9 }), C.hair, smooth);
  m.add(`head_lock_back_${s}`, taperTube([[s * 0.22, 4.5, -0.2], [s * 0.3, 4.2, -0.26], [s * 0.26, 3.9, -0.3]], (t) => 0.1 * (1 - t * 0.6), { segments: 12, radial: 9 }), C.hairShade, smooth);
});
const circlet = [];
for (let i = 0; i <= 12; i++) {
  const a = (i / 12 - 0.5) * Math.PI * 1.15;
  circlet.push([Math.sin(a) * 0.365, 4.535 - (1 - Math.cos(a)) * 0.05, H.z + Math.cos(a) * 0.36]);
}
m.add('head_circlet', tube(circlet, 0.02, 30, 6), C.gold, { metal: 0.6, roughness: 0.35, ...smooth });
m.add('head_circlet_gem', new THREE.OctahedronGeometry(0.055), C.gem, { pos: [0, 4.545, H.z + 0.375], scale: [1, 1.4, 0.6], glow: 0.45 });

// Ponytail (pivot at (0, 4.4, −0.2), swings on a spring).
m.add('tail_tie', new THREE.TorusGeometry(0.085, 0.03, 8, 16), C.gold, { pos: [0, 4.46, -0.33], rot: [0.35, 0, 0], metal: 0.5 });
m.add(
  'tail_hair',
  taperTube([[0, 4.5, -0.3], [0, 4.38, -0.48], [0.01, 4.0, -0.6], [0.03, 3.5, -0.62], [0.0, 3.05, -0.57], [-0.03, 2.82, -0.52]], (t) => 0.06 + 0.075 * Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.85) * (1 - t * 0.7), {
    segments: 30,
    radial: 10,
  }),
  C.hair,
  smooth,
);
m.add('tail_strand', taperTube([[0.05, 4.4, -0.42], [0.09, 3.9, -0.6], [0.07, 3.3, -0.62]], (t) => 0.05 * (1 - t) + 0.01, { segments: 16, radial: 7 }), C.hairShade, smooth);

fs.writeFileSync(OUT, toGLB(m, 'Elf & Crab elf builder'));
console.log(`${OUT}  ${m.parts.length} parts  ${Math.round(m.triangles)} triangles  ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
