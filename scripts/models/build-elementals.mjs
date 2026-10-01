/**
 * Builds the six "Nature Elements" models as low-poly GLB files, in the same style as the other
 * models (flat colours, flat-shaded facets, angry brows; Y up, facing +Z, normalised to 3.6 units
 * tall, separate named parts so they can be rigged in code).
 *
 *   node scripts/models/build-elementals.mjs            → public/models/elementals/*.glb
 *   node scripts/models/build-elementals.mjs <out-dir>  → somewhere else
 */
import * as THREE from 'three';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] ?? 'public/models/elementals';
const HEIGHT = 3.6;

// ---------------------------------------------------------------------------------------------
// Tiny modelling kit

class Model {
  constructor(name) {
    this.name = name;
    this.parts = [];
  }

  /** Adds a named part: geometry, colour (sRGB hex), transform, optional glow. */
  add(name, geo, color, { pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1], glow = 0 } = {}) {
    const g = geo.clone();
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...pos),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)),
      new THREE.Vector3(...(typeof scale === 'number' ? [scale, scale, scale] : scale)),
    );
    g.applyMatrix4(m);
    this.parts.push({ name, geo: g, color, glow });
    return this;
  }

  /** Calls fn(side) for the left (-1) and right (+1) side. */
  both(fn) {
    fn(-1);
    fn(1);
    return this;
  }

  /** Angry cartoon eyes: whites (or a coloured iris), black pupils, slanted brows. */
  face({ y, z, spread, size = 0.16, iris = 0xfffbef, browColor = 0x1c1f24, tilt = 0 }) {
    return this.both((s) => {
      this.add(`eye_${s}`, new THREE.SphereGeometry(size, 10, 8), iris, { pos: [s * spread, y, z], scale: [1, 0.85, 0.45], rot: [tilt, 0, 0] });
      this.add(`pupil_${s}`, new THREE.SphereGeometry(size * 0.55, 8, 6), 0x111316, { pos: [s * spread * 0.9, y - size * 0.05, z + size * 0.35], scale: [1, 1.15, 0.5] });
      this.add(`angry_brow_${s}`, new THREE.BoxGeometry(size * 2.2, size * 0.42, size * 0.4), browColor, { pos: [s * spread, y + size * 1.15, z + 0.02], rot: [0, 0, s * 0.42] });
    });
  }

  /** Scales to HEIGHT tall, feet on y = 0, centred on x/z. */
  normalise() {
    const box = new THREE.Box3();
    for (const p of this.parts) {
      p.geo.computeBoundingBox();
      box.union(p.geo.boundingBox);
    }
    const k = HEIGHT / (box.max.y - box.min.y);
    const cx = (box.min.x + box.max.x) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    const m = new THREE.Matrix4().makeScale(k, k, k).multiply(new THREE.Matrix4().makeTranslation(-cx, -box.min.y, -cz));
    for (const p of this.parts) p.geo.applyMatrix4(m);
    return this;
  }
}

/** A tube along a smooth curve through points. */
function tube(points, radius, segments = 24, radial = 6) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p))), segments, radius, radial, false);
}

/** A rock: a lumpy icosahedron. */
function rock(r, seed = 1, detail = 0) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const pos = g.attributes.position;
  let a = seed * 9301;
  const rnd = () => ((a = (a * 9301 + 49297) % 233280) / 233280);
  const seen = new Map();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    if (!seen.has(key)) seen.set(key, 0.85 + rnd() * 0.3);
    const f = seen.get(key);
    pos.setXYZ(i, pos.getX(i) * f, pos.getY(i) * f, pos.getZ(i) * f);
  }
  return g;
}

/** A flat leaf: a squashed, pointed diamond. */
function leaf(len = 0.5, width = 0.28) {
  return new THREE.OctahedronGeometry(1, 0).scale(width, 0.05, len);
}

// ---------------------------------------------------------------------------------------------
// The six elementals

