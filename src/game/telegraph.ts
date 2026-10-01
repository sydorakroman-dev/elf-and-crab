import * as THREE from 'three';

/** [x, z, radius, progress 0→1] — where a boss attack is about to land. */
export type TelegraphTuple = [number, number, number, number];

/**
 * A red warning ring on the floor that fills in as a boss slam approaches impact.
 * Driven by a tuple (hero sim and familiar view alike); null hides it.
 */
export class TelegraphRing {
  readonly group = new THREE.Group();
  private readonly rim: THREE.Mesh;
  private readonly fill: THREE.Mesh;

  constructor() {
    const mat = (opacity: number) =>
      new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
    this.rim = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 64).rotateX(-Math.PI / 2), mat(0.9));
    this.fill = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), mat(0.25));
    this.rim.position.y = 0.07;
    this.fill.position.y = 0.06;
    this.group.add(this.rim, this.fill);
    this.group.visible = false;
  }

  sync(t: TelegraphTuple | null, time: number): void {
    this.group.visible = t !== null;
    if (!t) return;
    const [x, z, r, p] = t;
    this.group.position.set(x, 0, z);
    this.rim.scale.setScalar(r);
    this.fill.scale.setScalar(Math.max(0.01, r * p));
    (this.rim.material as THREE.MeshBasicMaterial).opacity = 0.6 + Math.sin(time * 20) * 0.3;
  }
}
