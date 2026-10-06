import type * as THREE from 'three';

/**
 * How monsters react: a flinch when hit and a proper death, shared by every monster's visual.
 * Driven only by the pose's `flash` (1 at a hit, fading out) and `death` (0 → 1 while dying), so
 * the familiar's tablet plays the same animations from the snapshot.
 */

/** Seconds a death takes (guardians go down slower). */
export const DEATH_SECONDS = 0.9;
export const BOSS_DEATH_SECONDS = 1.6;

/**
 * topple: rear up, keel over sideways, sink away (walkers and beasts)
 * float: drift upward, swell and fade out (ghosts)
 * splat: flatten into a puddle (oozes, slimes)
 * crumble: shake, then crumble down into the ground (elementals)
 * burrow: sink straight back into the ground (worms)
 */
export type DeathStyle = 'topple' | 'float' | 'splat' | 'crumble' | 'burrow';

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const easeIn = (x: number) => x * x;
const easeOut = (x: number) => 1 - (1 - x) * (1 - x);

/**
 * Hit and death on the whole monster (`group`, already placed and turned for this frame): sets
 * its tilt and scale each frame. `seed` varies which way it falls.
 */
export function applyReaction(group: THREE.Object3D, flash: number, death: number, style: DeathStyle, time: number, seed: number): void {
  group.rotation.order = 'YXZ'; // tilts in the monster's own frame, after its facing
  group.rotation.x = 0;
  group.rotation.z = 0;
  group.scale.setScalar(1);
  if (death > 0) applyDeath(group, death, style, time, seed);
  else if (flash > 0) applyHit(group, flash);
}

/** The flinch: tips back away from the blow, squashes and hops a little, then springs back. */
function applyHit(group: THREE.Object3D, flash: number): void {
  const k = Math.sin(flash * Math.PI * 0.5);
  group.rotation.x = -0.3 * k;
  group.position.y += 0.12 * Math.sin(flash * Math.PI);
  const squash = 0.14 * k;
  group.scale.set(1 + squash * 0.5, 1 - squash, 1 + squash * 0.5);
}

function applyDeath(group: THREE.Object3D, death: number, style: DeathStyle, time: number, seed: number): void {
  const t = clamp01(death);
  const side = seed % 2 < 1 ? 1 : -1;
  // Everything but a ghost shrinks away over the last quarter.
  const vanish = 1 - easeIn(clamp01((t - 0.75) / 0.25));
  switch (style) {
    case 'topple': {
      // Rear up and stagger (first fifth), keel over to the side, then sink away.
      const rear = Math.sin(clamp01(t / 0.2) * Math.PI);
      const fall = easeIn(clamp01((t - 0.12) / 0.5));
      group.position.y += rear * 0.25 - easeIn(clamp01((t - 0.65) / 0.35)) * 0.5;
      group.rotation.x = -0.25 * rear;
      group.rotation.z = side * fall * 1.45;
      group.scale.setScalar(Math.max(0.001, vanish));
      break;
    }
    case 'float': {
      group.position.y += easeOut(t) * 2.2;
      group.rotation.y += t * 3;
      group.scale.setScalar(Math.max(0.001, (1 + t * 0.35) * (1 - easeIn(clamp01((t - 0.4) / 0.6)))));
      break;
    }
    case 'splat': {
      const flat = easeOut(clamp01(t / 0.45));
      group.scale.set(Math.max(0.001, (1 + flat * 0.7) * vanish), Math.max(0.02, 1 - flat * 0.88), Math.max(0.001, (1 + flat * 0.7) * vanish));
      break;
    }
    case 'crumble': {
      // Shudder in place, then fall in on itself.
      const shake = t < 0.45 ? (1 - t / 0.45) * 0.08 : 0;
      group.position.x += Math.sin(time * 60 + seed) * shake;
      group.position.z += Math.cos(time * 53 + seed) * shake;
      const down = easeIn(clamp01((t - 0.35) / 0.65));
      group.position.y -= down * 0.6;
      group.rotation.z = side * down * 0.35;
      group.scale.set(Math.max(0.001, 1 - down * 0.5), Math.max(0.001, 1 - down), Math.max(0.001, 1 - down * 0.5));
      break;
    }
    case 'burrow': {
      group.position.y -= easeIn(t) * 3;
      group.rotation.x = 0.3 * t;
      group.scale.setScalar(Math.max(0.001, 1 - easeIn(clamp01((t - 0.6) / 0.4))));
      break;
    }
  }
}
