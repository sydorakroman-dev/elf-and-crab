/**
 * Builds the elf archer (the hero) as a GLB, after the "Confident Woodland Elf Archer" art: long
 * wavy blonde hair parted in the middle under a silver circlet, dark eyes and a confident smirk,
 * a dark-green open vest with long pointed panels over a cream shirt, a leather chest strap and
 * belt with square silver buckles, long bracers, olive leggings, tall pointed boots with folded
 * cuffs, a hooded cloak with a jagged hem, a recurve bow with a green grip and a quiver.
 *
 * Model space matches the joints in src/player/elf.ts (Y up, front +Z, about 4.8 units tall,
 * bow hand on +X). Part names say which joint carries them:
 *   hips_*  · thigh_<side> · shin_<side>*  · armL_upper* / armL_lower* (draw arm, −X)
 *   armR_upper* / armR_lower* (bow arm, +X, bow included) · cloak* · head* · tail* (back hair)
 *   anything else rides on the torso.
 *
 *   node scripts/models/build-elf.mjs   → public/models/elf.glb
 */
import * as THREE from 'three';
import fs from 'node:fs';
import { Model, deform, lathe, limb, taperTube, toGLB, tube } from './kit.mjs';

const OUT = process.argv[2] ?? 'public/models/elf.glb';

// Storybook colours, a touch brighter than the art (the renderer's lighting darkens them).
const C = {
  skin: 0xf8d0aa,
  hair: 0xffd955,
  hairShade: 0xeebf3e,
  hairDeep: 0xd9a632,
  brow: 0x9a6a2c,
  iris: 0x3b2a1e,
  eyeWhite: 0xffffff,
  dark: 0x1e1612,
  lip: 0xb06650,
  vest: 0x46985e,
  vestEdge: 0x357a4a,
  cream: 0xf7e8c6,
  creamShade: 0xe8d4aa,
  cloak: 0x3f8654,
  cloakInner: 0x356f47,
  pants: 0x7c8646,
  leather: 0xc08a4c,
  leatherDark: 0x9c6a3a,
  boot: 0xb8844a,
  bootCuff: 0xcc9555,
  sole: 0x6a4428,
  wood: 0xc28a4a,
  grip: 0x5fae5a,
  silver: 0xd9dee6,
  gem: 0xeaf6ff,
  feather: 0xfbf4e2,
};
const smooth = { smooth: true };
const metal = { metal: 0.7, roughness: 0.3 };

const m = new Model('elf', 4.82);

/** A square ring (belt buckle / strap ring) facing +Z: a 4-sided torus turned 45°. */
const squareRing = (size, thick) => {
  const g = new THREE.TorusGeometry(size, thick, 4, 4);
  g.rotateZ(Math.PI / 4);
  g.rotateY(0); // faces +Z already
  return g;
};

/** A wavy strand's centre line from a to b with `waves` side-to-side ripples of `amp`. */
const wavy = (pts, amp, waves, phase = 0, n = 14) => {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = curve.getPointAt(t);
    const k = Math.min(1, t * 2.5); // calm near the root
    p.x += Math.sin(t * Math.PI * 2 * waves + phase) * amp * k;
    out.push(p.toArray());
  }
  return out;
};

