/**
 * Corrects a delivered hero's `AttackBow` clip so the drawing hand anchors at the cheek.
 *
 * The bow is held in the right hand (`wrR`, where the game puts every weapon), so the left hand draws
 * the string. Delivered clips have pulled that hand into the middle of the head with the elbow
 * raised over it, so from the game camera (behind the hero) the arm went through the head and showed
 * out of the back. Here the left arm is re-solved, key by key, with two-bone IK: the hand goes to
 * ANCHOR (by the chin, just in front of the face — in head space, as an archer's torso turns side-on
 * while the head keeps facing the target), the elbow straight back along the arrow's line (from the
 * bow hand through the anchor), blended in as far as the original clip had drawn (so the reach to the
 * string and the release keep their timing).
 *
 * Used by prepare-hero.mjs; works on the gltf-transform Document in place.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** Where the drawing hand rests at full draw (metres from the head bone, in its space: +x the hero's left, +z forward). */
const ANCHOR = new THREE.Vector3(0.12, 0.09, 0.15); // the side of the jaw, so the arrow passes beside the face

/** How far in front of the anchor the bow hand is held (metres; the arrow's line runs level between them). */
const BOW_REACH = 0.62;

/** @param {import('@gltf-transform/core').Document} doc  @param {import('@gltf-transform/core').NodeIO} io */
export async function fixBowDraw(doc, io) {
  const clip = doc.getRoot().listAnimations().find((a) => a.getName() === 'AttackBow');
  if (!clip) return false;
  const BONES = ['shL', 'elL', 'shR', 'elR', 'wrR'];
  const channels = Object.fromEntries(BONES.map((b) => [b, clip.listChannels().find((c) => c.getTargetNode()?.getName() === b && c.getTargetPath() === 'rotation')]));
  if (BONES.some((b) => !channels[b])) return false;
  const times = Array.from(channels.shL.getSampler().getInput().getArray());
  for (const b of BONES) {
    const tb = channels[b].getSampler().getInput().getArray();
    if (tb.length !== times.length || times.some((t, i) => Math.abs(t - tb[i]) > 1e-4)) return false; // keys must line up
  }

  // Pose the model in three.js to measure and solve.
  const glb = await io.writeBinary(doc);
  const gltf = await new Promise((res, rej) => new GLTFLoader().parse(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '', res, rej));
  const scene = gltf.scene;
  const node = (n) => scene.getObjectByName(n);
  const [chest, head, shL, elL, wrL, shR, elR, wrR] = ['chest', 'head', 'shL', 'elL', 'wrL', 'shR', 'elR', 'wrR'].map(node);
  if (!chest || !head || !shL || !elL || !wrL || !shR || !elR || !wrR) return false;
  // The bow hand's turn in the rest pose: the game holds weapons upright then, so matching it stands the bow up.
  scene.updateMatrixWorld(true);
  const bowRest = wrR.getWorldQuaternion(new THREE.Quaternion());
  const mixer = new THREE.AnimationMixer(scene);
  mixer.clipAction(gltf.animations.find((a) => a.name === 'AttackBow')).play();
  const pos = (o) => o.getWorldPosition(new THREE.Vector3());
  const pose = (t) => {
    mixer.setTime(t);
    scene.updateMatrixWorld(true);
  };

  // How far each hand has moved, key by key, against its furthest: how much of the fix to blend in.
  pose(0);
  const start = { L: pos(wrL).sub(pos(chest)), R: pos(wrR).sub(pos(chest)) };
  const reach = { L: [], R: [] };
  for (const t of times) {
    pose(t);
    reach.L.push(pos(wrL).sub(pos(chest)).distanceTo(start.L));
    reach.R.push(pos(wrR).sub(pos(chest)).distanceTo(start.R));
  }
  const weight = (side, i) => THREE.MathUtils.smoothstep(reach[side][i] / (Math.max(...reach[side]) || 1), 0.15, 0.85);

  const setWorld = (bone, world) => {
    const parent = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    bone.quaternion.copy(parent.invert().multiply(world));
    bone.updateMatrixWorld(true);
  };
  const turnTo = (bone, from, to) => {
    // Rotates `bone` (in world space) so the direction `from` becomes `to`.
    const delta = new THREE.Quaternion().setFromUnitVectors(from.clone().normalize(), to.clone().normalize());
    setWorld(bone, bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(delta));
  };
  /** Two-bone IK: the hand toward `target`, the elbow bent toward `hint`. */
  const solve = (sh, el, wr, target, hint) => {
    const S = pos(sh);
    const E = pos(el);
    const a = E.distanceTo(S);
    const b = pos(wr).distanceTo(E);
    const toT = target.clone().sub(S);
    const d = THREE.MathUtils.clamp(toT.length(), Math.abs(a - b) + 1e-3, a + b - 1e-3);
    const dir = toT.normalize();
    const along = (a * a - b * b + d * d) / (2 * d);
    const up = Math.sqrt(Math.max(0, a * a - along * along));
    const side = hint.clone().sub(S);
    side.sub(dir.clone().multiplyScalar(side.dot(dir))).normalize();
    const elbow = S.clone().add(dir.clone().multiplyScalar(along)).add(side.multiplyScalar(up));
    turnTo(sh, E.clone().sub(S), elbow.clone().sub(S));
    turnTo(el, pos(wr).sub(pos(el)), target.clone().sub(pos(el)));
  };

  const out = Object.fromEntries(BONES.map((b) => [b, channels[b].getSampler().getOutput().getArray().slice()]));
  const forward = new THREE.Vector3(0, 0, 1);
  times.forEach((t, i) => {
    pose(t);
    const wL = weight('L', i);
    const wR = weight('R', i);
    const anchor = ANCHOR.clone().applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion())).add(pos(head));
    if (wR > 0) {
      // The bow arm: straight out in front of the face, level with the drawing hand, the bow upright.
      const target = pos(wrR).lerp(anchor.clone().addScaledVector(forward, BOW_REACH).add(new THREE.Vector3(-0.04, 0.03, 0)), wR);
      const mid = pos(shR).add(target).multiplyScalar(0.5);
      solve(shR, elR, wrR, target, mid.add(new THREE.Vector3(-0.3, -0.2, 0)));
      setWorld(wrR, wrR.getWorldQuaternion(new THREE.Quaternion()).slerp(bowRest, wR));
    }
    if (wL > 0) {
      // The drawing hand: to the anchor, its elbow back along the arrow's line.
      const target = pos(wrL).lerp(anchor, wL);
      const hint = anchor.clone().add(anchor.clone().sub(pos(wrR)).normalize().multiplyScalar(0.4));
      solve(shL, elL, wrL, target, hint);
    }
    for (const b of BONES) node(b).quaternion.toArray(out[b], i * 4);
  });
  // New accessors: the old ones may be shared with other clips.
  const buffer = doc.getRoot().listBuffers()[0];
  for (const b of BONES) channels[b].getSampler().setOutput(doc.createAccessor().setType('VEC4').setArray(out[b]).setBuffer(buffer));
  return true;
}
