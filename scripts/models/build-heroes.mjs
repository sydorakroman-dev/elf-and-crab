/**
 * Builds the other heroes as GLBs, after their art: the Knight (silver plate, blue cape and
 * tabard, a visored helm, a kite shield with a white tree), the Mage (purple robe with gold trim,
 * a long white beard, a pointed hat, a crystal staff, a lavender flame in the other hand) and the
 * Barbarian (red hair and braided beard, a fur mantle, crossed straps, a blue kilt, fur boots,
 * a great axe) and the Beast Master (dark hair and beard, a fur mantle over one shoulder, a
 * mustard tunic, a torn sash, fur boot tops, a long spear-staff).
 *
 * Every hero shares the elf's skeleton (src/player/elf.ts): the same joints and the same
 * part-name prefixes, so the same rig animates them all:
 *   hips_* · thigh_<side> · shin_<side>* · armL_upper* / armL_lower* (−X) · armR_upper* /
 *   armR_lower* (+X, the weapon hand) · cloak* · head* · tail* · anything else rides the torso.
 *
 *   node scripts/models/build-heroes.mjs   → public/models/{knight,mage,barbarian,beastmaster}.glb
 */
import * as THREE from 'three';
import fs from 'node:fs';
import { Model, deform, lathe, limb, taperTube, toGLB, tube } from './kit.mjs';

const smooth = { smooth: true };
const metal = { metal: 0.65, roughness: 0.3 };
const H = new THREE.Vector3(0, 4.33, 0.03); // head centre
const L_HAND = [-0.84, 2.41, 0.08];
const R_HAND = [1.33, 2.96, 0.22];

// ── Shared body parts ─────────────────────────────────────────────────────────────────────────

/** A head with a strong jaw and a human face. */
function head(m, c, { age = 0, brows = 0.022, smirk = true, ears = true } = {}) {
  const g = new THREE.SphereGeometry(0.33, 28, 20);
  deform(g, (v) => {
    if (v.y < 0) {
      const k = -v.y / 0.33;
      v.x *= 1 - 0.1 * k;
      v.z += 0.05 * k * k;
      v.y = Math.max(v.y, -0.31);
    }
    v.z *= 0.97;
  });
  m.add('head', g, c.skin, { ...smooth, pos: H.toArray() });
  m.both((s) => {
    const ex = s * 0.13;
    const ey = 4.36;
    const ez = 0.3;
    const turn = [0, s * 0.42, 0];
    m.add(`head_eye_${s}`, new THREE.SphereGeometry(1, 14, 10), 0xffffff, { ...smooth, pos: [ex, ey, ez], rot: turn, scale: [0.065, 0.05 - age * 0.012, 0.03] });
    m.add(`head_iris_${s}`, new THREE.SphereGeometry(1, 12, 8), 0x2a1c16, { ...smooth, pos: [ex + 0.02, ey - 0.004, ez + 0.022], rot: turn, scale: [0.032, 0.036 - age * 0.01, 0.018] });
    m.add(`head_shine_${s}`, new THREE.SphereGeometry(0.009, 8, 6), 0xffffff, { pos: [ex + 0.03, ey + 0.012, ez + 0.042], glow: 0.5 });
    const lift = s > 0 && smirk ? 0.015 : 0;
    m.add(`head_brow_${s}`, taperTube([[ex - s * 0.08, ey + 0.075, ez + 0.035], [ex + s * 0.01, ey + 0.1 + lift, ez + 0.03], [ex + s * 0.1, ey + 0.11 + lift, ez - 0.01]], (t) => brows * (1 - t * 0.4), { segments: 10, radial: 6 }), c.brow, smooth);
    if (ears) m.add(`head_ear_${s}`, new THREE.SphereGeometry(1, 10, 8), c.skin, { ...smooth, pos: [s * 0.32, 4.32, -0.02], scale: [0.05, 0.1, 0.08] });
  });
  m.add('head_nose', limb([0, 4.35, 0.31], [0.005, 4.23, 0.38], 0.04, 0.034), c.skin, smooth);
  m.add('head_mouth', tube([[-0.06, 4.15, 0.31], [0, 4.145, 0.325], [0.05, 4.155, 0.318], [0.075, 4.18 + (smirk ? 0.012 : 0), 0.3]], 0.011, 12, 5), c.lip, smooth);
}

/** Bare or sleeved arms on the elf's joints; returns nothing (parts named armL_/armR_). */
function arms(m, c, { upper, lower, r = 1, hands = c.skin }) {
  m.add('armL_upper', limb([-0.5, 3.52, 0], [-0.8, 3.0, 0.02], 0.18 * r, 0.145 * r, { bulge: 0.04 * r }), upper, smooth);
  m.add('armL_lower', limb([-0.81, 3.0, 0.03], [-0.83, 2.55, 0.06], 0.145 * r, 0.115 * r), lower, smooth);
  m.add('armL_lower_hand', new THREE.SphereGeometry(1, 14, 10), hands, { ...smooth, pos: L_HAND, scale: [0.11 * r, 0.13 * r, 0.115 * r] });
  m.add('armR_upper', limb([0.5, 3.52, 0], [0.85, 3.08, 0.04], 0.18 * r, 0.145 * r, { bulge: 0.04 * r }), upper, smooth);
  m.add('armR_lower', limb([0.86, 3.08, 0.05], [1.22, 2.98, 0.17], 0.145 * r, 0.115 * r), lower, smooth);
  m.add('armR_lower_hand', new THREE.SphereGeometry(1, 14, 10), hands, { ...smooth, pos: R_HAND, scale: [0.12 * r, 0.125 * r, 0.115 * r] });
}

