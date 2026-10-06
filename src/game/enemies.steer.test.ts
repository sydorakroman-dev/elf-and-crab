import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Monster } from './monsters';

describe('enemy steering', () => {
  it('walks around an obstacle directly between it and the target instead of sticking', () => {
    // A skeleton north of a brazier-sized obstacle, target due south of it: dead-centre on the axis.
    const e = new Monster('skeleton', 0, -10);
    const target = new THREE.Vector3(0, 0, 10);
    const obstacles = [{ x: 0, z: 0, radius: 1.3 }];
    for (let i = 0; i < 60 * 12; i++) e.update(1 / 60, target, [e], obstacles);
    expect(e.z).toBeGreaterThan(2); // got past the obstacle
  });
});
