/**
 * A tiny modelling kit for the build scripts: named parts with a colour each, a few shape helpers,
 * and a GLB writer (positions + normals + one colour material per colour). Parts are flat-shaded
 * facets by default; `smooth: true` gives rounded parts soft normals.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export class Model {
  constructor(name, height) {
    this.name = name;
    this.height = height;
    this.parts = [];
  }

  /** Adds a named part: geometry, colour (sRGB hex), transform; options: glow, smooth shading, roughness, metal, double-sided, opacity (glass, water). */
  add(name, geo, color, { pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1], glow = 0, smooth = false, roughness = 0.85, metal = 0, double = false, opacity = 1 } = {}) {
    const g = geo.clone();
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...pos),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)),
      new THREE.Vector3(...(typeof scale === 'number' ? [scale, scale, scale] : scale)),
    );
    g.applyMatrix4(m);
    this.parts.push({ name, geo: g, color, glow, smooth, roughness, metal, double, opacity });
    return this;
  }

  /** Calls fn(side) for the left (-1) and right (+1) side. */
  both(fn) {
    fn(-1);
    fn(1);
    return this;
  }

  /** Scales to `height` tall, feet on y = 0, centred on x/z. */
  normalise() {
    const box = new THREE.Box3();
    for (const p of this.parts) {
      p.geo.computeBoundingBox();
      box.union(p.geo.boundingBox);
    }
    const k = this.height / (box.max.y - box.min.y);
    const cx = (box.min.x + box.max.x) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    const m = new THREE.Matrix4().makeScale(k, k, k).multiply(new THREE.Matrix4().makeTranslation(-cx, -box.min.y, -cz));
    for (const p of this.parts) p.geo.applyMatrix4(m);
    return this;
  }

  get triangles() {
    return this.parts.reduce((n, p) => n + (p.geo.index ? p.geo.index.count : p.geo.attributes.position.count) / 3, 0);
  }
}

const v3 = (p) => (p instanceof THREE.Vector3 ? p : new THREE.Vector3(...p));

/** A tube along a smooth curve through points. */
export function tube(points, radius, segments = 24, radial = 6) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(v3)), segments, radius, radial, false);
}

/**
 * A tube whose radius follows `radius(t)` (t: 0 at the start → 1 at the end), with rounded ends
 * when a radius is non-zero there: hair locks, limbs, bow limbs, tails.
 */
export function taperTube(points, radius, { segments = 24, radial = 10, closed = true } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map(v3));
  const frames = curve.computeFrenetFrames(segments, false);
  const pos = [];
  const idx = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const c = curve.getPointAt(t);
    const r = radius(t);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const n = frames.normals[i].clone().multiplyScalar(Math.cos(a)).add(frames.binormals[i].clone().multiplyScalar(Math.sin(a)));
      pos.push(c.x + n.x * r, c.y + n.y * r, c.z + n.z * r);
    }
  }
  for (let i = 0; i < segments; i++)
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  if (closed) {
    // Cap both ends with a fan to their centre.
    for (const [ring, t, flip] of [[0, 0, true], [segments, 1, false]]) {
      const c = curve.getPointAt(t);
      const centre = pos.length / 3;
      pos.push(c.x, c.y, c.z);
      for (let j = 0; j < radial; j++) {
        const a = ring * (radial + 1) + j;
        if (flip) idx.push(centre, a, a + 1);
        else idx.push(centre, a + 1, a);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

/**
 * A rounded limb from `a` to `b`: a capsule tapering from radius r1 to r2 (a lathe, so it's
 * smooth), optionally squashed front-to-back.
 */
export function limb(a, b, r1, r2, { radial = 14, depth = 1, bulge = 0 } = {}) {
  const A = v3(a);
  const B = v3(b);
  const len = A.distanceTo(B);
  const pts = [];
  const cap = 5;
  for (let i = 0; i <= cap; i++) {
    const t = (i / cap) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.sin(t) * r1, -Math.cos(t) * r1 + r1 * 0));
  }
  const body = 8;
  for (let i = 1; i < body; i++) {
    const t = i / body;
    const r = r1 + (r2 - r1) * t + Math.sin(t * Math.PI) * bulge;
    pts.push(new THREE.Vector2(r, t * len));
  }
  for (let i = 0; i <= cap; i++) {
    const t = (i / cap) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.cos(t) * r2, len + Math.sin(t) * r2));
  }
  const g = new THREE.LatheGeometry(pts, radial);
  g.scale(1, 1, depth);
  const dir = B.clone().sub(A).normalize();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
  g.translate(A.x, A.y, A.z);
  return g;
}

