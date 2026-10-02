import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/**
 * Helpers for "rigging" static glTF models in code: our models are sets of named, unrigged
 * parts, so we group parts under pivot objects (hips, shoulders…) and animate those.
 */

/**
 * Compressed models store vertices quantized (small integer types, normalised). We bake transforms
 * into the vertices and generate outline hulls from them, so turn them back into plain floats.
 */
function toFloat(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const name of Object.keys(geo.attributes)) {
    const attr = geo.getAttribute(name);
    if (!(attr instanceof THREE.InterleavedBufferAttribute) && attr.array instanceof Float32Array && !attr.normalized) continue;
    const out = new Float32Array(attr.count * attr.itemSize);
    for (let i = 0; i < attr.count; i++) for (let k = 0; k < attr.itemSize; k++) out[i * attr.itemSize + k] = attr.getComponent(i, k);
    geo.setAttribute(name, new THREE.BufferAttribute(out, attr.itemSize));
  }
  return geo;
}

/** Loads a model and returns its meshes by name, with transforms baked into geometry (shared origin). */
export async function loadParts(url: string): Promise<Map<string, THREE.Mesh>> {
  // Built models are meshopt-compressed (scripts/compress-models.mjs); dev serves them as-is.
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  const parts = new Map<string, THREE.Mesh>();
  gltf.scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.geometry = toFloat(o.geometry.clone()).applyMatrix4(o.matrixWorld);
    o.position.set(0, 0, 0);
    o.quaternion.identity();
    o.scale.set(1, 1, 1);
    o.castShadow = true;
    let name = o.name;
    while (parts.has(name)) name += '_'; // keep parts that share a name
    o.name = name;
    parts.set(name, o);
  });
  return parts;
}

/** Removes and returns the named parts that exist (missing names are skipped). */
export function take(parts: Map<string, THREE.Mesh>, ...names: string[]): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  for (const name of names) {
    const m = parts.get(name);
    if (!m) continue;
    parts.delete(name);
    found.push(m);
  }
  return found;
}

export function bounds(mesh: THREE.Mesh): THREE.Box3 {
  mesh.geometry.computeBoundingBox();
  return mesh.geometry.boundingBox!;
}

/**
 * Re-parents meshes (geometry in model space) under a new pivot at model-space point `at`,
 * keeping them visually in place. `parentOrigin` is the parent's own model-space position.
 */
export function attachAtPivot(parent: THREE.Object3D, parentOrigin: THREE.Vector3, at: THREE.Vector3, meshes: THREE.Mesh[]): THREE.Group {
  const pivot = new THREE.Group();
  pivot.position.copy(at).sub(parentOrigin);
  for (const m of meshes) {
    m.position.copy(at).negate();
    pivot.add(m);
  }
  parent.add(pivot);
  return pivot;
}