/** Legs on the elf's joints. */
function legs(m, { thigh, shin, r = 1 }) {
  m.both((s) => {
    m.add(`thigh_${s}`, limb([s * 0.28, 2.42, 0], [s * 0.42, 1.38, 0.01], 0.2 * r, 0.15 * r, { bulge: 0.02 }), thigh, smooth);
    m.add(`shin_${s}`, limb([s * 0.42, 1.45, 0.01], [s * 0.47, 0.5, 0], 0.145 * r, 0.115 * r, { bulge: 0.015 }), shin, smooth);
  });
}

/** A rounded boot: shaft, foot, sole. */
function boots(m, c, { top = 1.05, cuff = null, toe = 0.36 } = {}) {
  m.both((s) => {
    m.add(`shin_${s}_boot`, limb([s * 0.47, 0.3, 0], [s * 0.445, top, 0.01], 0.17, 0.18), c.boot, smooth);
    const foot = new THREE.SphereGeometry(1, 18, 12);
    deform(foot, (v) => {
      if (v.y < -0.55) v.y = -0.55;
    });
    m.add(`shin_${s}_foot`, foot, c.boot, { ...smooth, pos: [s * 0.48, 0.2, 0.14], scale: [0.18, 0.16, toe] });
    m.add(`shin_${s}_sole`, new THREE.CylinderGeometry(0.17, 0.17, 0.06, 14), c.sole, { pos: [s * 0.48, 0.08, 0.1], scale: [1, 1, 1.9] });
    if (cuff) m.add(`shin_${s}_cuff`, lathe([[0.19, top - 0.08], [0.24, top - 0.02], [0.25, top + 0.12], [0.2, top + 0.16]], 18), cuff, { ...smooth, pos: [s * 0.445, 0, 0.01] });
  });
}

/** A torso lathe (radius `w` at the chest), squashed front to back. */
function torso(m, name, color, w = 1, depth = 0.62) {
  const g = lathe([[0.0, 2.6], [0.4 * w, 2.62], [0.43 * w, 2.85], [0.5 * w, 3.2], [0.54 * w, 3.45], [0.46 * w, 3.64], [0.22, 3.76], [0.0, 3.78]], 30);
  m.add(name, g, color, { ...smooth, scale: [1, 1, depth] });
}

/** A shaggy fur pad (shoulder mantle). */
function furPad(m, name, at, color, r) {
  const g = new THREE.SphereGeometry(r, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.62);
  deform(g, (v) => {
    const a = Math.atan2(v.z, v.x);
    const k = 1 + 0.12 * Math.sin(a * 11 + v.y * 20) + 0.06 * Math.sin(a * 5);
    v.x *= k;
    v.z *= k;
  });
  m.add(name, g, color, { ...smooth, pos: at, scale: [1.05, 0.75, 1.15] });
}