function rockGolem() {
  const m = new Model('rock-golem');
  const stone = 0x97a3b6;
  const dark = 0x77839a;
  const moss = 0x6fae4c;
  m.both((s) => {
    m.add(`leg_${s}_0`, rock(0.42, 3 + s), dark, { pos: [s * 0.6, 0.8, 0], scale: [1, 1.35, 1] });
    m.add(`foot_${s}`, new THREE.ConeGeometry(0.62, 0.55, 4), stone, { pos: [s * 0.66, 0.27, 0.12], rot: [0, Math.PI / 4, 0], scale: [1, 1, 1.25] });
    m.add(`shoulder_${s}`, rock(0.56, 7 + s), stone, { pos: [s * 1.3, 2.6, 0] });
    m.add(`arm_${s}_0`, rock(0.42, 11 + s), dark, { pos: [s * 1.52, 1.95, 0.05], scale: [0.95, 1.35, 0.95] });
    m.add(`fist_${s}`, rock(0.66, 13 + s), stone, { pos: [s * 1.62, 1.12, 0.18], scale: [1, 1.15, 1.05] });
  });
  m.add('hips', rock(0.62, 21), dark, { pos: [0, 1.35, 0], scale: [1.35, 0.6, 0.95] });
  m.add('torso', rock(1.0, 23), stone, { pos: [0, 2.15, 0], scale: [1.35, 1.0, 0.95] });
  m.add('chest_plate', rock(0.6, 25), dark, { pos: [0, 2.2, 0.55], scale: [1.4, 0.8, 0.5] });
  m.add('head', rock(0.5, 27), stone, { pos: [0, 3.05, 0.3], scale: [1, 0.9, 0.95] });
  m.face({ y: 3.08, z: 0.74, spread: 0.2, size: 0.12, iris: 0xffb84a });
  m.add('moss_0', new THREE.SphereGeometry(0.34, 7, 5), moss, { pos: [-1.25, 2.98, 0.05], scale: [1.2, 0.45, 1] });
  m.add('moss_1', new THREE.SphereGeometry(0.26, 7, 5), moss, { pos: [0.62, 1.05, 0.4], scale: [1.1, 0.6, 0.6] });
  m.add('moss_2', new THREE.SphereGeometry(0.22, 7, 5), moss, { pos: [0.35, 2.85, 0.35], scale: [1.2, 0.4, 0.8] });
  return m;
}

function treant() {
  const m = new Model('treant');
  const bark = 0xae7a45;
  const dark = 0x87573a;
  const green = 0x6fb04e;
  m.add('trunk', new THREE.CylinderGeometry(0.5, 0.72, 2.3, 7), bark, { pos: [0, 1.95, 0] });
  m.add('bark_ridge', new THREE.CylinderGeometry(0.08, 0.1, 1.6, 4), dark, { pos: [0.18, 1.6, 0.62], rot: [0.05, 0, 0.1] });
  m.both((s) => {
    // Root legs splitting into roots.
    m.add(`leg_${s}_0`, new THREE.CylinderGeometry(0.24, 0.34, 1.1, 6), bark, { pos: [s * 0.5, 0.65, 0], rot: [0, 0, s * 0.38] });
    for (let k = 0; k < 3; k++) {
      const a = (k - 1) * 0.7;
      m.add(`root_${s}_${k}`, new THREE.ConeGeometry(0.14, 0.75, 5), dark, { pos: [s * 0.8 + Math.sin(a) * 0.25, 0.1, Math.cos(a) * 0.25], rot: [Math.cos(a) * 1.35, 0, -s * 1.3 + Math.sin(a)] });
    }
    // Branch arms with clawed twig hands.
    m.add(`arm_${s}_0`, new THREE.CylinderGeometry(0.13, 0.22, 1.35, 6), bark, { pos: [s * 0.92, 2.35, 0], rot: [0, 0, s * 1.05] });
    m.add(`arm_${s}_1`, new THREE.CylinderGeometry(0.1, 0.13, 0.8, 6), bark, { pos: [s * 1.45, 1.75, 0.08], rot: [0.15, 0, s * 0.25] });
    for (let k = 0; k < 3; k++) {
      m.add(`finger_${s}_${k}`, new THREE.ConeGeometry(0.07, 0.42, 5), dark, { pos: [s * (1.5 + (k - 1) * 0.12), 1.32, 0.12 + (k - 1) * 0.06], rot: [0.5, 0, s * (0.35 + (k - 1) * 0.35)] });
    }
    // Crown branches reaching up, with leaf clusters.
    m.add(`branch_${s}`, new THREE.CylinderGeometry(0.1, 0.18, 1.3, 6), bark, { pos: [s * 0.42, 3.45, 0], rot: [0, 0, -s * 0.55] });
    m.add(`twig_${s}`, new THREE.CylinderGeometry(0.06, 0.09, 0.6, 5), bark, { pos: [s * 0.95, 3.85, 0], rot: [0, 0, -s * 1.1] });
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      m.add(`leaf_${s}_${k}`, leaf(0.62, 0.42), green, { pos: [s * 0.82 + Math.cos(a) * 0.25, 4.2 + Math.sin(a) * 0.12, Math.sin(a) * 0.25], rot: [0.4, a, 0.3 * s] });
    }
  });
  // A side branch with leaves (left, like the art).
  m.add('side_branch', new THREE.CylinderGeometry(0.07, 0.12, 0.8, 5), bark, { pos: [-0.75, 2.9, 0.1], rot: [0, 0, 1.0] });
  for (let k = 0; k < 3; k++) m.add(`side_leaf_${k}`, leaf(0.5, 0.36), green, { pos: [-1.15 + k * 0.1, 3.1 + (k - 1) * 0.15, 0.15], rot: [0.5, k, 0.4] });
  m.add('head_top', new THREE.ConeGeometry(0.5, 0.5, 7), bark, { pos: [0, 3.35, 0] });
  m.face({ y: 2.7, z: 0.58, spread: 0.2, size: 0.12, iris: 0xffc24a, browColor: 0x2a1a0e });
  return m;
}