/** A lathe from (radius, y) pairs: torsos, skirts, boots, quivers. Faces outward either way up. */
export function lathe(profile, radial = 18, phiStart = 0, phiLength = Math.PI * 2) {
  const pts = profile[0][1] > profile[profile.length - 1][1] ? [...profile].reverse() : profile;
  return new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), radial, phiStart, phiLength);
}

/** Pushes every vertex by fn(vertex) (in place) — for organic tweaks. */
export function deform(geo, fn) {
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    fn(v);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------------------------------------
// GLB writer

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function toGLB(model, generator = 'Elf & Crab model builder') {
  const json = { asset: { version: '2.0', generator }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [] };
  const chunks = [];
  let offset = 0;
  const matIndex = new Map();
  const push = (arr, target) => {
    const bytes = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
    chunks.push(bytes);
    offset += bytes.length;
    const pad = (4 - (bytes.length % 4)) % 4;
    if (pad) {
      chunks.push(Buffer.alloc(pad));
      offset += pad;
    }
    return json.bufferViews.length - 1;
  };
  for (const part of model.parts) {
    let geo;
    if (part.smooth) {
      // Weld seams (lathes, tubes) so normals blend across them: soft, rounded shading.
      geo = part.geo.clone();
      geo.deleteAttribute('normal');
      geo.deleteAttribute('uv');
      geo = mergeVertices(geo, 1e-4);
      geo.computeVertexNormals();
    } else {
      geo = part.geo.index ? part.geo.toNonIndexed() : part.geo.clone();
      geo.deleteAttribute('normal');
      geo.computeVertexNormals(); // non-indexed → flat facets
    }
    const pos = geo.attributes.position.array;
    const nor = geo.attributes.normal.array;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3)
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], pos[i + k]);
        max[k] = Math.max(max[k], pos[i + k]);
      }
    const pv = push(new Float32Array(pos), 34962);
    json.accessors.push({ bufferView: pv, componentType: 5126, count: pos.length / 3, type: 'VEC3', min, max });
    const nv = push(new Float32Array(nor), 34962);
    json.accessors.push({ bufferView: nv, componentType: 5126, count: nor.length / 3, type: 'VEC3' });
    const prim = { attributes: { POSITION: json.accessors.length - 2, NORMAL: json.accessors.length - 1 } };
    if (geo.index) {
      const iv = push(new Uint32Array(geo.index.array), 34963);
      json.accessors.push({ bufferView: iv, componentType: 5125, count: geo.index.count, type: 'SCALAR' });
      prim.indices = json.accessors.length - 1;
    }
    const key = `${part.color}:${part.glow}:${part.roughness}:${part.metal}:${part.double}:${part.opacity}`;
    if (!matIndex.has(key)) {
      const c = new THREE.Color(part.color);
      const lin = [srgbToLinear(c.r), srgbToLinear(c.g), srgbToLinear(c.b)];
      json.materials.push({
        name: `c${part.color.toString(16)}`,
        pbrMetallicRoughness: { baseColorFactor: [...lin, part.opacity], metallicFactor: part.metal, roughnessFactor: part.roughness },
        ...(part.opacity < 1 ? { alphaMode: 'BLEND' } : {}),
        ...(part.glow ? { emissiveFactor: lin.map((v) => v * part.glow) } : {}),
        ...(part.double ? { doubleSided: true } : {}),
      });
      matIndex.set(key, json.materials.length - 1);
    }
    prim.material = matIndex.get(key);
    json.meshes.push({ name: part.name, primitives: [prim] });
    json.nodes.push({ name: part.name, mesh: json.meshes.length - 1 });
    json.scenes[0].nodes.push(json.nodes.length - 1);
  }
  const bin = Buffer.concat(chunks);
  json.buffers.push({ byteLength: bin.length });
  let jsonBuf = Buffer.from(JSON.stringify(json));
  if (jsonBuf.length % 4) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(4 - (jsonBuf.length % 4), 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // 'glTF'
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(jsonBuf.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4); // 'JSON'
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(bin.length, 0);
  bh.writeUInt32LE(0x004e4942, 4); // 'BIN\0'
  return Buffer.concat([header, jh, jsonBuf, bh, bin]);
}
