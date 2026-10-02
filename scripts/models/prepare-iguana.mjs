/**
 * Prepares the Magical Iguana familiar (a Blender export) for the game:
 *   - renames its parts to the familiar rig's names (src/player/beasts.ts): legs leg_<x>_<z>*
 *     (x −1 left / 1 right, z −1 hind / 1 front), head_*, tail_*, cape_*, everything else body_*;
 *   - simplifies the meshes (~134k → ~20k triangles) so it runs well on tablets.
 *
 *   node scripts/models/prepare-iguana.mjs [source.glb]   → public/models/iguana.glb
 */
import { NodeIO } from '@gltf-transform/core';
import { dedup, prune, simplify, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import os from 'node:os';
import path from 'node:path';

const SRC = process.argv[2] ?? path.join(os.homedir(), 'Downloads/Magical_Iguana.glb');
const OUT = 'public/models/iguana.glb';

const io = new NodeIO();
const doc = await io.read(SRC);
const root = doc.getRoot();

const HEAD = /^(Broad iguana head|Rounded muzzle|Lower jaw|Dewlap|Eye socket|Eye white|Amber iris|Black pupil|Eye catchlight|Nostril|Gentle smile|Iguana cheek plate|Silver woodland circlet|Forehead emerald|Crest spike 0[01])/;
const LEG_PART = /^(Lower leg|Palm|Toe|Claw)/;
const used = new Map();
const unique = (base) => {
  const n = used.get(base) ?? 0;
  used.set(base, n + 1);
  return n ? `${base}_${n}` : base;
};
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

for (const node of root.listNodes()) {
  if (!node.getMesh()) continue;
  const name = node.getName();
  const [x, , z] = node.getWorldTranslation();
  let renamed;
  const upper = /^(Front|Hind) upper leg (-?1)$/.exec(name);
  if (upper) renamed = `leg_${upper[2]}_${upper[1] === 'Front' ? 1 : -1}`;
  else if (LEG_PART.test(name)) renamed = `leg_${x < 0 ? -1 : 1}_${z > 0.2 ? 1 : -1}_${slug(name)}`;
  else if (HEAD.test(name)) renamed = `head_${slug(name)}`;
  else if (/^(Long curled iguana tail|Tail crest)/.test(name)) renamed = `tail_${slug(name)}`;
  else if (/^(Green woodland cape|Cape hem|Cape lower border)/.test(name)) renamed = `cape_${slug(name)}`;
  else renamed = `body_${slug(name)}`;
  renamed = unique(renamed);
  node.setName(renamed);
  node.getMesh().setName(renamed); // GLTFLoader names multi-material parts after the mesh
}

// No textures: drop the UVs (their seams would stop the simplifier from merging vertices).
for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) p.setAttribute('TEXCOORD_0', null);

await MeshoptSimplifier.ready;
await doc.transform(dedup(), weld(), simplify({ simplifier: MeshoptSimplifier, ratio: 0.1, error: 0.02 }), prune());

let tris = 0;
for (const mesh of root.listMeshes())
  for (const p of mesh.listPrimitives()) tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
await io.write(OUT, doc);
console.log(`${OUT}  ${root.listNodes().length} parts  ${Math.round(tris)} triangles`);