function windElemental() {
  const m = new Model('wind-elemental');
  const blue = 0xa9c4f0;
  const pale = 0xd8e6fb;
  const green = 0x6fb04e;
  // The tornado: a spiral ribbon widening as it rises.
  const spiral = [];
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    const a = t * Math.PI * 7;
    const r = 0.12 + t * t * 1.05;
    spiral.push([Math.cos(a) * r, 0.15 + t * 3.0, Math.sin(a) * r]);
  }
  m.add('vortex_body', tube(spiral, 0.2, 180, 7), blue);
  m.add('vortex_core', new THREE.ConeGeometry(0.55, 2.8, 8, 1, true), pale, { pos: [0, 1.75, 0], rot: [Math.PI, 0, 0] });
  m.add('vortex_top', new THREE.TorusGeometry(1.0, 0.3, 6, 14), pale, { pos: [0, 3.25, 0], rot: [Math.PI / 2, 0, 0], scale: [1.15, 1.15, 0.55] });
  m.add('vortex_crown', new THREE.TorusGeometry(0.62, 0.22, 6, 12), blue, { pos: [0, 3.55, 0.05], rot: [Math.PI / 2 + 0.15, 0, 0], scale: [1.1, 1.1, 0.6] });
  m.face({ y: 2.55, z: 0.72, spread: 0.24, size: 0.15, browColor: 0x1c2a44 });
  // Swirling gust arms.
  m.both((s) => {
    m.add(`gust_${s}`, tube([[s * 0.8, 2.1, 0.1], [s * 1.5, 2.25, 0.2], [s * 2.0, 1.95, 0.15], [s * 1.9, 1.55, 0.05], [s * 1.55, 1.65, 0]], 0.13, 32), blue);
  });
  // Leaves caught in the wind.
  m.add('leaf_0', leaf(0.42, 0.28), green, { pos: [1.7, 2.9, 0.3], rot: [0.6, 0.5, 0.8] });
  m.add('leaf_1', leaf(0.42, 0.28), green, { pos: [-1.5, 1.15, 0.25], rot: [0.2, 1.2, -0.6] });
  m.add('leaf_2', leaf(0.38, 0.26), green, { pos: [1.25, 0.85, -0.2], rot: [0.9, 0.3, 0.4] });
  return m;
}

