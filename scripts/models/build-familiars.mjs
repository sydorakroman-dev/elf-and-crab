/**
 * Builds the three familiars as GLBs, after their card art (public/art/*.webp): the crab, the
 * capybara and the wolf, each with the green cape and silver leaf clasp, and a circlet with a teal
 * gem. Rounded, smooth-shaded parts for the cartoon (toon + outline) look.
 *
 * Crab: model units, ~4.4 tall, scaled in game (src/player/crab.ts reads its part names:
 *   leg_<side>_<i>0/1, arm_<side>0/1, claw_palm_<side>, outer_/inner_pincer_<side>0, magic_*).
 * Capybara and wolf: metres, feet at y = 0, facing +Z (src/player/beasts.ts rigs them by name:
 *   leg_<x>_<z>* (x: −1 left / 1 right, z: −1 back / 1 front), head*, tail*, cape*).
 *
 *   node scripts/models/build-familiars.mjs   → public/models/{crab,capybara,wolf}.glb
 */
import * as THREE from 'three';
import fs from 'node:fs';
import path from 'node:path';
import { Model, deform, limb, taperTube, toGLB, tube } from './kit.mjs';

const OUT = process.argv[2] ?? 'public/models';
const smooth = { smooth: true };
const CAPE = 0x3f8a5a;
const CAPE_DARK = 0x2f6e46;
const SILVER = 0xe4e8ee;
const GEM = 0x46f0d2;
const INK = 0x1d1714;

/**
 * A cape draped over an ellipsoid back (radii rx, ry, rz around (0, cy, cz)): a cloth grid that
 * follows the curve from the shoulders (`front`) backwards over `depth`, falls over the flanks
 * (`spread` radians either side of the spine), ripples into folds and ends in a jagged hem.
 */
function drape({ rx, ry, rz, cy, cz = 0, front, depth, spread = 1.35, lift = 1.08, folds = 0.03 }) {
  const g = new THREE.PlaneGeometry(1, 1, 18, 14);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) * 2; // −1 … 1 across
    const v = 0.5 - p.getY(i); // 0 at the shoulders … 1 at the hem
    const z = front - v * depth;
    const k = Math.sqrt(Math.max(0.05, 1 - ((z - cz) / rz) ** 2));
    const a = u * spread;
    const wave = Math.sin(u * 9 + v * 2) * folds * (0.3 + v);
    const hem = v > 0.85 ? Math.abs(Math.sin(u * 7)) * 0.08 * (v - 0.85) * 8 : 0;
    const x = Math.sin(a) * rx * k * lift + Math.sin(a) * wave;
    const y = cy + Math.cos(a) * ry * k * lift + Math.cos(a) * wave - hem * ry - Math.max(0, Math.abs(u) - 0.7) * ry * 0.4;
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

/** A silver leaf (the cape clasp): a flattened, pointed blade with a midrib. */
function leaf(m, name, pos, size, rot = [0, 0, 0]) {
  m.add(name, new THREE.OctahedronGeometry(1, 1), SILVER, { pos, rot, scale: [size * 0.45, size, size * 0.18], metal: 0.6, roughness: 0.3 });
}

/** A silver circlet with a teal gem at the front. */
function circlet(m, centre, radius, gemAt) {
  const pts = [];
  for (let i = 0; i <= 14; i++) {
    const a = (i / 14 - 0.5) * Math.PI * 1.3;
    pts.push([centre[0] + Math.sin(a) * radius, centre[1] - (1 - Math.cos(a)) * radius * 0.25, centre[2] + Math.cos(a) * radius]);
  }
  m.add('head_circlet', tube(pts, radius * 0.07, 28, 6), SILVER, { ...smooth, metal: 0.6, roughness: 0.3 });
  m.add('head_gem', new THREE.OctahedronGeometry(radius * 0.2), GEM, { pos: gemAt, scale: [1, 1.3, 0.6], glow: 0.6 });
}

