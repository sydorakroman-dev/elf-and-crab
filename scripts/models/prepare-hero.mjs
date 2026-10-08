/**
 * Prepares a delivered, animated hero model (see docs/hero-model-spec.md) for the game:
 *   - checks it has the bones and animation clips the game needs (warns about missing ones);
 *   - bakes each material's colour into the vertices and gives everything one shared material,
 *     so all the pieces riding a bone merge into a single draw call;
 *   - drops texture coordinates (the game uses flat colours) and simplifies to ~`budget`
 *     triangles, keeping every animation.
 *
 *   node scripts/models/prepare-hero.mjs <source.glb> <hero> [budget]
 *     → public/models/heroes/<hero>.glb      e.g.  … ~/Downloads/frostbound-warrior.glb barbarian
 */
import { NodeIO } from '@gltf-transform/core';
import { dedup, join, prune, simplify, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import fs from 'node:fs';
import path from 'node:path';
import { fixBowDraw } from './fix-bow-draw.mjs';

const [src, hero, budgetArg] = process.argv.slice(2);
if (!src || !hero) {
  console.error('usage: node scripts/models/prepare-hero.mjs <source.glb> <hero> [triangle budget]');
  process.exit(1);
}
const BUDGET = Number(budgetArg ?? 32000);
/** How far (relative to the model's size) the simplifier may move the surface: low enough that thin parts (an axe haft) survive. */
const ERROR = 0.012;
const OUT = `public/models/heroes/${hero}.glb`;
const BONES = ['pelvis', 'spine', 'chest', 'neck', 'head', 'shL', 'elL', 'wrL', 'shR', 'elR', 'wrR', 'hipL', 'kneeL', 'ankleL', 'hipR', 'kneeR', 'ankleR'];
const CLIPS = { required: ['Idle', 'Walk', 'Run', 'Attack1H'], optional: ['Attack2H', 'AttackBow', 'AttackStaff', 'Skill', 'Jump', 'Hit', 'Death', 'Victory'] };
/** Accepted alternative clip names (the model's name → ours). */
const CLIP_ALIASES = { Attack: 'Attack1H', AxeCleave: 'Attack2H', Cleave: 'Attack2H', Slash: 'Attack1H', Cast: 'AttackStaff', BattleRoar: 'Skill', Roar: 'Skill' };

const io = new NodeIO();
const doc = await io.read(src);
const root = doc.getRoot();

// ── Check ─────────────────────────────────────────────────────────────────────────────────────
const names = new Set(root.listNodes().map((n) => n.getName()));
const missingBones = BONES.filter((b) => !names.has(b));
for (const a of root.listAnimations()) {
  const alias = CLIP_ALIASES[a.getName()];
  if (alias) a.setName(alias);
}
const clips = root.listAnimations().map((a) => a.getName());
const missingClips = CLIPS.required.filter((c) => !clips.includes(c) && !(c === 'Attack1H' && clips.some((n) => n.startsWith('Attack'))));
if (missingBones.length) console.warn(`! missing bones: ${missingBones.join(', ')}`);
if (missingClips.length) console.warn(`! missing required clips: ${missingClips.join(', ')}`);
if (root.listSkins().length) console.warn('! the model is skinned: the game expects rigid parts on bones (see the spec)');

// ── Weapons are held separately (the game puts them in the right hand): drop any the model has ─
for (const node of root.listNodes()) {
  if (!/^(axe|sword|bow|staff|shield|weapon|mace|hammer|spear)/i.test(node.getName())) continue;
  console.warn(`- removing the model's weapon "${node.getName()}" (weapons are separate items)`);
  node.traverse((n) => n.getMesh()?.dispose());
  node.dispose();
}

// ── The face: paired parts mirrored evenly (head_eye / head_eye2), eyes brought out of the skull ──
/** Face details: kept as their own meshes (not merged into the head), so the game can leave them without an outline. */
const FACE = /eye|brow|nose|mouth|lip|pupil|lash|mustache|gem/i;
for (const node of root.listNodes()) {
  const twin = root.listNodes().find((n) => n.getName() === `${node.getName()}2` && n.getParentNode() === node.getParentNode());
  if (!twin || !FACE.test(node.getName())) continue;
  const [x1, y1, z1] = node.getTranslation();
  const [x2, y2, z2] = twin.getTranslation();
  if (x1 * x2 >= 0 || Math.abs(y1 - y2) > 1e-3 || Math.abs(z1 - z2) > 1e-3) continue;
  const x = (Math.abs(x1) + Math.abs(x2)) / 2;
  if (Math.abs(Math.abs(x1) - x) < 1e-3) continue;
  node.setTranslation([Math.sign(x1) * x, y1, z1]);
  twin.setTranslation([Math.sign(x2) * x, y2, z2]);
  console.log(`- face: ${node.getName()} / ${twin.getName()} mirrored evenly (x ±${x.toFixed(3)})`);
}
for (const node of root.listNodes()) {
  if (!/(^|_)eye\d*$/i.test(node.getName())) continue;
  // Flattened eyes sunk into the skull barely show: rounder, a little bigger, a little further out.
  const [sx, sy, sz] = node.getScale();
  const [x, y, z] = node.getTranslation();
  node.setScale([sx * 1.15, sy * 1.1, Math.max(sz, 0.9)]);
  node.setTranslation([x, y, z + 0.004]);
}

// ── The bow draw: the string hand to the cheek (not into the head) ─────────────────────────────
if (await fixBowDraw(doc, io)) console.log('- AttackBow: drawing hand re-anchored at the cheek');

// ── Colours into the vertices, one shared material ───────────────────────────────────────────
const shared = doc.createMaterial('hero').setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.85).setMetallicFactor(0);
for (const mesh of root.listMeshes())
  for (const prim of mesh.listPrimitives()) {
    const mat = prim.getMaterial();
    const [r, g, b] = mat ? mat.getBaseColorFactor() : [0.8, 0.8, 0.8];
    const count = prim.getAttribute('POSITION').getCount();
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) colors.set([r, g, b], i * 3);
    prim.setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(colors).setBuffer(root.listBuffers()[0]));
    prim.setAttribute('TEXCOORD_0', null);
    prim.setMaterial(shared);
  }

// ── Merge and simplify to the budget ─────────────────────────────────────────────────────────
await MeshoptSimplifier.ready;
const count = () => {
  let t = 0;
  let p = 0;
  for (const m of root.listMeshes())
    for (const pr of m.listPrimitives()) {
      p++;
      t += (pr.getIndices()?.getCount() ?? pr.getAttribute('POSITION').getCount()) / 3;
    }
  return { tris: Math.round(t), prims: p };
};
await doc.transform(dedup(), weld(), join({ keepNamed: false, filter: (node) => !FACE.test(node.getName()) }), prune());
const before = count().tris;
const ratio = Math.min(1, BUDGET / before);
if (ratio < 1) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error: ERROR }), prune());
const after = count();

fs.mkdirSync(path.dirname(OUT), { recursive: true });
await io.write(OUT, doc);
console.log(`${OUT}  ${before} → ${after.tris} triangles, ${after.prims} draw calls, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB, clips: ${root.listAnimations().map((a) => a.getName()).join(', ')}`);