// ── Legs (hip joints at (±0.29, 2.35), knees at (±0.42, 1.42)) ───────────────────────────────
m.both((s) => {
  m.add(`thigh_${s}`, limb([s * 0.28, 2.42, 0], [s * 0.42, 1.38, 0.01], 0.19, 0.14, { bulge: 0.02 }), C.pants, smooth);
  m.add(`shin_${s}`, limb([s * 0.42, 1.45, 0.01], [s * 0.47, 0.5, 0], 0.135, 0.105, { bulge: 0.015 }), C.pants, smooth);
  // Tall boot shaft up to just under the knee.
  m.add(`shin_${s}_boot`, limb([s * 0.47, 0.3, 0], [s * 0.435, 1.2, 0.01], 0.155, 0.17), C.boot, smooth);
  // Folded cuff with a point at the front and the outside, like the art.
  const cuff = lathe([[0.18, 1.12], [0.215, 1.15], [0.235, 1.3], [0.24, 1.34]], 28);
  deform(cuff, (v) => {
    const a = Math.atan2(v.x * s, v.z); // 0 front, +π/2 outside
    const top = v.y > 1.2 ? 1 : 0;
    const pt = Math.max(Math.pow(Math.max(0, Math.cos(a)), 6), Math.pow(Math.max(0, Math.cos(a - 1.7)), 6) * 0.8);
    v.y += top * (pt * 0.17 - 0.03);
    // Flare outward toward the top.
    const r = Math.hypot(v.x, v.z) * (1 + top * 0.06);
    const aa = Math.atan2(v.x, v.z);
    v.x = Math.sin(aa) * r;
    v.z = Math.cos(aa) * r;
  });
  m.add(`shin_${s}_cuff`, cuff, C.bootCuff, { ...smooth, double: true, pos: [s * 0.435, 0, 0.01] });
  // Foot narrowing to a long pointed toe that tips up a little.
  const foot = new THREE.SphereGeometry(1, 22, 14);
  deform(foot, (v) => {
    if (v.z > 0) {
      const k = v.z;
      v.x *= 1 - 0.75 * k * k;
      v.y *= 1 - 0.55 * k * k;
      v.z *= 1 + 0.35 * k;
      v.y += k * k * k * 0.25;
    }
    if (v.y < -0.55) v.y = -0.55; // flat sole
  });
  m.add(`shin_${s}_foot`, foot, C.boot, { ...smooth, pos: [s * 0.48, 0.2, 0.14], scale: [0.16, 0.16, 0.34] });
  m.add(`shin_${s}_sole`, new THREE.CylinderGeometry(0.15, 0.15, 0.05, 16), C.sole, { pos: [s * 0.48, 0.09, 0.08], scale: [1, 1, 1.9] });
  m.add(`shin_${s}_heel`, new THREE.BoxGeometry(0.22, 0.12, 0.16), C.sole, { pos: [s * 0.48, 0.08, -0.1] });
});

// ── Hips: cream shirt hem and the vest's long pointed panels (they twist with the hips) ─────────
const shirtHem = lathe([[0.41, 2.78], [0.46, 2.55], [0.55, 2.2], [0.6, 1.98]], 30);
deform(shirtHem, (v) => {
  v.z *= 0.74;
  const a = Math.atan2(v.x, v.z);
  v.y += (2.78 - v.y) * 0.05 * Math.sin(a * 7);
});
m.add('hips_shirt', shirtHem, C.cream, smooth);

// Vest panels: open at the front, hem cut into long points (two at the front corners).
const GAP = 0.32;
const panels = lathe([[0.43, 2.8], [0.48, 2.55], [0.58, 2.15], [0.66, 1.82]], 44, GAP, Math.PI * 2 - GAP * 2);
deform(panels, (v) => {
  const a = Math.atan2(v.x, v.z); // ±π
  const t = (2.8 - v.y) / 0.98; // 0 waist → 1 hem
  // Points at the front corners (±GAP), the sides and the back.
  const d = Math.abs(a);
  const pt = Math.max(Math.pow(Math.max(0, 1 - (d - GAP) / 0.55), 2), 0.75 * Math.pow(Math.max(0, Math.cos((d - 1.9) * 2.6)), 3), 0.7 * Math.pow(Math.max(0, Math.cos((d - Math.PI) * 2.6)), 3));
  v.y -= t * t * (pt * 0.3 - 0.06);
  v.z = v.z * 0.76 + 0.01;
});
m.add('hips_vest', panels, C.vest, { ...smooth, double: true });