/** Cartoon eyes: whites, dark pupils, a highlight; `lid` (a colour) closes them halfway — sleepy. */
function eyes(m, prefix, { at, spread, r, turn = 0.35, lid = null, look = [0, 0] }) {
  m.both((s) => {
    const pos = [s * spread, at[1], at[2]];
    const rot = [0, s * turn, 0];
    m.add(`${prefix}eye_${s}`, new THREE.SphereGeometry(1, 16, 12), 0xffffff, { ...smooth, pos, rot, scale: [r, r * 1.15, r * 0.6] });
    m.add(`${prefix}pupil_${s}`, new THREE.SphereGeometry(1, 12, 8), INK, {
      ...smooth,
      pos: [pos[0] + look[0] * r + s * r * 0.05, pos[1] + look[1] * r - r * 0.05, pos[2] + r * 0.45],
      rot,
      scale: [r * 0.5, r * 0.62, r * 0.3],
    });
    m.add(`${prefix}shine_${s}`, new THREE.SphereGeometry(r * 0.16, 8, 6), 0xffffff, { pos: [pos[0] + r * 0.2, pos[1] + r * 0.35, pos[2] + r * 0.62], glow: 0.6 });
    if (lid) m.add(`${prefix}lid_${s}`, new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.45), lid, { ...smooth, pos, rot: [0.35, s * turn, 0], scale: [r * 1.08, r * 1.25, r * 0.72] });
  });
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Crab (model units; ~4.4 tall with claws raised)

function crab() {
  const m = new Model('crab', 4.4);
  const SHELL = 0xff8a4c;
  const SHELL_DARK = 0xe8673a;
  const BELLY = 0xffd2a0;

  // Carapace: a wide, flattened dome with a ridge and little spikes along the front rim.
  const shell = new THREE.SphereGeometry(1, 32, 20);
  deform(shell, (v) => {
    v.y *= v.y > 0 ? 0.72 : 0.55;
    v.x *= 1.25;
    v.z *= 0.78;
    v.y += 0.04 * Math.cos(v.x * 2.5) * (v.y > 0 ? 1 : 0); // a soft ridge
  });
  m.add('carapace', shell, SHELL, { ...smooth, pos: [0, 1.2, 0] });
  for (let i = -3; i <= 3; i++) {
    const a = i * 0.32;
    m.add(`carapace_spike_${i + 3}`, new THREE.ConeGeometry(0.07, 0.18, 6), SHELL_DARK, {
      ...smooth,
      pos: [Math.sin(a) * 1.12, 1.5 - Math.abs(i) * 0.03, Math.cos(a) * 0.68],
      rot: [Math.PI / 2 - 0.5, a, 0],
    });
  }
  // A pale belly across the front and underside.
  m.add('cream_belly', new THREE.SphereGeometry(1, 28, 16), BELLY, { ...smooth, pos: [0, 0.98, 0.16], scale: [1.0, 0.36, 0.66] });
  m.add('smile', tube([[-0.36, 1.4, 0.77], [-0.18, 1.31, 0.82], [0, 1.28, 0.83], [0.18, 1.31, 0.82], [0.36, 1.4, 0.77]], 0.03, 16, 6), INK, smooth);

  // Eyes on stalks, and the circlet between them.
  m.both((s) => {
    m.add(`eyestalk_${s}`, limb([s * 0.32, 1.7, 0.36], [s * 0.42, 2.12, 0.42], 0.1, 0.085), SHELL, smooth);
  });
  eyes(m, '', { at: [0, 2.3, 0.46], spread: 0.45, r: 0.25, turn: 0.25, look: [0, 0.15] });
  const ring = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    ring.push([(t - 0.5) * 1.3, 2.56 + Math.sin(t * Math.PI) * 0.06 - (Math.abs(t - 0.5) > 0.35 ? 0.05 : 0), 0.42 + Math.sin(t * Math.PI) * 0.06]);
  }
  m.add('silver_circlet', tube(ring, 0.04, 20, 6), SILVER, { ...smooth, metal: 0.6, roughness: 0.3 });
  m.add('crown_gem', new THREE.OctahedronGeometry(0.11), GEM, { pos: [0, 2.66, 0.5], scale: [1, 1.3, 0.6], glow: 0.6 });

  // Legs: four a side, each an upper and a pointed lower segment.
  m.both((s) => {
    [0.55, 0.2, -0.18, -0.55].forEach((z, i) => {
      const hip = [s * 0.95, 0.95, z];
      const knee = [s * 1.4, 1.15, z * 1.2];
      const foot = [s * 1.55, 0.07, z * 1.3];
      m.add(`leg_${s}_${i}0`, limb(hip, knee, 0.17, 0.15), SHELL, smooth);
      m.add(`leg_${s}_${i}1`, taperTube([knee, [s * 1.52, 0.7, z * 1.27], foot], (t) => 0.15 * (1 - t) + 0.04, { segments: 12, radial: 10 }), SHELL, smooth);
    });
    // Arms raised high, big claws open.
    const shoulder = [s * 0.95, 1.42, 0.35];
    const elbow = [s * 1.45, 1.95, 0.24];
    const wrist = [s * 1.68, 2.45, 0.2];
    m.add(`arm_${s}0`, limb(shoulder, elbow, 0.15, 0.13), SHELL, smooth);
    m.add(`arm_${s}1`, limb(elbow, wrist, 0.14, 0.13), SHELL, smooth);
    m.add(`claw_palm_${s}`, new THREE.SphereGeometry(1, 20, 14), SHELL, { ...smooth, pos: [s * 1.75, 2.82, 0.18], rot: [0, 0, -s * 0.2], scale: [0.36, 0.46, 0.26] });
    m.add(`outer_pincer_${s}0`, taperTube([[s * 1.9, 3.1, 0.18], [s * 2.12, 3.45, 0.18], [s * 2.02, 3.78, 0.18], [s * 1.82, 3.86, 0.18]], (t) => 0.19 * (1 - t) + 0.03, { segments: 16, radial: 10 }), SHELL, smooth);
    m.add(`inner_pincer_${s}0`, taperTube([[s * 1.6, 3.06, 0.18], [s * 1.5, 3.38, 0.18], [s * 1.62, 3.58, 0.18]], (t) => 0.13 * (1 - t) + 0.025, { segments: 12, radial: 8 }), SHELL_DARK, smooth);
  });

  // Cape over the back, collar ends to the front, and the leaf clasp.
  m.add('forest_cape', drape({ rx: 1.25, ry: 0.72, rz: 0.78, cy: 1.2, front: 0.15, depth: 1.25, spread: 1.4, lift: 1.18 }), CAPE, { ...smooth, double: true });
  m.both((s) => m.add(`cape_collar_${s}`, taperTube([[s * 1.05, 1.58, 0.05], [s * 0.65, 1.7, 0.6], [s * 0.12, 1.6, 0.72]], (t) => 0.11 - t * 0.05, { segments: 12, radial: 8 }), CAPE_DARK, { ...smooth, scale: [1, 0.6, 1] }));
  leaf(m, 'silver_leaf_clasp', [0, 1.56, 0.74], 0.2, [-0.5, 0, 0.5]);

  // Teal magic flames floating above.
  [[-0.55, 3.45, 0.05], [0.1, 3.75, -0.1], [0.62, 3.5, 0.05]].forEach(([x, y, z], i) => {
    m.add(`magic_orb_${i}`, new THREE.SphereGeometry(0.15, 14, 10), GEM, { ...smooth, pos: [x, y, z], glow: 1.2 });
    m.add(`magic_flame_${i}`, new THREE.ConeGeometry(0.1, 0.3, 10), 0x9ffbe8, { ...smooth, pos: [x + 0.04, y + 0.2, z], rot: [0, 0, -0.3], glow: 1.2 });
    m.add(`magic_spark_${i}`, new THREE.OctahedronGeometry(0.05), 0xffffff, { pos: [x + 0.28, y + 0.25, z + 0.05], glow: 1.5 });
  });
  return m;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Capybara (metres; ~1.1 m long)

