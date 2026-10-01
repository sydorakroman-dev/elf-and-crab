import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Slime } from './enemies';

describe('slime steering', () => {
  it('walks around an obstacle directly between it and the target instead of sticking', () => {
    // Slime north of a brazier-sized obstacle, target due south of it: dead-centre on the axis.
    const slime = new Slime('small', 0, -10, 0, 1);
    const target = new THREE.Vector3(0, 0, 10);
    const obstacles = [{ x: 0, z: 0, radius: 1.3 }];
    for (let i = 0; i < 60 * 12; i++) slime.update(1 / 60, target, [slime], obstacles, 28);
    expect(slime.z).toBeGreaterThan(2); // got past the obstacle
  });
});