function fireElemental() {
  const m = new Model('fire-elemental');
  const orange = 0xff7a2a;
  const bright = 0xffa13d;
  const face = 0xffd27a;
  const boot = 0x3b3f47;
  m.both((s) => {
    m.add(`leg_${s}_0`, new THREE.CylinderGeometry(0.2, 0.26, 1.15, 7), orange, { pos: [s * 0.4, 1.12, 0], rot: [0, 0, s * 0.12], glow: 0.35 });
    m.add(`boot_${s}`, new THREE.CylinderGeometry(0.3, 0.42, 0.6, 5), boot, { pos: [s * 0.46, 0.3, 0.06] });
    m.add(`arm_${s}_0`, new THREE.CylinderGeometry(0.16, 0.2, 0.95, 7), orange, { pos: [s * 0.82, 2.25, 0], rot: [0, 0, s * 0.62], glow: 0.35 });
    m.add(`fist_${s}`, new THREE.IcosahedronGeometry(0.42, 1), orange, { pos: [s * 1.22, 1.62, 0.15], scale: [1, 1.05, 0.95], glow: 0.35 });
    m.add(`thumb_${s}`, new THREE.ConeGeometry(0.12, 0.3, 6), bright, { pos: [s * 1.02, 1.82, 0.32], rot: [0.6, 0, s * 0.9], glow: 0.4 });
  });
  m.add('torso', new THREE.CylinderGeometry(0.58, 0.38, 1.25, 8), orange, { pos: [0, 2.2, 0], glow: 0.35 });
  m.add('head', new THREE.IcosahedronGeometry(0.55, 1), orange, { pos: [0, 3.05, 0], glow: 0.4 });
  m.add('face_glow', new THREE.SphereGeometry(0.5, 12, 8), face, { pos: [0, 2.98, 0.32], scale: [0.85, 0.75, 0.45], glow: 0.6 });
  // Flame crown: spikes licking upward and back.
  const spikes = [[0, 3.75, -0.05, 0, 0.85], [-0.38, 3.55, -0.05, 0.45, 0.6], [0.38, 3.55, -0.05, -0.45, 0.6], [-0.55, 3.25, -0.1, 0.9, 0.5], [0.55, 3.25, -0.1, -0.9, 0.5], [0.15, 3.6, -0.35, -0.2, 0.55]];
  spikes.forEach(([x, y, z, rz, h], i) => {
    m.add(`flame_${i}`, new THREE.ConeGeometry(0.2, h, 6), i % 2 ? bright : orange, { pos: [x, y, z], rot: [-0.25, 0, rz], glow: 0.6 });
  });
  m.face({ y: 3.0, z: 0.55, spread: 0.2, size: 0.13, browColor: 0x2b1408 });
  return m;
}

function waterElemental() {
  const m = new Model('water-elemental');
  const teal = 0x2fa7b8;
  const light = 0x7fd8e3;
  const deep = 0x1d8494;
  // A tall flowing body, wide at the base, narrowing into the neck.
  const profile = [[0.0, 0.18], [0.95, 0.2], [0.72, 0.6], [0.55, 1.2], [0.6, 1.9], [0.72, 2.45], [0.6, 2.85], [0.35, 3.1], [0.0, 3.18]].map(([r, y]) => new THREE.Vector2(r, y));
  m.add('body', new THREE.LatheGeometry(profile, 12), teal);
  // The wave crest curling over the head.
  m.add('crest', tube([[0, 2.95, 0.45], [0, 3.45, 0.25], [0, 3.6, -0.25], [0, 3.35, -0.7], [0, 3.05, -0.55]], 0.26, 32, 8), light, { scale: [2.6, 1, 1] });
  m.add('crest_tip', new THREE.SphereGeometry(0.22, 8, 6), light, { pos: [0, 3.0, 0.5], scale: [2.2, 1, 1] });
  m.both((s) => {
    m.add(`arm_${s}_0`, tube([[s * 0.5, 2.45, 0.05], [s * 1.0, 2.25, 0.15], [s * 1.25, 1.75, 0.25], [s * 1.2, 1.35, 0.3]], 0.2, 24, 8), teal);
    m.add(`hand_${s}`, new THREE.SphereGeometry(0.3, 10, 8), teal, { pos: [s * 1.2, 1.28, 0.3], scale: [1, 1.25, 1] });
    m.add(`shine_${s}`, new THREE.SphereGeometry(0.16, 8, 6), light, { pos: [s * 0.32, 1.7 + (s > 0 ? 0.6 : 0), 0.56], scale: [0.6, 1.3, 0.3] });
  });
  m.add('puddle', new THREE.CylinderGeometry(1.75, 1.85, 0.08, 14), light, { pos: [0, 0.04, 0.1], scale: [1, 1, 0.8] });
  m.add('puddle_edge', new THREE.TorusGeometry(1.75, 0.07, 4, 20), deep, { pos: [0, 0.07, 0.1], rot: [Math.PI / 2, 0, 0], scale: [1, 0.8, 1] });
  // Droplets: one falling near the head, splashes around the puddle.
  m.add('drop_0', new THREE.SphereGeometry(0.14, 8, 6), light, { pos: [1.15, 3.2, 0.2], scale: [1, 1.3, 1] });
  m.add('drop_0_tip', new THREE.ConeGeometry(0.1, 0.2, 6), light, { pos: [1.15, 3.42, 0.2] });
  [[-1.7, 0.25, 0.6], [1.6, 0.2, 0.7], [-1.2, 0.3, -0.9]].forEach(([x, y, z], i) => m.add(`splash_${i}`, new THREE.SphereGeometry(0.12, 7, 5), teal, { pos: [x, y, z] }));
  m.face({ y: 2.6, z: 0.66, spread: 0.2, size: 0.14, browColor: 0x0e3a42 });
  return m;
}