const write = (m, file) => {
  fs.writeFileSync(file, toGLB(m, 'Elf & Crab hero builder'));
  console.log(`${file}  ${m.parts.length} parts  ${Math.round(m.triangles)} triangles  ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
};

// ── The Knight ────────────────────────────────────────────────────────────────────────────────
{
  const c = {
    skin: 0xf2c49a,
    brow: 0x8a6a3a,
    lip: 0xa85c4c,
    hair: 0xe8c068,
    steel: 0xe6eaf0,
    steelDark: 0x9aa4b2,
    blue: 0x2457c8,
    blueDark: 0x1a3f94,
    black: 0x3a3c44,
    boot: 0xe6eaf0,
    sole: 0x6a7280,
    white: 0xffffff,
  };
  const m = new Model('knight', 5);
  // Plate legs: cuisses, knee cops, greaves, sabatons.
  legs(m, { thigh: c.steel, shin: c.steel, r: 1.08 });
  boots(m, c, { top: 1.0, toe: 0.38 });
  m.both((s) => {
    m.add(`shin_${s}_knee`, new THREE.SphereGeometry(1, 12, 8), c.steel, { ...smooth, ...metal, pos: [s * 0.42, 1.44, 0.12], scale: [0.2, 0.22, 0.17] });
    m.add(`shin_${s}_kneefan`, new THREE.ConeGeometry(0.16, 0.14, 4), c.steelDark, { ...metal, pos: [s * 0.42, 1.44, 0.27], rot: [Math.PI / 2, Math.PI / 4, 0] });
  });
  // Tassets (plate skirt) and the blue tabard falling front and back.
  const tasset = lathe([[0.43, 2.82], [0.5, 2.55], [0.58, 2.22]], 28);
  deform(tasset, (v) => (v.z *= 0.72));
  m.add('hips_tasset', tasset, c.steel, { ...smooth, ...metal, double: true });
  for (const z of [1, -1]) {
    const tab = new THREE.PlaneGeometry(0.5, 1.15, 1, 4);
    deform(tab, (v) => (v.z = 0.02 * Math.cos(v.x * 6)));
    m.add(`hips_tabard_${z}`, tab, c.blue, { pos: [0, 2.2, z * 0.44], rot: [z > 0 ? -0.12 : 0.12, z > 0 ? 0 : Math.PI, 0], double: true });
  }
  // Breastplate, gorget, belt.
  torso(m, 'breastplate', c.steel, 1.12, 0.68);
  m.add('breast_ridge', tube([[0, 3.62, 0.38], [0, 3.2, 0.42], [0, 2.85, 0.33]], 0.03, 10, 5), c.steelDark, { ...metal, ...smooth });
  m.add('breast_tabard', new THREE.PlaneGeometry(0.42, 0.55), c.blue, { pos: [0, 2.82, 0.37], rot: [-0.25, 0, 0], double: true });
  m.add('gorget', new THREE.TorusGeometry(0.24, 0.08, 8, 20), c.black, { ...smooth, pos: [0, 3.72, 0], rot: [Math.PI / 2, 0, 0] });
  m.add('neck', limb([0, 3.62, 0], [0, 4.02, 0.02], 0.16, 0.15), c.skin, smooth);
  m.add('belt', new THREE.CylinderGeometry(0.5, 0.5, 0.15, 30, 1, true), c.black, { ...smooth, pos: [0, 2.74, 0], scale: [1, 1, 0.72] });
  m.add('belt_buckle', new THREE.TorusGeometry(0.09, 0.025, 4, 4), c.steel, { ...metal, pos: [0, 2.74, 0.37], rot: [0, 0, Math.PI / 4] });
  m.both((s) => m.add(`breast_rivet_${s}`, new THREE.CylinderGeometry(0.08, 0.08, 0.04, 12), c.steelDark, { ...metal, pos: [s * 0.28, 3.62, 0.33], rot: [Math.PI / 2 - 0.3, 0, 0] }));
  // Arms in plate with big pauldrons.
  arms(m, c, { upper: c.steel, lower: c.steel, r: 1.12, hands: c.black });
  m.both((s) => {
    const side = s < 0 ? 'armL_upper' : 'armR_upper';
    m.add(`${side}_pauldron`, new THREE.SphereGeometry(0.3, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), c.steel, { ...smooth, ...metal, pos: [s * 0.55, 3.52, 0], rot: [0, 0, -s * 0.6], scale: [1.05, 0.8, 1.1] });
    m.add(`${side}_pauldron_rim`, new THREE.TorusGeometry(0.3, 0.035, 6, 20), c.steelDark, { ...metal, pos: [s * 0.62, 3.42, 0], rot: [Math.PI / 2, s * 0.6, 0], scale: [1.05, 1.1, 1] });
  });
  // The blue cape hanging from the shoulders.
  const cape = lathe([[0.42, 3.72], [0.6, 3.5], [0.68, 2.8], [0.78, 1.8], [0.88, 0.75]], 32, Math.PI - 1.3, 2.6);
  deform(cape, (v) => {
    const a = Math.atan2(v.x, v.z);
    const r = Math.hypot(v.x, v.z) + Math.sin(a * 6) * 0.05 * ((3.72 - v.y) / 3);
    v.x = Math.sin(a) * r;
    v.z = Math.cos(a) * r * 0.75 - 0.05;
  });
  m.add('cloak', cape, c.blue, { ...smooth, double: true });
  m.add('cloak_lining', cape, c.blueDark, { ...smooth, double: true, scale: [0.98, 1, 0.98], pos: [0, 0, 0.02] });
  // Longsword in the weapon hand (standing up from the fist), a kite shield on the other arm.
  const [hx, hy, hz] = R_HAND;
  m.add('armR_lower_grip', new THREE.CylinderGeometry(0.06, 0.06, 0.5, 8), c.black, { pos: [hx, hy, hz] });
  m.add('armR_lower_pommel', new THREE.SphereGeometry(0.09, 10, 8), c.steel, { ...metal, pos: [hx, hy - 0.3, hz] });
  m.add('armR_lower_guard', new THREE.BoxGeometry(0.7, 0.1, 0.14), c.steel, { ...metal, pos: [hx, hy + 0.28, hz] });
  m.add('armR_lower_blade', new THREE.BoxGeometry(0.18, 2.5, 0.05), c.steel, { ...metal, pos: [hx, hy + 1.58, hz] });
  m.add('armR_lower_bladetip', new THREE.ConeGeometry(0.13, 0.36, 4), c.steel, { ...metal, pos: [hx, hy + 3.0, hz], rot: [0, Math.PI / 4, 0], scale: [1, 1, 0.3] });
  m.add('armR_lower_fuller', new THREE.BoxGeometry(0.04, 2.1, 0.06), c.steelDark, { ...metal, pos: [hx, hy + 1.5, hz] });
  const kite = new THREE.Shape();
  kite.moveTo(0, 0.75);
  kite.quadraticCurveTo(0.55, 0.72, 0.58, 0.35);
  kite.quadraticCurveTo(0.55, -0.45, 0, -1.05);
  kite.quadraticCurveTo(-0.55, -0.45, -0.58, 0.35);
  kite.quadraticCurveTo(-0.55, 0.72, 0, 0.75);
  const shieldAt = [-0.98, 2.75, 0.18];
  const shieldRot = [0, -0.55, 0];
  const out = (d) => [shieldAt[0] + Math.sin(-0.55) * d, shieldAt[1], shieldAt[2] + Math.cos(-0.55) * d];
  m.add('armL_lower_shield', new THREE.ExtrudeGeometry(kite, { depth: 0.08, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.03, bevelSegments: 1 }), c.steel, { ...metal, pos: shieldAt, rot: shieldRot });
  m.add('armL_lower_shield_face', new THREE.ShapeGeometry(kite), c.blue, { pos: out(0.15), rot: shieldRot, scale: [0.86, 0.86, 1], double: true });
  const tree = new THREE.Shape();
  tree.moveTo(0, 0.5);
  for (const [x, y] of [[0.12, 0.28], [0.06, 0.28], [0.2, 0.02], [0.08, 0.02], [0.26, -0.3], [0.05, -0.3], [0.05, -0.55], [-0.05, -0.55], [-0.05, -0.3], [-0.26, -0.3], [-0.08, 0.02], [-0.2, 0.02], [-0.06, 0.28], [-0.12, 0.28]]) tree.lineTo(x, y);
  tree.closePath();
  m.add('armL_lower_shield_tree', new THREE.ShapeGeometry(tree), c.white, { pos: out(0.165), rot: shieldRot, double: true });
  // Head: a square-jawed face, blond hair at the sides, the helm with its visor raised.
  head(m, c, { brows: 0.024 });
  m.add('head_helm', new THREE.SphereGeometry(0.37, 26, 16, 0, Math.PI * 2, 0, 1.75), c.steel, { ...smooth, pos: [H.x, H.y + 0.02, H.z - 0.04], rot: [-0.45, 0, 0], scale: [1.02, 1.05, 1.05] });
  m.add('head_helm_crest', new THREE.BoxGeometry(0.06, 0.12, 0.6), c.steelDark, { ...metal, pos: [0, 4.73, -0.05], rot: [0.3, 0, 0] });
  m.add('head_visor', new THREE.SphereGeometry(0.41, 22, 10, -1.25, 2.5, 0.35, 0.55), c.steel, { ...smooth, double: true, pos: [H.x, H.y + 0.08, H.z + 0.03], rot: [-0.35, 0, 0] });
  for (let i = -2; i <= 2; i++) m.add(`head_slit_${i + 2}`, new THREE.BoxGeometry(0.04, 0.12, 0.03), c.black, { pos: [i * 0.075, 4.74, 0.34], rot: [-0.7, 0, 0] });
  m.both((s) => {
    m.add(`head_rivet_${s}`, new THREE.CylinderGeometry(0.06, 0.06, 0.04, 12), c.steelDark, { ...metal, pos: [s * 0.36, 4.42, 0.05], rot: [0, 0, Math.PI / 2] });
    m.add(`head_hair_${s}`, taperTube([[s * 0.24, 4.6, 0.18], [s * 0.33, 4.45, 0.17], [s * 0.34, 4.3, 0.12]], (t) => 0.07 * (1 - t * 0.5), { segments: 10, radial: 7 }), c.hair, smooth);
  });
  write(m, 'public/models/knight.glb');
}

// ── The Mage ──────────────────────────────────────────────────────────────────────────────────
{
  const c = {
    skin: 0xf0c8a6,
    brow: 0xf2f2f0,
    lip: 0xb06a5a,
    beard: 0xf4f4f0,
    robe: 0x7a2ec0,
    robeDark: 0x5a1f94,
    gold: 0xf2c24a,
    leather: 0x7a4a26,
    boot: 0x8a5530,
    sole: 0x4a301c,
    pants: 0x5a3a22,
    wood: 0x8a5a30,
    crystal: 0xc8a8ff,
  };
  const m = new Model('mage', 5);
  legs(m, { thigh: c.pants, shin: c.pants });
  boots(m, c, { top: 0.8, cuff: c.boot });
  // The robe: a long skirt to the ankles, gold-trimmed, with a gold panel down the front.
  const robe = lathe([[0.43, 2.82], [0.5, 2.4], [0.66, 1.6], [0.86, 0.75], [0.95, 0.42]], 36);
  deform(robe, (v) => {
    const a = Math.atan2(v.x, v.z);
    v.z *= 0.8;
    v.y += (2.82 - v.y) * 0.03 * Math.sin(a * 5);
  });
  m.add('hips_robe', robe, c.robe, { ...smooth, double: true });
  m.add('hips_robe_hem', lathe([[0.95, 0.5], [0.98, 0.45], [0.97, 0.38], [0.93, 0.38]], 36), c.gold, { ...smooth, scale: [1, 1, 0.8] });
  m.add('hips_panel', new THREE.PlaneGeometry(0.34, 2.2, 1, 6), c.gold, { pos: [0, 1.62, 0.6], rot: [-0.17, 0, 0], double: true });
  m.add('hips_sash', new THREE.PlaneGeometry(0.2, 1.0), c.leather, { pos: [0, 2.3, 0.55], rot: [-0.12, 0, 0], double: true });
  // Robe top with gold lapels, a belt with a gold buckle.
  torso(m, 'robe_torso', c.robe, 1.02);
  m.both((s) => m.add(`robe_lapel_${s}`, taperTube([[s * 0.22, 3.74, 0.12], [s * 0.15, 3.4, 0.3], [s * 0.05, 2.95, 0.32]], (t) => 0.06 * (1 - t * 0.4), { segments: 12, radial: 6 }), c.gold, smooth));
  m.add('robe_collar', new THREE.TorusGeometry(0.25, 0.09, 8, 20, Math.PI * 1.3), c.robeDark, { ...smooth, pos: [0, 3.72, -0.02], rot: [Math.PI / 2, 0, Math.PI * 0.85] });
  m.add('neck', limb([0, 3.62, 0], [0, 4.02, 0.02], 0.14, 0.13), c.skin, smooth);
  m.add('belt', new THREE.CylinderGeometry(0.45, 0.45, 0.15, 30, 1, true), c.leather, { ...smooth, pos: [0, 2.76, 0], scale: [1, 1, 0.66] });
  m.add('belt_buckle', new THREE.TorusGeometry(0.1, 0.03, 4, 4), c.gold, { ...metal, pos: [0, 2.76, 0.31], rot: [0, 0, Math.PI / 4] });
  // Arms in wide bell sleeves with gold cuffs.
  arms(m, c, { upper: c.robe, lower: c.robe });
  for (const [side, from, to] of [['armL_lower', [-0.8, 3.02, 0.02], [-0.84, 2.5, 0.06]], ['armR_lower', [0.86, 3.08, 0.05], [1.24, 2.97, 0.18]]]) {
    const len = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    const sleeve = lathe([[0.15, 0], [0.22, len * 0.5], [0.34, len]], 16);
    const dir = new THREE.Vector3(to[0] - from[0], to[1] - from[1], to[2] - from[2]).normalize();
    sleeve.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
    sleeve.translate(...from);
    m.add(`${side}_sleeve`, sleeve, c.robe, { ...smooth, double: true });
    const cuff = new THREE.TorusGeometry(0.34, 0.045, 6, 18);
    cuff.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir));
    cuff.translate(to[0], to[1], to[2]);
    m.add(`${side}_cuff`, cuff, c.gold, smooth);
  }
  // A gnarled staff topped by a glowing crystal; a lavender flame over the other palm.
  const [hx, hy, hz] = R_HAND;
  m.add('armR_lower_staff', taperTube([[hx + 0.02, 0.2, hz], [hx - 0.04, 1.6, hz + 0.03], [hx, hy, hz], [hx + 0.05, 4.4, hz - 0.02], [hx - 0.02, 5.35, hz]], (t) => 0.075 - t * 0.02, { segments: 30, radial: 7 }), c.wood, smooth);
  for (const a of [0, 2.1, 4.2]) m.add(`armR_lower_prong_${a.toFixed(1)}`, taperTube([[hx, 5.3, hz], [hx + Math.cos(a) * 0.16, 5.55, hz + Math.sin(a) * 0.16], [hx + Math.cos(a) * 0.1, 5.85, hz + Math.sin(a) * 0.1]], (t) => 0.045 * (1 - t * 0.6), { segments: 8, radial: 5 }), c.wood, smooth);
  m.add('armR_lower_crystal', new THREE.OctahedronGeometry(0.22, 0), c.crystal, { pos: [hx, 5.72, hz], scale: [0.85, 1.6, 0.85], glow: 0.9 });
  m.add('armL_lower_flame', new THREE.SphereGeometry(0.16, 12, 10), 0xc9a0ff, { pos: [L_HAND[0] - 0.02, L_HAND[1] - 0.28, L_HAND[2] + 0.15], scale: [1, 1.5, 1], glow: 1.2, opacity: 0.85 });
  // Head: an old face, white hair and a long white beard, the pointed hat.
  head(m, c, { age: 1, brows: 0.032 });
  m.add('head_beard', taperTube([[0, 4.18, 0.24], [0, 3.85, 0.33], [0, 3.45, 0.35], [0.02, 3.05, 0.3]], (t) => 0.2 * (1 - t * 0.75) + 0.03, { segments: 20, radial: 10 }), c.beard, { ...smooth, scale: [1.25, 1, 0.75] });
  m.add('head_moustache', taperTube([[-0.17, 4.12, 0.28], [0, 4.2, 0.33], [0.17, 4.12, 0.28]], (t) => 0.045 * (1 - Math.abs(t - 0.5)), { segments: 12, radial: 6 }), c.beard, smooth);
  m.both((s) => m.add(`head_hair_${s}`, taperTube([[s * 0.3, 4.45, 0.05], [s * 0.36, 4.15, -0.05], [s * 0.3, 3.85, -0.15]], (t) => 0.1 * (1 - t * 0.6), { segments: 12, radial: 8 }), c.beard, smooth));
  m.add('head_hair_back', new THREE.SphereGeometry(0.34, 18, 12, 0, Math.PI * 2, Math.PI * 0.4, Math.PI * 0.5), c.beard, { ...smooth, pos: [0, 4.3, -0.06], rot: [0.4, 0, 0] });
  m.add('head_hat_brim', new THREE.CylinderGeometry(0.62, 0.66, 0.05, 28), c.robe, { ...smooth, pos: [0, 4.6, -0.02], rot: [-0.12, 0, 0.06] });
  m.add('head_hat_band', new THREE.CylinderGeometry(0.36, 0.38, 0.13, 24, 1, true), c.gold, { ...smooth, pos: [0, 4.69, -0.03], rot: [-0.12, 0, 0.06] });
  m.add('head_hat', taperTube([[0, 4.62, -0.03], [0, 5.1, -0.08], [0.05, 5.5, -0.2], [0.25, 5.72, -0.38]], (t) => 0.37 * Math.pow(1 - t, 1.1) + 0.012, { segments: 24, radial: 18 }), c.robe, smooth);
  write(m, 'public/models/mage.glb');
}

// ── The Barbarian ─────────────────────────────────────────────────────────────────────────────
{
  const c = {
    skin: 0xf2b88e,
    brow: 0xc0501e,
    lip: 0xa85c4c,
    hair: 0xd8642a,
    hairDark: 0xb04a1a,
    fur: 0xe4e2dc,
    furDark: 0xb8b4ac,
    tunic: 0x4a3324,
    leather: 0x7a4a2a,
    strap: 0x5a3a24,
    kilt: 0x4f6f9f,
    kiltTrim: 0x9aa4b2,
    pants: 0x4a3324,
    boot: 0x8a5a34,
    sole: 0x4a301c,
    iron: 0x9aa0a8,
    steel: 0xd6dbe2,
    wood: 0x6a4026,
  };
  const m = new Model('barbarian', 5);
  legs(m, { thigh: c.pants, shin: c.pants, r: 1.18 });
  boots(m, c, { top: 1.0, toe: 0.38 });
  // Fur boot tops.
  m.both((s) => {
    const fur = lathe([[0.2, 0.92], [0.3, 0.98], [0.32, 1.15], [0.27, 1.3], [0.2, 1.32]], 16);
    deform(fur, (v) => {
      const a = Math.atan2(v.x, v.z);
      const k = 1 + 0.12 * Math.sin(a * 7 + v.y * 9);
      v.x *= k;
      v.z *= k;
    });
    m.add(`shin_${s}_fur`, fur, c.fur, { ...smooth, pos: [s * 0.445, 0, 0.01] });
  });
  // A blue kilt with grey trim over the trousers, and a leather front flap.
  const kilt = lathe([[0.48, 2.82], [0.56, 2.4], [0.7, 1.75]], 30, 0.35, Math.PI * 2 - 0.7);
  deform(kilt, (v) => {
    v.z = v.z * 0.76 + 0.01;
    const a = Math.atan2(v.x, v.z);
    v.y -= (2.82 - v.y) * 0.08 * Math.max(0, Math.cos(a * 2));
  });
  m.add('hips_kilt', kilt, c.kilt, { ...smooth, double: true });
  m.add('hips_kilt_trim', lathe([[0.7, 1.82], [0.72, 1.76], [0.71, 1.72], [0.68, 1.72]], 30, 0.35, Math.PI * 2 - 0.7), c.kiltTrim, { ...smooth, scale: [1, 1, 0.76] });
  m.add('hips_flap', new THREE.PlaneGeometry(0.34, 1.0), c.leather, { pos: [0, 2.3, 0.47], rot: [-0.14, 0, 0], double: true });
  // A big chest in a dark sleeveless tunic, crossed straps, a wide belt with an iron buckle.
  torso(m, 'tunic', c.tunic, 1.2, 0.7);
  m.add('strap_a', tube([[-0.5, 3.66, 0.12], [-0.2, 3.35, 0.43], [0.25, 2.92, 0.42], [0.55, 2.82, 0.1]], 0.04, 24, 6), c.strap, smooth);
  m.add('strap_b', tube([[0.5, 3.66, 0.12], [0.2, 3.35, 0.44], [-0.25, 2.92, 0.43], [-0.55, 2.82, 0.1]], 0.04, 24, 6), c.strap, smooth);
  m.add('neck', limb([0, 3.6, 0], [0, 4.0, 0.03], 0.19, 0.17), c.skin, smooth);
  m.add('belt', new THREE.CylinderGeometry(0.55, 0.55, 0.22, 30, 1, true), c.leather, { ...smooth, pos: [0, 2.74, 0], scale: [1, 1, 0.74] });
  m.add('belt_buckle', new THREE.TorusGeometry(0.13, 0.035, 4, 4), c.iron, { ...metal, pos: [0, 2.74, 0.42], rot: [0, 0, Math.PI / 4] });
  // The fur mantle over the shoulders and back, held by two iron discs.
  const mantle = lathe([[0.3, 3.86], [0.62, 3.7], [0.76, 3.35], [0.72, 2.7], [0.66, 2.05]], 30, Math.PI - 1.75, 3.5);
  deform(mantle, (v) => {
    const a = Math.atan2(v.x, v.z);
    const shag = 1 + 0.07 * Math.sin(a * 13 + v.y * 6) + 0.05 * Math.sin(a * 7);
    v.x *= shag;
    v.z = v.z * shag * 0.82 - 0.04;
    if (v.y < 2.3) v.y -= Math.abs(Math.sin(a * 9)) * 0.22; // ragged hem
  });
  m.add('cloak', mantle, c.fur, { ...smooth, double: true });
  const collar = new THREE.TorusGeometry(0.42, 0.2, 10, 24, Math.PI * 1.4);
  deform(collar, (v) => {
    const k = 1 + 0.08 * Math.sin(Math.atan2(v.y, v.x) * 11);
    v.x *= k;
    v.y *= k;
  });
  m.add('mantle_collar', collar, c.fur, { ...smooth, pos: [0, 3.74, -0.06], rot: [Math.PI / 2, 0, Math.PI * 0.8] });
  m.both((s) => m.add(`mantle_disc_${s}`, new THREE.CylinderGeometry(0.11, 0.11, 0.05, 16), c.iron, { ...metal, pos: [s * 0.36, 3.62, 0.36], rot: [Math.PI / 2 - 0.35, 0, 0] }));
  // Bare, muscular arms with studded leather bracers.
  arms(m, c, { upper: c.skin, lower: c.skin, r: 1.25 });
  for (const [side, at, dir] of [['armL_lower', [-0.82, 2.68, 0.05], [-0.04, -0.9, 0.08]], ['armR_lower', [1.1, 3.01, 0.13], [0.95, -0.25, 0.3]]]) {
    const d = new THREE.Vector3(...dir).normalize();
    const brace = new THREE.CylinderGeometry(0.17, 0.16, 0.34, 14, 1, true);
    brace.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d));
    brace.translate(...at);
    m.add(`${side}_bracer`, brace, c.leather, { ...smooth, double: true });
  }
  // The great axe: a long wrapped haft, a broad crescent head.
  const [hx, hy, hz] = R_HAND;
  m.add('armR_lower_haft', taperTube([[hx, 0.5, hz], [hx, hy, hz], [hx, 5.3, hz]], () => 0.075, { segments: 12, radial: 8 }), c.wood, smooth);
  for (let i = 0; i < 4; i++) m.add(`armR_lower_wrap${i}`, new THREE.TorusGeometry(0.08, 0.02, 5, 10), c.strap, { pos: [hx, 1.2 + i * 0.35, hz], rot: [Math.PI / 2, 0, 0] });
  const blade = new THREE.Shape();
  blade.moveTo(0, 0.25);
  blade.lineTo(0.35, 0.3);
  blade.quadraticCurveTo(0.95, 0.75, 1.0, 0.0);
  blade.quadraticCurveTo(0.95, -0.75, 0.35, -0.3);
  blade.lineTo(0, -0.25);
  blade.closePath();
  m.add('armR_lower_axe', new THREE.ExtrudeGeometry(blade, { depth: 0.1, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 1 }), c.steel, { ...metal, pos: [hx + 0.02, 4.75, hz - 0.05], rot: [0, -Math.PI / 2, 0] });
  m.add('armR_lower_axe_socket', new THREE.BoxGeometry(0.22, 0.6, 0.22), c.iron, { ...metal, pos: [hx, 4.75, hz] });
  m.add('armR_lower_axe_spike', new THREE.ConeGeometry(0.08, 0.35, 5), c.iron, { ...metal, pos: [hx, 5.42, hz] });
  // Head: a big jaw, an undercut with red hair swept back, a bushy beard with two braids.
  head(m, c, { brows: 0.03, smirk: true });
  m.add('head_hair_top', new THREE.SphereGeometry(0.35, 22, 14, 0, Math.PI * 2, 0, 1.25), c.hair, { ...smooth, pos: [H.x, H.y + 0.06, H.z - 0.06], rot: [-0.5, 0, 0], scale: [0.72, 1, 1.05] });
  for (let i = -1; i <= 1; i++)
    m.add(`head_hair_sweep_${i + 1}`, taperTube([[i * 0.1, 4.68, 0.15], [i * 0.12, 4.78, -0.1], [i * 0.14, 4.62, -0.38]], (t) => 0.09 * (1 - t * 0.5), { segments: 12, radial: 8 }), i ? c.hairDark : c.hair, smooth);
  m.add('head_beard', taperTube([[0, 4.1, 0.25], [0, 3.95, 0.34], [0, 3.78, 0.33]], (t) => 0.2 * (1 - t * 0.35), { segments: 14, radial: 12 }), c.hair, { ...smooth, scale: [1.15, 1, 0.75] });
  m.both((s) => m.add(`head_jaw_${s}`, taperTube([[s * 0.28, 4.3, 0.06], [s * 0.26, 4.1, 0.2], [s * 0.1, 4.0, 0.3]], () => 0.07, { segments: 10, radial: 6 }), c.hair, smooth));
  m.both((s) => {
    m.add(`head_sideburn_${s}`, taperTube([[s * 0.3, 4.4, 0.08], [s * 0.3, 4.15, 0.18], [s * 0.2, 4.0, 0.28]], (t) => 0.07, { segments: 10, radial: 6 }), c.hair, smooth);
    m.add(`head_braid_${s}`, taperTube([[s * 0.12, 3.86, 0.33], [s * 0.14, 3.62, 0.36], [s * 0.13, 3.38, 0.33]], (t) => 0.055 * (1 - t * 0.3), { segments: 12, radial: 6 }), c.hairDark, smooth);
    for (const y of [3.7, 3.5]) m.add(`head_braid_ring_${s}_${y}`, new THREE.TorusGeometry(0.06, 0.022, 5, 10), c.iron, { ...metal, pos: [s * 0.135, y, 0.35], rot: [Math.PI / 2, 0, 0] });
  });
  m.add('head_moustache', taperTube([[-0.15, 4.11, 0.3], [0, 4.19, 0.35], [0.15, 4.11, 0.3]], (t) => 0.045 * (1 - Math.abs(t - 0.5)), { segments: 12, radial: 6 }), c.hairDark, smooth);
  // Big shaggy fur on both shoulders (the mantle's top).
  m.both((s) => furPad(m, `${s < 0 ? 'armL' : 'armR'}_upper_fur`, [s * 0.58, 3.55, -0.02], c.fur, 0.42));
  write(m, 'public/models/barbarian.glb');
}

// ── The Beast Master ──────────────────────────────────────────────────────────────────────────
{
  const c = {
    skin: 0xeab088,
    brow: 0x3a2416,
    lip: 0xa05a48,
    hair: 0x4a2e1c,
    hairDark: 0x35200f,
    fur: 0xe8e2d4,
    tunic: 0xc8962e,
    tunicDark: 0xa6781e,
    sash: 0xeee0c2,
    leather: 0x7a4a2a,
    strap: 0x5a3622,
    pants: 0x4a3324,
    boot: 0x8a5a34,
    sole: 0x4a301c,
    iron: 0x9aa0a8,
    wood: 0x7a4a26,
  };
  const m = new Model('beastmaster', 5);
  legs(m, { thigh: c.pants, shin: c.pants, r: 1.15 });
  boots(m, c, { top: 0.95, toe: 0.38 });
  // Wrapped boots with fur tops.
  m.both((s) => {
    for (let i = 0; i < 3; i++) m.add(`shin_${s}_wrap${i}`, new THREE.TorusGeometry(0.19, 0.025, 5, 14), c.strap, { pos: [s * 0.46, 0.45 + i * 0.18, 0.01], rot: [Math.PI / 2 + (i % 2 ? 0.2 : -0.2), 0, 0] });
    const fur = lathe([[0.2, 0.9], [0.3, 0.96], [0.32, 1.12], [0.27, 1.26], [0.2, 1.28]], 16);
    deform(fur, (v) => {
      const a = Math.atan2(v.x, v.z);
      const k = 1 + 0.12 * Math.sin(a * 7 + v.y * 9);
      v.x *= k;
      v.z *= k;
    });
    m.add(`shin_${s}_fur`, fur, c.fur, { ...smooth, pos: [s * 0.445, 0, 0.01] });
  });
  // The tunic's skirt with a ragged hem, and the torn cream sash hanging in front.
  const skirt = lathe([[0.46, 2.82], [0.54, 2.4], [0.66, 1.85]], 30);
  deform(skirt, (v) => {
    v.z *= 0.74;
    const a = Math.atan2(v.x, v.z);
    if (v.y < 2.0) v.y -= Math.abs(Math.sin(a * 6)) * 0.18;
  });
  m.add('hips_tunic', skirt, c.tunic, { ...smooth, double: true });
  const sash = new THREE.PlaneGeometry(0.36, 1.25, 4, 6);
  deform(sash, (v) => {
    if (v.y < -0.4) v.y -= Math.abs(Math.sin(v.x * 18)) * 0.18;
    v.z = 0.03 * Math.sin(v.y * 4);
  });
  m.add('hips_sash', sash, c.sash, { pos: [0.08, 2.18, 0.47], rot: [-0.15, 0, 0.05], double: true });
  m.add('hips_sash_tail', new THREE.PlaneGeometry(0.16, 0.9), c.leather, { pos: [-0.12, 2.25, 0.49], rot: [-0.15, 0, -0.04], double: true });
  // A broad chest in the sleeveless mustard tunic, a V neck, a belt with an iron buckle.
  torso(m, 'tunic', c.tunic, 1.16, 0.68);
  const v = new THREE.Shape();
  v.moveTo(-0.2, 0);
  v.lineTo(0.2, 0);
  v.lineTo(0, -0.42);
  v.closePath();
  m.add('tunic_vneck', new THREE.ShapeGeometry(v), c.skin, { pos: [0, 3.74, 0.37], rot: [-0.15, 0, 0], double: true });
  m.add('neck', limb([0, 3.6, 0], [0, 4.0, 0.03], 0.18, 0.16), c.skin, smooth);
  m.add('belt', new THREE.CylinderGeometry(0.53, 0.53, 0.2, 30, 1, true), c.leather, { ...smooth, pos: [0, 2.74, 0], scale: [1, 1, 0.72] });
  m.add('belt_buckle', new THREE.TorusGeometry(0.12, 0.034, 4, 4), c.iron, { ...metal, pos: [0, 2.74, 0.4], rot: [0, 0, Math.PI / 4] });
  m.add('strap', tube([[-0.55, 3.66, 0.05], [-0.25, 3.4, 0.42], [0.25, 2.98, 0.42], [0.55, 2.84, 0.1]], 0.045, 24, 6), c.strap, smooth);
  // A fur mantle over one shoulder, pinned with an iron disc.
  furPad(m, 'armL_upper_fur', [-0.6, 3.56, -0.02], c.fur, 0.48);
  const mantle = lathe([[0.3, 3.82], [0.58, 3.6], [0.66, 3.1], [0.62, 2.5]], 24, Math.PI - 0.4, 1.9);
  deform(mantle, (v) => {
    const a = Math.atan2(v.x, v.z);
    const k = 1 + 0.08 * Math.sin(a * 13 + v.y * 6);
    v.x *= k;
    v.z = v.z * k * 0.82 - 0.05;
    if (v.y < 2.7) v.y -= Math.abs(Math.sin(a * 9)) * 0.2;
  });
  m.add('cloak', mantle, c.fur, { ...smooth, double: true });
  m.add('mantle_disc', new THREE.CylinderGeometry(0.12, 0.12, 0.05, 16), c.iron, { ...metal, pos: [-0.3, 3.62, 0.38], rot: [Math.PI / 2 - 0.3, 0, 0] });
  // Bare, strong arms with wrapped bracers.
  arms(m, c, { upper: c.skin, lower: c.skin, r: 1.2 });
  for (const [side, at, dir] of [['armL_lower', [-0.82, 2.68, 0.05], [-0.04, -0.9, 0.08]], ['armR_lower', [1.1, 3.01, 0.13], [0.95, -0.25, 0.3]]]) {
    const d = new THREE.Vector3(...dir).normalize();
    const brace = new THREE.CylinderGeometry(0.165, 0.155, 0.36, 14, 1, true);
    brace.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d));
    brace.translate(...at);
    m.add(`${side}_bracer`, brace, c.strap, { ...smooth, double: true });
  }
  // A long wooden spear-staff with a small iron head and leather grips.
  const [hx, hy, hz] = R_HAND;
  m.add('armR_lower_staff', taperTube([[hx, 0.15, hz], [hx, hy, hz], [hx, 5.6, hz]], (t) => 0.085 - t * 0.015, { segments: 14, radial: 8 }), c.wood, smooth);
  for (const y of [hy - 0.2, hy + 0.25, 4.7]) m.add(`armR_lower_grip_${y.toFixed(1)}`, new THREE.CylinderGeometry(0.095, 0.095, 0.22, 8), c.strap, { pos: [hx, y, hz] });
  m.add('armR_lower_tip', new THREE.ConeGeometry(0.11, 0.45, 5), c.iron, { ...metal, pos: [hx, 5.8, hz] });
  // Head: dark, tousled hair, a full beard.
  head(m, c, { brows: 0.032 });
  m.add('head_hair_cap', new THREE.SphereGeometry(0.36, 22, 14, 0, Math.PI * 2, 0, 1.5), c.hair, { ...smooth, pos: [H.x, H.y + 0.03, H.z - 0.04], rot: [-0.45, 0, 0], scale: [1.04, 1, 1.05] });
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    m.add(`head_tuft_${i}`, new THREE.ConeGeometry(0.1, 0.28, 5), i % 2 ? c.hairDark : c.hair, { pos: [Math.sin(a) * 0.24, 4.68 + Math.cos(a * 2) * 0.03, Math.cos(a) * 0.22 - 0.05], rot: [Math.cos(a) * 0.8, 0, -Math.sin(a) * 0.8] });
  }
  m.add('head_beard', taperTube([[0, 4.12, 0.26], [0, 3.98, 0.34], [0, 3.84, 0.31]], (t) => 0.19 * (1 - t * 0.4), { segments: 14, radial: 12 }), c.hair, { ...smooth, scale: [1.15, 1, 0.75] });
  m.both((s) => m.add(`head_jaw_${s}`, taperTube([[s * 0.29, 4.32, 0.05], [s * 0.27, 4.12, 0.2], [s * 0.1, 4.0, 0.3]], () => 0.07, { segments: 10, radial: 6 }), c.hair, smooth));
  m.add('head_moustache', taperTube([[-0.15, 4.11, 0.3], [0, 4.19, 0.35], [0.15, 4.11, 0.3]], (t) => 0.045 * (1 - Math.abs(t - 0.5)), { segments: 12, radial: 6 }), c.hairDark, smooth);
  write(m, 'public/models/beastmaster.glb');
}