// ── Torso ───────────────────────────────────────────────────────────────────────────────────
// Cream shirt underneath.
const shirt = lathe([[0.0, 2.6], [0.39, 2.62], [0.41, 2.85], [0.47, 3.2], [0.5, 3.45], [0.43, 3.64], [0.22, 3.74], [0.0, 3.76]], 28);
m.add('shirt_torso', shirt, C.cream, { ...smooth, scale: [1, 1, 0.62] });
// Sleeveless vest over it, open down the front in a V that widens toward the collar.
const vest = lathe([[0.42, 2.6], [0.43, 2.85], [0.5, 3.2], [0.53, 3.45], [0.47, 3.63], [0.3, 3.73]], 44, 0.12, Math.PI * 2 - 0.24);
deform(vest, (v) => {
  const a = Math.atan2(v.x, v.z);
  const r = Math.hypot(v.x, v.z);
  const gap = 0.14 + 0.62 * Math.min(1, Math.max(0, (v.y - 2.95) / 0.7));
  const na = Math.sign(a) * (gap + ((Math.abs(a) - 0.12) * (Math.PI - gap)) / (Math.PI - 0.12));
  v.x = Math.sin(na) * r;
  v.z = Math.cos(na) * r * 0.64;
});
m.add('vest_torso', vest, C.vest, { ...smooth, double: true });
// Crossed cream collar of the shirt, showing in the V.
m.both((s) => {
  m.add(`shirt_lapel_${s}`, taperTube([[s * 0.2, 3.74, 0.1], [s * 0.12, 3.6, 0.27], [-s * 0.02, 3.3, 0.32]], (t) => 0.05 * (1 - t * 0.6), { segments: 12, radial: 8 }), C.creamShade, smooth);
  m.add(`vest_edge_${s}`, tube([[s * 0.29, 3.72, 0.13], [s * 0.21, 3.5, 0.29], [s * 0.1, 3.1, 0.31], [s * 0.06, 2.75, 0.3]], 0.024, 14, 6), C.vestEdge, smooth);
});
m.add('neck', limb([0, 3.62, 0], [0, 4.02, 0.02], 0.15, 0.135), C.skin, smooth);
// Belt with a square silver buckle.
m.add('belt', new THREE.CylinderGeometry(0.445, 0.445, 0.15, 32, 1, true), C.leather, { ...smooth, pos: [0, 2.74, 0], scale: [1, 1, 0.68] });
m.add('belt_buckle', squareRing(0.1, 0.025), C.silver, { ...metal, pos: [0, 2.74, 0.315] });
m.add('belt_pouch', new THREE.BoxGeometry(0.2, 0.22, 0.12), C.leatherDark, { pos: [0.34, 2.6, 0.2], rot: [0, 0.55, 0] });
// Chest strap from the right shoulder to the left hip, with a square ring on the chest.
m.add(
  'strap',
  tube([[-0.5, 3.8, -0.34], [-0.4, 3.76, 0.06], [-0.2, 3.52, 0.33], [0.14, 3.1, 0.35], [0.4, 2.86, 0.24], [0.45, 2.84, -0.1], [0.05, 2.92, -0.42], [-0.32, 3.02, -0.52]], 0.034, 44, 6),
  C.leather,
  smooth,
);
m.add('strap_ring', squareRing(0.075, 0.02), C.silver, { ...metal, pos: [-0.07, 3.33, 0.37], rot: [-0.12, 0, 0.6] });

// ── Draw arm (−X): shoulder (−0.5, 3.5), elbow (−0.8, 3.0) ──────────────────────────────────────
m.add('armL_upper', limb([-0.5, 3.52, 0], [-0.8, 3.0, 0.02], 0.175, 0.14, { bulge: 0.035 }), C.cream, smooth);
m.add('armL_lower_sleeve', limb([-0.8, 3.04, 0.02], [-0.81, 2.9, 0.03], 0.15, 0.145), C.cream, smooth);
m.add('armL_lower', limb([-0.81, 2.96, 0.03], [-0.83, 2.55, 0.06], 0.14, 0.11), C.leather, smooth);
m.add('armL_lower_flare', lathe([[0.135, 2.86], [0.17, 2.96], [0.165, 3.0]], 18), C.leatherDark, { ...smooth, double: true, pos: [-0.81, 0, 0.03] });
m.add('armL_lower_hand', new THREE.SphereGeometry(1, 16, 12), C.skin, { ...smooth, pos: [-0.84, 2.41, 0.08], scale: [0.1, 0.13, 0.11] });
m.add('armL_lower_thumb', limb([-0.78, 2.47, 0.13], [-0.76, 2.39, 0.17], 0.035, 0.03), C.skin, smooth);
m.add('armL_lower_fingers', limb([-0.86, 2.36, 0.12], [-0.86, 2.27, 0.12], 0.06, 0.045, { depth: 1.4 }), C.skin, smooth);