function thornVine() {
  const m = new Model('thorn-vine');
  const vine = 0x88ad4f;
  const dark = 0x6d9140;
  const pink = 0xe0607a;
  const light = 0xf29aaa;
  const green = 0x6fb04e;
  // Body: three vines twisting round each other.
  for (let k = 0; k < 3; k++) {
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const a = t * Math.PI * 2.2 + (k * Math.PI * 2) / 3;
      pts.push([Math.cos(a) * 0.24, 1.0 + t * 1.75, Math.sin(a) * 0.24]);
    }
    m.add(`vine_body_${k}`, tube(pts, 0.19, 40), k % 2 ? dark : vine);
  }
  m.both((s) => {
    // Legs: twisting vines splaying out into roots.
    m.add(`leg_${s}_0`, tube([[s * 0.12, 1.05, 0], [s * 0.4, 0.6, 0.05], [s * 0.7, 0.15, 0.1]], 0.17, 16), vine);
    for (let k = 0; k < 3; k++) {
      const a = (k - 1) * 0.8;
      m.add(`root_${s}_${k}`, new THREE.ConeGeometry(0.09, 0.6, 5), dark, { pos: [s * 0.82 + Math.sin(a) * 0.2, 0.08, 0.1 + Math.cos(a) * 0.2], rot: [Math.cos(a) * 1.4, 0, -s * 1.3 + Math.sin(a)] });
    }
    // Arms: vines reaching out and down, ending in claws.
    m.add(`arm_${s}_0`, tube([[s * 0.25, 2.55, 0], [s * 0.85, 2.45, 0.05], [s * 1.25, 1.95, 0.15], [s * 1.35, 1.55, 0.2]], 0.15, 24), vine);
    for (let k = 0; k < 3; k++) {
      m.add(`claw_${s}_${k}`, new THREE.ConeGeometry(0.06, 0.38, 5), dark, { pos: [s * (1.38 + (k - 1) * 0.1), 1.33, 0.25 + (k - 1) * 0.05], rot: [0.4, 0, s * (0.2 + (k - 1) * 0.35)] });
    }
    // Thorns.
    m.add(`thorn_arm_${s}`, new THREE.ConeGeometry(0.1, 0.32, 5), pink, { pos: [s * 0.95, 2.6, 0.05], rot: [0, 0, -s * 0.9] });
    m.add(`thorn_leg_${s}`, new THREE.ConeGeometry(0.09, 0.28, 5), pink, { pos: [s * 0.55, 0.55, 0.15], rot: [0.6, 0, -s * 1.2] });
    // Sepal leaves under the bud.
    m.add(`leaf_${s}`, leaf(0.7, 0.42), green, { pos: [s * 0.55, 2.85, 0.1], rot: [0.3, s * 0.4, s * 0.35] });
  });
  m.add('thorn_body', new THREE.ConeGeometry(0.08, 0.26, 5), pink, { pos: [0.22, 1.7, 0.18], rot: [1.2, 0, -0.6] });
  // Flower-bud head.
  m.add('head', new THREE.SphereGeometry(0.45, 10, 8), pink, { pos: [0, 3.15, 0], scale: [1, 0.85, 0.95] });
  m.add('bud_tip', new THREE.ConeGeometry(0.4, 0.75, 7), pink, { pos: [0, 3.65, 0] });
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    m.add(`petal_${k}`, new THREE.ConeGeometry(0.22, 0.6, 5), light, { pos: [Math.cos(a) * 0.32, 3.4, Math.sin(a) * 0.32], rot: [Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4] });
  }
  m.face({ y: 3.15, z: 0.4, spread: 0.17, size: 0.11, browColor: 0x3a0d14 });
  return m;
}