function capybara() {
  const m = new Model('capybara', 0);
  const COAT = 0xe9bb8a;
  const COAT_DARK = 0xd6a274;
  const SNOUT = 0xb98a5e;
  const PAW = 0x8a5a36;

  // A round barrel of a body.
  const body = new THREE.SphereGeometry(1, 28, 20);
  deform(body, (v) => {
    v.z *= v.z > 0 ? 1.0 : 1.08; // a bigger rump
    v.y *= v.y < 0 ? 0.85 : 1;
  });
  m.add('body', body, COAT, { ...smooth, pos: [0, 0.5, -0.02], scale: [0.33, 0.3, 0.48] });
  m.add('body_chest', new THREE.SphereGeometry(1, 20, 14), COAT, { ...smooth, pos: [0, 0.55, 0.3], scale: [0.27, 0.27, 0.22] });

  // Short legs, dark paws with toes.
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const x = sx * 0.19;
      const z = sz * 0.28;
      m.add(`leg_${sx}_${sz}`, limb([x, 0.46, z], [x, 0.1, z + 0.02], 0.085, 0.07), COAT_DARK, smooth);
      m.add(`leg_${sx}_${sz}_paw`, new THREE.SphereGeometry(1, 14, 10), PAW, { ...smooth, pos: [x, 0.05, z + 0.05], scale: [0.08, 0.05, 0.1] });
    }

  // Big blocky head with a square, darker snout; small round ears; a sleepy, content look.
  const head = new THREE.SphereGeometry(1, 26, 18);
  deform(head, (v) => {
    // Boxier: push towards a rounded cube.
    const k = 0.35;
    v.x = v.x * (1 - k) + Math.sign(v.x) * Math.pow(Math.abs(v.x), 0.6) * k;
    v.y = v.y * (1 - k) + Math.sign(v.y) * Math.pow(Math.abs(v.y), 0.6) * k;
  });
  m.add('head', head, COAT, { ...smooth, pos: [0, 0.82, 0.5], scale: [0.19, 0.19, 0.24] });
  m.add('head_snout', new THREE.SphereGeometry(1, 20, 14), SNOUT, { ...smooth, pos: [0, 0.78, 0.7], scale: [0.16, 0.14, 0.12] });
  m.both((s) => {
    m.add(`head_nostril_${s}`, new THREE.SphereGeometry(0.018, 8, 6), INK, { pos: [s * 0.05, 0.83, 0.81], scale: [1, 0.6, 0.6] });
    m.add(`head_ear_${s}`, new THREE.SphereGeometry(1, 12, 8), SNOUT, { ...smooth, pos: [s * 0.15, 0.99, 0.42], rot: [0, 0, s * 0.4], scale: [0.055, 0.065, 0.035] });
  });
  m.add('head_mouth', tube([[-0.06, 0.72, 0.79], [0, 0.7, 0.81], [0.05, 0.725, 0.795]], 0.008, 10, 5), INK, smooth);
  eyes(m, 'head_', { at: [0, 0.9, 0.6], spread: 0.158, r: 0.045, turn: 0.75, lid: COAT, look: [0.3, 0] });
  circlet(m, [0, 0.98, 0.48], 0.15, [0, 1.0, 0.64]);

  // Cape over the shoulders and back, clasp at the chest.
  m.add('cape', drape({ rx: 0.33, ry: 0.3, rz: 0.48, cy: 0.52, cz: -0.02, front: 0.3, depth: 0.62, spread: 1.4, folds: 0.012 }), CAPE, { ...smooth, double: true });
  m.add('cape_collar', taperTube([[-0.28, 0.66, 0.24], [0, 0.74, 0.4], [0.28, 0.66, 0.24]], () => 0.045, { segments: 14, radial: 8 }), CAPE_DARK, { ...smooth, scale: [1, 0.7, 1] });
  leaf(m, 'clasp', [0, 0.68, 0.43], 0.075, [0.3, 0, 0.6]);
  return m;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Wolf (metres; ~1.3 m long)