// ── Bow arm (+X): shoulder (0.5, 3.5), elbow (0.85, 3.08), hand round the grip ───────────────────
m.add('armR_upper', limb([0.5, 3.52, 0], [0.85, 3.08, 0.04], 0.175, 0.14, { bulge: 0.035 }), C.cream, smooth);
m.add('armR_lower', limb([0.86, 3.08, 0.05], [1.22, 2.98, 0.17], 0.14, 0.11), C.leather, smooth);
m.add('armR_lower_flare', new THREE.CylinderGeometry(0.17, 0.14, 0.12, 18, 1, true), C.leatherDark, {
  ...smooth,
  double: true,
  pos: [0.9, 3.07, 0.06],
  rot: [0, -0.33, Math.PI / 2 + 0.27],
});
m.add('armR_lower_hand', new THREE.SphereGeometry(1, 16, 12), C.skin, { ...smooth, pos: [1.33, 2.96, 0.22], scale: [0.12, 0.125, 0.11] });
// Recurve bow in the X–Y plane: belly bends away (+X), tips flick back, string on the archer's side.
const BZ = 0.22;
const bowPts = [[1.2, 0.98], [1.32, 1.12], [1.5, 1.6], [1.56, 2.2], [1.45, 2.75], [1.43, 2.95], [1.45, 3.15], [1.56, 3.7], [1.5, 4.3], [1.32, 4.78], [1.2, 4.92]].map(([x, y]) => [x, y, BZ]);
m.add('armR_lower_bow', taperTube(bowPts, (t) => 0.022 + 0.05 * Math.pow(Math.sin(t * Math.PI), 1.5), { segments: 64, radial: 8 }), C.wood, smooth);
m.add('armR_lower_bow_grip', new THREE.CylinderGeometry(0.072, 0.072, 0.5, 12), C.grip, { pos: [1.435, 2.95, BZ] });
for (let i = 0; i < 5; i++)
  m.add(`armR_lower_bow_wrap${i}`, new THREE.TorusGeometry(0.074, 0.012, 5, 14), C.vestEdge, { pos: [1.435, 2.74 + i * 0.105, BZ], rot: [Math.PI / 2 + 0.15, 0, 0] });
m.add('armR_lower_bowstring', tube([[1.2, 0.98, BZ], [1.2, 4.92, BZ]], 0.01, 2, 4), C.cream);
for (const y of [0.98, 4.92]) m.add(`armR_lower_bow_nock${y > 2 ? 1 : 0}`, new THREE.SphereGeometry(0.03, 8, 6), C.leatherDark, { pos: [1.2, y, BZ] });

