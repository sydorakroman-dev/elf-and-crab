import * as THREE from 'three';
import { glowTexture } from '../util/glow';

/**
 * Looks for the skill tree's effects, shared by the hero's view and the familiar's tablet:
 * Hunter's Mark (a turning golden reticle over the marked foe, drawn through walls) and Tumble's
 * decoy (a glowing leaf-green spirit of the hero that the foes chase).
 */

export function makeMarkRing(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xffc23a, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.07, 6, 28), mat);
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  // Four ticks pointing in, and an arrowhead over the top.
  for (let i = 0; i < 4; i++) {
    const tick = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.32), mat);
    const a = (i / 4) * Math.PI * 2;
    tick.position.set(Math.sin(a) * 0.72, 0, Math.cos(a) * 0.72);
    tick.rotation.y = a;
    g.add(tick);
  }
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.45, 4), mat);
  head.rotation.x = Math.PI;
  head.position.y = 0.55;
  g.add(head);
  g.traverse((o) => (o.renderOrder = 10));
  g.visible = false;
  return g;
}

/** Puts the reticle over a foe of `radius` at (x, z) (null hides it). */
export function placeMarkRing(ring: THREE.Group, foe: { x: number; z: number; radius: number } | null, time: number): void {
  ring.visible = !!foe;
  if (!foe) return;
  const r = Math.max(1, foe.radius);
  ring.position.set(foe.x, foe.radius * 2.4 + 1.6 + Math.sin(time * 4) * 0.12, foe.z);
  ring.scale.setScalar(r);
  ring.rotation.y = time * 1.8;
}

export function makeDecoy(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.38, 1.1, 4, 10),
    new THREE.MeshBasicMaterial({ color: 0x8fffb0, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  body.position.y = 1.0;
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x7dff9a, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.scale.setScalar(2.6);
  glow.position.y = 1.1;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.7, 0.9, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x7dff9a, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  ring.position.y = 0.04;
  g.add(body, glow, ring);
  g.visible = false;
  return g;
}

/** Shows the decoy at (x, z) with `left` seconds to go (null hides it): it bobs, and fades at the end. */
export function placeDecoy(decoy: THREE.Group, at: { x: number; z: number; left: number } | null, time: number): void {
  decoy.visible = !!at;
  if (!at) return;
  decoy.position.set(at.x, Math.sin(time * 3) * 0.08, at.z);
  const fade = Math.min(1, at.left / 0.5);
  decoy.children.forEach((c, i) => {
    const m = (c as THREE.Mesh | THREE.Sprite).material as THREE.Material & { opacity: number };
    m.opacity = [0.32, 0.7, 0.6][i] * fade * (0.85 + Math.sin(time * 6 + i) * 0.15);
  });
}
