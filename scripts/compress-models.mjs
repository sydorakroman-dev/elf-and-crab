/**
 * Build step: compresses every model in dist/models with meshopt (quantized, packed vertex data)
 * — several times smaller downloads, no visible change. The source models in public/ stay as they
 * are (the build scripts and tools read them). The game decodes them with MeshoptDecoder.
 *
 *   node scripts/compress-models.mjs [dir]   (default: dist/models; run after vite build)
 */
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization, KHRMaterialsEmissiveStrength } from '@gltf-transform/extensions';
import { meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import fs from 'node:fs';
import path from 'node:path';

const DIR = process.argv[2] ?? 'dist/models';
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization, KHRMaterialsEmissiveStrength])
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

const files = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (p.endsWith('.glb')) files.push(p);
  }
};
walk(DIR);

let before = 0;
let after = 0;
for (const f of files) {
  const size = fs.statSync(f).size;
  const doc = await io.read(f);
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(f, doc);
  before += size;
  after += fs.statSync(f).size;
}
console.log(`compressed ${files.length} models: ${(before / 1048576).toFixed(1)} MB → ${(after / 1048576).toFixed(1)} MB`);