// ── Quiver over the right shoulder (on the back, over the cloak), white-fletched arrows ─────────
const qAxis = new THREE.Vector3(-0.5, 1.05, -0.04).normalize();
const qBase = new THREE.Vector3(-0.3, 2.9, -0.62);
const qq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), qAxis);
const qEuler = new THREE.Euler().setFromQuaternion(qq);
const along = (d) => qBase.clone().addScaledVector(qAxis, d);
const qGeo = lathe([[0.0, 0], [0.13, 0.0], [0.15, 0.08], [0.15, 1.05], [0.175, 1.08], [0.175, 1.18]], 18);
m.add('quiver', qGeo, C.leather, { ...smooth, pos: qBase.toArray(), rot: [qEuler.x, qEuler.y, qEuler.z] });
m.add('quiver_band', new THREE.TorusGeometry(0.157, 0.022, 6, 18), C.leatherDark, { pos: along(0.5).toArray(), rot: [qEuler.x + Math.PI / 2, qEuler.y, qEuler.z] });
for (let i = 0; i < 5; i++) {
  const off = new THREE.Vector3(Math.cos(i * 1.3) * 0.07, 0, Math.sin(i * 1.3) * 0.07);
  const a = along(0.6 + (i % 2) * 0.05).add(off);
  const b = along(1.62 + (i % 3) * 0.05).add(off);
  m.add(`arrow_${i}`, tube([a.toArray(), b.toArray()], 0.016, 2, 5), C.wood);
  for (let f = 0; f < 3; f++) {
    const ang = (f / 3) * Math.PI * 2 + i;
    const fin = new THREE.BoxGeometry(0.008, 0.22, 0.08);
    fin.translate(0, 0, 0.045);
    fin.applyQuaternion(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang));
    fin.applyQuaternion(qq);
    const p = b.clone().addScaledVector(qAxis, -0.13);
    m.add(`arrow_${i}_fletch${f}`, fin, C.feather, { pos: p.toArray() });
  }
}

// ── Cloak: draped behind the shoulders, folds, a jagged pointed hem, and a hood lying back ───────
const cloakGeo = lathe([[0.4, 3.72], [0.55, 3.56], [0.63, 3.1], [0.72, 2.4], [0.82, 1.7], [0.9, 1.2]], 40, Math.PI - 1.42, 2.84);
deform(cloakGeo, (v) => {
  const a = Math.atan2(v.x, v.z);
  const down = (3.72 - v.y) / 2.52;
  const fold = Math.sin(a * 7) * 0.05 * down;
  const r = Math.hypot(v.x, v.z) + fold;
  v.x = Math.sin(a) * r;
  v.z = Math.cos(a) * r * 0.78 - 0.04;
  // Jagged hem: long points hanging down, deepest at the sides.
  if (v.y < 1.3) {
    const saw = Math.abs(((((a + Math.PI) / (Math.PI * 2)) * 9) % 1) * 2 - 1); // 0 at points … 1 between
    v.y -= (1 - saw) * 0.38 - 0.05;
  }
});
m.add('cloak', cloakGeo, C.cloak, { ...smooth, double: true });
// Hood (on the torso, so it stays put when the cloak swings): a soft cowl bunched behind the neck and over the shoulders.
const hood = new THREE.SphereGeometry(0.4, 26, 14, Math.PI * 0.5 - 1.7, 3.4, 0.35, 1.5);
deform(hood, (v) => {
  v.y *= 0.62;
  v.z *= 0.9;
  if (v.z > 0) v.z *= 0.4; // flatter where it wraps forward
});
m.add('hood', hood, C.cloakInner, { ...smooth, double: true, pos: [0, 3.82, -0.12], rot: [Math.PI, 0, 0] });
m.add('hood_roll', new THREE.TorusGeometry(0.34, 0.085, 8, 22, Math.PI * 1.2), C.cloak, {
  ...smooth,
  pos: [0, 3.68, -0.06],
  rot: [Math.PI / 2, 0, Math.PI * 0.9],
  scale: [1, 0.82, 1],
});

