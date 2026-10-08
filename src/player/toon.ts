import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * The cartoon look: banded "toon" shading plus a dark outline, to match the creature
 * illustrations. Outlines are the classic inverted hull — a copy of each mesh drawn back-faces
 * only, pushed out along its normals — with the push scaled by distance to the camera, so the line
 * keeps the same width on screen up close, and is capped in world size so it stays light from far away.
 */

/** Light bands: shadow, mid, lit. */
function gradientMap(): THREE.DataTexture {
  const tones = new Uint8Array([125, 195, 255]);
  const tex = new THREE.DataTexture(tones, tones.length, 1, THREE.RedFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

let sharedGradient: THREE.DataTexture | null = null;

/** Outline width as an angle (radians of view; ~4 px on a 1080p screen up close)… */
const OUTLINE_WIDTH = 0.0055;
/** …but never thicker than this in the world (metres), so it stays light from the far game camera. */
const OUTLINE_MAX = 0.04;
const OUTLINE_COLOR = new THREE.Color(0x1d1410);

function outlineMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uWidth: { value: OUTLINE_WIDTH }, uMax: { value: OUTLINE_MAX }, uColor: { value: OUTLINE_COLOR } },
    vertexShader: /* glsl */ `
      uniform float uWidth;
      uniform float uMax;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * normal);
        mv.xyz += n * min(uWidth * max(-mv.z, 0.5), uMax);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      void main() { gl_FragColor = vec4(uColor, 1.0); }`,
    side: THREE.BackSide,
  });
}

/**
 * Gives every mesh under `root` toon shading (keeping its colour and glow) and an outline, except
 * meshes whose names match `noOutline` (small face details would turn into blobs).
 */
export function toonify(root: THREE.Object3D, noOutline: RegExp): void {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh && !o.userData.outline) meshes.push(o);
  });
  toonifyMeshes(meshes, noOutline);
}

/** Small parts and face details on the monsters that shouldn't get an outline. */
export const MONSTER_NO_OUTLINE =
  /eye|pupil|shine|brow|nostril|nose_hole|mouth|tooth|fang|tusk|rib_mark|stitch|cap_spot|blue_mark|bowstring|arrow_feather|shell_seam|goggle|clock_hand|face_glow|drop|spore|finger|thumb|bristle|^thorn_?\d|claw|spot/;

const vcKeys = new WeakMap<THREE.Material, object>();
/** A stand-in cache key for "this material, with vertex colours". */
function vertexColored(m: THREE.Material): object {
  let k = vcKeys.get(m);
  if (!k) vcKeys.set(m, (k = {}));
  return k;
}

/** `toonify` for a loose set of meshes (e.g. a model's parts, before they're rigged). */
export function toonifyMeshes(meshes: Iterable<THREE.Mesh>, noOutline: RegExp): void {
  sharedGradient ??= gradientMap();
  const toon = new Map<THREE.Material, THREE.MeshToonMaterial>();
  const outline = outlineMaterial();
  for (const mesh of meshes) {
    const src = mesh.material as THREE.MeshStandardMaterial;
    // Delivered models carry their colours in the vertices (scripts/models/prepare-hero.mjs).
    const vertexColors = !!mesh.geometry.getAttribute('color');
    const key = (vertexColors ? vertexColored(src) : src) as THREE.Material;
    let mat = toon.get(key);
    if (!mat) {
      mat = new THREE.MeshToonMaterial({ color: src.color, emissive: src.emissive, emissiveIntensity: src.emissiveIntensity, gradientMap: sharedGradient, side: src.side, vertexColors });
      if (src.transparent) {
        // Glass and water stay see-through.
        mat.transparent = true;
        mat.opacity = src.opacity;
        mat.depthWrite = false;
      }
      toon.set(key, mat);
    }
    mesh.material = mat;
    if (noOutline.test(mesh.name)) continue;
    const hull = new THREE.Mesh(hullGeometry(mesh.geometry), outline);
    hull.userData.outline = true;
    hull.castShadow = false;
    hull.receiveShadow = false;
    hull.raycast = () => {};
    mesh.add(hull);
  }
}

/**
 * The hull is pushed out along its normals. Faceted (flat-shaded, unindexed) models have a normal per
 * face, which would split the hull into loose triangles with gaps at every edge — so for those the
 * hull gets welded vertices and smooth normals.
 */
function hullGeometry(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  if (geo.index) return geo;
  const pos = new THREE.BufferGeometry();
  pos.setAttribute('position', geo.getAttribute('position'));
  const welded = mergeVertices(pos, 1e-4);
  welded.computeVertexNormals();
  return welded;
}