const MODELS = [rockGolem, treant, windElemental, fireElemental, waterElemental, thornVine];

// ---------------------------------------------------------------------------------------------
// GLB writer (positions + flat normals + a colour material per part)

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function toGLB(model) {
  const json = { asset: { version: '2.0', generator: 'Elf & Crab elementals builder' }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [] };
  const chunks = [];
  let offset = 0;
  const matIndex = new Map();
  const push = (arr, target) => {
    const bytes = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
    chunks.push(bytes);
    offset += bytes.length;
    return json.bufferViews.length - 1;
  };
  for (const part of model.parts) {
    const geo = part.geo.index ? part.geo.toNonIndexed() : part.geo;
    geo.deleteAttribute('normal');
    geo.computeVertexNormals(); // non-indexed → flat facets
    const pos = geo.attributes.position.array;
    const nor = geo.attributes.normal.array;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], pos[i + k]);
      max[k] = Math.max(max[k], pos[i + k]);
    }
    const pv = push(new Float32Array(pos), 34962);
    json.accessors.push({ bufferView: pv, componentType: 5126, count: pos.length / 3, type: 'VEC3', min, max });
    const nv = push(new Float32Array(nor), 34962);
    json.accessors.push({ bufferView: nv, componentType: 5126, count: nor.length / 3, type: 'VEC3' });
    const key = `${part.color}:${part.glow}`;
    if (!matIndex.has(key)) {
      const c = new THREE.Color(part.color);
      const lin = [srgbToLinear(c.r), srgbToLinear(c.g), srgbToLinear(c.b)];
      json.materials.push({
        name: `c${part.color.toString(16)}`,
        pbrMetallicRoughness: { baseColorFactor: [...lin, 1], metallicFactor: 0, roughnessFactor: 0.85 },
        ...(part.glow ? { emissiveFactor: lin.map((v) => v * part.glow) } : {}),
      });
      matIndex.set(key, json.materials.length - 1);
    }
    json.meshes.push({ name: part.name, primitives: [{ attributes: { POSITION: json.accessors.length - 2, NORMAL: json.accessors.length - 1 }, material: matIndex.get(key) }] });
    json.nodes.push({ name: part.name, mesh: json.meshes.length - 1 });
    json.scenes[0].nodes.push(json.nodes.length - 1);
  }
  const bin = Buffer.concat(chunks);
  json.buffers.push({ byteLength: bin.length });
  let jsonBuf = Buffer.from(JSON.stringify(json));
  if (jsonBuf.length % 4) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(4 - (jsonBuf.length % 4), 0x20)]);
  const binPad = bin.length % 4 ? Buffer.concat([bin, Buffer.alloc(4 - (bin.length % 4))]) : bin;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // 'glTF'
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binPad.length, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(jsonBuf.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4); // 'JSON'
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(binPad.length, 0);
  bh.writeUInt32LE(0x004e4942, 4); // 'BIN\0'
  return Buffer.concat([header, jh, jsonBuf, bh, binPad]);
}

fs.mkdirSync(OUT, { recursive: true });
for (const build of MODELS) {
  const model = build().normalise();
  const file = path.join(OUT, `${model.name}.glb`);
  fs.writeFileSync(file, toGLB(model));
  console.log(`${file}  ${model.parts.length} parts  ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
}