// ── Head (neck pivot at y 3.95) ───────────────────────────────────────────────────────────────
const H = new THREE.Vector3(0, 4.33, 0.03); // head centre
const head = new THREE.SphereGeometry(0.33, 30, 22);
deform(head, (v) => {
  // A strong, square jaw: only slightly narrower toward a flat, forward chin.
  if (v.y < 0) {
    const k = -v.y / 0.33;
    v.x *= 1 - 0.14 * k;
    v.z *= 1 - 0.06 * k;
    v.z += 0.05 * k * k;
    v.y = Math.max(v.y, -0.3);
  }
  if (v.y > -0.05 && v.y < 0.1) v.x *= 1.03;
  v.z *= 0.96;
});
m.add('head', head, C.skin, { ...smooth, pos: H.toArray() });
// Eyes: white almonds with big dark irises glancing to the side, thin lids, slanted brows.
m.both((s) => {
  const ex = s * 0.135;
  const ey = 4.35;
  const ez = 0.3;
  const turn = [0, s * 0.42, 0];
  m.add(`head_eye_${s}`, new THREE.SphereGeometry(1, 16, 12), C.eyeWhite, { ...smooth, pos: [ex, ey, ez], rot: turn, scale: [0.072, 0.06, 0.032] });
  m.add(`head_iris_${s}`, new THREE.SphereGeometry(1, 14, 10), C.iris, { ...smooth, pos: [ex + 0.022, ey - 0.004, ez + 0.022], rot: turn, scale: [0.042, 0.05, 0.02] });
  m.add(`head_pupil_${s}`, new THREE.SphereGeometry(1, 12, 8), C.dark, { ...smooth, pos: [ex + 0.024, ey - 0.005, ez + 0.034], rot: turn, scale: [0.027, 0.033, 0.012] });
  m.add(`head_shine_${s}`, new THREE.SphereGeometry(0.01, 8, 6), 0xffffff, { pos: [ex + 0.033, ey + 0.018, ez + 0.046], glow: 0.5 });
  m.add(`head_lid_${s}`, tube([[ex - s * 0.075, ey + 0.02, ez + 0.0], [ex, ey + 0.055, ez + 0.024], [ex + s * 0.08, ey + 0.035, ez - 0.012]], 0.012, 12, 5), C.dark, smooth);
  // Brows: slanted down toward the nose — a sure, slightly cocky look; one cocked higher.
  const lift = s > 0 ? 0.015 : 0;
  m.add(`head_brow_${s}`, taperTube([[ex - s * 0.075, ey + 0.08, ez + 0.035], [ex + s * 0.01, ey + 0.11 + lift, ez + 0.03], [ex + s * 0.095, ey + 0.13 + lift, ez - 0.005]], (t) => 0.022 - t * 0.01, { segments: 10, radial: 6 }), C.brow, smooth);
  // Long elf ears, pointing out and up, poking through the hair.
  m.add(
    `head_ear_${s}`,
    taperTube([[s * 0.29, 4.3, 0.0], [s * 0.43, 4.39, -0.04], [s * 0.62, 4.6, -0.12]], (t) => 0.075 * Math.pow(1 - t, 0.9) + 0.004, { segments: 12, radial: 8 }),
    C.skin,
    { ...smooth, scale: [1, 1, 0.6] },
  );
});
m.add('head_nose', limb([0, 4.34, 0.31], [0.005, 4.235, 0.375], 0.034, 0.027), C.skin, smooth);
// A confident smirk: the left corner (+X) curls up.
m.add('head_mouth', tube([[-0.06, 4.16, 0.305], [-0.01, 4.152, 0.322], [0.045, 4.163, 0.316], [0.075, 4.19, 0.297]], 0.01, 12, 5), C.lip, smooth);
m.add('head_mouth_dimple', new THREE.SphereGeometry(0.009, 6, 5), C.lip, { pos: [0.083, 4.2, 0.292] });

