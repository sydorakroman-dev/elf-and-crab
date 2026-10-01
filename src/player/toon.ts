import * as THREE from 'three';

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
  sharedGradient ??= gradientMap();
  const toon = new Map<THREE.Material, THREE.MeshToonMaterial>();
  const outline = outlineMaterial();
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh && !o.userData.outline) meshes.push(o);
  });
  for (const mesh of meshes) {
    const src = mesh.material as THREE.MeshStandardMaterial;
    let mat = toon.get(src);
    if (!mat) {
      mat = new THREE.MeshToonMaterial({ color: src.color, emissive: src.emissive, emissiveIntensity: src.emissiveIntensity, gradientMap: sharedGradient, side: src.side });
      toon.set(src, mat);
    }
    mesh.material = mat;
    if (noOutline.test(mesh.name)) continue;
    const hull = new THREE.Mesh(mesh.geometry, outline);
    hull.userData.outline = true;
    hull.castShadow = false;
    hull.receiveShadow = false;
    hull.raycast = () => {};
    mesh.add(hull);
  }
}