function wolf() {
  const m = new Model('wolf', 0);
  const COAT = 0xa9a5a0;
  const COAT_DARK = 0x86817c;
  const CREAM = 0xf6ead2;

  // Deep chest, tucked waist.
  const body = new THREE.SphereGeometry(1, 28, 20);
  deform(body, (v) => {
    const front = (v.z + 1) / 2; // 0 rump … 1 chest
    v.y *= 0.75 + 0.3 * front;
    v.x *= 0.85 + 0.2 * front;
  });
  m.add('body', body, COAT, { ...smooth, pos: [0, 0.8, 0], scale: [0.24, 0.26, 0.52] });
  m.add('body_chest', new THREE.SphereGeometry(1, 20, 14), CREAM, { ...smooth, pos: [0, 0.74, 0.38], scale: [0.18, 0.24, 0.16] });
  m.add('body_neck', limb([0, 0.82, 0.32], [0, 1.05, 0.55], 0.17, 0.14), COAT, smooth);
  // A fluffy cream ruff on the chest.
  m.add('body_ruff', new THREE.SphereGeometry(1, 18, 12), CREAM, { ...smooth, pos: [0, 0.86, 0.48], scale: [0.16, 0.17, 0.12] });

  // Long legs with cream socks and paws.
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const x = sx * 0.14;
      const z = sz * 0.36;
      m.add(`leg_${sx}_${sz}`, limb([x, 0.76, z], [x, 0.3, z + 0.02], sz > 0 ? 0.075 : 0.09, 0.055), COAT, smooth);
      m.add(`leg_${sx}_${sz}_sock`, limb([x, 0.32, z + 0.02], [x, 0.07, z + 0.03], 0.056, 0.05), CREAM, smooth);
      m.add(`leg_${sx}_${sz}_paw`, new THREE.SphereGeometry(1, 14, 10), CREAM, { ...smooth, pos: [x, 0.045, z + 0.07], scale: [0.065, 0.045, 0.09] });
    }

  // Head: skull, cream muzzle, black nose, tall pointed ears, a confident look.
  const skull = new THREE.SphereGeometry(1, 24, 18);
  m.add('head', skull, COAT, { ...smooth, pos: [0, 1.13, 0.62], scale: [0.19, 0.17, 0.2] });
  m.add('head_cheeks', new THREE.SphereGeometry(1, 18, 12), CREAM, { ...smooth, pos: [0, 1.06, 0.68], scale: [0.17, 0.1, 0.14] });
  m.add('head_muzzle', limb([0, 1.08, 0.7], [0, 1.04, 0.96], 0.095, 0.06, { depth: 0.9 }), CREAM, smooth);
  m.add('head_nose', new THREE.SphereGeometry(1, 12, 8), INK, { ...smooth, pos: [0, 1.07, 1.0], scale: [0.045, 0.035, 0.035] });
  m.add('head_mouth', tube([[-0.05, 1.0, 0.92], [0, 1.0, 0.955], [0.05, 1.0, 0.92]], 0.007, 8, 5), INK, smooth);
  m.both((s) => {
    m.add(`head_ear_${s}`, new THREE.ConeGeometry(0.085, 0.26, 10), COAT, { ...smooth, pos: [s * 0.11, 1.33, 0.56], rot: [-0.15, 0, -s * 0.22], scale: [1, 1, 0.55] });
    m.add(`head_ear_inner_${s}`, new THREE.ConeGeometry(0.05, 0.17, 8), CREAM, { ...smooth, pos: [s * 0.108, 1.31, 0.59], rot: [-0.15, 0, -s * 0.22], scale: [1, 1, 0.4] });
    m.add(`head_brow_${s}`, taperTube([[s * 0.05, 1.235, 0.79], [s * 0.12, 1.25, 0.75]], (t) => 0.014 - t * 0.006, { segments: 6, radial: 6 }), COAT_DARK, smooth);
  });
  eyes(m, 'head_', { at: [0, 1.18, 0.76], spread: 0.095, r: 0.04, turn: 0.4, look: [0.15, 0.1] });
  circlet(m, [0, 1.22, 0.6], 0.16, [0, 1.25, 0.77]);

  // Big bushy tail, held up and curling, with a cream tip.
  const tailPts = [[0, 0.9, -0.46], [0, 1.08, -0.62], [0, 1.24, -0.74], [0, 1.36, -0.72]];
  m.add('tail', taperTube(tailPts, (t) => 0.05 + 0.1 * Math.sin(Math.min(1, t * 1.25) * Math.PI * 0.85), { segments: 24, radial: 12 }), COAT, smooth);
  m.add('tail_tip', taperTube([[0, 1.3, -0.74], [0, 1.4, -0.71], [0, 1.47, -0.66]], (t) => 0.075 * (1 - t) + 0.01, { segments: 10, radial: 10 }), CREAM, smooth);

  // Cape over the shoulders and back, clasp at the chest.
  m.add('cape', drape({ rx: 0.24, ry: 0.26, rz: 0.52, cy: 0.83, front: 0.34, depth: 0.62, spread: 1.4, folds: 0.012 }), CAPE, { ...smooth, double: true });
  m.add('cape_collar', taperTube([[-0.2, 0.95, 0.3], [0, 1.0, 0.46], [0.2, 0.95, 0.3]], () => 0.04, { segments: 14, radial: 8 }), CAPE_DARK, { ...smooth, scale: [1, 0.7, 1] });
  leaf(m, 'clasp', [0, 0.92, 0.5], 0.07, [0.3, 0, 0.6]);
  return m;
}

fs.mkdirSync(OUT, { recursive: true });
for (const build of [crab, capybara, wolf]) {
  const model = build();
  if (model.height) model.normalise();
  const file = path.join(OUT, `${model.name}.glb`);
  fs.writeFileSync(file, toGLB(model, 'Elf & Crab familiars builder'));
  console.log(`${file}  ${model.parts.length} parts  ${Math.round(model.triangles)} triangles  ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
}