// Hair: a cap tilted back, parted in the middle, with two thick swoops framing the face.
m.add('head_hair_cap', new THREE.SphereGeometry(0.362, 30, 18, 0, Math.PI * 2, 0, 1.62), C.hair, {
  ...smooth,
  pos: [H.x, H.y + 0.01, H.z - 0.02],
  rot: [-0.5, 0, 0],
  scale: [1.03, 1, 1.02],
});
m.both((s) => {
  // Swoops from the part over the brow corners, down past the cheeks.
  m.add(
    `head_bang_${s}`,
    taperTube([[s * 0.02, 4.7, 0.18], [s * 0.15, 4.66, 0.3], [s * 0.3, 4.52, 0.27], [s * 0.36, 4.3, 0.2], [s * 0.36, 4.06, 0.16]], (t) => 0.085 * (1 - t * 0.55), { segments: 20, radial: 9 }),
    C.hair,
    smooth,
  );
  m.add(
    `head_bang_${s}_b`,
    taperTube([[s * 0.06, 4.71, 0.12], [s * 0.22, 4.66, 0.22], [s * 0.35, 4.48, 0.17]], (t) => 0.075 * (1 - t * 0.5), { segments: 12, radial: 8 }),
    C.hairShade,
    smooth,
  );
  // Long wavy locks over the shoulders onto the chest.
  m.add(
    `head_lock_${s}`,
    taperTube(wavy([[s * 0.34, 4.42, 0.12], [s * 0.39, 4.0, 0.12], [s * 0.38, 3.6, 0.24], [s * 0.33, 3.15, 0.33]], 0.045, 2.2, s), (t) => 0.08 * (1 - t * 0.7) + 0.012, { segments: 26, radial: 9 }),
    C.hair,
    smooth,
  );
  m.add(
    `head_lock_${s}_b`,
    taperTube(wavy([[s * 0.3, 4.45, 0.0], [s * 0.42, 4.0, 0.0], [s * 0.46, 3.6, 0.1], [s * 0.44, 3.25, 0.18]], 0.04, 2.0, 1 + s), (t) => 0.075 * (1 - t * 0.7) + 0.01, { segments: 24, radial: 8 }),
    C.hairShade,
    smooth,
  );
  m.add(`head_lock_${s}_strand`, taperTube(wavy([[s * 0.28, 4.36, 0.2], [s * 0.33, 4.0, 0.2], [s * 0.3, 3.65, 0.3]], 0.03, 1.6, s * 2), (t) => 0.035 * (1 - t) + 0.008, { segments: 16, radial: 6 }), C.hairDeep, smooth);
});
// Thin silver circlet with a diamond-shaped setting on the brow.
const circlet = [];
for (let i = 0; i <= 14; i++) {
  const a = (i / 14 - 0.5) * Math.PI * 1.2;
  circlet.push([Math.sin(a) * 0.37, 4.58 - (1 - Math.cos(a)) * 0.06, H.z + Math.cos(a) * 0.35]);
}
m.add('head_circlet', tube(circlet, 0.016, 32, 6), C.silver, { ...metal, ...smooth });
m.add('head_circlet_plate', new THREE.OctahedronGeometry(0.062), C.silver, { ...metal, pos: [0, 4.58, H.z + 0.36], scale: [1, 1.35, 0.4] });
m.add('head_circlet_gem', new THREE.OctahedronGeometry(0.032), C.gem, { pos: [0, 4.58, H.z + 0.385], scale: [1, 1.35, 0.6], glow: 0.35 });

// Long back hair (pivot at (0, 4.4, −0.2), sways on a spring): wavy locks falling to mid-back.
for (let i = -3; i <= 3; i++) {
  const x = i * 0.085;
  const end = 2.75 + Math.abs(i) * 0.1 + ((i + 3) % 2) * 0.08;
  const pts = wavy(
    [[x * 0.8, 4.66, -0.12], [x * 1.25, 4.45, -0.37], [x * 1.4, 4.05, -0.45], [x * 1.4, 3.55, -0.52], [x * 1.3, 3.1, -0.6], [x * 1.15, end, -0.62]],
    0.05,
    2.4,
    i * 1.3,
    24,
  );
  m.add(`tail_lock_${i + 3}`, taperTube(pts, (t) => 0.115 * (1 - t * 0.75) + 0.012, { segments: 34, radial: 9 }), i % 2 ? C.hairShade : C.hair, smooth);
}
m.both((s) => {
  const pts = wavy([[s * 0.24, 4.5, -0.22], [s * 0.36, 4.0, -0.36], [s * 0.4, 3.5, -0.46], [s * 0.36, 3.05, -0.52]], 0.04, 2, s * 2, 18);
  m.add(`tail_lock_side_${s}`, taperTube(pts, (t) => 0.09 * (1 - t * 0.75) + 0.01, { segments: 26, radial: 8 }), C.hairDeep, smooth);
});

fs.writeFileSync(OUT, toGLB(m, 'Elf & Crab elf builder'));
console.log(`${OUT}  ${m.parts.length} parts  ${Math.round(m.triangles)} triangles  ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
